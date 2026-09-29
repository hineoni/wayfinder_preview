import { planBaseline } from './baseline'
import { checkAppend, cursorAfter, startCursor } from './constraints'
import { PRIORITIES, type Engineer, type Order, type PlanInput } from './contracts'
import { compareObjective, computeMetrics, type Objective } from './metrics'
import type { OptimizedPlanResult, Plan, Route, UnassignedOrder } from './plan'
import { buildRoute } from './route'

export interface OptimizationOptions {
  /** Максимум пересчётов полного расписания одного изменённого маршрута. */
  readonly candidateCheckBudget?: number
  /** Максимум принятых улучшающих ходов; по умолчанию поиск идёт до локального оптимума. */
  readonly localSearchPasses?: number
  /** Для остаточного планирования: сохранять прежние назначения раньше сокращения пробега. */
  readonly stability?: {
    readonly reference: Plan
    readonly startShiftThresholdMin?: number
  }
}

/** Хватает для сходимости на трёх территориях с запасом: до ~620 тыс. проверок на Юго-востоке. */
export const DEFAULT_CANDIDATE_CHECK_BUDGET = 1_000_000
export const DEFAULT_LOCAL_SEARCH_PASSES = Number.POSITIVE_INFINITY

export interface PlanState {
  readonly routes: readonly (readonly Order[])[]
  readonly built: readonly Route[]
  readonly unassigned: readonly Order[]
}

type State = PlanState

class Search {
  checks = 0
  exhausted = false
  constructor(
    readonly input: PlanInput,
    readonly budget: number,
    readonly stability: OptimizationOptions['stability'],
  ) {}

  better(a: State, b: State): boolean {
    return compareObjective(objective(a, this.stability), objective(b, this.stability)) < 0
  }

  canBuild(count = 1): boolean {
    if (this.checks + count <= this.budget) return true
    this.exhausted = true
    return false
  }

  build(engineer: Engineer, orders: readonly Order[]): Route | undefined {
    if (!this.canBuild()) return undefined
    this.checks += 1
    return buildRoute(engineer, orders, this.input.travel).route
  }
}

export function planOptimized(
  input: PlanInput,
  options: OptimizationOptions = {},
): OptimizedPlanResult {
  const budget = Math.max(
    0,
    Math.floor(options.candidateCheckBudget ?? DEFAULT_CANDIDATE_CHECK_BUDGET),
  )
  const passes = Math.max(0, Math.floor(options.localSearchPasses ?? DEFAULT_LOCAL_SEARCH_PASSES))
  const search = new Search(input, budget, options.stability)
  const baseline = planBaseline(input)
  let best =
    stateFromReference(input, options.stability?.reference, search) ??
    stateFromPlan(input, baseline)
  const orders = input.orders.map((order, index) => ({ order, index }))
  const compatibleCount = (order: Order) =>
    input.engineers.filter(
      (engineer) =>
        engineer.skills.includes(order.skill) &&
        (order.transport === undefined || order.transport === engineer.transport),
    ).length
  const orderings = [
    orders.toSorted(
      (a, b) =>
        PRIORITIES.indexOf(a.order.priority) - PRIORITIES.indexOf(b.order.priority) ||
        a.order.window.end - b.order.window.end ||
        a.index - b.index,
    ),
    orders.toSorted((a, b) => a.order.window.end - b.order.window.end || a.index - b.index),
    orders.toSorted(
      (a, b) =>
        compatibleCount(a.order) - compatibleCount(b.order) ||
        a.order.window.end - a.order.window.start - (b.order.window.end - b.order.window.start) ||
        a.index - b.index,
    ),
  ]
  for (const ordering of orderings) {
    const candidate = construct(
      input,
      ordering.map((item) => item.order),
      search,
    )
    if (search.better(candidate, best)) best = candidate
    if (search.exhausted) break
  }
  for (let pass = 0; pass < passes && !search.exhausted; pass += 1) {
    const improved = improveOnce(input, best, search)
    if (improved === undefined) break
    best = improved
  }
  const provenInfeasible = proveUnassigned(input, best, search)
  const plan = finalizePlan(input, best, provenInfeasible)
  return {
    plan,
    search: { candidateChecks: search.checks, budget, budgetExhausted: search.exhausted },
  }
}

function construct(input: PlanInput, orders: readonly Order[], search: Search): State {
  let state = emptyState(input)
  for (const order of orders) {
    const inserted = bestInsertion(input, state, order, search)
    state = inserted ?? { ...state, unassigned: [...state.unassigned, order] }
    if (search.exhausted) {
      const remaining = orders.slice(orders.indexOf(order) + 1)
      return { ...state, unassigned: [...state.unassigned, ...remaining] }
    }
  }
  return state
}

function emptyState(input: PlanInput): State {
  return {
    routes: input.engineers.map(() => []),
    built: input.engineers.map((engineer) => buildRoute(engineer, [], input.travel).route!),
    unassigned: [],
  }
}

function bestInsertion(
  input: PlanInput,
  state: State,
  order: Order,
  search: Search,
  excludedRoute = -1,
): State | undefined {
  let best: State | undefined
  for (let routeIndex = 0; routeIndex < state.routes.length; routeIndex += 1) {
    if (routeIndex === excludedRoute) continue
    const engineer = input.engineers[routeIndex]!
    if (!engineer.skills.includes(order.skill)) continue
    if (order.transport !== undefined && order.transport !== engineer.transport) continue
    const route = state.routes[routeIndex]!
    for (let position = 0; position <= route.length; position += 1) {
      if (!search.canBuild()) return best
      const orders = [...route.slice(0, position), order, ...route.slice(position)]
      const built = search.build(engineer, orders)
      if (built === undefined) continue
      const candidate = replaceRoute(state, routeIndex, orders, built, order.id)
      if (best === undefined || search.better(candidate, best)) best = candidate
    }
  }
  return best
}

function improveOnce(input: PlanInput, state: State, search: Search): State | undefined {
  const reinserted = reinsertUnassigned(input, state, search)
  if (search.better(reinserted, state)) return reinserted
  if (!search.canBuild()) return undefined
  const freed = freeRoute(input, state, search)
  if (freed !== undefined) return freed
  for (let from = 0; from < state.routes.length; from += 1) {
    for (let index = 0; index < state.routes[from]!.length; index += 1) {
      if (!search.canBuild()) return undefined
      const order = state.routes[from]![index]!
      const remaining = state.routes[from]!.filter((_, i) => i !== index)
      const sourceBuilt = search.build(input.engineers[from]!, remaining)
      if (sourceBuilt === undefined) continue
      const removed = replaceRoute(state, from, remaining, sourceBuilt)
      const moved = bestInsertion(input, removed, order, search, from)
      if (moved !== undefined && search.better(moved, state)) return moved
    }
  }
  for (let a = 0; a < state.routes.length; a += 1) {
    for (let b = a + 1; b < state.routes.length; b += 1) {
      for (let i = 0; i < state.routes[a]!.length; i += 1) {
        for (let j = 0; j < state.routes[b]!.length; j += 1) {
          if (!search.canBuild(2)) return undefined
          const ar = [...state.routes[a]!]
          const br = [...state.routes[b]!]
          ;[ar[i], br[j]] = [br[j]!, ar[i]!]
          const ab = search.build(input.engineers[a]!, ar)
          const bb = search.build(input.engineers[b]!, br)
          if (ab === undefined || bb === undefined) continue
          const candidate = replaceRoute(replaceRoute(state, a, ar, ab), b, br, bb)
          if (search.better(candidate, state)) return candidate
        }
      }
    }
  }
  for (let routeIndex = 0; routeIndex < state.routes.length; routeIndex += 1) {
    const route = state.routes[routeIndex]!
    for (let start = 0; start < route.length - 1; start += 1) {
      for (let end = start + 1; end < route.length; end += 1) {
        if (!search.canBuild()) return undefined
        const reversed = [
          ...route.slice(0, start),
          ...route.slice(start, end + 1).toReversed(),
          ...route.slice(end + 1),
        ]
        const built = search.build(input.engineers[routeIndex]!, reversed)
        if (built === undefined) continue
        const candidate = replaceRoute(state, routeIndex, reversed, built)
        if (search.better(candidate, state)) return candidate
      }
    }
  }
  return undefined
}

function freeRoute(input: PlanInput, state: State, search: Search): State | undefined {
  for (let source = state.routes.length - 1; source >= 0; source -= 1) {
    if (!search.canBuild()) return undefined
    if (state.routes[source]!.length === 0) continue
    let candidate = replaceRoute(
      state,
      source,
      [],
      buildRoute(input.engineers[source]!, [], input.travel).route!,
    )
    let possible = true
    for (const order of state.routes[source]!) {
      const inserted = bestInsertion(input, candidate, order, search, source)
      if (inserted === undefined) {
        possible = false
        break
      }
      candidate = inserted
    }
    if (possible && search.better(candidate, state)) return candidate
  }
  return undefined
}

function reinsertUnassigned(input: PlanInput, state: State, search: Search): State {
  let result = state
  for (const order of state.unassigned) {
    if (!search.canBuild()) break
    const inserted = bestInsertion(input, result, order, search)
    if (inserted !== undefined) result = inserted
  }
  return result
}

function replaceRoute(
  state: State,
  index: number,
  orders: readonly Order[],
  route: Route,
  assignedOrderId?: string,
): State {
  return {
    routes: state.routes.map((value, i) => (i === index ? orders : value)),
    built: state.built.map((value, i) => (i === index ? route : value)),
    unassigned:
      assignedOrderId === undefined
        ? state.unassigned
        : state.unassigned.filter((order) => order.id !== assignedOrderId),
  }
}

function objective(state: State, stability: OptimizationOptions['stability']): Objective {
  return [
    state.unassigned.filter((order) => order.priority === 'emergency').length,
    state.unassigned.filter((order) => order.priority === 'connection').length,
    state.unassigned.length,
    stability === undefined
      ? state.routes.filter((route) => route.length > 0).length
      : disruptionCount(state, stability),
    state.built.reduce((sum, route) => sum + route.distanceM, 0),
  ]
}

function disruptionCount(
  state: State,
  stability: NonNullable<OptimizationOptions['stability']>,
): number {
  const threshold = stability.startShiftThresholdMin ?? 15
  const eligible = new Set([
    ...state.routes.flatMap((route) => route.map((order) => order.id)),
    ...state.unassigned.map((order) => order.id),
  ])
  const previous = new Map(
    [...planAssignments(stability.reference)].filter(([orderId]) => eligible.has(orderId)),
  )
  const current = new Map(
    state.built.flatMap((route) =>
      route.visits.map(
        (visit, position) =>
          [
            visit.orderId,
            { engineerId: route.engineerId, startMin: visit.startMin, position },
          ] as const,
      ),
    ),
  )
  const affected = new Set<string>()
  for (const [orderId, before] of previous) {
    const after = current.get(orderId)
    if (
      after === undefined ||
      after.engineerId !== before.engineerId ||
      Math.abs(after.startMin - before.startMin) > threshold
    ) {
      affected.add(orderId)
    }
  }
  markReordered(previous, current, affected)
  return affected.size
}

interface StableAssignment {
  readonly engineerId: string
  readonly startMin: number
  readonly position: number
}

function planAssignments(plan: Plan): Map<string, StableAssignment> {
  return new Map(
    plan.routes.flatMap((route) =>
      route.visits.map(
        (visit, position) =>
          [
            visit.orderId,
            { engineerId: route.engineerId, startMin: visit.startMin, position },
          ] as const,
      ),
    ),
  )
}

function markReordered(
  previous: ReadonlyMap<string, StableAssignment>,
  current: ReadonlyMap<string, StableAssignment>,
  affected: Set<string>,
): void {
  const entries = [...previous.entries()]
  for (let left = 0; left < entries.length; left += 1) {
    const [leftId, leftBefore] = entries[left]!
    const leftAfter = current.get(leftId)
    if (leftAfter === undefined || leftAfter.engineerId !== leftBefore.engineerId) continue
    for (let right = left + 1; right < entries.length; right += 1) {
      const [rightId, rightBefore] = entries[right]!
      const rightAfter = current.get(rightId)
      if (
        rightAfter === undefined ||
        rightBefore.engineerId !== leftBefore.engineerId ||
        rightAfter.engineerId !== leftAfter.engineerId
      ) {
        continue
      }
      if (
        Math.sign(leftBefore.position - rightBefore.position) !==
        Math.sign(leftAfter.position - rightAfter.position)
      ) {
        affected.add(leftId)
        affected.add(rightId)
      }
    }
  }
}

function stateFromReference(
  input: PlanInput,
  reference: Plan | undefined,
  search: Search,
): State | undefined {
  if (reference === undefined) return undefined
  const orders = new Map(input.orders.map((order) => [order.id, order]))
  const assigned = new Set<string>()
  const routes: Order[][] = []
  const built: Route[] = []
  for (const engineer of input.engineers) {
    const referenceRoute = reference.routes.find((route) => route.engineerId === engineer.id)
    const routeOrders =
      referenceRoute?.visits.flatMap((visit) => {
        const order = orders.get(visit.orderId)
        return order === undefined ? [] : [order]
      }) ?? []
    const route = search.build(engineer, routeOrders)
    if (route === undefined) return undefined
    routes.push(routeOrders)
    built.push(route)
    for (const order of routeOrders) assigned.add(order.id)
  }
  return {
    routes,
    built,
    unassigned: input.orders.filter((order) => !assigned.has(order.id)),
  }
}

function stateFromPlan(input: PlanInput, plan: Plan): State {
  const orders = new Map(input.orders.map((order) => [order.id, order]))
  return {
    routes: plan.routes.map((route) => route.visits.map((visit) => orders.get(visit.orderId)!)),
    built: plan.routes,
    unassigned: plan.unassigned.map((item) => orders.get(item.orderId)!),
  }
}

export function finalizePlan(
  input: PlanInput,
  state: PlanState,
  provenInfeasible: ReadonlySet<string> = new Set(),
): Plan {
  const unassigned = state.unassigned.map((order) =>
    describeUnassigned(input, state, order, provenInfeasible.has(order.id)),
  )
  const ordersById = new Map(input.orders.map((order) => [order.id, order]))
  return {
    kind: 'optimized',
    routes: state.built,
    unassigned,
    metrics: computeMetrics(state.built, unassigned, ordersById),
  }
}

function describeUnassigned(
  input: PlanInput,
  state: State,
  order: Order,
  provenInfeasible: boolean,
): UnassignedOrder {
  let withSkill = 0
  let withSkillAndTransport = 0
  let approximate = false
  const rejections = input.engineers.flatMap((engineer, index) => {
    const hasSkill = engineer.skills.includes(order.skill)
    const hasTransport = order.transport === undefined || order.transport === engineer.transport
    if (hasSkill) withSkill += 1
    if (hasSkill && hasTransport) withSkillAndTransport += 1
    const route = state.built[index]!
    const last = route.visits.at(-1)
    const cursor =
      last === undefined ? startCursor(engineer) : cursorAfter(last, orderById(input, last.orderId))
    const check = checkAppend(engineer, cursor, order, input.travel)
    if (check.ok) return []
    approximate ||= check.rejection.approximate === true
    return [check.rejection]
  })
  return {
    orderId: order.id,
    class:
      withSkillAndTransport === 0
        ? 'incompatible'
        : provenInfeasible
          ? 'infeasible-in-plan'
          : 'search-limit',
    withSkill,
    withSkillAndTransport,
    rejections,
    approximate,
  }
}

function proveUnassigned(input: PlanInput, state: State, search: Search): ReadonlySet<string> {
  const proven = new Set<string>()
  for (const order of state.unassigned) {
    const compatible = input.engineers.some(
      (engineer) =>
        engineer.skills.includes(order.skill) &&
        (order.transport === undefined || order.transport === engineer.transport),
    )
    if (!compatible) continue
    let fits = false
    let complete = true
    for (let routeIndex = 0; routeIndex < state.routes.length && !fits; routeIndex += 1) {
      const engineer = input.engineers[routeIndex]!
      if (!engineer.skills.includes(order.skill)) continue
      if (order.transport !== undefined && order.transport !== engineer.transport) continue
      const route = state.routes[routeIndex]!
      for (let position = 0; position <= route.length; position += 1) {
        if (!search.canBuild()) {
          complete = false
          break
        }
        const built = search.build(engineer, [
          ...route.slice(0, position),
          order,
          ...route.slice(position),
        ])
        if (built !== undefined) {
          fits = true
          break
        }
        if (search.exhausted) {
          complete = false
          break
        }
      }
      if (!complete) break
    }
    if (complete && !fits) proven.add(order.id)
  }
  return proven
}

function orderById(input: PlanInput, id: string): Order {
  return input.orders.find((order) => order.id === id)!
}

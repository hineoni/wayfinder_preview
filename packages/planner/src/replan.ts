import type { Engineer, EquipmentStock, Minute, Order, PlanInput } from './contracts'
import { planOptimized, type OptimizationOptions } from './optimized'
import type { Plan, SearchStats, Visit } from './plan'
import { validatePlan, type Violation } from './validator'
import { buildRoute } from './route'
import { finalizePlan } from './optimized'

export type ConfirmedOrderStatus = 'completed'

export interface OrderFact {
  readonly orderId: string
  readonly status: ConfirmedOrderStatus
}

export interface UrgentOrderEvent {
  readonly kind: 'urgent-order'
  readonly atMin: Minute
  readonly order: Order
}

export interface CancelOrderEvent {
  readonly kind: 'cancel-order'
  readonly atMin: Minute
  readonly orderId: string
}

export interface EngineerUnavailableEvent {
  readonly kind: 'engineer-unavailable'
  readonly atMin: Minute
  readonly engineerId: string
}

export type PlanningEvent = UrgentOrderEvent | CancelOrderEvent | EngineerUnavailableEvent

export type HistoryState =
  | 'completed'
  | 'en-route'
  | 'waiting'
  | 'in-progress'
  | 'cancelled-en-route'
  | 'cancelled-waiting'
  | 'cancelled-in-progress'
  | 'interrupted'
  | 'interrupted-en-route'
  | 'interrupted-waiting'

export interface ReplanHistoryVisit {
  readonly recordedAtMin?: number
  readonly engineerId: string
  readonly state: HistoryState
  readonly visit: Visit
  /** Только для прерванного переезда: оценка пройденного расстояния пропорционально времени. */
  readonly estimatedTravelledDistanceM?: number
}

export type PlanChangeKind =
  | 'new-assignment'
  | 'new-unassigned'
  | 'engineer-changed'
  | 'time-changed'
  | 'unassigned'
  | 'reordered'
  | 'cancelled'
  | 'interrupted'

export interface PlanChange {
  readonly orderId: string
  readonly kind: PlanChangeKind
  readonly previousEngineerId?: string
  readonly engineerId?: string
  readonly previousStartMin?: Minute
  readonly startMin?: Minute
  readonly reason?: 'replan-no-feasible-assignment'
  readonly timeChanged?: true
  readonly reordered?: true
}

export interface EquipmentBalance {
  readonly engineerId: string
  /** Фактический остаток после работ, начатых к моменту события. */
  readonly actualAtEvent: EquipmentStock
  /** Доступно новому плану после резерва уже начатых переездов и ожиданий. */
  readonly availableAfterCommitments: EquipmentStock
  readonly afterPlan: EquipmentStock
}

export interface ReplanContinuation {
  readonly engineerId: string
  readonly pointId: string
  readonly freeAtMin: Minute
}

export interface ReplanDayMetrics {
  readonly assigned: number
  readonly unassigned: number
  readonly engineersUsed: number
  readonly historyDistanceM: number
  readonly remainingDistanceM: number
  readonly distanceM: number
}

export interface ReplanResult {
  readonly checkpoint?: {
    readonly orders: readonly Order[]
    readonly engineers: readonly Engineer[]
    readonly plan: Plan
  }
  readonly promiseConflicts?: readonly string[]
  readonly plan: Plan
  readonly event: PlanningEvent
  readonly history: readonly ReplanHistoryVisit[]
  readonly changes: readonly PlanChange[]
  readonly affectedOrderCount: number
  readonly equipment: readonly EquipmentBalance[]
  readonly continuations: readonly ReplanContinuation[]
  readonly dayMetrics: ReplanDayMetrics
  readonly search: SearchStats
  readonly violations: readonly Violation[]
}

export interface ReplanOptions extends OptimizationOptions {
  readonly startShiftThresholdMin?: number
  readonly promises?: Readonly<Record<string, number>>
  readonly originalOrders?: readonly Order[]
}

/**
 * Строит остаток дня после подготовленной аварии. Завершение никогда не выводится из часов плана:
 * каждый визит, закончившийся к событию, должен быть явно подтверждён фактом.
 */
export function replanForUrgentOrder(
  input: PlanInput,
  previousPlan: Plan,
  event: UrgentOrderEvent,
  facts: readonly OrderFact[],
  options: ReplanOptions = {},
): ReplanResult {
  return replanAfterEvent(input, previousPlan, event, facts, options)
}

/** Перестраивает остаток дня после аварии, отмены заявки или недоступности инженера. */
export function replanAfterEvent(
  input: PlanInput,
  previousPlan: Plan,
  event: PlanningEvent,
  facts: readonly OrderFact[],
  options: ReplanOptions = {},
): ReplanResult {
  const previousViolations = validatePlan(input, previousPlan)
  if (previousViolations.length > 0) {
    throw new Error(`Исходный план нарушает модель: ${previousViolations.length}`)
  }
  if (event.kind === 'urgent-order') {
    if (input.orders.some((order) => order.id === event.order.id)) {
      throw new Error(`Заявка события ${event.order.id} уже есть в сценарии`)
    }
    if (event.order.availableFromMin !== event.atMin) {
      throw new Error('Время доступности аварии должно совпадать со временем события')
    }
  } else if (event.kind === 'cancel-order') {
    if (!input.orders.some((order) => order.id === event.orderId)) {
      throw new Error(`Отмена ссылается на неизвестную заявку ${event.orderId}`)
    }
  } else if (!input.engineers.some((engineer) => engineer.id === event.engineerId)) {
    throw new Error(`Недоступность ссылается на неизвестного инженера ${event.engineerId}`)
  }
  const factsByOrder = new Map<string, ConfirmedOrderStatus>()
  for (const fact of facts) {
    if (factsByOrder.has(fact.orderId)) throw new Error(`Повтор факта по заявке ${fact.orderId}`)
    factsByOrder.set(fact.orderId, fact.status)
  }
  const ordersById = new Map(input.orders.map((order) => [order.id, order]))
  const history: ReplanHistoryVisit[] = []
  const retained = new Set<string>()
  const residuals = input.engineers.map((engineer) =>
    residualEngineer(
      engineer,
      previousPlan.routes.find((route) => route.engineerId === engineer.id)?.visits ?? [],
      ordersById,
      factsByOrder,
      event.atMin,
      event,
      history,
      retained,
    ),
  )
  const engineers = residuals
    .filter(
      (item) => event.kind !== 'engineer-unavailable' || item.engineer.id !== event.engineerId,
    )
    .map((item) => item.engineer)
  if (
    event.kind === 'cancel-order' &&
    history.some((item) => item.visit.orderId === event.orderId && item.state === 'completed')
  ) {
    throw new Error(`Нельзя отменить уже выполненную заявку ${event.orderId}`)
  }
  for (const fact of facts) {
    if (!ordersById.has(fact.orderId))
      throw new Error(`Факт ссылается на неизвестную заявку ${fact.orderId}`)
    if (
      !history.some((item) => item.state === 'completed' && item.visit.orderId === fact.orderId)
    ) {
      throw new Error(`Заявка ${fact.orderId} не завершилась к моменту события`)
    }
  }
  const residualInput: PlanInput = {
    orders: [
      ...input.orders.filter(
        (order) =>
          !retained.has(order.id) && (event.kind !== 'cancel-order' || order.id !== event.orderId),
      ),
      ...(event.kind === 'urgent-order' ? [event.order] : []),
    ].map((order) => {
      const original = options.originalOrders?.find((o) => o.id === order.id) ?? order
      const promised = options.promises?.[order.id]
      return {
        ...order,
        window: promised === undefined ? original.window : { start: promised, end: promised },
      }
    }),
    engineers,
    travel: input.travel,
  }
  const threshold = options.startShiftThresholdMin ?? 15
  const optimized = planOptimized(residualInput, {
    ...(options.candidateCheckBudget === undefined
      ? {}
      : { candidateCheckBudget: options.candidateCheckBudget }),
    ...(options.localSearchPasses === undefined
      ? {}
      : { localSearchPasses: options.localSearchPasses }),
    stability: { reference: previousPlan, startShiftThresholdMin: threshold },
  })
  const violations = validatePlan(residualInput, optimized.plan)
  const excludedOrderId =
    event.kind === 'urgent-order'
      ? event.order.id
      : event.kind === 'cancel-order'
        ? event.orderId
        : undefined
  const changes = describeChanges(previousPlan, optimized.plan, excludedOrderId)
  if (event.kind === 'cancel-order') {
    changes.unshift({ orderId: event.orderId, kind: 'cancelled' })
  } else if (event.kind === 'engineer-unavailable') {
    for (const item of history.filter(
      (entry) => entry.engineerId === event.engineerId && entry.state === 'interrupted',
    )) {
      changes.unshift({ orderId: item.visit.orderId, kind: 'interrupted' })
    }
  }
  const affectedOrderCount = new Set(
    changes
      .filter(
        (change) =>
          change.orderId !== excludedOrderId &&
          change.kind !== 'cancelled' &&
          (change.reordered === true ||
            change.kind !== 'time-changed' ||
            Math.abs((change.startMin ?? 0) - (change.previousStartMin ?? 0)) > threshold),
      )
      .map((change) => change.orderId),
  ).size
  const historyDistanceM = history.reduce(
    (sum, item) => sum + (item.estimatedTravelledDistanceM ?? item.visit.travel.distanceM),
    0,
  )
  const usedEngineers = new Set([
    ...history.map((item) => item.engineerId),
    ...optimized.plan.routes
      .filter((route) => route.visits.length > 0)
      .map((route) => route.engineerId),
  ])
  return {
    checkpoint: makeCheckpoint(input, previousPlan, residualInput, optimized.plan, history),
    promiseConflicts: Object.keys(options.promises ?? {}).filter(
      (id) =>
        residualInput.orders.some((o) => o.id === id) &&
        optimized.plan.unassigned.some((o) => o.orderId === id),
    ),
    plan: optimized.plan,
    event,
    history,
    changes,
    affectedOrderCount,
    equipment: residuals.map(({ engineer, actualAtEvent }) => {
      const last = optimized.plan.routes
        .find((route) => route.engineerId === engineer.id)
        ?.visits.at(-1)
      return {
        engineerId: engineer.id,
        actualAtEvent,
        availableAfterCommitments: engineer.equipment,
        afterPlan: last?.equipmentRemaining ?? engineer.equipment,
      }
    }),
    continuations: engineers.map((engineer) => ({
      engineerId: engineer.id,
      pointId: engineer.startPointId,
      freeAtMin: engineer.shift.start,
    })),
    dayMetrics: {
      assigned:
        history.filter(
          (item) =>
            item.state === 'completed' ||
            item.state === 'en-route' ||
            item.state === 'waiting' ||
            item.state === 'in-progress',
        ).length + optimized.plan.routes.reduce((sum, route) => sum + route.visits.length, 0),
      unassigned: optimized.plan.metrics.unassignedTotal,
      engineersUsed: usedEngineers.size,
      historyDistanceM,
      remainingDistanceM: optimized.plan.metrics.distanceM,
      distanceM: historyDistanceM + optimized.plan.metrics.distanceM,
    },
    search: optimized.search,
    violations,
  }
}

function residualEngineer(
  engineer: Engineer,
  visits: readonly Visit[],
  ordersById: ReadonlyMap<string, Order>,
  facts: ReadonlyMap<string, ConfirmedOrderStatus>,
  atMin: Minute,
  event: PlanningEvent,
  history: ReplanHistoryVisit[],
  retained: Set<string>,
): { readonly engineer: Engineer; readonly actualAtEvent: EquipmentStock } {
  let startPointId = engineer.startPointId
  let freeAtMin = Math.max(atMin, engineer.shift.start)
  let equipment = engineer.equipment
  let actualAtEvent = engineer.equipment
  let deferFirstDeparture = engineer.deferFirstDeparture !== false
  for (const visit of visits) {
    const order = ordersById.get(visit.orderId)
    if (order === undefined) continue
    const fact = facts.get(order.id)
    const departureMin = visit.arrivalMin - visit.travel.durationMin
    const isCancelled = event.kind === 'cancel-order' && event.orderId === order.id
    const isUnavailable = event.kind === 'engineer-unavailable' && event.engineerId === engineer.id
    let state: HistoryState | undefined
    if (visit.endMin <= atMin) {
      if (fact !== 'completed') {
        throw new Error(`Подтвердите выполнение заявки ${order.id} до перепланирования`)
      }
      state = 'completed'
    } else if (departureMin < atMin) {
      state =
        visit.startMin <= atMin ? 'in-progress' : visit.arrivalMin <= atMin ? 'waiting' : 'en-route'
    }
    if (isCancelled && state !== 'completed') {
      state =
        state === 'in-progress'
          ? 'cancelled-in-progress'
          : state === 'waiting'
            ? 'cancelled-waiting'
            : state === 'en-route'
              ? 'cancelled-en-route'
              : undefined
    } else if (isUnavailable && state === 'in-progress') {
      state = 'interrupted'
    } else if (isUnavailable && state === 'en-route') {
      state = 'interrupted-en-route'
    } else if (isUnavailable && state === 'waiting') {
      state = 'interrupted-waiting'
    }
    if (state === undefined) continue
    deferFirstDeparture = false
    history.push({
      recordedAtMin: atMin,
      engineerId: engineer.id,
      state,
      visit,
      ...(state === 'interrupted-en-route'
        ? {
            estimatedTravelledDistanceM: Math.round(
              (visit.travel.distanceM * (atMin - departureMin)) / visit.travel.durationMin,
            ),
          }
        : {}),
    })
    // История перемещения не удерживает заявку и не резервирует неначатую работу.
    if (state === 'interrupted-en-route' || state === 'interrupted-waiting') continue
    if (state !== 'interrupted') retained.add(order.id)
    startPointId = order.pointId
    freeAtMin =
      state === 'cancelled-en-route'
        ? Math.max(atMin, visit.arrivalMin)
        : state === 'cancelled-waiting' || state === 'cancelled-in-progress'
          ? atMin
          : Math.max(atMin, visit.endMin)
    equipment =
      state === 'cancelled-en-route' || state === 'cancelled-waiting'
        ? equipment
        : visit.equipmentRemaining
    if (
      state === 'completed' ||
      state === 'in-progress' ||
      state === 'cancelled-in-progress' ||
      state === 'interrupted'
    ) {
      actualAtEvent = consumeEquipment(actualAtEvent, order.equipment)
    }
  }
  return {
    engineer: {
      ...engineer,
      startPointId,
      deferFirstDeparture,
      shift: { start: freeAtMin, end: engineer.shift.end },
      equipment,
    },
    actualAtEvent,
  }
}

/** Снимок для следующего события: незавершённые обязательства остаются проверяемым префиксом. */
function makeCheckpoint(
  input: PlanInput,
  previous: Plan,
  residual: PlanInput,
  plan: Plan,
  history: readonly ReplanHistoryVisit[],
) {
  const pending = history.filter(
    (h) => h.state === 'en-route' || h.state === 'waiting' || h.state === 'in-progress',
  )
  const orders = [
    ...input.orders.filter((o) => pending.some((h) => h.visit.orderId === o.id)),
    ...residual.orders,
  ]
  const byId = new Map(orders.map((o) => [o.id, o]))
  const engineers = residual.engineers.map((e) => {
    const prefix = pending.find((h) => h.engineerId === e.id)
    if (prefix === undefined) return e
    const original = input.engineers.find((item) => item.id === e.id)!
    const visits = previous.routes.find((r) => r.engineerId === e.id)!.visits
    const index = visits.findIndex((v) => v.orderId === prefix.visit.orderId)
    const before = visits[index - 1]
    return {
      ...e,
      startPointId:
        before === undefined
          ? original.startPointId
          : input.orders.find((o) => o.id === before.orderId)!.pointId,
      shift: { start: prefix.visit.arrivalMin - prefix.visit.travel.durationMin, end: e.shift.end },
      // Зафиксированный переезд нельзя сдвигать при восстановлении префикса дня.
      deferFirstDeparture: false,
      equipment: before?.equipmentRemaining ?? original.equipment,
    }
  })
  const routes = engineers.map((e) => [
    ...pending.filter((h) => h.engineerId === e.id).map((h) => byId.get(h.visit.orderId)!),
    ...(plan.routes.find((r) => r.engineerId === e.id)?.visits ?? []).map((v) =>
      byId.get(v.orderId)!,
    ),
  ])
  const built = engineers.map((e, i) => buildRoute(e, routes[i]!, input.travel).route!)
  if (built.some((r) => r === undefined))
    throw new Error('Не удалось сохранить продолжение рабочего дня')
  const nextInput = { ...input, orders, engineers }
  const nextPlan = finalizePlan(nextInput, {
    routes,
    built,
    unassigned: orders.filter((o) => plan.unassigned.some((u) => u.orderId === o.id)),
  })
  if (validatePlan(nextInput, nextPlan).length)
    throw new Error('Продолжение дня не прошло независимую проверку')
  return { orders, engineers, plan: nextPlan }
}

/** Следующее событие сохраняет накопленные факты, складские остатки и время прошлых прерываний. */
export function continuePlanningDay(
  input: PlanInput,
  previous: ReplanResult,
  event: PlanningEvent,
  facts: readonly OrderFact[],
  options: ReplanOptions = {},
): ReplanResult {
  if (event.atMin < previous.event.atMin)
    throw new Error('Событие не может предшествовать предыдущему')
  const checkpoint = previous.checkpoint
  if (checkpoint === undefined) throw new Error('Отсутствует продолжение дня')
  const usedIds = new Set([
    ...input.orders.map((o) => o.id),
    ...previous.history.map((h) => h.visit.orderId),
  ])
  if (event.kind === 'urgent-order' && usedIds.has(event.order.id))
    throw new Error('ID аварии уже использован в этом дне')
  const next = replanAfterEvent(
    { ...checkpoint, travel: input.travel },
    checkpoint.plan,
    event,
    facts,
    { ...options, originalOrders: input.orders },
  )
  const archived = previous.history
    .filter((h) => h.state !== 'en-route' && h.state !== 'waiting' && h.state !== 'in-progress')
    .map((h): ReplanHistoryVisit => {
      if (
        h.state !== 'cancelled-en-route' ||
        event.kind !== 'engineer-unavailable' ||
        h.engineerId !== event.engineerId ||
        h.visit.arrivalMin <= event.atMin
      )
        return h
      const departure = h.visit.arrivalMin - h.visit.travel.durationMin
      return {
        ...h,
        state: 'interrupted-en-route',
        recordedAtMin: event.atMin,
        estimatedTravelledDistanceM: Math.round(
          (h.visit.travel.distanceM * (event.atMin - departure)) / h.visit.travel.durationMin,
        ),
      }
    })
  const history = [...archived, ...next.history]
  const historyDistanceM = history.reduce(
    (sum, h) => sum + (h.estimatedTravelledDistanceM ?? h.visit.travel.distanceM),
    0,
  )
  const assigned = new Set([
    ...history
      .filter((h) => ['completed', 'en-route', 'waiting', 'in-progress'].includes(h.state))
      .map((h) => h.visit.orderId),
    ...next.plan.routes.flatMap((r) => r.visits.map((v) => v.orderId)),
  ])
  const used = new Set([
    ...history.map((h) => h.engineerId),
    ...next.plan.routes.filter((r) => r.visits.length).map((r) => r.engineerId),
  ])
  return {
    ...next,
    history,
    equipment: [
      ...previous.equipment.filter(
        (e) => !next.equipment.some((n) => n.engineerId === e.engineerId),
      ),
      ...next.equipment,
    ],
    dayMetrics: {
      ...next.dayMetrics,
      assigned: assigned.size,
      engineersUsed: used.size,
      historyDistanceM,
      distanceM: historyDistanceM + next.plan.metrics.distanceM,
    },
  }
}

function describeChanges(previous: Plan, current: Plan, eventOrderId?: string): PlanChange[] {
  const eligible = new Set([
    ...current.routes.flatMap((route) => route.visits.map((visit) => visit.orderId)),
    ...current.unassigned.map((item) => item.orderId),
  ])
  if (eventOrderId !== undefined) eligible.delete(eventOrderId)
  const before = assignmentIndex(previous, eligible)
  const after = assignmentIndex(current, eligible)
  const reordered = reorderedOrders(before, after)
  const eventAssignment =
    eventOrderId === undefined ? undefined : assignmentIndex(current).get(eventOrderId)
  const changes: PlanChange[] = []
  if (eventOrderId !== undefined && eventAssignment !== undefined) {
    changes.push({
      orderId: eventOrderId,
      kind: 'new-assignment',
      engineerId: eventAssignment.engineerId,
      startMin: eventAssignment.startMin,
    })
  }
  for (const [orderId, next] of after) {
    const prior = before.get(orderId)
    const timeChanged = prior !== undefined && prior.startMin !== next.startMin
    const orderChanged = reordered.has(orderId)
    const changeFlags = {
      ...(timeChanged ? { timeChanged: true as const } : {}),
      ...(orderChanged ? { reordered: true as const } : {}),
    }
    if (prior === undefined) {
      changes.push({
        orderId,
        kind: 'new-assignment',
        engineerId: next.engineerId,
        startMin: next.startMin,
        ...changeFlags,
      })
    } else if (prior.engineerId !== next.engineerId) {
      changes.push({
        orderId,
        kind: 'engineer-changed',
        previousEngineerId: prior.engineerId,
        engineerId: next.engineerId,
        previousStartMin: prior.startMin,
        startMin: next.startMin,
        ...changeFlags,
      })
    } else if (timeChanged) {
      changes.push({
        orderId,
        kind: 'time-changed',
        engineerId: next.engineerId,
        previousStartMin: prior.startMin,
        startMin: next.startMin,
        ...changeFlags,
      })
    } else if (orderChanged) {
      changes.push({
        orderId,
        kind: 'reordered',
        engineerId: next.engineerId,
        previousStartMin: prior.startMin,
        startMin: next.startMin,
        ...changeFlags,
      })
    }
  }
  for (const item of current.unassigned) {
    if (item.orderId === eventOrderId)
      changes.push({ orderId: item.orderId, kind: 'new-unassigned' })
    else if (before.has(item.orderId)) {
      const prior = before.get(item.orderId)!
      changes.push({
        orderId: item.orderId,
        kind: 'unassigned',
        previousEngineerId: prior.engineerId,
        previousStartMin: prior.startMin,
        reason: 'replan-no-feasible-assignment',
      })
    }
  }
  return changes
}

function consumeEquipment(stock: EquipmentStock, used: EquipmentStock): EquipmentStock {
  return {
    'emergency-kit': stock['emergency-kit'] - used['emergency-kit'],
    router: stock.router - used.router,
    'tv-box': stock['tv-box'] - used['tv-box'],
    'cable-kit': stock['cable-kit'] - used['cable-kit'],
  }
}

function reorderedOrders(
  before: ReadonlyMap<string, { engineerId: string; relativeIndex: number }>,
  after: ReadonlyMap<string, { engineerId: string; relativeIndex: number }>,
): ReadonlySet<string> {
  const reordered = new Set<string>()
  const entries = [...before.entries()]
  for (let left = 0; left < entries.length; left += 1) {
    const [leftId, leftBefore] = entries[left]!
    const leftAfter = after.get(leftId)
    if (leftAfter === undefined || leftAfter.engineerId !== leftBefore.engineerId) continue
    for (let right = left + 1; right < entries.length; right += 1) {
      const [rightId, rightBefore] = entries[right]!
      const rightAfter = after.get(rightId)
      if (
        rightAfter === undefined ||
        rightBefore.engineerId !== leftBefore.engineerId ||
        rightAfter.engineerId !== leftAfter.engineerId
      ) {
        continue
      }
      if (
        Math.sign(leftBefore.relativeIndex - rightBefore.relativeIndex) !==
        Math.sign(leftAfter.relativeIndex - rightAfter.relativeIndex)
      ) {
        reordered.add(leftId)
        reordered.add(rightId)
      }
    }
  }
  return reordered
}

function assignmentIndex(
  plan: Plan,
  eligible?: ReadonlySet<string>,
): Map<string, { engineerId: string; startMin: Minute; relativeIndex: number }> {
  return new Map(
    plan.routes.flatMap((route) =>
      route.visits
        .filter((visit) => eligible === undefined || eligible.has(visit.orderId))
        .map(
          (visit, relativeIndex) =>
            [
              visit.orderId,
              { engineerId: route.engineerId, startMin: visit.startMin, relativeIndex },
            ] as const,
        ),
    ),
  )
}

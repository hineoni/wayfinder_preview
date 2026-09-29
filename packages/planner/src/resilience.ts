import type { Engineer, Order, PlanInput } from './contracts'
import type { Plan } from './plan'
import { replanAfterEvent } from './replan'
import { buildRoute } from './route'
import { finalizePlan } from './optimized'
import { validatePlan } from './validator'

export interface EmergencyProbe {
  readonly id: string
  readonly pointId: string
  readonly atMin: number
  readonly windowMin: number
}
interface ProbeResult extends EmergencyProbe {
  readonly assigned: boolean
  readonly startMin?: number
  readonly engineerId?: string
  readonly changedOrderIds: readonly string[]
  readonly lostOrderIds: readonly string[]
  readonly withoutDisruption: boolean
  readonly budgetExhausted: boolean
  readonly approximate: boolean
}
export interface ReadinessReport {
  readonly cases: readonly ProbeResult[]
  readonly assigned: number
  readonly withoutDisruption: number
  readonly candidateCheckBudget: number
}

/** Независимые модельные события, а не прогноз вероятностей. Факты завершения моделируются. */
export function assessReadiness(
  input: PlanInput,
  plan: Plan,
  probes: readonly EmergencyProbe[],
  candidateCheckBudget = 2000,
): ReadinessReport {
  const cases = probes.map((probe): ProbeResult => {
    let id = `probe-${probe.id}`
    while (input.orders.some((o) => o.id === id)) id += '-1'
    const order: Order = {
      id,
      pointId: probe.pointId,
      durationMin: 100,
      availableFromMin: probe.atMin,
      window: { start: probe.atMin, end: Math.min(1439, probe.atMin + probe.windowMin) },
      skill: 'emergency',
      priority: 'emergency',
      transport: 'car',
      equipment: { 'emergency-kit': 1, router: 0, 'tv-box': 0, 'cable-kit': 0 },
    }
    const facts = plan.routes.flatMap((r) =>
      r.visits
        .filter((v) => v.endMin <= probe.atMin)
        .map((v) => ({ orderId: v.orderId, status: 'completed' as const })),
    )
    const result = replanAfterEvent(
      input,
      plan,
      { kind: 'urgent-order', atMin: probe.atMin, order },
      facts,
      { candidateCheckBudget },
    )
    if (result.violations.length) throw new Error('Проверочный план нарушает модель')
    const route = result.plan.routes.find((r) => r.visits.some((v) => v.orderId === id))
    const visit = route?.visits.find((v) => v.orderId === id)
    const changedOrderIds = [
      ...new Set(result.changes.filter((c) => c.orderId !== id).map((c) => c.orderId)),
    ]
    const lostOrderIds = result.changes
      .filter((c) => c.kind === 'unassigned' && c.orderId !== id)
      .map((c) => c.orderId)
    return {
      ...probe,
      assigned: visit !== undefined,
      ...(visit === undefined ? {} : { startMin: visit.startMin, engineerId: route!.engineerId }),
      changedOrderIds,
      lostOrderIds,
      withoutDisruption: visit !== undefined && changedOrderIds.length === 0,
      budgetExhausted: result.search.budgetExhausted,
      approximate: result.plan.metrics.approximate,
    }
  })
  return {
    cases,
    assigned: cases.filter((c) => c.assigned).length,
    withoutDisruption: cases.filter((c) => c.withoutDisruption).length,
    candidateCheckBudget,
  }
}

/** Пересчёт тех же назначений и порядка по новым утренним комплектам. */
function rebuildFixedPlan(input: PlanInput, plan: Plan): Plan | undefined {
  const orders = new Map(input.orders.map((o) => [o.id, o]))
  const routes = input.engineers.map((e) =>
    (plan.routes.find((r) => r.engineerId === e.id)?.visits ?? []).map((v) =>
      orders.get(v.orderId)!,
    ),
  )
  const built = input.engineers.map((e, i) => buildRoute(e, routes[i]!, input.travel).route)
  if (built.some((r) => r === undefined)) return undefined
  const assigned = new Set(routes.flatMap((r) => r.map((o) => o.id)))
  const result = finalizePlan(input, {
    routes,
    built: built.filter((r) => r !== undefined),
    unassigned: input.orders.filter((o) => !assigned.has(o.id)),
  })
  return validatePlan(input, result).length ? undefined : result
}

export interface EquipmentPreparation {
  readonly before: ReadinessReport
  readonly after: ReadinessReport
  readonly transfer?: {
    readonly fromEngineerId: string
    readonly toEngineerId: string
    readonly units: 1
  }
  readonly engineers: readonly Engineer[]
  readonly plan: Plan
  readonly checkedTransfers: number
  readonly possibleTransfers: number
}

/** Один перенос аварийного комплекта до выезда. Общий запас и исходные назначения сохраняются. */
export function prepareEmergencyEquipment(
  input: PlanInput,
  plan: Plan,
  probes: readonly EmergencyProbe[],
  maxTransfers = 12,
): EquipmentPreparation {
  const before = assessReadiness(input, plan, probes)
  let best: EquipmentPreparation = {
    before,
    after: before,
    engineers: input.engineers,
    plan,
    checkedTransfers: 0,
    possibleTransfers: 0,
  }
  let checked = 0
  let possible = 0
  for (const from of input.engineers) {
    for (const to of input.engineers) {
      if (
        from.id === to.id ||
        from.equipment['emergency-kit'] < 1 ||
        !to.skills.includes('emergency') ||
        to.transport !== 'car'
      )
        continue
      possible += 1
      if (checked >= maxTransfers) continue
      checked += 1
      const engineers = input.engineers.map((e) =>
        e.id === from.id || e.id === to.id
          ? {
              ...e,
              equipment: {
                ...e.equipment,
                'emergency-kit': e.equipment['emergency-kit'] + (e.id === to.id ? 1 : -1),
              },
            }
          : e,
      )
      const changed = { ...input, engineers }
      const candidate = rebuildFixedPlan(changed, plan)
      if (candidate === undefined) continue
      const after = assessReadiness(changed, candidate, probes)
      // Ни один проверенный случай не должен потерять назначенную аварию или устойчивость.
      const safe = after.cases.every(
        (c, i) =>
          (!before.cases[i]!.assigned || c.assigned) &&
          (!before.cases[i]!.withoutDisruption || c.withoutDisruption) &&
          c.lostOrderIds.length <= before.cases[i]!.lostOrderIds.length,
      )
      if (
        safe &&
        (after.withoutDisruption > best.after.withoutDisruption ||
          (after.withoutDisruption === best.after.withoutDisruption &&
            after.assigned > best.after.assigned))
      )
        best = {
          before,
          after,
          engineers,
          plan: candidate,
          transfer: { fromEngineerId: from.id, toEngineerId: to.id, units: 1 },
          checkedTransfers: checked,
          possibleTransfers: possible,
        }
    }
  }
  return { ...best, checkedTransfers: checked, possibleTransfers: possible }
}

/** Сохраняет порядок маршрута и распространяет задержку, не маскируя нарушения перепланированием. */
export function assessDelay(
  input: PlanInput,
  plan: Plan,
  orderId: string,
  delayMin: number,
  promises: Readonly<Record<string, number>> = {},
) {
  if (![15, 30, 60].includes(delayMin)) throw new Error('Допустимы задержки 15, 30 и 60 минут')
  const route = plan.routes.find((r) => r.visits.some((v) => v.orderId === orderId))
  if (route === undefined) throw new Error('Выберите назначенный визит')
  const engineer = input.engineers.find((e) => e.id === route.engineerId)!
  const orders = new Map(input.orders.map((o) => [o.id, o]))
  let end = engineer.shift.start
  let delayed = false
  return {
    engineerId: route.engineerId,
    orderId,
    delayMin,
    approximate: route.approximate,
    visits: route.visits.flatMap((v) => {
      const order = orders.get(v.orderId)!
      const startMin = Math.max(
        v.startMin,
        end + v.travel.durationMin,
        order.window.start,
        order.availableFromMin,
      )
      if (v.orderId === orderId) delayed = true
      end = startMin + order.durationMin + (v.orderId === orderId ? delayMin : 0)
      return delayed
        ? [
            {
              orderId: v.orderId,
              previousStartMin: v.startMin,
              startMin,
              endMin: end,
              shiftMin: startMin - v.startMin,
              windowMissed: startMin > order.window.end,
              shiftMissed: end > engineer.shift.end,
              promiseMissed: promises[v.orderId] !== undefined && startMin !== promises[v.orderId],
            },
          ]
        : []
    }),
  }
}

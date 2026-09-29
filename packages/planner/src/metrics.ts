import type { Order } from './contracts'
import type { PlanMetrics, Route, UnassignedOrder } from './plan'

export function computeMetrics(
  routes: readonly Route[],
  unassigned: readonly UnassignedOrder[],
  ordersById: ReadonlyMap<string, Order>,
): PlanMetrics {
  let distanceM = 0
  let approximate = false
  let engineersUsed = 0
  const perEngineer = routes.map((route) => {
    distanceM += route.distanceM
    approximate ||= route.approximate
    if (route.visits.length > 0) engineersUsed += 1
    return { engineerId: route.engineerId, distanceM: route.distanceM, visits: route.visits.length }
  })
  let unassignedEmergency = 0
  let unassignedConnection = 0
  for (const item of unassigned) {
    const priority = ordersById.get(item.orderId)?.priority
    if (priority === 'emergency') unassignedEmergency += 1
    if (priority === 'connection') unassignedConnection += 1
    approximate ||= item.approximate
  }
  return {
    unassignedEmergency,
    unassignedConnection,
    unassignedTotal: unassigned.length,
    engineersUsed,
    distanceM,
    approximate,
    perEngineer,
  }
}

/** Лексикографическая цель: (неназначенные аварии, подключения, всего, инженеры, пробег). */
export type Objective = readonly [number, number, number, number, number]

/** Компоненты цели в порядке `Objective`. */
export const OBJECTIVE_COMPONENTS = [
  'unassignedEmergency',
  'unassignedConnection',
  'unassignedTotal',
  'engineersUsed',
  'distanceM',
] as const
export type ObjectiveComponent = (typeof OBJECTIVE_COMPONENTS)[number]

export function objectiveOf(metrics: PlanMetrics): Objective {
  return [
    metrics.unassignedEmergency,
    metrics.unassignedConnection,
    metrics.unassignedTotal,
    metrics.engineersUsed,
    metrics.distanceM,
  ]
}

/** Отрицательное значение: `a` лучше `b`. */
export function compareObjective(a: Objective, b: Objective): number {
  const index = decisiveIndex(a, b)
  return index === -1 ? 0 : a[index]! - b[index]!
}

/** Первая компонента цели, по которой планы различаются; `undefined` при равенстве. */
export function decisiveComponent(a: Objective, b: Objective): ObjectiveComponent | undefined {
  return OBJECTIVE_COMPONENTS[decisiveIndex(a, b)]
}

/** Цикл без замыканий: сравнение вызывается в горячем цикле оптимизатора. */
function decisiveIndex(a: Objective, b: Objective): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return i
  return -1
}

import type { PlanInput } from './contracts'
import { finalizePlan, type PlanState } from './optimized'
import type { Plan, Route } from './plan'
import { buildRoute } from './route'

export type ManualAssignmentFailureCode =
  | 'order-not-found'
  | 'engineer-not-found'
  | 'no-feasible-position'

export type ManualAssignmentResult =
  | {
      readonly ok: true
      readonly plan: Plan
      readonly previousEngineerId?: string
      readonly position: number
    }
  | { readonly ok: false; readonly code: ManualAssignmentFailureCode }

/**
 * Переназначает заявку выбранному инженеру, не меняя порядок остальных визитов.
 * Из допустимых позиций выбирает вариант с наименьшим пробегом выбранного маршрута.
 */
export function assignOrderManually(
  input: PlanInput,
  plan: Plan,
  orderId: string,
  engineerId: string,
): ManualAssignmentResult {
  const order = input.orders.find((candidate) => candidate.id === orderId)
  if (order === undefined) return { ok: false, code: 'order-not-found' }
  const targetIndex = input.engineers.findIndex((candidate) => candidate.id === engineerId)
  if (targetIndex < 0) return { ok: false, code: 'engineer-not-found' }

  const ordersById = new Map(input.orders.map((candidate) => [candidate.id, candidate]))
  const previousEngineerId = plan.routes.find((route) =>
    route.visits.some((visit) => visit.orderId === orderId),
  )?.engineerId
  const routeOrders = input.engineers.map((engineer) =>
    (plan.routes.find((route) => route.engineerId === engineer.id)?.visits ?? []).flatMap(
      (visit) => {
        const candidate = ordersById.get(visit.orderId)
        return candidate === undefined || candidate.id === orderId ? [] : [candidate]
      },
    ),
  )
  const sourceIndex = input.engineers.findIndex((engineer) => engineer.id === previousEngineerId)
  const sourceRoute =
    sourceIndex < 0 || sourceIndex === targetIndex
      ? undefined
      : buildRoute(input.engineers[sourceIndex]!, routeOrders[sourceIndex]!, input.travel).route
  if (sourceIndex >= 0 && sourceIndex !== targetIndex && sourceRoute === undefined) {
    return { ok: false, code: 'no-feasible-position' }
  }
  const target = routeOrders[targetIndex]!
  let best: { readonly route: Route; readonly position: number } | undefined
  for (let position = 0; position <= target.length; position += 1) {
    const built = buildRoute(
      input.engineers[targetIndex]!,
      [...target.slice(0, position), order, ...target.slice(position)],
      input.travel,
    ).route
    if (built !== undefined && (best === undefined || built.distanceM < best.route.distanceM)) {
      best = { route: built, position }
    }
  }
  if (best === undefined) return { ok: false, code: 'no-feasible-position' }

  const built = input.engineers.map((_, index) => {
    if (index === targetIndex) return best.route
    if (index === sourceIndex) return sourceRoute!
    return plan.routes.find((route) => route.engineerId === input.engineers[index]!.id)!
  })
  const assigned = new Set(built.flatMap((route) => route.visits.map((visit) => visit.orderId)))
  const state: PlanState = {
    routes: routeOrders.map((orders, index) =>
      index === targetIndex
        ? orders.slice(0, best.position).concat(order, orders.slice(best.position))
        : orders,
    ),
    built,
    unassigned: input.orders.filter((candidate) => !assigned.has(candidate.id)),
  }
  return {
    ok: true,
    plan: finalizePlan(input, state),
    ...(previousEngineerId === undefined ? {} : { previousEngineerId }),
    position: best.position,
  }
}

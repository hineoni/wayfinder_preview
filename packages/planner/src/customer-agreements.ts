import type { Plan } from './plan'
import type { PlanChangeKind, ReplanResult } from './replan'

export interface CustomerAgreement {
  readonly orderId: string
  readonly previousStartMin?: number
  readonly startMin?: number
  readonly engineerId?: string
  readonly reason: PlanChangeKind
  readonly status: 'pending' | 'confirmed'
  /** Фиксация времени независима от необходимости уведомить о смене исполнителя. */
  readonly promisedStartMin?: number | undefined
}

/** Изменение опубликованного времени снимает прежнее подтверждение, неизменённое сохраняется. */
export function reconcileAgreements(
  previous: readonly CustomerAgreement[],
  result: ReplanResult,
): readonly CustomerAgreement[] {
  const entries = new Map(previous.map((item) => [item.orderId, item]))
  const finished = new Set(
    result.history.filter((h) => h.state === 'completed').map((h) => h.visit.orderId),
  )
  for (const change of result.changes) {
    if (change.kind === 'reordered' && !change.timeChanged) continue
    const prior = entries.get(change.orderId)
    const route = result.plan.routes.find((r) => r.visits.some((v) => v.orderId === change.orderId))
    const visit = route?.visits.find((v) => v.orderId === change.orderId)
    const oldStart =
      prior?.status === 'confirmed'
        ? prior.startMin
        : (prior?.previousStartMin ?? change.previousStartMin)
    entries.set(change.orderId, {
      orderId: change.orderId,
      reason: change.kind,
      status: 'pending',
      ...(prior?.promisedStartMin !== undefined && visit?.startMin === prior.promisedStartMin
        ? { promisedStartMin: prior.promisedStartMin }
        : {}),
      ...(oldStart === undefined ? {} : { previousStartMin: oldStart }),
      ...(visit === undefined ? {} : { startMin: visit.startMin, engineerId: route!.engineerId }),
    })
  }
  return [...entries.values()]
    .filter((item) => !finished.has(item.orderId))
    .toSorted((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
      if ((a.startMin === undefined) !== (b.startMin === undefined))
        return a.startMin === undefined ? -1 : 1
      return (
        Math.min(a.previousStartMin ?? Infinity, a.startMin ?? Infinity) -
          Math.min(b.previousStartMin ?? Infinity, b.startMin ?? Infinity) ||
        Math.abs((b.startMin ?? 0) - (b.previousStartMin ?? b.startMin ?? 0)) -
          Math.abs((a.startMin ?? 0) - (a.previousStartMin ?? a.startMin ?? 0))
      )
    })
}

export function confirmCustomerTime(
  queue: readonly CustomerAgreement[],
  plan: Plan,
  orderId: string,
): readonly CustomerAgreement[] {
  const route = plan.routes.find((r) => r.visits.some((v) => v.orderId === orderId))
  const visit = route?.visits.find((v) => v.orderId === orderId)
  if (visit === undefined) throw new Error('Нельзя подтвердить время неназначенной заявки')
  const prior = queue.find((q) => q.orderId === orderId)
  return [
    ...queue.filter((q) => q.orderId !== orderId),
    {
      ...prior,
      orderId,
      startMin: visit.startMin,
      promisedStartMin: visit.startMin,
      engineerId: route!.engineerId,
      reason: prior?.reason ?? 'new-assignment',
      status: 'confirmed',
    },
  ]
}

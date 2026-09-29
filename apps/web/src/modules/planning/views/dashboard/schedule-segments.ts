import type { Plan, ReplanHistoryVisit, Visit } from '@wayfinder/planner'

/** Только будущие паузы опубликованного плана, без истории и свободного конца смены. */
export function reserveSummary(plan: Pick<Plan, 'routes'>) {
  let minutes = 0
  let crews = 0
  for (const route of plan.routes) {
    const reserve = route.visits.reduce((sum, visit) => sum + visit.waitMin, 0)
    minutes += reserve
    if (reserve > 0) crews += 1
  }
  return { minutes, crews }
}

export interface ScheduleSegment {
  kind: 'travel' | 'wait' | 'work'
  start: number
  end: number
}

/** Display committed history only; cancelled/interrupted service ends at the event. */
export function scheduleSegments(
  visit: Visit,
  state?: ReplanHistoryVisit['state'],
  eventAt?: number,
): ScheduleSegment[] {
  const stop = eventAt ?? Infinity
  const cancelledBeforeWork =
    state === 'cancelled-en-route' ||
    state === 'cancelled-waiting' ||
    state === 'interrupted-en-route' ||
    state === 'interrupted-waiting'
  const end =
    state === 'interrupted' || state === 'cancelled-in-progress'
      ? Math.min(visit.endMin, stop)
      : visit.endMin
  const segments: ScheduleSegment[] = [
    {
      kind: 'travel',
      start: visit.arrivalMin - visit.travel.durationMin,
      end: state === 'interrupted-en-route' ? Math.min(visit.arrivalMin, stop) : visit.arrivalMin,
    },
    {
      kind: 'wait',
      start: visit.arrivalMin,
      end:
        state === 'cancelled-en-route' || state === 'interrupted-en-route'
          ? visit.arrivalMin
          : state === 'cancelled-waiting' || state === 'interrupted-waiting'
            ? Math.min(visit.startMin, stop)
            : visit.startMin,
    },
    { kind: 'work', start: visit.startMin, end: cancelledBeforeWork ? visit.startMin : end },
  ]
  return segments.filter((segment) => segment.end > segment.start)
}

export function occupiedMinutes(segments: readonly ScheduleSegment[]): number {
  const sorted = segments.toSorted((a, b) => a.start - b.start)
  let end = -Infinity
  let total = 0
  for (const segment of sorted) {
    total += Math.max(0, segment.end - Math.max(segment.start, end))
    end = Math.max(end, segment.end)
  }
  return total
}

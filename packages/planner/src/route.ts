import { checkAppend, cursorAfter, startCursor } from './constraints'
import type { Engineer, Order, TravelProvider } from './contracts'
import type { AddedDistance, AssignmentExplanation, Route, Visit } from './plan'

export interface RouteBuild {
  readonly ok: boolean
  readonly route?: Route
}

/** Пересчитывает только один маршрут и всё его расписание. */
export function buildRoute(
  engineer: Engineer,
  orders: readonly Order[],
  travel: TravelProvider,
): RouteBuild {
  let cursor = startCursor(engineer)
  const visits: Visit[] = []
  let distanceM = 0
  let approximate = false
  for (const order of orders) {
    const check = checkAppend(engineer, cursor, order, travel)
    if (!check.ok) return { ok: false }
    const explanation = assignmentExplanation(engineer, orders, visits.length, check.visit, travel)
    visits.push({ ...check.visit, explanation })
    cursor = cursorAfter(check.visit, order)
    distanceM += check.visit.travel.distanceM
    approximate ||= check.visit.travel.approximate
  }
  return { ok: true, route: { engineerId: engineer.id, visits, distanceM, approximate } }
}

function assignmentExplanation(
  engineer: Engineer,
  orders: readonly Order[],
  index: number,
  visit: Omit<Visit, 'explanation'>,
  travel: TravelProvider,
): AssignmentExplanation {
  const order = orders[index]!
  const distance = addedDistance(engineer, orders, index, travel)
  return {
    engineerId: engineer.id,
    requiredSkill: order.skill,
    skillMatched: true,
    ...(order.transport === undefined ? {} : { requiredTransport: order.transport }),
    transportMatched: true,
    arrivalMin: visit.arrivalMin,
    waitMin: visit.waitMin,
    startMin: visit.startMin,
    endMin: visit.endMin,
    addedDistance: distance.value,
    approximate: visit.travel.approximate || distance.approximate,
  }
}

function addedDistance(
  engineer: Engineer,
  orders: readonly Order[],
  index: number,
  travel: TravelProvider,
): { readonly value: AddedDistance; readonly approximate: boolean } {
  const current = orders[index]!
  const previousPoint = index === 0 ? engineer.startPointId : orders[index - 1]!.pointId
  const incoming = travel.travel(engineer.transport, previousPoint, current.pointId)
  if (incoming === null) {
    return {
      value: { status: 'undefined', reason: 'connecting-leg-unreachable' },
      approximate: false,
    }
  }
  const next = orders[index + 1]
  if (next === undefined) {
    return {
      value: { status: 'defined', distanceM: incoming.distanceM },
      approximate: incoming.approximate,
    }
  }
  const outgoing = travel.travel(engineer.transport, current.pointId, next.pointId)
  const connecting = travel.travel(engineer.transport, previousPoint, next.pointId)
  if (outgoing === null || connecting === null) {
    return {
      value: { status: 'undefined', reason: 'connecting-leg-unreachable' },
      approximate: incoming.approximate || outgoing?.approximate === true,
    }
  }
  return {
    value: {
      status: 'defined',
      distanceM: incoming.distanceM + outgoing.distanceM - connecting.distanceM,
    },
    approximate: incoming.approximate || outgoing.approximate || connecting.approximate,
  }
}

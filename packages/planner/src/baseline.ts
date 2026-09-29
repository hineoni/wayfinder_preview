import {
  checkAppend,
  cursorAfter,
  startCursor,
  type RouteCursor,
  type ScheduledVisit,
} from './constraints'
import type { Engineer, Order, PlanInput, TravelProvider } from './contracts'
import { computeMetrics } from './metrics'
import type { EngineerRejection, Plan, Route, UnassignedOrder } from './plan'
import { buildRoute } from './route'

interface RouteDraft {
  readonly engineer: Engineer
  cursor: RouteCursor
  readonly visits: ScheduledVisit[]
  distanceM: number
  approximate: boolean
}

/**
 * Базовый вариант по разделу 2.3 ТЗ: заявки по порядку поступления, инженеры по порядку входных
 * данных, добавление только в конец маршрута первого инженера, у которого это допустимо.
 * Детерминирован; без глобальной оптимизации. Объяснение неназначенных считается по итоговым
 * маршрутам, а не по состоянию на момент отказа.
 */
export function planBaseline(input: PlanInput): Plan {
  const drafts = input.engineers.map((engineer): RouteDraft => ({
    engineer,
    cursor: startCursor(engineer),
    visits: [],
    distanceM: 0,
    approximate: false,
  }))
  const skipped: Order[] = []

  for (const order of input.orders) {
    let assigned = false
    for (const draft of drafts) {
      const check = checkAppend(draft.engineer, draft.cursor, order, input.travel)
      if (!check.ok) continue
      draft.visits.push(check.visit)
      draft.cursor = cursorAfter(check.visit, order)
      draft.distanceM += check.visit.travel.distanceM
      draft.approximate ||= check.visit.travel.approximate
      assigned = true
      break
    }
    if (!assigned) skipped.push(order)
  }

  const routes: Route[] = drafts.map((draft) => {
    const orders = draft.visits.map((visit) =>
      input.orders.find((order) => order.id === visit.orderId)!,
    )
    return buildRoute(draft.engineer, orders, input.travel).route!
  })
  const unassigned = skipped.map((order) => describeUnassigned(order, drafts, input.travel))
  const ordersById = new Map(input.orders.map((order) => [order.id, order]))
  return {
    kind: 'baseline',
    routes,
    unassigned,
    metrics: computeMetrics(routes, unassigned, ordersById),
  }
}

/**
 * Последовательное сужение причин по итоговым маршрутам: навык → транспорт → конец маршрута.
 * Базовый не проверяет вставку в середину, поэтому совместимая заявка получает класс search-limit.
 */
function describeUnassigned(
  order: Order,
  drafts: readonly RouteDraft[],
  travel: TravelProvider,
): UnassignedOrder {
  const rejections: EngineerRejection[] = []
  let withSkill = 0
  let withSkillAndTransport = 0
  let approximate = false
  for (const draft of drafts) {
    const check = checkAppend(draft.engineer, draft.cursor, order, travel)
    if (check.ok) {
      withSkill += 1
      withSkillAndTransport += 1
      continue
    }
    rejections.push(check.rejection)
    approximate ||= check.rejection.approximate === true
    if (check.rejection.code === 'skill') continue
    withSkill += 1
    if (check.rejection.code !== 'transport') withSkillAndTransport += 1
  }
  return {
    orderId: order.id,
    class: withSkillAndTransport === 0 ? 'incompatible' : 'search-limit',
    withSkill,
    withSkillAndTransport,
    rejections,
    approximate,
  }
}

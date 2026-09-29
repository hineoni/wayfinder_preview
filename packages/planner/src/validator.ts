import {
  EQUIPMENT_KINDS,
  type Engineer,
  type EquipmentStock,
  type Minute,
  type Order,
  type PlanInput,
  type TravelLeg,
} from './contracts'
import type { EngineerRejection, Plan, Route } from './plan'

export type ViolationCode =
  | 'duplicate-order-id'
  | 'duplicate-engineer-id'
  | 'unknown-kind'
  | 'unknown-order'
  | 'unknown-engineer'
  | 'duplicate-route'
  | 'missing-route'
  | 'order-assigned-twice'
  | 'order-missing'
  | 'order-assigned-and-unassigned'
  | 'skill'
  | 'transport'
  | 'equipment'
  | 'equipment-remaining-mismatch'
  | 'unreachable'
  | 'travel-mismatch'
  | 'arrival-mismatch'
  | 'start-mismatch'
  | 'start-after-window'
  | 'wait-mismatch'
  | 'end-mismatch'
  | 'end-after-shift'
  | 'not-finite'
  | 'route-distance-mismatch'
  | 'approximate-mismatch'
  | 'unassigned-count-mismatch'
  | 'unassigned-class-mismatch'
  | 'rejection-mismatch'
  | 'assignment-explanation-mismatch'
  | 'metrics-mismatch'

export interface Violation {
  readonly code: ViolationCode
  readonly detail: string
  readonly orderId?: string
  readonly engineerId?: string
}

const PLAN_KINDS = new Set<string>(['baseline', 'optimized'])

/**
 * Независимая проверка финального плана по исходным данным. Не использует проверщик ограничений:
 * расписание, переезды, покрытие заявок, объяснение неназначенных и метрики пересчитываются заново.
 * Расписание точное: прибытие = конец предыдущего визита + переезд, начало = max(прибытие, начало окна, поступление).
 * Доказуемые факты объяснения (счётчики по навыку и транспорту, отказы по концу итогового маршрута,
 * признаки приближения) сверяются; infeasible-in-plan независимо проверяется по всем позициям.
 */
export function validatePlan(input: PlanInput, plan: Plan): readonly Violation[] {
  const violations: Violation[] = []
  const push = (violation: Violation) => violations.push(violation)

  if (!PLAN_KINDS.has(plan.kind)) {
    push({ code: 'unknown-kind', detail: `неизвестный вид плана ${plan.kind}` })
  }
  const ordersById = indexUnique(input.orders, (order) => order.id, 'duplicate-order-id', push)
  const engineersById = indexUnique(
    input.engineers,
    (engineer) => engineer.id,
    'duplicate-engineer-id',
    push,
  )

  const seenOrders = new Map<string, string>()
  const routeEnds = new Map<string, RouteEnd>()
  const recomputed = new Map<string, { distanceM: number; approximate: boolean }>()
  let totalDistanceM = 0
  let engineersUsed = 0
  let approximate = false

  for (const route of plan.routes) {
    const engineer = engineersById.get(route.engineerId)
    if (engineer === undefined) {
      push({
        code: 'unknown-engineer',
        engineerId: route.engineerId,
        detail: 'маршрут неизвестного инженера',
      })
      continue
    }
    if (routeEnds.has(route.engineerId)) {
      push({
        code: 'duplicate-route',
        engineerId: route.engineerId,
        detail: 'у инженера больше одного маршрута',
      })
      continue
    }
    if (route.visits.length > 0) engineersUsed += 1
    const end = checkRoute(input, engineer, route, ordersById, seenOrders, push)
    routeEnds.set(engineer.id, end)
    if (end.distanceM !== route.distanceM) {
      push({
        code: 'route-distance-mismatch',
        engineerId: engineer.id,
        detail: `пробег маршрута ${route.distanceM}, пересчитано ${end.distanceM}`,
      })
    }
    if (end.approximate !== route.approximate) {
      push({
        code: 'approximate-mismatch',
        engineerId: engineer.id,
        detail: 'признак приближения маршрута не совпадает с рёбрами',
      })
    }
    recomputed.set(engineer.id, { distanceM: end.distanceM, approximate: end.approximate })
    totalDistanceM += end.distanceM
    approximate ||= end.approximate
  }

  for (const engineer of input.engineers) {
    if (!routeEnds.has(engineer.id)) {
      push({
        code: 'missing-route',
        engineerId: engineer.id,
        detail: 'у инженера нет маршрута (даже пустого)',
      })
    }
  }

  const unassignedIds = new Set<string>()
  let unassignedEmergency = 0
  let unassignedConnection = 0
  for (const item of plan.unassigned) {
    const order = ordersById.get(item.orderId)
    if (order === undefined) {
      push({
        code: 'unknown-order',
        orderId: item.orderId,
        detail: 'неназначенная заявка не из входных данных',
      })
      continue
    }
    if (seenOrders.has(item.orderId)) {
      push({
        code: 'order-assigned-and-unassigned',
        orderId: item.orderId,
        detail: 'заявка одновременно назначена и не назначена',
      })
    }
    if (unassignedIds.has(item.orderId)) {
      push({
        code: 'order-assigned-twice',
        orderId: item.orderId,
        detail: 'заявка дважды в списке неназначенных',
      })
    }
    unassignedIds.add(item.orderId)
    if (order.priority === 'emergency') unassignedEmergency += 1
    if (order.priority === 'connection') unassignedConnection += 1
    const explanationApproximate = checkExplanation(
      input,
      order,
      item,
      routeEnds,
      plan.routes,
      push,
    )
    approximate ||= explanationApproximate
  }
  for (const order of input.orders) {
    if (!seenOrders.has(order.id) && !unassignedIds.has(order.id)) {
      push({
        code: 'order-missing',
        orderId: order.id,
        detail: 'заявка не учтена ни в маршрутах, ни в неназначенных',
      })
    }
  }

  const metrics = plan.metrics
  const expected = {
    unassignedEmergency,
    unassignedConnection,
    unassignedTotal: unassignedIds.size,
    engineersUsed,
    distanceM: totalDistanceM,
    approximate,
  }
  const metricKeys = [
    'unassignedEmergency',
    'unassignedConnection',
    'unassignedTotal',
    'engineersUsed',
    'distanceM',
    'approximate',
  ] as const
  for (const key of metricKeys) {
    if (metrics[key] !== expected[key]) {
      push({
        code: 'metrics-mismatch',
        detail: `${key}: в плане ${metrics[key]}, пересчитано ${expected[key]}`,
      })
    }
  }
  const seenMetrics = new Set<string>()
  for (const item of metrics.perEngineer) {
    const route = plan.routes.find((candidate) => candidate.engineerId === item.engineerId)
    const actual = recomputed.get(item.engineerId)
    if (route === undefined || actual === undefined) {
      push({
        code: 'metrics-mismatch',
        engineerId: item.engineerId,
        detail: 'метрики инженера без маршрута',
      })
      continue
    }
    if (seenMetrics.has(item.engineerId)) {
      push({
        code: 'metrics-mismatch',
        engineerId: item.engineerId,
        detail: 'метрики инженера повторяются',
      })
      continue
    }
    seenMetrics.add(item.engineerId)
    if (item.distanceM !== actual.distanceM || item.visits !== route.visits.length) {
      push({
        code: 'metrics-mismatch',
        engineerId: item.engineerId,
        detail: `инженер: пробег ${item.distanceM}/${actual.distanceM}, визитов ${item.visits}/${route.visits.length}`,
      })
    }
  }
  for (const engineerId of recomputed.keys()) {
    if (!seenMetrics.has(engineerId)) {
      push({ code: 'metrics-mismatch', engineerId, detail: 'нет метрик инженера' })
    }
  }

  return violations
}

/** Где и когда заканчивается пересчитанный маршрут; `null` — расписание не удалось восстановить. */
interface RouteEnd {
  readonly pointId: string
  readonly freeAtMin: Minute | null
  readonly distanceM: number
  readonly approximate: boolean
  readonly equipment: EquipmentStock
}

function checkRoute(
  input: PlanInput,
  engineer: Engineer,
  route: Route,
  ordersById: ReadonlyMap<string, Order>,
  seenOrders: Map<string, string>,
  push: (violation: Violation) => void,
): RouteEnd {
  let pointId = engineer.startPointId
  let freeAtMin: Minute | null = engineer.shift.start
  let distanceM = 0
  let approximate = false
  let equipment = engineer.equipment
  for (let visitIndex = 0; visitIndex < route.visits.length; visitIndex += 1) {
    const visit = route.visits[visitIndex]!
    const order = ordersById.get(visit.orderId)
    const ref = { orderId: visit.orderId, engineerId: engineer.id }
    if (order === undefined) {
      push({ code: 'unknown-order', ...ref, detail: 'визит к неизвестной заявке' })
      freeAtMin = null
      continue
    }
    const previous = seenOrders.get(order.id)
    if (previous !== undefined) {
      push({
        code: 'order-assigned-twice',
        ...ref,
        detail: `заявка уже назначена инженеру ${previous}`,
      })
    }
    seenOrders.set(order.id, engineer.id)
    checkCompatibility(engineer, order, ref, push)
    const missingEquipment = EQUIPMENT_KINDS.find((kind) => order.equipment[kind] > equipment[kind])
    if (missingEquipment !== undefined) {
      push({
        code: 'equipment',
        ...ref,
        detail: `нужно ${order.equipment[missingEquipment]} ${missingEquipment}, доступно ${equipment[missingEquipment]}`,
      })
    }
    const expectedEquipment = consumeEquipment(equipment, order.equipment)
    if (!sameEquipment(visit.equipmentRemaining, expectedEquipment)) {
      push({
        code: 'equipment-remaining-mismatch',
        ...ref,
        detail: 'остаток оборудования после визита не совпадает с пересчётом',
      })
    }
    checkAssignmentExplanation(input, engineer, route, visitIndex, order, push)

    const numbers = [
      visit.arrivalMin,
      visit.startMin,
      visit.waitMin,
      visit.endMin,
      visit.travel.distanceM,
      visit.travel.durationMin,
    ]
    if (!numbers.every((value) => Number.isFinite(value))) {
      push({ code: 'not-finite', ...ref, detail: 'в расписании визита не число' })
      freeAtMin = null
      pointId = order.pointId
      continue
    }

    const leg = input.travel.travel(engineer.transport, pointId, order.pointId)
    if (leg === null) {
      push({ code: 'unreachable', ...ref, detail: `нет маршрута ${pointId} → ${order.pointId}` })
    } else {
      if (!sameLeg(leg, visit.travel)) {
        push({
          code: 'travel-mismatch',
          ...ref,
          detail: 'переезд визита не совпадает с источником',
        })
      }
      const expectedArrival =
        freeAtMin === null
          ? null
          : visitIndex === 0 && engineer.deferFirstDeparture !== false
            ? Math.max(freeAtMin + leg.durationMin, order.window.start, order.availableFromMin)
            : freeAtMin + leg.durationMin
      if (expectedArrival !== null && visit.arrivalMin !== expectedArrival) {
        push({
          code: 'arrival-mismatch',
          ...ref,
          detail: `прибытие ${visit.arrivalMin}, по выезду и переезду ${expectedArrival}`,
        })
      }
      distanceM += leg.distanceM
      approximate ||= leg.approximate
    }
    const expectedStart = Math.max(visit.arrivalMin, order.window.start, order.availableFromMin)
    if (visit.startMin !== expectedStart) {
      push({
        code: 'start-mismatch',
        ...ref,
        detail: `начало ${visit.startMin}, ожидается max(прибытие, окно, поступление) = ${expectedStart}`,
      })
    }
    if (visit.startMin > order.window.end) {
      push({ code: 'start-after-window', ...ref, detail: 'начало работы позже окна' })
    }
    if (visit.waitMin !== visit.startMin - visit.arrivalMin) {
      push({ code: 'wait-mismatch', ...ref, detail: 'ожидание не равно началу минус прибытие' })
    }
    if (visit.endMin !== visit.startMin + order.durationMin) {
      push({ code: 'end-mismatch', ...ref, detail: 'окончание не равно началу плюс длительность' })
    }
    if (visit.endMin > engineer.shift.end) {
      push({ code: 'end-after-shift', ...ref, detail: 'работа заканчивается после смены' })
    }
    pointId = order.pointId
    freeAtMin = visit.endMin
    equipment = expectedEquipment
  }
  return { pointId, freeAtMin, distanceM, approximate, equipment }
}

function checkAssignmentExplanation(
  input: PlanInput,
  engineer: Engineer,
  route: Route,
  index: number,
  order: Order,
  push: (violation: Violation) => void,
) {
  const visit = route.visits[index]!
  const explanation = visit.explanation
  const previousPoint =
    index === 0
      ? engineer.startPointId
      : input.orders.find((item) => item.id === route.visits[index - 1]!.orderId)?.pointId
  const nextOrder = input.orders.find((item) => item.id === route.visits[index + 1]?.orderId)
  let addedDistance: typeof explanation.addedDistance
  let explanationApproximate = false
  const incoming =
    previousPoint === undefined
      ? null
      : input.travel.travel(engineer.transport, previousPoint, order.pointId)
  if (incoming === null) {
    addedDistance = { status: 'undefined', reason: 'connecting-leg-unreachable' }
  } else if (nextOrder === undefined) {
    addedDistance = { status: 'defined', distanceM: incoming.distanceM }
    explanationApproximate = incoming.approximate
  } else {
    const outgoing = input.travel.travel(engineer.transport, order.pointId, nextOrder.pointId)
    const connecting = input.travel.travel(engineer.transport, previousPoint!, nextOrder.pointId)
    addedDistance =
      outgoing === null || connecting === null
        ? { status: 'undefined', reason: 'connecting-leg-unreachable' }
        : {
            status: 'defined',
            distanceM: incoming.distanceM + outgoing.distanceM - connecting.distanceM,
          }
    explanationApproximate =
      incoming.approximate || outgoing?.approximate === true || connecting?.approximate === true
  }
  const expected = {
    engineerId: engineer.id,
    requiredSkill: order.skill,
    skillMatched: true,
    ...(order.transport === undefined ? {} : { requiredTransport: order.transport }),
    transportMatched: true,
    arrivalMin: visit.arrivalMin,
    waitMin: visit.waitMin,
    startMin: visit.startMin,
    endMin: visit.endMin,
    addedDistance,
    approximate: visit.travel.approximate || explanationApproximate,
  }
  const addedDistanceMatches =
    explanation.addedDistance.status === expected.addedDistance.status &&
    (explanation.addedDistance.status === 'defined' && expected.addedDistance.status === 'defined'
      ? explanation.addedDistance.distanceM === expected.addedDistance.distanceM
      : explanation.addedDistance.status === 'undefined' &&
        expected.addedDistance.status === 'undefined' &&
        explanation.addedDistance.reason === expected.addedDistance.reason)
  const matches =
    explanation.engineerId === expected.engineerId &&
    explanation.requiredSkill === expected.requiredSkill &&
    explanation.skillMatched === expected.skillMatched &&
    explanation.requiredTransport === expected.requiredTransport &&
    explanation.transportMatched === expected.transportMatched &&
    explanation.arrivalMin === expected.arrivalMin &&
    explanation.waitMin === expected.waitMin &&
    explanation.startMin === expected.startMin &&
    explanation.endMin === expected.endMin &&
    addedDistanceMatches &&
    explanation.approximate === expected.approximate
  if (!matches) {
    push({
      code: 'assignment-explanation-mismatch',
      orderId: order.id,
      engineerId: engineer.id,
      detail: 'объяснение назначения не совпадает с финальным маршрутом и входом',
    })
  }
}

/**
 * Объяснение неназначенной заявки по итоговым маршрутам: счётчики, класс и отказы.
 * Инженеры, чьё расписание не восстановлено, в сверке отказов не участвуют.
 * Возвращает признак приближения, пересчитанный по отказам.
 */
function checkExplanation(
  input: PlanInput,
  order: Order,
  item: Plan['unassigned'][number],
  routeEnds: ReadonlyMap<string, RouteEnd>,
  routes: readonly Route[],
  push: (violation: Violation) => void,
): boolean {
  const ref = { orderId: order.id }
  const expected: EngineerRejection[] = []
  const skipped = new Set<string>()
  let withSkill = 0
  let withSkillAndTransport = 0
  let fits = 0
  for (const engineer of input.engineers) {
    const end = routeEnds.get(engineer.id)
    if (end === undefined) continue
    const hasSkill = engineer.skills.includes(order.skill)
    const hasTransport = order.transport === undefined || order.transport === engineer.transport
    if (hasSkill) withSkill += 1
    if (hasSkill && hasTransport) withSkillAndTransport += 1
    const rejection = expectedRejection(input, engineer, end, order)
    if (rejection === 'fits') fits += 1
    else if (rejection === 'unknown') skipped.add(engineer.id)
    else expected.push(rejection)
  }

  if (item.withSkill !== withSkill || item.withSkillAndTransport !== withSkillAndTransport) {
    push({
      code: 'unassigned-count-mismatch',
      ...ref,
      detail: `с навыком ${item.withSkill}/${withSkill}, с транспортом ${item.withSkillAndTransport}/${withSkillAndTransport}`,
    })
  }
  if ((item.class === 'incompatible') !== (withSkillAndTransport === 0)) {
    push({
      code: 'unassigned-class-mismatch',
      ...ref,
      detail: `класс ${item.class} при ${withSkillAndTransport} совместимых инженерах`,
    })
  } else if (fits > 0 && item.class === 'infeasible-in-plan') {
    push({
      code: 'unassigned-class-mismatch',
      ...ref,
      detail: 'класс infeasible-in-plan, но заявка помещается в конец итогового маршрута',
    })
  } else if (
    item.class === 'infeasible-in-plan' &&
    input.engineers.some((engineer) => {
      if (!engineer.skills.includes(order.skill)) return false
      if (order.transport !== undefined && order.transport !== engineer.transport) return false
      const route = routes.find((candidate) => candidate.engineerId === engineer.id)
      return route !== undefined && insertionFits(input, engineer, route, order)
    })
  ) {
    push({
      code: 'unassigned-class-mismatch',
      ...ref,
      detail: 'класс infeasible-in-plan, но заявка вставляется в итоговый маршрут',
    })
  }
  const actual = item.rejections.filter((rejection) => !skipped.has(rejection.engineerId))
  if (!sameRejections(actual, expected)) {
    push({
      code: 'rejection-mismatch',
      ...ref,
      detail: 'отказы не совпадают с пересчётом по концам итоговых маршрутов',
    })
  }
  const recomputedApproximate =
    item.rejections.some(
      (rejection) => skipped.has(rejection.engineerId) && rejection.approximate === true,
    ) || expected.some((rejection) => rejection.approximate === true)
  if (item.approximate !== recomputedApproximate) {
    push({
      code: 'approximate-mismatch',
      ...ref,
      detail: 'признак приближения не совпадает с отказами',
    })
  }
  return recomputedApproximate
}

/** Независимая полная проверка всех позиций с сохранением относительного порядка маршрута. */
function insertionFits(
  input: PlanInput,
  engineer: Engineer,
  route: Route,
  inserted: Order,
): boolean {
  const ordersById = new Map(input.orders.map((order) => [order.id, order]))
  const current = route.visits.flatMap((visit) => {
    const order = ordersById.get(visit.orderId)
    return order === undefined ? [] : [order]
  })
  for (let position = 0; position <= current.length; position += 1) {
    const orders = [...current.slice(0, position), inserted, ...current.slice(position)]
    let pointId = engineer.startPointId
    let freeAtMin = engineer.shift.start
    let feasible = true
    let equipment = engineer.equipment
    for (const order of orders) {
      if (EQUIPMENT_KINDS.some((kind) => order.equipment[kind] > equipment[kind])) {
        feasible = false
        break
      }
      const leg = input.travel.travel(engineer.transport, pointId, order.pointId)
      if (leg === null) {
        feasible = false
        break
      }
      const startMin = Math.max(
        freeAtMin + leg.durationMin,
        order.window.start,
        order.availableFromMin,
      )
      if (startMin > order.window.end || startMin + order.durationMin > engineer.shift.end) {
        feasible = false
        break
      }
      pointId = order.pointId
      freeAtMin = startMin + order.durationMin
      equipment = consumeEquipment(equipment, order.equipment)
    }
    if (feasible) return true
  }
  return false
}

/** Отказ по концу итогового маршрута; 'fits' — заявка помещается; 'unknown' — расписание маршрута не восстановлено. */
function expectedRejection(
  input: PlanInput,
  engineer: Engineer,
  end: RouteEnd,
  order: Order,
): EngineerRejection | 'fits' | 'unknown' {
  const reject = (rejection: Omit<EngineerRejection, 'engineerId'>): EngineerRejection => ({
    engineerId: engineer.id,
    ...rejection,
  })
  if (!engineer.skills.includes(order.skill)) return reject({ code: 'skill' })
  if (order.transport !== undefined && order.transport !== engineer.transport) {
    return reject({ code: 'transport' })
  }
  const missingEquipment = EQUIPMENT_KINDS.find(
    (kind) => order.equipment[kind] > end.equipment[kind],
  )
  if (missingEquipment !== undefined) {
    return reject({
      code: 'equipment',
      equipment: missingEquipment,
      requiredUnits: order.equipment[missingEquipment],
      availableUnits: end.equipment[missingEquipment],
    })
  }
  const leg = input.travel.travel(engineer.transport, end.pointId, order.pointId)
  if (leg === null) return reject({ code: 'unreachable' })
  if (end.freeAtMin === null) return 'unknown'
  const startMin = Math.max(
    end.freeAtMin + leg.durationMin,
    order.window.start,
    order.availableFromMin,
  )
  const basis = leg.approximate ? { approximate: true } : {}
  if (startMin > order.window.end) {
    return reject({ code: 'window', earliestStartMin: startMin, ...basis })
  }
  if (startMin + order.durationMin > engineer.shift.end) {
    return reject({ code: 'shift', earliestStartMin: startMin, ...basis })
  }
  return 'fits'
}

function sameRejections(
  actual: readonly EngineerRejection[],
  expected: readonly EngineerRejection[],
): boolean {
  if (actual.length !== expected.length) return false
  const byEngineer = new Map(expected.map((rejection) => [rejection.engineerId, rejection]))
  return actual.every((rejection) => {
    const other = byEngineer.get(rejection.engineerId)
    return (
      other !== undefined &&
      other.code === rejection.code &&
      other.earliestStartMin === rejection.earliestStartMin &&
      other.equipment === rejection.equipment &&
      other.requiredUnits === rejection.requiredUnits &&
      other.availableUnits === rejection.availableUnits &&
      (other.approximate === true) === (rejection.approximate === true)
    )
  })
}

function consumeEquipment(stock: EquipmentStock, used: EquipmentStock): EquipmentStock {
  return {
    'emergency-kit': stock['emergency-kit'] - used['emergency-kit'],
    router: stock.router - used.router,
    'tv-box': stock['tv-box'] - used['tv-box'],
    'cable-kit': stock['cable-kit'] - used['cable-kit'],
  }
}

function sameEquipment(a: EquipmentStock, b: EquipmentStock): boolean {
  return EQUIPMENT_KINDS.every((kind) => a[kind] === b[kind])
}

function sameLeg(a: TravelLeg, b: TravelLeg): boolean {
  return (
    a.distanceM === b.distanceM &&
    a.durationMin === b.durationMin &&
    a.approximate === b.approximate
  )
}

function checkCompatibility(
  engineer: Engineer,
  order: Order,
  ref: { orderId: string; engineerId: string },
  push: (violation: Violation) => void,
) {
  if (!engineer.skills.includes(order.skill)) {
    push({ code: 'skill', ...ref, detail: `нужен навык ${order.skill}` })
  }
  if (order.transport !== undefined && order.transport !== engineer.transport) {
    push({ code: 'transport', ...ref, detail: `нужен транспорт ${order.transport}` })
  }
}

function indexUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  code: 'duplicate-order-id' | 'duplicate-engineer-id',
  push: (violation: Violation) => void,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const id = key(item)
    if (map.has(id)) {
      push({ code, detail: `повтор идентификатора ${id}` })
      continue
    }
    map.set(id, item)
  }
  return map
}

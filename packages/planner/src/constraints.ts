import {
  EQUIPMENT_KINDS,
  type Engineer,
  type EquipmentStock,
  type Minute,
  type Order,
  type TravelProvider,
} from './contracts'
import type { EngineerRejection, Visit } from './plan'

export type ScheduledVisit = Omit<Visit, 'explanation'>

/** Где и когда инженер заканчивает текущий маршрут. */
export interface RouteCursor {
  readonly pointId: string
  readonly freeAtMin: Minute
  readonly equipment: EquipmentStock
  readonly deferDeparture: boolean
}

export type AppendCheck =
  | { readonly ok: true; readonly visit: ScheduledVisit }
  | { readonly ok: false; readonly rejection: EngineerRejection }

export function startCursor(engineer: Engineer): RouteCursor {
  return {
    pointId: engineer.startPointId,
    freeAtMin: engineer.shift.start,
    equipment: engineer.equipment,
    deferDeparture: engineer.deferFirstDeparture !== false,
  }
}

export function cursorAfter(visit: ScheduledVisit, order: Order): RouteCursor {
  return {
    pointId: order.pointId,
    freeAtMin: visit.endMin,
    equipment: visit.equipmentRemaining,
    deferDeparture: false,
  }
}

/**
 * Общий проверщик ограничений: можно ли добавить заявку в конец маршрута инженера.
 * Проверки по порядку: навык, транспорт, достижимость, окно, смена.
 * Начало = max(прибытие, начало окна, поступление), окончание = начало + длительность.
 */
export function checkAppend(
  engineer: Engineer,
  cursor: RouteCursor,
  order: Order,
  travel: TravelProvider,
): AppendCheck {
  const reject = (rejection: Omit<EngineerRejection, 'engineerId'>): AppendCheck => ({
    ok: false,
    rejection: { engineerId: engineer.id, ...rejection },
  })
  if (!engineer.skills.includes(order.skill)) return reject({ code: 'skill' })
  if (order.transport !== undefined && order.transport !== engineer.transport) {
    return reject({ code: 'transport' })
  }
  const missingEquipment = EQUIPMENT_KINDS.find(
    (kind) => order.equipment[kind] > cursor.equipment[kind],
  )
  if (missingEquipment !== undefined) {
    return reject({
      code: 'equipment',
      equipment: missingEquipment,
      requiredUnits: order.equipment[missingEquipment],
      availableUnits: cursor.equipment[missingEquipment],
    })
  }
  const leg = travel.travel(engineer.transport, cursor.pointId, order.pointId)
  if (leg === null) return reject({ code: 'unreachable' })
  const departureMin = cursor.deferDeparture
    ? Math.max(
        cursor.freeAtMin,
        Math.max(order.window.start, order.availableFromMin) - leg.durationMin,
      )
    : cursor.freeAtMin
  const arrivalMin = departureMin + leg.durationMin
  const startMin = Math.max(arrivalMin, order.window.start, order.availableFromMin)
  const basis = leg.approximate ? { approximate: true } : {}
  if (startMin > order.window.end) {
    return reject({ code: 'window', earliestStartMin: startMin, ...basis })
  }
  const endMin = startMin + order.durationMin
  if (endMin > engineer.shift.end) {
    return reject({ code: 'shift', earliestStartMin: startMin, ...basis })
  }
  return {
    ok: true,
    visit: {
      orderId: order.id,
      travel: leg,
      arrivalMin,
      startMin,
      waitMin: startMin - arrivalMin,
      endMin,
      equipmentRemaining: consumeEquipment(cursor.equipment, order.equipment),
    },
  }
}

function consumeEquipment(stock: EquipmentStock, used: EquipmentStock): EquipmentStock {
  return {
    'emergency-kit': stock['emergency-kit'] - used['emergency-kit'],
    router: stock.router - used.router,
    'tv-box': stock['tv-box'] - used['tv-box'],
    'cable-kit': stock['cable-kit'] - used['cable-kit'],
  }
}

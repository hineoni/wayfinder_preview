import type { Engineer, Order, PlanInput, UrgentOrderEvent } from '@wayfinder/planner'
import type { GeoPoint } from './geo'
import type { PreparedDataset, PreparedEngineer, PreparedOrderBase } from './prepared'
import { parseClock } from './time'
import { createMatrixTravel } from './travel'

/** Единственное место преобразования prepared-набора во вход планировщика (ARCH-05). */
export function toPlanInput(
  dataset: PreparedDataset,
  additionalPoints: ReadonlyMap<string, GeoPoint> = new Map(),
): PlanInput {
  const coordinates = new Map<string, GeoPoint>(
    dataset.points.map((point) => [point.id, { lat: point.lat, lon: point.lon }]),
  )
  for (const [pointId, point] of additionalPoints) coordinates.set(pointId, point)
  return {
    orders: dataset.orders.map(toOrder),
    engineers: dataset.engineers.map(toEngineer),
    travel: createMatrixTravel({
      pointIds: dataset.travel.pointIds,
      profiles: dataset.travel.profiles,
      coordinates,
      model: dataset.assumptions.travelModel,
    }),
  }
}

export function toOrder(order: PreparedOrderBase): Order {
  return {
    id: order.id,
    pointId: order.pointId,
    durationMin: order.durationMin,
    availableFromMin: parseClock(order.availableFrom),
    window: { start: parseClock(order.window.start), end: parseClock(order.window.end) },
    priority: order.priority,
    skill: order.skill,
    ...(order.transport === undefined ? {} : { transport: order.transport }),
    equipment: order.equipment,
  }
}

export function toEngineer(engineer: PreparedEngineer): Engineer {
  return {
    id: engineer.id,
    name: engineer.name,
    startPointId: engineer.startPointId,
    shift: { start: parseClock(engineer.shift.start), end: parseClock(engineer.shift.end) },
    skills: engineer.skills,
    transport: engineer.transport,
    equipment: engineer.equipment,
  }
}

export function toUrgentOrderEvent(event: PreparedDataset['events'][number]): UrgentOrderEvent {
  return { kind: event.kind, atMin: parseClock(event.at), order: toOrder(event.order) }
}

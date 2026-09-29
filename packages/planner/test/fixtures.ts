import type {
  Engineer,
  EquipmentStock,
  Order,
  Transport,
  TravelLeg,
  TravelProvider,
} from '../src/contracts'

export const noEquipment: EquipmentStock = {
  'emergency-kit': 0,
  router: 0,
  'tv-box': 0,
  'cable-kit': 0,
}

/** Провайдер по явной таблице: ключ `from>to`; отсутствующая пара недостижима, одна точка — 0. */
export function tableTravel(
  table: Record<string, readonly [distanceM: number, durationMin: number]>,
  approximate = false,
): TravelProvider {
  return {
    travel(_transport: Transport, from: string, to: string): TravelLeg | null {
      if (from === to) return { distanceM: 0, durationMin: 0, approximate: false }
      const leg = table[`${from}>${to}`]
      return leg === undefined ? null : { distanceM: leg[0], durationMin: leg[1], approximate }
    },
  }
}

export function order(partial: Partial<Order> & { id: string }): Order {
  return {
    pointId: partial.id,
    durationMin: 60,
    availableFromMin: 540,
    window: { start: 600, end: 720 },
    priority: 'normal',
    skill: 'local',
    equipment: noEquipment,
    ...partial,
  }
}

export function engineer(partial: Partial<Engineer> & { id: string }): Engineer {
  return {
    name: partial.id,
    startPointId: 'office',
    shift: { start: 540, end: 1320 },
    skills: ['local', 'connection'],
    transport: 'car',
    equipment: noEquipment,
    ...partial,
  }
}

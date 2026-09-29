import { describe, expect, it } from 'vitest'
import { toOrder, toPlanInput } from '../src/adapter'
import {
  checkPreparedConsistency,
  parsePreparedDataset,
  type PreparedDataset,
  type PreparedMatrix,
} from '../src/prepared'

function matrix(): PreparedMatrix {
  return {
    graph: 'car',
    source: { endpoint: 'test', fetchedAt: '2026-09-19T00:00:00Z', dataVersion: null },
    units: { distance: 'm', duration: 's' },
    snapDistanceM: [0, 0],
    distanceM: [
      [0, 100],
      [100, 0],
    ],
    durationS: [
      [0, 60],
      [60, 0],
    ],
    geometryGaps: [],
  }
}

const dataset: PreparedDataset = {
  formatVersion: 3,
  group: 'east',
  title: 'Восток',
  day: '2026-08-17',
  timezone: 'Europe/Moscow',
  generatedAt: '2026-09-19T00:00:00Z',
  sources: [],
  assumptions: {
    shift: { start: '09:00', end: '22:00' },
    durationMinByHdType: {},
    emergencyDurationMin: 100,
    skillByBkType: {},
    priorityByBkType: {},
    orderAvailability: 'shift-start',
    carRequiredHdTypes: [],
    equipmentByHdType: {},
    equipmentPerQualifiedEngineer: {
      'emergency-kit': 3,
      router: 4,
      'tv-box': 3,
      'cable-kit': 3,
    },
    travelModel: {
      publicTransport: { speedKmh: 18, transferMin: 10 },
      approximation: { factor: 1.3, speedKmh: { car: 30, bicycle: 15, foot: 5, public: 18 } },
    },
    provenance: { model: 'team', emergencyDurationMin: 'organizer', priorityOrder: 'organizer' },
  },
  points: [
    {
      id: 'office',
      lat: 55.7,
      lon: 37.7,
      address: 'a',
      query: 'a',
      precision: 'house',
      displayName: 'a',
      osm: null,
    },
    {
      id: 'pt-000',
      lat: 55.71,
      lon: 37.71,
      address: 'b',
      query: 'b',
      precision: 'house',
      displayName: 'b',
      osm: null,
    },
  ],
  orders: [
    {
      id: '1',
      pointId: 'pt-000',
      bkType: 'Подключение',
      hdType: 'Конвергенция абонента',
      district: 'x',
      address: 'b',
      connection: null,
      gigabit: false,
      skill: 'connection',
      durationMin: 60,
      availableFrom: '09:00',
      priority: 'connection',
      equipment: { 'emergency-kit': 0, router: 0, 'tv-box': 0, 'cable-kit': 0 },
      sourceWindow: { start: '10:00', end: '12:00' },
      window: { start: '10:00', end: '12:00' },
      source: { file: 'f', row: 2 },
      control: { id: 'c', status: 'Выполнена', team: null },
    },
  ],
  engineers: [
    {
      id: 'E01',
      name: 'Бригада',
      controlTeam: 'Бригада',
      startPointId: 'office',
      shift: { start: '09:00', end: '22:00' },
      skills: ['connection'],
      transport: 'car',
      equipment: { 'emergency-kit': 0, router: 4, 'tv-box': 0, 'cable-kit': 0 },
      skillBasis: ['Подключение'],
    },
  ],
  events: [],
  travel: {
    pointIds: ['office', 'pt-000'],
    profiles: { car: matrix(), bicycle: matrix(), foot: matrix() },
    geometryFile: 'east.geometry.json',
  },
}

describe('preparedDatasetSchema', () => {
  it('отклоняет прежний формат и устаревший приоритет urgent', () => {
    expect(() => parsePreparedDataset({ ...dataset, formatVersion: 2 })).toThrow(/Invalid/)
    expect(() =>
      parsePreparedDataset({ ...dataset, orders: [{ ...dataset.orders[0], priority: 'urgent' }] }),
    ).toThrow(/Invalid/)
  })

  it('передаёт приоритет и время доступности, сохраняя исторический статус только как контекст', () => {
    const input = toPlanInput(dataset)
    expect(input.orders).toHaveLength(1)
    expect(input.orders[0]).toMatchObject({ priority: 'connection', availableFromMin: 540 })
    expect(toOrder({ ...dataset.orders[0]!, availableFrom: '13:30' }).availableFromMin).toBe(810)
  })
  it('принимает согласованный набор', () => {
    expect(() => parsePreparedDataset(dataset)).not.toThrow(/Invalid/)
  })

  it('отклоняет отрицательные и бесконечные переезды и привязки', () => {
    const negative = structuredClone(dataset)
    negative.travel.profiles.car.durationS[0]![1] = -600
    expect(() => parsePreparedDataset(negative)).toThrow(/Invalid/)
    const infinite = structuredClone(dataset)
    infinite.travel.profiles.foot.distanceM[1]![0] = Number.POSITIVE_INFINITY
    expect(() => parsePreparedDataset(infinite)).toThrow(/Invalid/)
    const snap = structuredClone(dataset)
    snap.travel.profiles.bicycle.snapDistanceM[0] = -1
    expect(() => parsePreparedDataset(snap)).toThrow(/Invalid/)
  })

  it('отклоняет нулевые скорости и коэффициент, отрицательную надбавку', () => {
    const zeroSpeed = structuredClone(dataset)
    zeroSpeed.assumptions.travelModel.publicTransport.speedKmh = 0
    expect(() => parsePreparedDataset(zeroSpeed)).toThrow(/Invalid/)
    const zeroFactor = structuredClone(dataset)
    zeroFactor.assumptions.travelModel.approximation.factor = 0
    expect(() => parsePreparedDataset(zeroFactor)).toThrow(/Invalid/)
    const negativeTransfer = structuredClone(dataset)
    negativeTransfer.assumptions.travelModel.publicTransport.transferMin = -1
    expect(() => parsePreparedDataset(negativeTransfer)).toThrow(/Invalid/)
  })

  it('отклоняет отрицательный запас оборудования', () => {
    const invalid = structuredClone(dataset)
    invalid.engineers[0]!.equipment.router = -1
    expect(() => parsePreparedDataset(invalid)).toThrow(/Invalid/)
  })

  it('отклоняет время вне суток и координаты вне диапазона', () => {
    const badClock = structuredClone(dataset)
    badClock.orders[0]!.window.end = '99:99'
    expect(() => parsePreparedDataset(badClock)).toThrow(/HH:MM/)
    const badLat = structuredClone(dataset)
    badLat.points[0]!.lat = 95
    expect(() => parsePreparedDataset(badLat)).toThrow(/Invalid/)
  })
})

describe('checkPreparedConsistency', () => {
  it('отклоняет устаревший норматив аварии и несогласованное поступление события', () => {
    const event = {
      kind: 'urgent-order' as const,
      at: '13:30',
      order: {
        ...dataset.orders[0]!,
        id: 'U1',
        priority: 'emergency' as const,
        durationMin: 120,
        availableFrom: '09:00',
      },
    }
    expect(checkPreparedConsistency({ ...dataset, events: [event] })).toEqual([
      'заявка события U1: доступность не совпадает со временем события',
      'заявка U1: длительность аварии должна быть 100 минут',
    ])
  })
  it('согласованный набор без проблем', () => {
    expect(checkPreparedConsistency(dataset)).toEqual([])
  })

  it('ловит окно вне смены и перевёрнутое окно', () => {
    const order = dataset.orders[0]!
    const outside = { ...dataset, orders: [{ ...order, window: { start: '22:00', end: '23:59' } }] }
    expect(checkPreparedConsistency(outside)).toEqual([
      'заявка 1: окно 22:00–23:59 вне смены 09:00–22:00',
    ])
    const inverted = {
      ...dataset,
      orders: [{ ...order, window: { start: '12:00', end: '10:00' } }],
    }
    expect(checkPreparedConsistency(inverted)).toHaveLength(1)
  })

  it('ловит повтор заявки события', () => {
    const event = {
      kind: 'urgent-order' as const,
      at: '12:00',
      order: { ...dataset.orders[0]!, id: 'U1', availableFrom: '12:00' },
    }
    const duplicated = { ...dataset, events: [event, event] }
    expect(checkPreparedConsistency(duplicated)).toEqual(['повтор заявки события U1'])
  })

  it('ловит повторы pointIds матриц и висячие ссылки', () => {
    const duplicated = { ...dataset, travel: { ...dataset.travel, pointIds: ['office', 'office'] } }
    expect(checkPreparedConsistency(duplicated)).toContain(
      'порядок pointIds матриц не совпадает с множеством точек',
    )
    const dangling = { ...dataset, orders: [{ ...dataset.orders[0]!, pointId: 'ghost' }] }
    expect(checkPreparedConsistency(dangling)).toEqual(['заявка 1 ссылается на точку ghost'])
  })
})

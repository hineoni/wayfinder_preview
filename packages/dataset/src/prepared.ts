import { PRIORITIES, SKILLS, TRANSPORTS } from '@wayfinder/planner'
import * as v from 'valibot'

/** Формат `datasets/prepared/*.json`. Версия формата растёт при несовместимом изменении. */
export const PREPARED_FORMAT_VERSION = 3

export const GROUPS = ['east', 'south-east', 'south-center'] as const
export type Group = (typeof GROUPS)[number]

/** Происхождение: из файла / организаторы / принято командой / изменено пользователем. */
export const PROVENANCES = ['source', 'organizer', 'team', 'user'] as const

const clock = v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ожидается HH:MM'))
const timeWindowSchema = v.object({ start: clock, end: clock })
const skillSchema = v.picklist(SKILLS)
const transportSchema = v.picklist(TRANSPORTS)
const id = v.pipe(v.string(), v.nonEmpty())
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1))
const nonNegative = v.pipe(v.number(), v.finite(), v.minValue(0))
const positive = v.pipe(v.number(), v.finite(), v.gtValue(0))
const latitude = v.pipe(v.number(), v.minValue(-90), v.maxValue(90))
const longitude = v.pipe(v.number(), v.minValue(-180), v.maxValue(180))
const nonNegativeInt = v.pipe(v.number(), v.integer(), v.minValue(0))
const equipmentSchema = v.object({
  'emergency-kit': nonNegativeInt,
  router: nonNegativeInt,
  'tv-box': nonNegativeInt,
  'cable-kit': nonNegativeInt,
})

const pointSchema = v.object({
  id,
  lat: latitude,
  lon: longitude,
  /** Адрес из источника без изменений. */
  address: v.string(),
  /** Нормализованный запрос, по которому нашлась точка. */
  query: v.string(),
  /** house — дом с корпусом и строением; block — тот же номер, другой корпус/строение; street — только улица. */
  precision: v.picklist(['house', 'block', 'street', 'locality']),
  displayName: v.string(),
  osm: v.nullable(v.object({ type: v.string(), id: v.number() })),
})

const orderBaseSchema = v.object({
  id,
  pointId: id,
  bkType: v.string(),
  hdType: v.string(),
  district: v.string(),
  address: v.string(),
  connection: v.nullable(v.picklist(['FMC', 'FTTB'])),
  gigabit: v.boolean(),
  skill: skillSchema,
  durationMin: positiveInt,
  availableFrom: clock,
  priority: v.picklist(PRIORITIES),
  transport: v.optional(transportSchema),
  equipment: equipmentSchema,
  /** Окно из источника. */
  sourceWindow: timeWindowSchema,
  /** Действующее окно: источник, пересечённый со сменой. */
  window: timeWindowSchema,
})

const orderSchema = v.object({
  ...orderBaseSchema.entries,
  source: v.object({ file: v.string(), row: positiveInt }),
  control: v.object({
    id: v.string(),
    status: v.string(),
    team: v.nullable(v.string()),
  }),
})

const engineerSchema = v.object({
  id,
  name: v.string(),
  controlTeam: v.string(),
  startPointId: id,
  shift: timeWindowSchema,
  skills: v.pipe(v.array(skillSchema), v.minLength(1), v.maxLength(3)),
  transport: transportSchema,
  equipment: equipmentSchema,
  /** Категории BK из контрольного файла, по которым выведены навыки. */
  skillBasis: v.array(v.string()),
})

const matrixSchema = v.object({
  graph: v.picklist(['car', 'bicycle', 'foot']),
  source: v.object({
    endpoint: v.string(),
    fetchedAt: v.string(),
    /** Версия данных OSRM, если сервер её сообщил. */
    dataVersion: v.nullable(v.string()),
  }),
  units: v.object({ distance: v.literal('m'), duration: v.literal('s') }),
  /** Расстояние от исходной координаты до точки привязки к графу, по порядку pointIds. */
  snapDistanceM: v.array(nonNegative),
  /** `null` — OSRM не нашёл маршрут в этом графе. */
  distanceM: v.array(v.array(v.nullable(nonNegative))),
  durationS: v.array(v.array(v.nullable(nonNegative))),
  /** Достижимые пары, для которых leg маршрута не сошёлся с таблицей: геометрии нет, числа матрицы верны. */
  geometryGaps: v.array(v.object({ from: id, to: id, detail: v.string() })),
})

const travelModelSchema = v.object({
  /** Общественный транспорт: граф foot, условная скорость и надбавка на переезд. */
  publicTransport: v.object({ speedKmh: positive, transferMin: nonNegative }),
  /** Только для точек вне матриц: гаверсинус × factor и скорость по транспорту. */
  approximation: v.object({
    factor: positive,
    speedKmh: v.object({ car: positive, bicycle: positive, foot: positive, public: positive }),
  }),
})

const assumptionsSchema = v.object({
  shift: timeWindowSchema,
  durationMinByHdType: v.record(v.string(), positiveInt),
  /** Норматив всех заявок с аварийным приоритетом, включая HD «Информация». */
  emergencyDurationMin: v.literal(100),
  skillByBkType: v.record(v.string(), skillSchema),
  priorityByBkType: v.record(v.string(), v.picklist(PRIORITIES)),
  /** Время поступления в CSV отсутствует; все исходные заявки доступны с начала смены. */
  orderAvailability: v.literal('shift-start'),
  carRequiredHdTypes: v.array(v.string()),
  /** Расход по типам HD и утренний комплект — демонстрационная модель команды. */
  equipmentByHdType: v.record(v.string(), equipmentSchema),
  equipmentPerQualifiedEngineer: equipmentSchema,
  travelModel: travelModelSchema,
  /** Модельные параметры и соответствие BK задаёт команда; два правила — организаторы. */
  provenance: v.object({
    model: v.literal('team'),
    emergencyDurationMin: v.literal('organizer'),
    priorityOrder: v.literal('organizer'),
  }),
})

const urgentOrderEventSchema = v.object({
  kind: v.literal('urgent-order'),
  /** Модельное время события, HH:MM. */
  at: clock,
  order: orderBaseSchema,
})

export const preparedDatasetSchema = v.object({
  formatVersion: v.literal(PREPARED_FORMAT_VERSION),
  group: v.picklist(GROUPS),
  title: v.string(),
  day: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  timezone: v.literal('Europe/Moscow'),
  generatedAt: v.string(),
  sources: v.array(v.object({ file: v.string(), sha256: v.string(), records: v.number() })),
  assumptions: assumptionsSchema,
  points: v.array(pointSchema),
  orders: v.array(orderSchema),
  engineers: v.array(engineerSchema),
  events: v.array(urgentOrderEventSchema),
  travel: v.object({
    pointIds: v.array(id),
    profiles: v.object({ car: matrixSchema, bicycle: matrixSchema, foot: matrixSchema }),
    geometryFile: v.string(),
  }),
})

export const geometryFileSchema = v.object({
  formatVersion: v.literal(PREPARED_FORMAT_VERSION),
  pointIds: v.array(id),
  encoding: v.literal('polyline5'),
  /** Геометрия ребра i→j по фактическому графу профиля; `null` — маршрута нет или геометрия не согласована. */
  profiles: v.object({
    car: v.array(v.array(v.nullable(v.string()))),
    bicycle: v.array(v.array(v.nullable(v.string()))),
    foot: v.array(v.array(v.nullable(v.string()))),
  }),
})

export type PreparedDataset = v.InferOutput<typeof preparedDatasetSchema>
export type PreparedPoint = v.InferOutput<typeof pointSchema>
export type PreparedOrder = v.InferOutput<typeof orderSchema>
export type PreparedOrderBase = v.InferOutput<typeof orderBaseSchema>
export type PreparedEngineer = v.InferOutput<typeof engineerSchema>
export type PreparedMatrix = v.InferOutput<typeof matrixSchema>
export type PreparedAssumptions = v.InferOutput<typeof assumptionsSchema>
export type TravelModel = v.InferOutput<typeof travelModelSchema>
export type GeometryFile = v.InferOutput<typeof geometryFileSchema>

export function parsePreparedDataset(data: unknown): PreparedDataset {
  return v.parse(preparedDatasetSchema, data)
}

export function parseGeometryFile(data: unknown): GeometryFile {
  return v.parse(geometryFileSchema, data)
}

/**
 * Согласованность подготовленного набора сверх формата: уникальность ID (включая заявки событий),
 * ссылки на точки, окна внутри смены, порядок и размеры матриц. Числовые диапазоны (неотрицательные
 * матрицы, положительные скорости, часы 00–23) проверяет схема. Пустой список — набор согласован.
 */
export function checkPreparedConsistency(dataset: PreparedDataset): string[] {
  const problems: string[] = []
  const pointIds = new Set<string>()
  for (const point of dataset.points) {
    if (pointIds.has(point.id)) problems.push(`повтор точки ${point.id}`)
    pointIds.add(point.id)
  }
  const orderIds = new Set<string>()
  for (const order of dataset.orders) {
    if (orderIds.has(order.id)) problems.push(`повтор заявки ${order.id}`)
    orderIds.add(order.id)
    if (!pointIds.has(order.pointId))
      problems.push(`заявка ${order.id} ссылается на точку ${order.pointId}`)
    if (order.availableFrom !== dataset.assumptions.shift.start) {
      problems.push(`заявка ${order.id}: доступность не соответствует модели shift-start`)
    }
  }
  const engineerIds = new Set<string>()
  for (const engineer of dataset.engineers) {
    if (engineerIds.has(engineer.id)) problems.push(`повтор инженера ${engineer.id}`)
    engineerIds.add(engineer.id)
    if (!pointIds.has(engineer.startPointId)) {
      problems.push(`инженер ${engineer.id} ссылается на точку ${engineer.startPointId}`)
    }
  }
  const eventOrderIds = new Set<string>()
  for (const event of dataset.events) {
    if (orderIds.has(event.order.id))
      problems.push(`заявка события ${event.order.id} совпадает с заявкой набора`)
    if (eventOrderIds.has(event.order.id)) problems.push(`повтор заявки события ${event.order.id}`)
    eventOrderIds.add(event.order.id)
    if (!pointIds.has(event.order.pointId)) {
      problems.push(`заявка события ${event.order.id} ссылается на точку ${event.order.pointId}`)
    }
    if (event.order.availableFrom !== event.at) {
      problems.push(
        `заявка события ${event.order.id}: доступность не совпадает со временем события`,
      )
    }
  }
  const shiftStart = dataset.assumptions.shift.start
  const shiftEnd = dataset.assumptions.shift.end
  for (const order of [...dataset.orders, ...dataset.events.map((event) => event.order)]) {
    if (
      order.priority === 'emergency' &&
      order.durationMin !== dataset.assumptions.emergencyDurationMin
    ) {
      problems.push(`заявка ${order.id}: длительность аварии должна быть 100 минут`)
    }
    const { start, end } = order.window
    if (start > end || start < shiftStart || end > shiftEnd) {
      problems.push(`заявка ${order.id}: окно ${start}–${end} вне смены ${shiftStart}–${shiftEnd}`)
    }
  }
  const matrixIds = dataset.travel.pointIds
  const uniqueMatrixIds = new Set(matrixIds)
  if (
    uniqueMatrixIds.size !== matrixIds.length ||
    uniqueMatrixIds.size !== pointIds.size ||
    !matrixIds.every((pointId) => pointIds.has(pointId))
  ) {
    problems.push('порядок pointIds матриц не совпадает с множеством точек')
  }
  const n = matrixIds.length
  for (const [name, matrix] of Object.entries(dataset.travel.profiles)) {
    for (const [field, rows] of [
      ['distanceM', matrix.distanceM],
      ['durationS', matrix.durationS],
    ] as const) {
      if (rows.length !== n || rows.some((row) => row.length !== n)) {
        problems.push(`матрица ${name}.${field} не ${n}×${n}`)
      }
    }
    if (matrix.snapDistanceM.length !== n)
      problems.push(`матрица ${name}.snapDistanceM не длины ${n}`)
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const d = matrix.distanceM[i]?.[j]
        const t = matrix.durationS[i]?.[j]
        if ((d === null) !== (t === null))
          problems.push(`матрица ${name}: ячейка ${i},${j} частично недостижима`)
      }
    }
  }
  return problems
}

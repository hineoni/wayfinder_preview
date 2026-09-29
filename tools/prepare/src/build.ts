import { resolve } from 'node:path'
import {
  checkPreparedConsistency,
  formatClock,
  parseControlCsv,
  parseGeometryFile,
  parsePreparedDataset,
  parseSyntheticCsv,
  PREPARED_FORMAT_VERSION,
  decodePolyline,
  parseClock,
  toPlanInput,
  type GeometryFile,
  type PreparedDataset,
  type PreparedMatrix,
  type PreparedOrderBase,
  type PreparedPoint,
  type SyntheticRecord,
} from '@wayfinder/dataset'
import { planBaseline, validatePlan } from '@wayfinder/planner'
import { createRequestLogger } from 'evlog'
import {
  CAR_REQUIRED_HD_TYPES,
  DAY,
  DURATION_MIN_BY_HD_TYPE,
  EQUIPMENT_BY_HD_TYPE,
  EQUIPMENT_PER_QUALIFIED_ENGINEER,
  EMERGENCY_DURATION_MIN,
  GEOMETRY_TOLERANCE_M,
  ROUTING_ENDPOINTS,
  SHIFT,
  PRIORITY_BY_BK_TYPE,
  SKILL_BY_BK_TYPE,
  TIMEZONE,
  TRAVEL_MODEL,
} from './config/common'
import type { GroupConfig, UrgentOrderSpec } from './config/groups'
import { synthesizeEngineers } from './engineers'
import { Geocoder } from './geocode'
import { PREPARED_DIR, readRawCsv, writeJson } from './io'
import { encodePolyline, simplifyLine } from './polyline'
import { Router, type LonLat, type MatrixWithGeometry } from './routing'

export interface BuildOptions {
  readonly offline: boolean
}

const OFFICE_POINT_ID = 'office'

/** Собирает prepared-набор одной группы, пишет JSON и геометрию, проверяет базовый план валидатором. */
export async function buildGroup(config: GroupConfig, options: BuildOptions): Promise<void> {
  const log = createRequestLogger()
  log.set({ action: 'prepare', group: config.group })
  const synthetic = readRawCsv(config.syntheticFile)
  const control = readRawCsv(config.controlFile)
  const syntheticFile = parseSyntheticCsv(synthetic.text, config.syntheticFile)
  const controlFile = parseControlCsv(control.text, config.controlFile)
  verifyPairing(syntheticFile.records, controlFile.records)
  log.set({ orders: syntheticFile.records.length })

  const geocoder = new Geocoder(options)
  const points = new PointRegistry(geocoder)
  const officePointId = await points.register(OFFICE_POINT_ID, syntheticFile.office)

  const orders: PreparedDataset['orders'] = []
  for (const [index, record] of syntheticFile.records.entries()) {
    const controlRecord = controlFile.records[index]
    if (controlRecord === undefined) throw new Error('несогласованная длина файлов')
    const pointId = await points.register(null, record.address)
    orders.push({
      ...orderBase(record.id, pointId, record),
      source: { file: config.syntheticFile, row: record.row },
      control: { id: controlRecord.id, status: controlRecord.status, team: controlRecord.team },
    })
  }
  const events: PreparedDataset['events'] = []
  for (const spec of config.events) {
    const pointId = await points.register(null, spec.address)
    const point = points.byId(pointId)
    if (point.precision !== 'house')
      throw new Error(`Адрес события ${spec.id} найден только с точностью «${point.precision}»`)
    events.push({
      kind: 'urgent-order',
      at: spec.at,
      order: { ...orderBase(spec.id, pointId, urgentRecord(spec)), availableFrom: spec.at },
    })
  }
  const engineers = synthesizeEngineers(controlFile.records, config.transportByTeam, officePointId)
  log.set({
    points: points.list().length,
    geocodeRequests: geocoder.requests,
    precision: points.precisionSummary(),
  })

  const router = new Router(options)
  const pointIds = points.list().map((point) => point.id)
  const coordinates: LonLat[] = points.list().map((point) => [point.lon, point.lat])
  const profiles = {
    car: await router.matrix(ROUTING_ENDPOINTS.car, coordinates),
    bicycle: await router.matrix(ROUTING_ENDPOINTS.bike, coordinates),
    foot: await router.matrix(ROUTING_ENDPOINTS.foot, coordinates),
  }
  log.set({
    routingRequests: router.requests,
    mismatches: Object.fromEntries(
      Object.entries(profiles).map(([name, matrix]) => [name, matrix.mismatches.length]),
    ),
    unreachable: Object.fromEntries(
      Object.entries(profiles).map(([name, matrix]) => [
        name,
        matrix.distances.flat().filter((cell) => cell === null).length,
      ]),
    ),
    maxSnapM: Object.fromEntries(
      Object.entries(profiles).map(([name, matrix]) => [name, Math.max(...matrix.snapDistances)]),
    ),
  })

  const geometryFile = `${config.group}.geometry.json`
  const dataset: PreparedDataset = {
    formatVersion: PREPARED_FORMAT_VERSION,
    group: config.group,
    title: config.title,
    day: DAY,
    timezone: TIMEZONE,
    generatedAt: new Date().toISOString(),
    sources: [
      {
        file: config.syntheticFile,
        sha256: synthetic.sha256,
        records: syntheticFile.records.length,
      },
      { file: config.controlFile, sha256: control.sha256, records: controlFile.records.length },
    ],
    assumptions: {
      shift: { ...SHIFT },
      durationMinByHdType: { ...DURATION_MIN_BY_HD_TYPE },
      emergencyDurationMin: EMERGENCY_DURATION_MIN,
      skillByBkType: { ...SKILL_BY_BK_TYPE },
      priorityByBkType: { ...PRIORITY_BY_BK_TYPE },
      orderAvailability: 'shift-start',
      carRequiredHdTypes: [...CAR_REQUIRED_HD_TYPES],
      equipmentByHdType: { ...EQUIPMENT_BY_HD_TYPE },
      equipmentPerQualifiedEngineer: EQUIPMENT_PER_QUALIFIED_ENGINEER,
      travelModel: TRAVEL_MODEL,
      provenance: {
        model: 'team',
        emergencyDurationMin: 'organizer',
        priorityOrder: 'organizer',
      },
    },
    points: points.list(),
    orders,
    engineers,
    events,
    travel: {
      pointIds,
      profiles: {
        car: toPreparedMatrix(profiles.car, 'car', ROUTING_ENDPOINTS.car, pointIds),
        bicycle: toPreparedMatrix(profiles.bicycle, 'bicycle', ROUTING_ENDPOINTS.bike, pointIds),
        foot: toPreparedMatrix(profiles.foot, 'foot', ROUTING_ENDPOINTS.foot, pointIds),
      },
      geometryFile,
    },
  }
  const geometry: GeometryFile = {
    formatVersion: PREPARED_FORMAT_VERSION,
    pointIds,
    encoding: 'polyline5',
    profiles: {
      car: simplifyGeometry(profiles.car.geometry),
      bicycle: simplifyGeometry(profiles.bicycle.geometry),
      foot: simplifyGeometry(profiles.foot.geometry),
    },
  }

  const parsed = parsePreparedDataset(dataset)
  parseGeometryFile(geometry)
  const problems = checkPreparedConsistency(parsed)
  if (problems.length > 0)
    throw new Error(`Набор ${config.group} несогласован: ${problems.join('; ')}`)

  const input = toPlanInput(parsed)
  const plan = planBaseline(input)
  const violations = validatePlan(input, plan)
  if (violations.length > 0) {
    throw new Error(
      `Базовый план ${config.group} нарушает модель: ${violations.map((v) => `${v.code} ${v.detail}`).join('; ')}`,
    )
  }
  log.set({
    baseline: {
      unassigned: plan.metrics.unassignedTotal,
      engineersUsed: plan.metrics.engineersUsed,
      distanceKm: Math.round(plan.metrics.distanceM / 100) / 10,
      byTransport: transportUsage(parsed, plan.routes),
      violations: violations.length,
    },
  })

  writeJson(resolve(PREPARED_DIR, `${config.group}.json`), parsed)
  writeJson(resolve(PREPARED_DIR, geometryFile), geometry)
  log.emit()
}

function orderBase(id: string, pointId: string, record: SyntheticRecord): PreparedOrderBase {
  if (record.start.day !== DAY || record.end.day !== DAY) {
    throw new Error(`Заявка ${id}: дата ${record.start.day} не совпадает с модельным днём ${DAY}`)
  }
  // Границы включены, как в домене: окно 08:00–09:00 при смене с 09:00 допускает старт ровно в 09:00.
  const shiftStart = parseClock(SHIFT.start)
  const shiftEnd = parseClock(SHIFT.end)
  if (record.start.minute > shiftEnd || record.end.minute < shiftStart) {
    throw new Error(
      `Заявка ${id}: окно ${formatClock(record.start.minute)}–${formatClock(record.end.minute)} не пересекается со сменой`,
    )
  }
  const transport = CAR_REQUIRED_HD_TYPES.includes(record.hdType)
    ? { transport: 'car' as const }
    : {}
  const priority = PRIORITY_BY_BK_TYPE[record.bkType]
  return {
    id,
    pointId,
    bkType: record.bkType,
    hdType: record.hdType,
    district: record.district,
    address: record.address,
    connection: record.connection,
    gigabit: record.gigabit,
    skill: SKILL_BY_BK_TYPE[record.bkType],
    durationMin:
      priority === 'emergency' ? EMERGENCY_DURATION_MIN : DURATION_MIN_BY_HD_TYPE[record.hdType],
    availableFrom: SHIFT.start,
    priority,
    ...transport,
    equipment: EQUIPMENT_BY_HD_TYPE[record.hdType],
    sourceWindow: { start: formatClock(record.start.minute), end: formatClock(record.end.minute) },
    window: {
      start: formatClock(Math.max(record.start.minute, shiftStart)),
      end: formatClock(Math.min(record.end.minute, shiftEnd)),
    },
  }
}

function urgentRecord(spec: UrgentOrderSpec): SyntheticRecord {
  return {
    id: spec.id,
    bkType: spec.bkType,
    hdType: spec.hdType,
    start: { day: DAY, minute: parseClock(spec.window.start) },
    end: { day: DAY, minute: parseClock(spec.window.end) },
    district: spec.district,
    address: spec.address,
    connection: null,
    gigabit: false,
    row: 0,
  }
}

/** Строки синтетического и контрольного файлов соответствуют один к одному по порядку. */
function verifyPairing(
  synthetic: readonly SyntheticRecord[],
  control: readonly SyntheticRecord[],
): void {
  if (synthetic.length !== control.length) {
    throw new Error(
      `Число записей различается: синтетических ${synthetic.length}, контрольных ${control.length}`,
    )
  }
  for (const [index, a] of synthetic.entries()) {
    const b = control[index] as SyntheticRecord
    const same =
      a.bkType === b.bkType &&
      a.hdType === b.hdType &&
      a.district === b.district &&
      a.start.minute === b.start.minute &&
      a.end.minute === b.end.minute &&
      b.address.startsWith(a.address)
    if (!same)
      throw new Error(
        `Строки не совпадают: синтетическая ${a.row} (${a.id}) и контрольная ${b.row} (${b.id})`,
      )
  }
}

/** Точки набора: одинаковый нормализованный запрос → одна точка. Порядок — порядок первого появления. */
class PointRegistry {
  private readonly points: PreparedPoint[] = []
  private readonly byQuery = new Map<string, string>()

  constructor(private readonly geocoder: Geocoder) {}

  async register(fixedId: string | null, address: string): Promise<string> {
    const result = await this.geocoder.geocode(address)
    const existing = this.byQuery.get(result.query)
    if (existing !== undefined && fixedId === null) return existing
    const id = fixedId ?? `pt-${String(this.points.length).padStart(3, '0')}`
    this.points.push({ id, address, ...result })
    this.byQuery.set(result.query, id)
    return id
  }

  byId(id: string): PreparedPoint {
    const point = this.points.find((item) => item.id === id)
    if (point === undefined) throw new Error(`Нет точки ${id}`)
    return point
  }

  list(): PreparedPoint[] {
    return [...this.points]
  }

  precisionSummary(): Record<string, number> {
    const summary: Record<string, number> = {}
    for (const point of this.points) summary[point.precision] = (summary[point.precision] ?? 0) + 1
    return summary
  }
}

function toPreparedMatrix(
  matrix: MatrixWithGeometry,
  graph: PreparedMatrix['graph'],
  endpoint: string,
  pointIds: readonly string[],
): PreparedMatrix {
  return {
    graph,
    source: { endpoint, fetchedAt: matrix.fetchedAt, dataVersion: matrix.dataVersion },
    units: { distance: 'm', duration: 's' },
    snapDistanceM: matrix.snapDistances,
    distanceM: matrix.distances.map((row) =>
      row.map((cell) => (cell === null ? null : Math.round(cell))),
    ),
    durationS: matrix.durations.map((row) =>
      row.map((cell) => (cell === null ? null : Math.round(cell))),
    ),
    geometryGaps: matrix.mismatches.map((gap) => ({
      from: pointIds[gap.from] ?? String(gap.from),
      to: pointIds[gap.to] ?? String(gap.to),
      detail: gap.detail,
    })),
  }
}

function simplifyGeometry(geometry: readonly (readonly (string | null)[])[]): (string | null)[][] {
  return geometry.map((row) =>
    row.map((edge) =>
      edge === null
        ? null
        : encodePolyline(simplifyLine(decodePolyline(edge), GEOMETRY_TOLERANCE_M)),
    ),
  )
}

function transportUsage(
  dataset: PreparedDataset,
  routes: ReturnType<typeof planBaseline>['routes'],
): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const route of routes) {
    const engineer = dataset.engineers.find((item) => item.id === route.engineerId)
    if (engineer === undefined) continue
    usage[engineer.transport] = (usage[engineer.transport] ?? 0) + route.visits.length
  }
  return usage
}

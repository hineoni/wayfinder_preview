import * as v from 'valibot'
import { parseAddress } from './address'
import { parseCsvRows } from './csv'
import {
  CAR_REQUIRED_HD_TYPES,
  DURATION_MIN_BY_HD_TYPE,
  EMERGENCY_DURATION_MIN,
  EMPTY_EQUIPMENT,
  EQUIPMENT_BY_HD_TYPE,
  EQUIPMENT_PER_QUALIFIED_ENGINEER,
  PRIORITY_BY_BK_TYPE,
  SKILL_BY_BK_TYPE,
} from './defaults'
import {
  preparedDatasetSchema,
  type PreparedDataset,
  type PreparedOrder,
  type PreparedPoint,
} from './prepared'
import { BK_TYPES, HD_TYPES, CsvFormatError, parseSyntheticCsv } from './raw'
import { formatClock } from './time'

const orderFields = preparedDatasetSchema.entries.orders.item.entries
const engineerFields = preparedDatasetSchema.entries.engineers.item.entries
const pointFields = preparedDatasetSchema.entries.points.item.entries
const coordinates = { lat: pointFields.lat, lon: pointFields.lon }
const orderSchema = v.pipe(
  v.object({
    id: orderFields.id,
    ...coordinates,
    address: v.optional(v.string(), ''),
    bkType: v.optional(v.picklist(BK_TYPES, 'неизвестная категория BK')),
    hdType: v.optional(v.picklist(HD_TYPES, 'неизвестная категория HD')),
    window: orderFields.window,
    durationMin: v.optional(orderFields.durationMin),
    skill: v.optional(orderFields.skill),
    priority: v.optional(orderFields.priority),
    transport: orderFields.transport,
    equipment: v.optional(orderFields.equipment),
    district: v.optional(v.string(), ''),
    connection: v.optional(orderFields.connection, null),
    gigabit: v.optional(v.boolean(), false),
  }),
  v.check(
    (record) =>
      (record.bkType !== undefined && record.hdType !== undefined) ||
      (record.durationMin !== undefined &&
        record.skill !== undefined &&
        record.priority !== undefined),
    'укажите BK/HD либо durationMin, skill и priority',
  ),
  v.transform((record) => ({
    ...record,
    bkType:
      record.bkType ??
      (record.priority === 'emergency'
        ? 'Глобальная проблема'
        : record.priority === 'connection'
          ? 'Подключение'
          : record.skill === 'connection'
            ? 'Дозаказ'
            : 'Локальная заявка'),
    hdType: record.hdType ?? 'Информация',
  })),
)
const engineerSchema = v.object({
  id: engineerFields.id,
  name: v.pipe(v.string(), v.nonEmpty()),
  ...coordinates,
  address: v.optional(v.string(), ''),
  shift: engineerFields.shift,
  skills: engineerFields.skills,
  transport: engineerFields.transport,
  equipment: v.optional(engineerFields.equipment),
})
const customInputSchema = v.object({
  orders: v.pipe(v.array(orderSchema), v.minLength(1, 'нет заявок')),
  engineers: v.pipe(v.array(engineerSchema), v.minLength(1, 'нет инженеров')),
})

export interface CustomInputIssue {
  readonly location: string
  readonly message: string
}
export class CustomInputError extends Error {
  constructor(readonly issues: readonly CustomInputIssue[]) {
    super(issues.map((issue) => `${issue.location}: ${issue.message}`).join('; '))
    this.name = 'CustomInputError'
  }
}

function addressKey(address: string): string {
  try {
    return JSON.stringify(parseAddress(address)).toLocaleLowerCase('ru')
  } catch {
    return address.trim().toLocaleLowerCase('ru')
  }
}

/** Атомарный импорт: матрицы базовой территории разделяются по ссылке; новые точки вне матриц. */
export function importCustomScenario(
  text: string,
  file: string,
  base: PreparedDataset,
): PreparedDataset {
  const issues: CustomInputIssue[] = []
  const points = [...base.points]
  const pointIds = new Set(points.map((point) => point.id))
  const addPoint = (record: { lat: number; lon: number; address: string }): string => {
    const known = points.find((point) => point.lat === record.lat && point.lon === record.lon)
    if (known !== undefined) return known.id
    let id = `custom-point-${points.length + 1}`
    while (pointIds.has(id)) id += '-new'
    pointIds.add(id)
    points.push({
      lat: record.lat,
      lon: record.lon,
      address: record.address,
      id,
      query: record.address,
      precision: 'house',
      displayName: record.address,
      osm: null,
    })
    return id
  }
  let data: unknown
  const csvRows: number[] = []
  if (/\.csv$/i.test(file)) {
    let source
    try {
      source = parseSyntheticCsv(text, file)
    } catch (cause) {
      if (cause instanceof CsvFormatError)
        throw new CustomInputError(
          cause.issues.map((issue) => ({
            location: `строка ${issue.row}`,
            message: issue.message,
          })),
        )
      throw cause
    }
    const table = parseCsvRows(text)
    const cellsByRow = new Map(table.map((record) => [record.row, record.cells]))
    const header = table[0]?.cells.map((cell) => cell.trim()) ?? []
    const latIndex = header.indexOf('Широта')
    const lonIndex = header.indexOf('Долгота')
    const addresses = new Map<string, PreparedPoint>()
    for (const point of base.points) addresses.set(addressKey(point.address), point)
    data = {
      orders: source.records.map((record) => {
        csvRows.push(record.row)
        const cells = cellsByRow.get(record.row) ?? []
        const lat = cells[latIndex]?.trim() ?? ''
        const lon = cells[lonIndex]?.trim() ?? ''
        const known = addresses.get(addressKey(record.address))
        if (record.start.day !== base.day || record.end.day !== base.day)
          issues.push({ location: `строка ${record.row}`, message: `ожидается день ${base.day}` })
        if (lat === '' && lon === '' && known === undefined)
          issues.push({
            location: `строка ${record.row}`,
            message: 'адрес не найден в выбранной территории; укажите Широта и Долгота',
          })
        return {
          ...record,
          lat: lat === '' && lon === '' ? known?.lat : Number(lat.replace(',', '.')),
          lon: lat === '' && lon === '' ? known?.lon : Number(lon.replace(',', '.')),
          window: { start: formatClock(record.start.minute), end: formatClock(record.end.minute) },
        }
      }),
      engineers: base.engineers.map((engineer) => ({
        ...engineer,
        ...base.points.find((point) => point.id === engineer.startPointId),
        id: engineer.id,
      })),
    }
    // Одна координата не означает нулевую вторую координату.
    for (const row of csvRows) {
      const cells = cellsByRow.get(row) ?? []
      if (Boolean(cells[latIndex]?.trim()) !== Boolean(cells[lonIndex]?.trim()))
        issues.push({ location: `строка ${row}`, message: 'укажите обе координаты' })
    }
  } else if (/\.json$/i.test(file)) {
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
      throw new CustomInputError([{ location: 'JSON', message: 'неверный синтаксис JSON' }])
    }
  } else throw new CustomInputError([{ location: 'Файл', message: 'выберите CSV или JSON' }])
  const result = v.safeParse(customInputSchema, data)
  const location = (kind: string, index: number) =>
    kind === 'orders' && csvRows[index] !== undefined
      ? `строка ${csvRows[index]}`
      : `${kind}[${index + 1}]`
  if (!result.success) {
    for (const issue of result.issues) {
      const path = issue.path ?? []
      const key = path[0]?.key
      const kind = typeof key === 'string' ? key : 'JSON'
      const index = path[1]?.key
      issues.push({
        location:
          typeof index === 'number'
            ? `${location(kind, index)}.${path
                .slice(2)
                .map((part) => part.key)
                .join('.')}`
            : kind,
        message: issue.message,
      })
    }
    throw new CustomInputError(issues)
  }
  for (const kind of ['orders', 'engineers'] as const) {
    const ids = new Set<string>()
    result.output[kind].forEach((record, index) => {
      if (ids.has(record.id))
        issues.push({ location: location(kind, index), message: `повтор ID ${record.id}` })
      ids.add(record.id)
      const window = 'window' in record ? record.window : record.shift
      if (window.start > window.end)
        issues.push({ location: location(kind, index), message: 'начало позже окончания' })
      if (
        window.end < base.assumptions.shift.start ||
        window.start > base.assumptions.shift.end ||
        (kind === 'engineers' &&
          (window.start < base.assumptions.shift.start || window.end > base.assumptions.shift.end))
      )
        issues.push({
          location: location(kind, index),
          message: 'окно вне модельной смены территории',
        })
    })
  }
  if (issues.length > 0) throw new CustomInputError(issues)
  const orders: PreparedOrder[] = result.output.orders.map((record, index) => {
    const priority = record.priority ?? PRIORITY_BY_BK_TYPE[record.bkType]
    const transport =
      record.transport ?? (CAR_REQUIRED_HD_TYPES.includes(record.hdType) ? 'car' : undefined)
    return {
      ...record,
      pointId: addPoint(record),
      priority,
      skill: record.skill ?? SKILL_BY_BK_TYPE[record.bkType],
      durationMin:
        priority === 'emergency'
          ? EMERGENCY_DURATION_MIN
          : (record.durationMin ?? DURATION_MIN_BY_HD_TYPE[record.hdType]),
      ...(transport === undefined ? {} : { transport }),
      equipment: record.equipment ?? { ...EQUIPMENT_BY_HD_TYPE[record.hdType] },
      availableFrom: base.assumptions.shift.start,
      sourceWindow: record.window,
      window: {
        start:
          record.window.start < base.assumptions.shift.start
            ? base.assumptions.shift.start
            : record.window.start,
        end:
          record.window.end > base.assumptions.shift.end
            ? base.assumptions.shift.end
            : record.window.end,
      },
      source: { file, row: csvRows[index] ?? index + 1 },
      control: { id: record.id, status: '', team: null },
    }
  })
  const engineers = /\.csv$/i.test(file)
    ? base.engineers
    : result.output.engineers.map((record) => ({
        ...record,
        startPointId: addPoint(record),
        controlTeam: '',
        skillBasis: [],
        equipment:
          record.equipment ??
          (record.transport !== 'car'
            ? { ...EMPTY_EQUIPMENT }
            : {
                'emergency-kit': record.skills.includes('emergency')
                  ? EQUIPMENT_PER_QUALIFIED_ENGINEER['emergency-kit']
                  : 0,
                router: record.skills.includes('connection')
                  ? EQUIPMENT_PER_QUALIFIED_ENGINEER.router
                  : 0,
                'tv-box': record.skills.includes('local')
                  ? EQUIPMENT_PER_QUALIFIED_ENGINEER['tv-box']
                  : 0,
                'cable-kit': record.skills.includes('local')
                  ? EQUIPMENT_PER_QUALIFIED_ENGINEER['cable-kit']
                  : 0,
              }),
      }))
  return {
    ...base,
    title: file,
    generatedAt: new Date().toISOString(),
    sources: [{ file, sha256: '', records: orders.length }],
    points,
    orders,
    engineers,
    events: [],
  }
}

import * as v from 'valibot'
import { parseCsvRows } from './csv'
import { parseSourceDateTime, type SourceDateTime } from './time'

/** Наблюдаемые значения справочников источника (datasets/README.md). Новое значение — ошибка формата. */
export const BK_TYPES = [
  'Подключение',
  'Дозаказ',
  'Локальная заявка',
  'Глобальная проблема',
] as const
export type BkType = (typeof BK_TYPES)[number]

export const HD_TYPES = [
  'IP-адрес 169...',
  'TVE/ENT. Другие ошибки',
  'TVE/ENT. Замена приставки техником',
  'Авария',
  'Дозаказ оборудования',
  'Заказ подключения/Дозаказ оборудования',
  'Заявка на подключение',
  'Информация',
  'Конвергенция абонента',
  'Мониторинг',
  'Нет линка',
  'Низкая скорость',
  'Переключение на Гбит/с',
  'Работа с кабелем',
  'Разрывы',
  'Рост ошибок на порту',
  'Роутер. Замена техническим специалистом',
  'ТВ. Замена приставки техником',
] as const
export type HdType = (typeof HD_TYPES)[number]

export const CONTROL_STATUSES = [
  'Не отправлена',
  'Отправлена',
  'В пути',
  'Отменена',
  'В работе',
  'Выполнена',
  'Просрочена',
] as const

const nonEmpty = v.pipe(v.string(), v.trim(), v.nonEmpty('пустое значение'))
const dateTime = v.pipe(
  nonEmpty,
  v.transform((text): SourceDateTime => parseSourceDateTime(text)),
)
const yesNo = v.pipe(
  v.picklist(['Да', 'Нет'], 'ожидается «Да» или «Нет»'),
  v.transform((value) => value === 'Да'),
)
const optionalText = v.pipe(
  v.optional(v.string(), ''),
  v.trim(),
  v.transform((value) => (value === '' ? null : value)),
)

const commonColumns = {
  Заявка: nonEmpty,
  'Тип заявки BK': v.picklist(BK_TYPES, 'неизвестный «Тип заявки BK»'),
  'Тип заявки HD': v.picklist(HD_TYPES, 'неизвестный «Тип заявки HD»'),
  Начало: dateTime,
  Окончание: dateTime,
  Район: nonEmpty,
  Адрес: nonEmpty,
  Подключение: v.pipe(
    v.optional(v.string(), ''),
    v.trim(),
    v.picklist(['FMC', 'FTTB', ''], 'ожидается FMC, FTTB или пусто'),
    v.transform((value) => (value === '' ? null : value)),
  ),
  'Гигабитное подключение': yesNo,
}

function windowIsOrdered<T extends { Начало: SourceDateTime; Окончание: SourceDateTime }>() {
  return v.check<T, string>(
    (row) => row.Начало.day === row.Окончание.day && row.Начало.minute < row.Окончание.minute,
    '«Начало» должно быть раньше «Окончание» в тот же день',
  )
}

const syntheticColumns = v.object(commonColumns)
const controlColumns = v.object({
  ...commonColumns,
  'Статус BK': v.picklist(CONTROL_STATUSES, 'неизвестный «Статус BK»'),
  Бригада: optionalText,
})
const syntheticRowSchema = v.pipe(
  syntheticColumns,
  windowIsOrdered<v.InferOutput<typeof syntheticColumns>>(),
)
const controlRowSchema = v.pipe(
  controlColumns,
  windowIsOrdered<v.InferOutput<typeof controlColumns>>(),
)

export interface SyntheticRecord {
  readonly id: string
  readonly bkType: BkType
  readonly hdType: HdType
  readonly start: SourceDateTime
  readonly end: SourceDateTime
  readonly district: string
  readonly address: string
  readonly connection: 'FMC' | 'FTTB' | null
  readonly gigabit: boolean
  /** Номер строки в исходном файле, заголовок — строка 1. */
  readonly row: number
}

export interface ControlRecord extends SyntheticRecord {
  readonly status: (typeof CONTROL_STATUSES)[number]
  readonly team: string | null
}

export interface CsvIssue {
  readonly row: number
  readonly message: string
}

export class CsvFormatError extends Error {
  constructor(
    readonly file: string,
    readonly issues: readonly CsvIssue[],
  ) {
    super(`${file}: ${issues.map((issue) => `строка ${issue.row}: ${issue.message}`).join('; ')}`)
    this.name = 'CsvFormatError'
  }
}

export interface SyntheticFile {
  readonly records: readonly SyntheticRecord[]
  readonly office: string
}

export interface ControlFile {
  readonly records: readonly ControlRecord[]
}

/** Синтетический файл: заявки, в конце пустые строки и строка «Адрес офиса». */
export function parseSyntheticCsv(text: string, file: string): SyntheticFile {
  const { header, rows, issues } = readTable(text)
  let office: string | null = null
  const records: SyntheticRecord[] = []
  for (const { row, cells } of rows) {
    if (isOfficeRow(cells)) {
      const address = cells[1]?.trim() ?? ''
      if (address === '') issues.push({ row, message: 'строка офиса без адреса во второй ячейке' })
      else if (office !== null) issues.push({ row, message: 'повторная строка офиса' })
      else office = address
      continue
    }
    let parsed: v.InferOutput<typeof syntheticRowSchema> | null = null
    try {
      parsed = parseRow(syntheticRowSchema, header, cells, row, issues)
    } catch (cause) {
      issues.push({ row, message: cause instanceof Error ? cause.message : 'Неверная дата' })
    }
    if (parsed !== null) records.push(toSynthetic(parsed, row))
  }
  if (office === null) {
    issues.push({ row: rows.length + 1, message: 'не найдена строка «Адрес офиса»' })
    throw new CsvFormatError(file, issues)
  }
  if (issues.length > 0) throw new CsvFormatError(file, issues)
  return { records, office }
}

/** Контрольный файл: те же заявки со статусом и бригадой, без строки офиса. */
export function parseControlCsv(text: string, file: string): ControlFile {
  const { header, rows, issues } = readTable(text)
  const records: ControlRecord[] = []
  for (const { row, cells } of rows) {
    if (isOfficeRow(cells)) {
      issues.push({ row, message: 'неожиданная строка офиса в контрольном файле' })
      continue
    }
    const parsed = parseRow(controlRowSchema, header, cells, row, issues)
    if (parsed !== null) {
      records.push({
        ...toSynthetic(parsed, row),
        status: parsed['Статус BK'],
        team: parsed['Бригада'],
      })
    }
  }
  if (issues.length > 0) throw new CsvFormatError(file, issues)
  return { records }
}

function toSynthetic(
  parsed: v.InferOutput<typeof syntheticRowSchema>,
  row: number,
): SyntheticRecord {
  return {
    id: parsed['Заявка'],
    bkType: parsed['Тип заявки BK'],
    hdType: parsed['Тип заявки HD'],
    start: parsed['Начало'],
    end: parsed['Окончание'],
    district: parsed['Район'],
    address: parsed['Адрес'],
    connection: parsed['Подключение'],
    gigabit: parsed['Гигабитное подключение'],
    row,
  }
}

function readTable(text: string) {
  const issues: CsvIssue[] = []
  const table = parseCsvRows(text)
  const header = (table[0]?.cells ?? []).map((name) => name.trim())
  if (header.length === 0 || header[0] === '')
    throw new CsvFormatError('csv', [{ row: 1, message: 'нет заголовка' }])
  const rows: { row: number; cells: string[] }[] = []
  table.slice(1).forEach(({ cells, row }) => {
    if (cells.every((cell) => cell.trim() === '')) return
    if (cells.length !== header.length) {
      issues.push({ row, message: `ячеек ${cells.length}, в заголовке ${header.length}` })
      return
    }
    rows.push({ row, cells })
  })
  return { header, rows, issues }
}

function isOfficeRow(cells: readonly string[]): boolean {
  return (cells[0] ?? '').trim().toLowerCase() === 'адрес офиса'
}

function parseRow<TSchema extends v.GenericSchema>(
  schema: TSchema,
  header: readonly string[],
  cells: readonly string[],
  row: number,
  issues: CsvIssue[],
): v.InferOutput<TSchema> | null {
  const record = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']))
  const result = v.safeParse(schema, record)
  if (result.success) return result.output
  for (const issue of result.issues) {
    const column = issue.path?.map((segment) => String(segment.key)).join('.')
    issues.push({
      row,
      message: column === undefined ? issue.message : `${column}: ${issue.message}`,
    })
  }
  return null
}

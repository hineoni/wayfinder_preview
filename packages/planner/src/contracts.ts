/** Справочники ТЗ 2.4.1. Подписи для диспетчера формирует UI. */
export const SKILLS = ['connection', 'local', 'emergency'] as const
export type Skill = (typeof SKILLS)[number]

export const TRANSPORTS = ['car', 'foot', 'bicycle', 'public'] as const
export type Transport = (typeof TRANSPORTS)[number]

export const EQUIPMENT_KINDS = ['emergency-kit', 'router', 'tv-box', 'cable-kit'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

/** Неотрицательный целочисленный дневной запас или расход по заявке. */
export type EquipmentStock = Readonly<Record<EquipmentKind, number>>

/** От высшего к низшему: авария, подключение, ремонт/дозаказ. Не зависит от навыка. */
export const PRIORITIES = ['emergency', 'connection', 'normal'] as const
export type Priority = (typeof PRIORITIES)[number]

/**
 * Модельное время: минуты от полуночи модельного дня. Планировщик предполагает конечные числа;
 * проверка диапазонов — обязанность источника данных (Valibot-схемы в dataset), не домена.
 */
export type Minute = number

/** Предусловие: start ≤ end. */
export interface TimeWindow {
  readonly start: Minute
  readonly end: Minute
}

export interface Order {
  readonly id: string
  /** Точка на карте; пробег и время в пути берутся по ней из TravelProvider. */
  readonly pointId: string
  readonly durationMin: number
  /** Не раньше поступления; для статической выгрузки — модельное начало дня. */
  readonly availableFromMin: Minute
  /** Действующее окно: начало работы должно попасть в него. */
  readonly window: TimeWindow
  readonly priority: Priority
  readonly skill: Skill
  /** Требуемый транспорт; отсутствует, если ограничения нет. */
  readonly transport?: Transport
  /** Расходуется при начале работы и не восстанавливается перепланированием. */
  readonly equipment: EquipmentStock
}

export interface Engineer {
  readonly id: string
  readonly name: string
  readonly startPointId: string
  /** По умолчанию первый выезд отложен до окна; false у продолжения уже начатого маршрута. */
  readonly deferFirstDeparture?: boolean
  readonly shift: TimeWindow
  readonly skills: readonly Skill[]
  readonly transport: Transport
  /** Комплект, выданный бригаде в офисе перед началом дня. */
  readonly equipment: EquipmentStock
}

/** Предусловие: неотрицательные конечные числа. */
export interface TravelLeg {
  readonly distanceM: number
  readonly durationMin: number
  /** Ребро посчитано приближением, а не по подготовленной матрице. */
  readonly approximate: boolean
}

/**
 * Источник переездов. `null` — пара недостижима для этого транспорта.
 * Предусловия: детерминирован для одних и тех же аргументов; переезд точки в себя — нулевой;
 * не бросает для точек, известных сценарию.
 */
export interface TravelProvider {
  travel(transport: Transport, fromPointId: string, toPointId: string): TravelLeg | null
}

/**
 * Вход планировщика. Порядок заявок — порядок поступления; порядок инженеров — порядок входных данных.
 * Предусловия: уникальные ID заявок и инженеров, durationMin > 0, окна и смены с start ≤ end.
 * Валидатор плана проверяет уникальность ID; остальное — источник данных.
 */
export interface PlanInput {
  readonly orders: readonly Order[]
  readonly engineers: readonly Engineer[]
  readonly travel: TravelProvider
}

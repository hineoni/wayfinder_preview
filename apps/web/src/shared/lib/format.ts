export function formatMinute(value: number): string {
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Длительность в минутах: «45 мин», «1 ч», «1 ч 20 мин». */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes)
  return rounded < 60
    ? `${rounded} мин`
    : `${Math.floor(rounded / 60)} ч${rounded % 60 ? ` ${rounded % 60} мин` : ''}`
}

export function formatDistance(value: number, signed = false): string {
  const prefix = signed && value > 0 ? '+' : ''
  return Math.abs(value) < 1000
    ? `${prefix}${Math.round(value)} м`
    : `${prefix}${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`
}

export const groupLabels = {
  east: 'Восток',
  'south-east': 'Юго-восток',
  'south-center': 'Югоцентр',
} as const

export const priorityLabels = {
  emergency: 'Авария',
  connection: 'Подключение',
  normal: 'Ремонт / дозаказ',
} as const

// Названия для диспетчера; исходный тип заявки сохраняется в данных и экспорте.
const workTypeLabels: Readonly<Record<string, string>> = {
  'IP-адрес 169...': 'Восстановление получения IP-адреса',
  'TVE/ENT. Другие ошибки': 'Устранение неполадок ТВ',
  'TVE/ENT. Замена приставки техником': 'Замена ТВ-приставки',
  'ТВ. Замена приставки техником': 'Замена ТВ-приставки',
  'Роутер. Замена техническим специалистом': 'Замена роутера',
  'Заявка на подключение': 'Подключение услуг',
  'Конвергенция абонента': 'Подключение пакета услуг',
  'Заказ подключения/Дозаказ оборудования': 'Подключение / установка оборудования',
  'Дозаказ оборудования': 'Установка дополнительного оборудования',
  'Нет линка': 'Восстановление соединения',
  'Низкая скорость': 'Устранение низкой скорости',
  'Переключение на Гбит/с': 'Подключение скорости 1 Гбит/с',
  Разрывы: 'Устранение обрывов связи',
  'Рост ошибок на порту': 'Устранение ошибок сетевого порта',
  Мониторинг: 'Проверка работы связи',
}

export function workTypeLabel(value: string): string {
  return Object.hasOwn(workTypeLabels, value) ? (workTypeLabels[value] ?? value) : value
}

export function workLabel(order: {
  readonly priority: keyof typeof priorityLabels
  readonly hdType?: string
}): string {
  const label = order.hdType ? workTypeLabel(order.hdType) : undefined
  if (order.priority === 'emergency' && label && label !== 'Авария') return `Авария: ${label}`
  return label ?? priorityLabels[order.priority]
}

export const skillLabels = {
  connection: 'Работы на подключение и дозаказы',
  local: 'Локальные работы',
  emergency: 'Аварийные работы',
} as const
export const equipmentLabels = {
  'emergency-kit': 'Аварийные комплекты',
  router: 'Роутеры',
  'tv-box': 'ТВ-приставки',
  'cable-kit': 'Кабельные комплекты',
} as const

export const transportLabels = {
  car: 'Автомобиль',
  bicycle: 'Велосипед',
  foot: 'Пешком',
  public: 'Общественный транспорт',
} as const

const pluralRules = new Intl.PluralRules('ru-RU')

/** Форма слова для числа: `plural(n, ['бригада', 'бригады', 'бригад'])`. */
export function plural(count: number, forms: readonly [one: string, few: string, many: string]) {
  const category = pluralRules.select(count)
  return category === 'one' ? forms[0] : category === 'few' ? forms[1] : forms[2]
}

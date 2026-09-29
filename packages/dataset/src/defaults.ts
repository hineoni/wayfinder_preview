import type { BkType, HdType } from './raw'
import type { TravelModel } from './prepared'
import type { EquipmentStock, Priority, Skill } from '@wayfinder/planner'

/** Модель команды и норматив организаторов; происхождение записывается в prepared. */

export const DAY = '2026-08-17'
export const TIMEZONE = 'Europe/Moscow'
export const SHIFT = { start: '09:00', end: '22:00' } as const
export const EMERGENCY_DURATION_MIN = 100

/** Соответствие BK типам работ — модель команды; порядок приоритетов задан организаторами. */
export const PRIORITY_BY_BK_TYPE: Record<BkType, Priority> = {
  Подключение: 'connection',
  Дозаказ: 'normal',
  'Локальная заявка': 'normal',
  'Глобальная проблема': 'emergency',
}

export const SKILL_BY_BK_TYPE: Record<BkType, Skill> = {
  Подключение: 'connection',
  Дозаказ: 'connection',
  'Локальная заявка': 'local',
  'Глобальная проблема': 'emergency',
}

export const DURATION_MIN_BY_HD_TYPE: Record<HdType, number> = {
  'IP-адрес 169...': 30,
  'TVE/ENT. Другие ошибки': 40,
  'TVE/ENT. Замена приставки техником': 30,
  Авария: EMERGENCY_DURATION_MIN,
  'Дозаказ оборудования': 45,
  'Заказ подключения/Дозаказ оборудования': 75,
  'Заявка на подключение': 90,
  Информация: 30,
  'Конвергенция абонента': 60,
  Мониторинг: 30,
  'Нет линка': 45,
  'Низкая скорость': 45,
  'Переключение на Гбит/с': 45,
  'Работа с кабелем': 90,
  Разрывы: 45,
  'Рост ошибок на порту': 45,
  'Роутер. Замена техническим специалистом': 30,
  'ТВ. Замена приставки техником': 30,
}

/** Заявки с оборудованием или кабелем требуют автомобиль (демонстрационное правило). */
export const CAR_REQUIRED_HD_TYPES: readonly HdType[] = [
  'Дозаказ оборудования',
  'Заказ подключения/Дозаказ оборудования',
  'Работа с кабелем',
  'Роутер. Замена техническим специалистом',
  'TVE/ENT. Замена приставки техником',
  'ТВ. Замена приставки техником',
  'Авария',
]

export const EMPTY_EQUIPMENT: EquipmentStock = {
  'emergency-kit': 0,
  router: 0,
  'tv-box': 0,
  'cable-kit': 0,
}

/** Демонстрационный расход: одна единица профильного комплекта на заявку. */
export const EQUIPMENT_BY_HD_TYPE: Record<HdType, EquipmentStock> = Object.fromEntries(
  Object.keys(DURATION_MIN_BY_HD_TYPE).map((hdType) => [hdType, { ...EMPTY_EQUIPMENT }]),
) as Record<HdType, EquipmentStock>
EQUIPMENT_BY_HD_TYPE['Авария'] = { ...EMPTY_EQUIPMENT, 'emergency-kit': 1 }
EQUIPMENT_BY_HD_TYPE['Дозаказ оборудования'] = { ...EMPTY_EQUIPMENT, router: 1 }
EQUIPMENT_BY_HD_TYPE['Заказ подключения/Дозаказ оборудования'] = {
  ...EMPTY_EQUIPMENT,
  router: 1,
}
EQUIPMENT_BY_HD_TYPE['Роутер. Замена техническим специалистом'] = {
  ...EMPTY_EQUIPMENT,
  router: 1,
}
EQUIPMENT_BY_HD_TYPE['TVE/ENT. Замена приставки техником'] = {
  ...EMPTY_EQUIPMENT,
  'tv-box': 1,
}
EQUIPMENT_BY_HD_TYPE['ТВ. Замена приставки техником'] = {
  ...EMPTY_EQUIPMENT,
  'tv-box': 1,
}
EQUIPMENT_BY_HD_TYPE['Работа с кабелем'] = { ...EMPTY_EQUIPMENT, 'cable-kit': 1 }

/** Запас достаточен для статического дня, но конечен и переносится в остаток перепланирования. */
export const EQUIPMENT_PER_QUALIFIED_ENGINEER: EquipmentStock = {
  'emergency-kit': 3,
  router: 4,
  'tv-box': 3,
  'cable-kit': 3,
}

export const TRAVEL_MODEL: TravelModel = {
  publicTransport: { speedKmh: 18, transferMin: 10 },
  approximation: { factor: 1.3, speedKmh: { car: 30, bicycle: 15, foot: 5, public: 18 } },
}

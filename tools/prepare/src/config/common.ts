export {
  DAY,
  TIMEZONE,
  SHIFT,
  EMERGENCY_DURATION_MIN,
  PRIORITY_BY_BK_TYPE,
  SKILL_BY_BK_TYPE,
  DURATION_MIN_BY_HD_TYPE,
  CAR_REQUIRED_HD_TYPES,
  EMPTY_EQUIPMENT,
  EQUIPMENT_BY_HD_TYPE,
  EQUIPMENT_PER_QUALIFIED_ENGINEER,
  TRAVEL_MODEL,
} from '@wayfinder/dataset'

/**
 * OSRM-графы по профилям. По умолчанию — публичные графы FOSSGIS (по одному на профиль).
 * Локальный osrm-backend подключается через переменные окружения.
 */
export const ROUTING_ENDPOINTS = {
  car: process.env['OSRM_CAR_URL'] ?? 'https://routing.openstreetmap.de/routed-car',
  bike: process.env['OSRM_BIKE_URL'] ?? 'https://routing.openstreetmap.de/routed-bike',
  foot: process.env['OSRM_FOOT_URL'] ?? 'https://routing.openstreetmap.de/routed-foot',
} as const

export const NOMINATIM_URL = process.env['NOMINATIM_URL'] ?? 'https://nominatim.openstreetmap.org'

/** Идентификация приложения для публичных сервисов; контакт задаётся через окружение. */
export const USER_AGENT = `wayfinder-prepare/0.1 (${process.env['PREPARE_CONTACT'] ?? 'wayfinder route planner prototype'})`

/** Публичные сервисы: не чаще одного запроса в секунду. */
export const REQUEST_INTERVAL_MS = 1100

/** Допуск сверки leg маршрута с ячейкой таблицы того же графа: расстояние и время. */
export const LEG_TOLERANCE = { absoluteM: 20, absoluteS: 5, relative: 0.01 }

/** Упрощение геометрии рёбер (Дуглас — Пекер), метры. */
export const GEOMETRY_TOLERANCE_M = 8

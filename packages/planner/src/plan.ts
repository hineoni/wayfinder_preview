import type {
  EquipmentKind,
  EquipmentStock,
  Minute,
  Skill,
  Transport,
  TravelLeg,
} from './contracts'

export interface Visit {
  readonly orderId: string
  /** Переезд от предыдущей точки маршрута (стартовой точки для первого визита). */
  readonly travel: TravelLeg
  readonly arrivalMin: Minute
  readonly startMin: Minute
  readonly waitMin: number
  readonly endMin: Minute
  /** Остаток дневного комплекта после начала этой работы. */
  readonly equipmentRemaining: EquipmentStock
  /** Факты назначения, рассчитанные по окончательному маршруту. */
  readonly explanation: AssignmentExplanation
}

export type AddedDistance =
  | { readonly status: 'defined'; readonly distanceM: number }
  | { readonly status: 'undefined'; readonly reason: 'connecting-leg-unreachable' }

export interface AssignmentExplanation {
  readonly engineerId: string
  readonly requiredSkill: Skill
  readonly skillMatched: true
  readonly requiredTransport?: Transport
  readonly transportMatched: true
  readonly arrivalMin: Minute
  readonly waitMin: number
  readonly startMin: Minute
  readonly endMin: Minute
  /** Разница пробега этого маршрута с заявкой и без неё; не вклад в глобальный оптимум. */
  readonly addedDistance: AddedDistance
  readonly approximate: boolean
}

export interface Route {
  readonly engineerId: string
  readonly visits: readonly Visit[]
  readonly distanceM: number
  /** Хотя бы одно ребро маршрута посчитано приближением. */
  readonly approximate: boolean
}

export type RejectionCode = 'skill' | 'transport' | 'equipment' | 'unreachable' | 'window' | 'shift'

/**
 * Почему заявку нельзя добавить в конец итогового маршрута конкретного инженера.
 * Факт о финальном плане, а не о промежуточном состоянии алгоритма: пересчитывается валидатором.
 */
export interface EngineerRejection {
  readonly engineerId: string
  readonly code: RejectionCode
  /** Самое раннее допустимое начало работы у этого инженера (для window и shift). */
  readonly earliestStartMin?: Minute
  /** Отказ по окну или смене опирается на приближённый переезд. */
  readonly approximate?: boolean
  readonly equipment?: EquipmentKind
  readonly requiredUnits?: number
  readonly availableUnits?: number
}

/**
 * incompatible — ни один инженер не подходит по навыку или транспорту (доказуемо по входу);
 * infeasible-in-plan — доказано, что заявка не вставляется ни в одну позицию итоговых маршрутов
 *   совместимых инженеров без изменения других визитов;
 * search-limit — алгоритм не нашёл варианта, но полноту не проверял (базовый добавляет только
 *   в конец маршрута в момент поступления и к пропущенным заявкам не возвращается).
 */
export type UnassignedClass = 'incompatible' | 'infeasible-in-plan' | 'search-limit'

export interface UnassignedOrder {
  readonly orderId: string
  readonly class: UnassignedClass
  /** Число инженеров с нужным навыком и, из них, с нужным транспортом; считается по входу. */
  readonly withSkill: number
  readonly withSkillAndTransport: number
  /**
   * По одному отказу на инженера, к которому заявку нельзя добавить в конец итогового маршрута.
   * Совместимый инженер без отказа — заявка помещается в конец его итогового маршрута;
   * такое бывает только при классе search-limit.
   */
  readonly rejections: readonly EngineerRejection[]
  /** Хотя бы один отказ опирается на приближённый переезд: неназначение может быть следствием приближения. */
  readonly approximate: boolean
}

export interface EngineerMetrics {
  readonly engineerId: string
  readonly distanceM: number
  readonly visits: number
}

export interface PlanMetrics {
  readonly unassignedEmergency: number
  readonly unassignedConnection: number
  readonly unassignedTotal: number
  readonly engineersUsed: number
  readonly distanceM: number
  readonly approximate: boolean
  readonly perEngineer: readonly EngineerMetrics[]
}

export interface Plan {
  readonly kind: 'baseline' | 'optimized'
  readonly routes: readonly Route[]
  readonly unassigned: readonly UnassignedOrder[]
  readonly metrics: PlanMetrics
}

export interface SearchStats {
  /** Число пересчётов полного расписания одного изменённого маршрута. */
  readonly candidateChecks: number
  readonly budget: number
  readonly budgetExhausted: boolean
}

export interface OptimizedPlanResult {
  readonly plan: Plan
  readonly search: SearchStats
}

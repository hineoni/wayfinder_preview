import { toPlanInput, type GeoPoint, type PreparedDataset } from '@wayfinder/dataset'
import {
  comparePlans,
  continuePlanningDay,
  engineerLowerBound,
  planBaseline,
  planOptimized,
  replanAfterEvent,
  validatePlan,
  type EngineerLowerBound,
  type Plan,
  type PlanComparison,
  type PlanningEvent,
  type ReplanResult,
  type SearchStats,
  type Violation,
} from '@wayfinder/planner'

export interface CalculationResult {
  readonly baseline: Plan
  readonly optimized: Plan
  readonly comparison: PlanComparison
  readonly violations: readonly Violation[]
  readonly search: SearchStats
  readonly lowerBound: EngineerLowerBound
}

/** Остаток дня после события: от улучшенного плана или от предыдущего перепланирования. */
export interface ReplanRequest {
  readonly dataset: PreparedDataset
  readonly eventPoint?: { readonly id: string; readonly coordinates: GeoPoint }
  readonly previous:
    | { readonly kind: 'plan'; readonly plan: Plan }
    | { readonly kind: 'replan'; readonly replan: ReplanResult }
  readonly event: PlanningEvent
  readonly completedOrderIds: readonly string[]
  readonly promises: Readonly<Record<string, number>>
}

export type PlanningJob =
  | { readonly kind: 'plans'; readonly dataset: PreparedDataset }
  | { readonly kind: 'replan'; readonly request: ReplanRequest }

/** Базовый и улучшенный планы набора; выполняется в рабочем потоке или в тестах напрямую. */
export function calculatePlanPair(dataset: PreparedDataset): CalculationResult {
  const input = toPlanInput(dataset)
  const baseline = planBaseline(input)
  const optimized = planOptimized(input)
  return {
    baseline,
    optimized: optimized.plan,
    comparison: comparePlans(baseline, optimized.plan),
    violations: [...validatePlan(input, baseline), ...validatePlan(input, optimized.plan)],
    search: optimized.search,
    lowerBound: engineerLowerBound(input),
  }
}

/** Поиск остатка дня до локального оптимума: на загруженном дне занимает секунды. */
export function calculateReplan(request: ReplanRequest): ReplanResult {
  const { eventPoint, previous, event, promises } = request
  const input = toPlanInput(
    request.dataset,
    eventPoint === undefined ? undefined : new Map([[eventPoint.id, eventPoint.coordinates]]),
  )
  const facts = request.completedOrderIds.map((orderId) => ({
    orderId,
    status: 'completed' as const,
  }))
  return previous.kind === 'plan'
    ? replanAfterEvent(input, previous.plan, event, facts, {
        promises,
        originalOrders: input.orders,
      })
    : continuePlanningDay(input, previous.replan, event, facts, { promises })
}

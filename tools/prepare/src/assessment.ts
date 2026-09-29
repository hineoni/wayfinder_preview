import { toPlanInput, type PreparedDataset } from '@wayfinder/dataset'
import {
  EQUIPMENT_KINDS,
  comparePlans,
  engineerLowerBound,
  planBaseline,
  planOptimized,
  validatePlan,
  type PlanInput,
} from '@wayfinder/planner'

export const ASSESSMENT_CASES = [
  'original',
  'travel-plus-20',
  'work-plus-20',
  'combined-plus-20',
  'equipment-minus-one',
  'engineer-unavailable',
] as const
export type AssessmentCase = (typeof ASSESSMENT_CASES)[number]

/** Сценарии независимы: каждый строится от исходного дня, матрицы не копируются. */
function assessmentInput(dataset: PreparedDataset, scenario: AssessmentCase): PlanInput {
  const input = toPlanInput(dataset)
  const travelFactor = scenario === 'travel-plus-20' || scenario === 'combined-plus-20' ? 1.2 : 1
  const workFactor = scenario === 'work-plus-20' || scenario === 'combined-plus-20' ? 1.2 : 1
  const unavailable =
    input.engineers.find((e) => e.skills.includes('emergency')) ?? input.engineers[0]
  return {
    ...input,
    orders: input.orders.map((o) =>
      o.priority === 'emergency' || workFactor === 1
        ? o
        : {
            ...o,
            durationMin: Math.ceil(o.durationMin * workFactor),
          },
    ),
    engineers: input.engineers
      .filter((e) => scenario !== 'engineer-unavailable' || e.id !== unavailable?.id)
      .map((e) => {
        if (scenario !== 'equipment-minus-one') return e
        const equipment = { ...e.equipment }
        for (const kind of EQUIPMENT_KINDS) equipment[kind] = Math.max(0, equipment[kind] - 1)
        return { ...e, equipment }
      }),
    travel: {
      travel: (...args) => {
        const leg = input.travel.travel(...args)
        return leg === null || travelFactor === 1
          ? leg
          : { ...leg, durationMin: Math.ceil(leg.durationMin * travelFactor) }
      },
    },
  }
}

export function assessDataset(dataset: PreparedDataset, scenario: AssessmentCase) {
  const input = assessmentInput(dataset, scenario)
  const baseline = planBaseline(input)
  const started = performance.now()
  const optimized = planOptimized(input)
  const optimizationMs = performance.now() - started
  const violations = [...validatePlan(input, baseline), ...validatePlan(input, optimized.plan)]
  const comparison = comparePlans(baseline, optimized.plan)
  return {
    group: dataset.group,
    scenario,
    orders: input.orders.length,
    engineerIds: input.engineers.map((e) => e.id),
    baseline: {
      assigned: input.orders.length - baseline.metrics.unassignedTotal,
      ...baseline.metrics,
    },
    optimized: {
      assigned: input.orders.length - optimized.plan.metrics.unassignedTotal,
      ...optimized.plan.metrics,
    },
    comparison,
    lowerBound: engineerLowerBound(input),
    search: optimized.search,
    optimizationMs,
    violations,
    unassigned: optimized.plan.unassigned,
  }
}

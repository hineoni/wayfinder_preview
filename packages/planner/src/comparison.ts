import {
  compareObjective,
  decisiveComponent,
  objectiveOf,
  type Objective,
  type ObjectiveComponent,
} from './metrics'
import type { Plan } from './plan'

export type ComparisonResult = 'better' | 'equal' | 'worse'

export interface PlanComparison {
  readonly baseline: Objective
  readonly candidate: Objective
  readonly result: ComparisonResult
  /** Первая компонента цели, определившая результат; `undefined` при равенстве. */
  readonly decisive: ObjectiveComponent | undefined
  /** Все разности направлены candidate − baseline; отрицательное значение лучше. */
  readonly delta: {
    readonly unassignedEmergency: number
    readonly unassignedConnection: number
    readonly unassignedTotal: number
    readonly engineersUsed: number
    readonly distanceM: number
    readonly distanceByEngineer: readonly {
      readonly engineerId: string
      readonly distanceM: number
    }[]
  }
}

export function comparePlans(baseline: Plan, candidate: Plan): PlanComparison {
  const a = objectiveOf(baseline.metrics)
  const b = objectiveOf(candidate.metrics)
  const compared = compareObjective(b, a)
  const baseDistance = new Map(
    baseline.metrics.perEngineer.map((item) => [item.engineerId, item.distanceM]),
  )
  const candidateDistance = new Map(
    candidate.metrics.perEngineer.map((item) => [item.engineerId, item.distanceM]),
  )
  const engineerIds = [...new Set([...baseDistance.keys(), ...candidateDistance.keys()])].toSorted()
  return {
    baseline: a,
    candidate: b,
    result: compared < 0 ? 'better' : compared > 0 ? 'worse' : 'equal',
    decisive: decisiveComponent(b, a),
    delta: {
      unassignedEmergency: b[0] - a[0],
      unassignedConnection: b[1] - a[1],
      unassignedTotal: b[2] - a[2],
      engineersUsed: b[3] - a[3],
      distanceM: b[4] - a[4],
      distanceByEngineer: engineerIds.map((engineerId) => ({
        engineerId,
        distanceM: (candidateDistance.get(engineerId) ?? 0) - (baseDistance.get(engineerId) ?? 0),
      })),
    },
  }
}

// ARCH-04: даже import type
import type { Plan } from '../../../../../../packages/planner/src/plan'

export const bad = (plan: Plan) => plan

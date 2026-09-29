import { EQUIPMENT_KINDS, type Engineer, type EquipmentStock, type PlanInput } from './contracts'
import { comparePlans, type PlanComparison } from './comparison'
import { assignOrderManually } from './manual-assignment'
import { compareObjective } from './metrics'
import type { Plan } from './plan'
import { validatePlan } from './validator'

export type AssignmentOption =
  | FeasibleAssignmentOption
  | {
      readonly kind: 'rejected'
      readonly engineer: Engineer
      readonly reason: 'no-feasible-position'
    }

interface FeasibleAssignmentOption {
  readonly kind: 'existing' | 'window' | 'equipment' | 'extra-engineer'
  readonly engineer: Engineer
  readonly windowExtensionMin: number
  readonly extraEquipment?: EquipmentStock
  readonly startMin: number
  /** Действующий план против варианта: результат, решающая компонента цели и разности. */
  readonly comparison: PlanComparison
  readonly changes: readonly {
    readonly orderId: string
    readonly previousStartMin: number
    readonly startMin: number
  }[]
  readonly plan: Plan
}

/**
 * Проверяет независимые варианты назначения статического дня.
 * Для назначенной заявки проверяет перенос к каждому другому совместимому инженеру;
 * варианты упорядочены по цели плана, затем по числу сдвигов времени.
 * Сохраняет исполнителей и порядок остальных визитов; сдвиги времени возвращает явно.
 * Запас и дополнительная бригада — предположения до выезда, не пополнение в течение дня.
 * Пустой результат не доказывает невозможность: проверяется только указанный набор действий.
 */
export function findAssignmentOptions(
  input: PlanInput,
  plan: Plan,
  orderId: string,
): readonly AssignmentOption[] {
  const order = input.orders.find((item) => item.id === orderId)
  if (order === undefined) return []
  const currentEngineerId = plan.routes.find((route) =>
    route.visits.some((visit) => visit.orderId === orderId),
  )?.engineerId
  if (currentEngineerId === undefined && !plan.unassigned.some((item) => item.orderId === orderId))
    return []
  const previous = new Map(plan.routes.flatMap((route) => route.visits.map((v) => [v.orderId, v])))
  const options: AssignmentOption[] = []

  function attempt(
    candidateInput: PlanInput,
    candidatePlan: Plan,
    engineer: Engineer,
    kind: FeasibleAssignmentOption['kind'],
    windowExtensionMin = 0,
    extraEquipment?: EquipmentStock,
  ): FeasibleAssignmentOption | undefined {
    const result = assignOrderManually(candidateInput, candidatePlan, orderId, engineer.id)
    if (!result.ok || validatePlan(candidateInput, result.plan).length > 0) return undefined
    const visit = result.plan.routes.flatMap((r) => r.visits).find((v) => v.orderId === orderId)!
    return {
      kind,
      engineer,
      windowExtensionMin,
      ...(extraEquipment === undefined ? {} : { extraEquipment }),
      startMin: visit.startMin,
      comparison: comparePlans(plan, result.plan),
      changes: result.plan.routes.flatMap((r) =>
        r.visits.flatMap((v) => {
          const old = previous.get(v.orderId)
          return old !== undefined && old.startMin !== v.startMin
            ? [{ orderId: v.orderId, previousStartMin: old.startMin, startMin: v.startMin }]
            : []
        }),
      ),
      plan: result.plan,
    }
  }

  function best(candidates: readonly (FeasibleAssignmentOption | undefined)[]) {
    return candidates
      .filter((item): item is FeasibleAssignmentOption => item !== undefined)
      .toSorted(
        (a, b) =>
          a.changes.length - b.changes.length ||
          a.comparison.delta.distanceM - b.comparison.delta.distanceM,
      )[0]
  }

  if (currentEngineerId !== undefined) {
    return input.engineers
      .filter(
        (engineer) =>
          engineer.id !== currentEngineerId &&
          engineer.skills.includes(order.skill) &&
          (order.transport === undefined || engineer.transport === order.transport),
      )
      .map(
        (engineer): AssignmentOption =>
          attempt(input, plan, engineer, 'existing') ?? {
            kind: 'rejected',
            engineer,
            reason: 'no-feasible-position',
          },
      )
      .toSorted((a, b) => {
        if (a.kind === 'rejected') return b.kind === 'rejected' ? 0 : 1
        if (b.kind === 'rejected') return -1
        return (
          compareObjective(a.comparison.candidate, b.comparison.candidate) ||
          a.changes.length - b.changes.length
        )
      })
  }

  const existing = best(input.engineers.map((e) => attempt(input, plan, e, 'existing')))
  if (existing !== undefined) return [existing]

  for (const extension of [30, 60, 120]) {
    if (order.window.end + extension > 1439) continue
    const changed = {
      ...input,
      orders: input.orders.map((o) =>
        o.id === orderId ? { ...o, window: { ...o.window, end: o.window.end + extension } } : o,
      ),
    }
    const option = best(input.engineers.map((e) => attempt(changed, plan, e, 'window', extension)))
    if (option !== undefined) {
      options.push(option)
      break
    }
  }

  if (EQUIPMENT_KINDS.some((kind) => order.equipment[kind] > 0)) {
    const option = best(
      input.engineers.map((e) => {
        const equipment = { ...e.equipment }
        for (const kind of EQUIPMENT_KINDS) equipment[kind] += order.equipment[kind]
        const engineer = { ...e, equipment }
        return attempt(
          {
            ...input,
            engineers: input.engineers.map((item) => (item.id === e.id ? engineer : item)),
          },
          plan,
          engineer,
          'equipment',
          0,
          order.equipment,
        )
      }),
    )
    if (option !== undefined) options.push(option)
  }

  let extraId = 'additional-engineer'
  while (input.engineers.some((e) => e.id === extraId)) extraId += '-1'
  const extra = best(
    input.engineers.map((template) => {
      const engineer: Engineer = {
        ...template,
        id: extraId,
        name: 'Дополнительная бригада',
        skills: [order.skill],
        transport: order.transport ?? template.transport,
        equipment: order.equipment,
      }
      const changed = { ...input, engineers: [...input.engineers, engineer] }
      const seed = {
        ...plan,
        routes: [
          ...plan.routes,
          { engineerId: extraId, visits: [], distanceM: 0, approximate: false },
        ],
      }
      return attempt(changed, seed, engineer, 'extra-engineer')
    }),
  )
  if (extra !== undefined) options.push(extra)
  return options
}

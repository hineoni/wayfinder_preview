import { describe, expect, it } from 'vitest'
import { comparePlans } from '../src/comparison'
import { objectiveOf } from '../src/metrics'
import { planOptimized } from '../src/optimized'
import { planBaseline } from '../src/baseline'
import { validatePlan } from '../src/validator'
import { engineer, order, tableTravel } from './fixtures'
import type { Engineer, Order, PlanInput } from '../src/contracts'
import type { Objective } from '../src/metrics'

describe('planOptimized', () => {
  it('вставляет раннюю заявку перед поздней и строго улучшает baseline', () => {
    const input = {
      orders: [
        order({ id: 'late', window: { start: 660, end: 660 }, durationMin: 60 }),
        order({ id: 'early', window: { start: 600, end: 630 }, durationMin: 30 }),
      ],
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 720 } })],
      travel: tableTravel({
        'office>late': [1000, 10],
        'office>early': [1000, 10],
        'early>late': [1000, 10],
        'late>early': [1000, 10],
      }),
    }
    const baseline = planBaseline(input)
    const result = planOptimized(input)
    expect(baseline.unassigned.map((item) => item.orderId)).toEqual(['early'])
    expect(result.plan.routes[0]?.visits.map((visit) => visit.orderId)).toEqual(['early', 'late'])
    expect(result.plan.unassigned).toEqual([])
    expect(comparePlans(baseline, result.plan).result).toBe('better')
    expect(validatePlan(input, result.plan)).toEqual([])
  })

  it('авария вытесняет обычную заявку', () => {
    const input = {
      orders: [
        order({ id: 'normal', window: { start: 540, end: 550 }, durationMin: 100 }),
        order({
          id: 'urgent',
          priority: 'emergency',
          window: { start: 540, end: 550 },
          durationMin: 100,
        }),
      ],
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 650 } })],
      travel: tableTravel({ 'office>normal': [1, 0], 'office>urgent': [1, 0] }),
    }
    const plan = planOptimized(input).plan
    expect(plan.routes[0]?.visits.map((visit) => visit.orderId)).toEqual(['urgent'])
    expect(plan.metrics.unassignedEmergency).toBe(0)
    expect(validatePlan(input, plan)).toEqual([])
  })

  it.each(['emergency', 'connection'] as const)(
    '%s важнее двух заявок следующего уровня даже при одинаковом навыке',
    (priority) => {
      const lowerPriority = priority === 'emergency' ? 'connection' : 'normal'
      const input = {
        orders: [
          order({
            id: 'repair-or-extra-1',
            pointId: 'office',
            priority: lowerPriority,
            skill: 'connection',
            durationMin: 50,
            window: { start: 540, end: 640 },
          }),
          order({
            id: 'repair-or-extra-2',
            pointId: 'office',
            priority: lowerPriority,
            skill: 'connection',
            durationMin: 50,
            window: { start: 540, end: 640 },
          }),
          order({
            id: 'higher',
            pointId: 'office',
            priority,
            skill: 'connection',
            durationMin: 100,
            window: { start: 540, end: 640 },
          }),
        ],
        engineers: [engineer({ id: 'e1', shift: { start: 540, end: 640 } })],
        travel: tableTravel({}),
      }
      const baseline = planBaseline(input)
      const result = planOptimized(input).plan
      expect(baseline.routes[0]!.visits.map((visit) => visit.orderId)).toEqual([
        'repair-or-extra-1',
        'repair-or-extra-2',
      ])
      expect(result.routes[0]!.visits.map((visit) => visit.orderId)).toEqual(['higher'])
      expect(result.metrics.unassignedTotal).toBe(2)
      const comparison = comparePlans(baseline, result)
      expect(comparison.result).toBe('better')
      expect(comparison.delta).toMatchObject({
        unassignedEmergency: priority === 'emergency' ? -1 : 0,
        unassignedConnection: priority === 'connection' ? -1 : 2,
        unassignedTotal: 1,
        engineersUsed: 0,
        distanceM: 0,
      })
      expect(objectiveOf(result.metrics)).toEqual(exhaustiveObjective(input))
      expect(validatePlan(input, result)).toEqual([])
    },
  )

  it.each([planBaseline, (input: PlanInput) => planOptimized(input).plan])(
    'учитывает поступление отдельно от окна и длительность до конца смены',
    (plan) => {
      const input = {
        orders: [
          order({
            id: 'a',
            priority: 'emergency',
            availableFromMin: 810,
            durationMin: 100,
            window: { start: 540, end: 900 },
          }),
        ],
        engineers: [engineer({ id: 'e1', shift: { start: 540, end: 910 } })],
        travel: tableTravel({ 'office>a': [100, 20] }),
      }
      const result = plan(input)
      expect(result.routes[0]!.visits[0]).toMatchObject({
        arrivalMin: 810,
        startMin: 810,
        endMin: 910,
        waitMin: 0,
      })
      expect(validatePlan(input, result)).toEqual([])
      const later = { ...input, orders: [{ ...input.orders[0]!, availableFromMin: 811 }] }
      expect(validatePlan(later, result).map((v) => v.code)).toContain('start-mismatch')
      const impossible = plan(later)
      expect(impossible.unassigned[0]?.rejections).toContainEqual({
        engineerId: 'e1',
        code: 'shift',
        earliestStartMin: 811,
      })
      expect(validatePlan(later, impossible)).toEqual([])
      const afterWindow = { ...input, orders: [{ ...input.orders[0]!, availableFromMin: 901 }] }
      const missed = plan(afterWindow)
      expect(missed.unassigned[0]?.rejections).toContainEqual({
        engineerId: 'e1',
        code: 'window',
        earliestStartMin: 901,
      })
      expect(validatePlan(afterWindow, missed)).toEqual([])
    },
  )

  it('уменьшает число инженеров даже ценой большего пробега при равном покрытии', () => {
    const input = {
      orders: [
        order({ id: 'late', window: { start: 660, end: 660 }, durationMin: 30 }),
        order({ id: 'early', window: { start: 600, end: 620 }, durationMin: 20 }),
      ],
      engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2' })],
      travel: tableTravel({
        'office>late': [100, 1],
        'office>early': [100, 1],
        'early>late': [5000, 1],
        'late>early': [100, 1],
      }),
    }
    const baseline = planBaseline(input)
    const optimized = planOptimized(input).plan
    expect(baseline.metrics.engineersUsed).toBe(2)
    expect(optimized.metrics.engineersUsed).toBe(1)
    expect(optimized.metrics.distanceM).toBeGreaterThan(baseline.metrics.distanceM)
    expect(comparePlans(baseline, optimized).result).toBe('better')
  })

  it('честно сообщает search-limit при нулевом бюджете и сохраняет baseline', () => {
    const input = {
      orders: [
        order({ id: 'late', window: { start: 660, end: 660 }, durationMin: 60 }),
        order({ id: 'early', window: { start: 600, end: 630 }, durationMin: 30 }),
      ],
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 720 } })],
      travel: tableTravel({
        'office>late': [1000, 10],
        'office>early': [1000, 10],
        'early>late': [1000, 10],
        'late>early': [1000, 10],
      }),
    }
    const baseline = planBaseline(input)
    const result = planOptimized(input, { candidateCheckBudget: 0 })
    expect(objectiveOf(result.plan.metrics)).toEqual(objectiveOf(baseline.metrics))
    expect(result.search).toEqual({ candidateChecks: 0, budget: 0, budgetExhausted: true })
    expect(result.plan.unassigned[0]?.class).toBe('search-limit')
    expect(validatePlan(input, result.plan)).toEqual([])
  })

  it('учитывает успешную последнюю разрешённую проверку кандидата', () => {
    const input = {
      orders: [
        order({ id: 'late', window: { start: 660, end: 660 }, durationMin: 60 }),
        order({ id: 'early', window: { start: 600, end: 630 }, durationMin: 30 }),
      ],
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 720 } })],
      travel: tableTravel({
        'office>late': [1000, 10],
        'office>early': [1000, 10],
        'early>late': [1000, 10],
        'late>early': [1000, 10],
      }),
    }
    const result = planOptimized(input, { candidateCheckBudget: 3 })
    expect(result.search).toEqual({ candidateChecks: 3, budget: 3, budgetExhausted: true })
    expect(result.plan.routes[0]!.visits.map((visit) => visit.orderId)).toEqual(['early', 'late'])
    expect(validatePlan(input, result.plan)).toEqual([])
  })

  it('при исчерпании внутри составных операций публикует только полностью проверенный план', () => {
    const input = {
      orders: [order({ id: 'a' }), order({ id: 'b' }), order({ id: 'c' })],
      engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2' })],
      travel: tableTravel({
        'office>a': [10, 1],
        'office>b': [20, 1],
        'office>c': [30, 1],
        'a>b': [10, 1],
        'a>c': [10, 1],
        'b>a': [10, 1],
        'b>c': [10, 1],
        'c>a': [10, 1],
        'c>b': [10, 1],
      }),
    }
    const baseline = planBaseline(input)
    for (let budget = 0; budget <= 24; budget += 1) {
      const result = planOptimized(input, { candidateCheckBudget: budget })
      expect(result.search.candidateChecks).toBeLessThanOrEqual(budget)
      expect(comparePlans(baseline, result.plan).result).not.toBe('worse')
      expect(validatePlan(input, result.plan)).toEqual([])
      expect(planOptimized(input, { candidateCheckBudget: budget })).toEqual(result)
    }
  })

  it('считает направленный добавленный пробег и явно отмечает недостижимую склейку', () => {
    const input = {
      orders: [order({ id: 'a' }), order({ id: 'b' })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [10, 1], 'a>b': [20, 1] }),
    }
    const plan = planBaseline(input)
    expect(plan.routes[0]?.visits[0]?.explanation.addedDistance).toEqual({
      status: 'undefined',
      reason: 'connecting-leg-unreachable',
    })
    expect(plan.routes[0]?.visits[1]?.explanation.addedDistance).toEqual({
      status: 'defined',
      distanceM: 20,
    })
    expect(validatePlan(input, plan)).toEqual([])
  })

  it('детерминирован и не мутирует вход', () => {
    const input = {
      orders: [order({ id: 'b' }), order({ id: 'a' })],
      engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2' })],
      travel: tableTravel({
        'office>a': [10, 1],
        'office>b': [10, 1],
        'a>b': [10, 1],
        'b>a': [10, 1],
      }),
    }
    const before = structuredClone({ orders: input.orders, engineers: input.engineers })
    expect(planOptimized(input)).toEqual(planOptimized(input))
    expect({ orders: input.orders, engineers: input.engineers }).toEqual(before)
  })

  it('совпадает с независимым полным перебором на малой эталонной задаче', () => {
    const input = {
      orders: [
        order({ id: 'late', window: { start: 650, end: 680 }, durationMin: 40 }),
        order({ id: 'early', window: { start: 560, end: 600 }, durationMin: 40 }),
        order({
          id: 'urgent',
          priority: 'emergency',
          window: { start: 600, end: 640 },
          durationMin: 30,
        }),
      ],
      engineers: [
        engineer({ id: 'e1', shift: { start: 540, end: 720 } }),
        engineer({ id: 'e2', shift: { start: 540, end: 720 } }),
      ],
      travel: tableTravel({
        'office>late': [30, 3],
        'office>early': [10, 1],
        'office>urgent': [20, 2],
        'late>early': [90, 9],
        'late>urgent': [10, 1],
        'early>late': [10, 1],
        'early>urgent': [10, 1],
        'urgent>late': [10, 1],
        'urgent>early': [90, 9],
      }),
    }
    expect(objectiveOf(planOptimized(input).plan.metrics)).toEqual(exhaustiveObjective(input))
  })

  it('обрабатывает пустой вход, отсутствие инженеров и полную несовместимость', () => {
    const empty = planOptimized({ orders: [], engineers: [], travel: tableTravel({}) }).plan
    expect(empty.routes).toEqual([])
    expect(empty.unassigned).toEqual([])
    const noEngineers = planOptimized({
      orders: [order({ id: 'a' })],
      engineers: [],
      travel: tableTravel({}),
    }).plan
    expect(noEngineers.unassigned[0]?.class).toBe('incompatible')
    const incompatibleInput = {
      orders: [order({ id: 'a', skill: 'emergency' })],
      engineers: [engineer({ id: 'e1', skills: ['local'] })],
      travel: tableTravel({}),
    }
    const incompatible = planOptimized(incompatibleInput).plan
    expect(incompatible.unassigned[0]?.class).toBe('incompatible')
    expect(validatePlan(incompatibleInput, incompatible)).toEqual([])
  })

  it('не считает сдвиг индексов после снятой заявки изменением взаимного порядка', () => {
    const travel = tableTravel({
      'office>a': [1, 1],
      'a>b': [1, 1],
      'b>c': [100, 1],
      'office>b': [100, 1],
      'office>c': [1, 1],
      'c>b': [1, 1],
    })
    const original = {
      orders: [
        order({ id: 'a', window: { start: 540, end: 1200 } }),
        order({ id: 'b', window: { start: 600, end: 1200 } }),
        order({ id: 'c', window: { start: 660, end: 1200 } }),
      ],
      engineers: [engineer({ id: 'e1' })],
      travel,
    }
    const reference = planBaseline(original)
    const changed = {
      ...original,
      orders: [order({ id: 'a', window: { start: 0, end: 0 } }), ...original.orders.slice(1)],
    }
    const result = planOptimized(changed, {
      stability: { reference },
      localSearchPasses: 8,
    }).plan
    expect(result.routes[0]?.visits.map((visit) => visit.orderId)).toEqual(['b', 'c'])
    expect(result.unassigned.map((item) => item.orderId)).toContain('a')
  })
})

function exhaustiveObjective(input: PlanInput): Objective {
  let best: Objective | undefined
  const visit = (
    index: number,
    routes: readonly (readonly Order[])[],
    unassigned: readonly Order[],
  ) => {
    if (index === input.orders.length) {
      const distances = routes.map((route, i) => routeDistance(input, input.engineers[i]!, route))
      if (distances.some((distance) => distance === undefined)) return
      const objective: Objective = [
        unassigned.filter((item) => item.priority === 'emergency').length,
        unassigned.filter((item) => item.priority === 'connection').length,
        unassigned.length,
        routes.filter((route) => route.length > 0).length,
        distances.reduce<number>((sum, distance) => sum + (distance ?? 0), 0),
      ]
      if (best === undefined || compareLexicographic(objective, best) < 0) best = objective
      return
    }
    const currentOrder = input.orders[index]!
    visit(index + 1, routes, [...unassigned, currentOrder])
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      for (let position = 0; position <= routes[routeIndex]!.length; position += 1) {
        const next = routes.map((route, i) =>
          i === routeIndex
            ? [...route.slice(0, position), currentOrder, ...route.slice(position)]
            : route,
        )
        visit(index + 1, next, unassigned)
      }
    }
  }
  visit(
    0,
    input.engineers.map(() => []),
    [],
  )
  return best!
}

function routeDistance(
  input: PlanInput,
  assignedEngineer: Engineer,
  orders: readonly Order[],
): number | undefined {
  let point = assignedEngineer.startPointId
  let freeAt = assignedEngineer.shift.start
  let distance = 0
  for (const routeOrder of orders) {
    if (!assignedEngineer.skills.includes(routeOrder.skill)) return undefined
    if (routeOrder.transport !== undefined && routeOrder.transport !== assignedEngineer.transport) {
      return undefined
    }
    const leg = input.travel.travel(assignedEngineer.transport, point, routeOrder.pointId)
    if (leg === null) return undefined
    const start = Math.max(
      freeAt + leg.durationMin,
      routeOrder.window.start,
      routeOrder.availableFromMin,
    )
    if (
      start > routeOrder.window.end ||
      start + routeOrder.durationMin > assignedEngineer.shift.end
    ) {
      return undefined
    }
    point = routeOrder.pointId
    freeAt = start + routeOrder.durationMin
    distance += leg.distanceM
  }
  return distance
}

function compareLexicographic(a: Objective, b: Objective): number {
  for (let i = 0; i < a.length; i += 1) {
    const difference = a[i]! - b[i]!
    if (difference !== 0) return difference
  }
  return 0
}

describe('comparePlans', () => {
  it('задаёт разности как candidate минус baseline и использует лексикографический компаратор', () => {
    const input = {
      orders: [order({ id: 'a' })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [100, 1] }),
    }
    const baseline = planBaseline(input)
    const comparison = comparePlans(baseline, planOptimized(input).plan)
    expect(comparison.result).toBe('equal')
    expect(comparison.delta).toEqual({
      unassignedEmergency: 0,
      unassignedConnection: 0,
      unassignedTotal: 0,
      engineersUsed: 0,
      distanceM: 0,
      distanceByEngineer: [{ engineerId: 'e1', distanceM: 0 }],
    })
  })
})

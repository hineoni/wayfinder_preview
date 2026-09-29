import { describe, expect, it } from 'vitest'
import { planBaseline } from '../src/baseline'
import type { Plan } from '../src/plan'
import { validatePlan } from '../src/validator'
import { engineer, order, tableTravel } from './fixtures'

const travel = tableTravel({
  'office>a': [1000, 10],
  'office>b': [2000, 20],
  'a>b': [500, 5],
  'b>a': [500, 5],
})

const input = {
  orders: [order({ id: 'a' }), order({ id: 'b' }), order({ id: 'c', skill: 'emergency' })],
  engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2', skills: ['connection'] })],
  travel,
}

const valid = planBaseline(input)

it('отклоняет ранний приезд с ожиданием и произвольную задержку первого выезда', () => {
  expect(validatePlan(input, valid)).toEqual([])
  const early = withVisit(valid, 0, (visit) => ({ ...visit, arrivalMin: 550, waitMin: 50 }))
  expect(validatePlan(input, early).map((v) => v.code)).toContain('arrival-mismatch')
  const late = withVisit(valid, 0, (visit) => ({
    ...visit,
    arrivalMin: 601,
    startMin: 601,
    endMin: 661,
  }))
  expect(validatePlan(input, late).map((v) => v.code)).toContain('arrival-mismatch')
})

function patched(mutate: (draft: Plan) => Plan): Plan {
  return mutate(structuredClone(valid))
}

function withFirstRoute(
  plan: Plan,
  mutate: (route: Plan['routes'][number]) => Plan['routes'][number],
): Plan {
  return { ...plan, routes: [mutate(plan.routes[0]!), ...plan.routes.slice(1)] }
}

function withVisit(
  plan: Plan,
  index: number,
  mutate: (
    visit: Plan['routes'][number]['visits'][number],
  ) => Plan['routes'][number]['visits'][number],
): Plan {
  return withFirstRoute(plan, (route) => ({
    ...route,
    visits: route.visits.map((visit, i) => (i === index ? mutate(visit) : visit)),
  }))
}

function codes(plan: Plan, data = input) {
  return validatePlan(data, plan).map((v) => v.code)
}

describe('validatePlan', () => {
  it.each(['unassignedEmergency', 'unassignedConnection'] as const)(
    'независимо проверяет счётчик %s',
    (key) => {
      const data = {
        orders: [
          order({ id: 'a', priority: 'emergency' }),
          order({ id: 'b', priority: 'connection' }),
          order({ id: 'c', priority: 'normal' }),
        ],
        engineers: [],
        travel,
      }
      const plan = planBaseline(data)
      expect(plan.metrics[key]).toBe(1)
      expect(validatePlan(data, { ...plan, metrics: { ...plan.metrics, [key]: 0 } })).toEqual([
        { code: 'metrics-mismatch', detail: `${key}: в плане 0, пересчитано 1` },
      ])
    },
  )
  it('не находит нарушений в базовом плане', () => {
    expect(validatePlan(input, valid)).toEqual([])
    expect(valid.routes.map((r) => r.visits.map((v) => v.orderId))).toEqual([['a', 'b'], []])
    expect(valid.unassigned.map((u) => u.orderId)).toEqual(['c'])
  })

  it('ловит двойное назначение и потерю заявки', () => {
    const twice = patched((plan) => ({
      ...plan,
      routes: [plan.routes[0]!, { ...plan.routes[1]!, visits: [plan.routes[0]!.visits[0]!] }],
    }))
    expect(codes(twice)).toContain('order-assigned-twice')

    const lost = patched((plan) => ({ ...plan, unassigned: [] }))
    expect(codes(lost)).toEqual(['order-missing', 'metrics-mismatch'])

    const both = patched((plan) => ({
      ...plan,
      unassigned: [...plan.unassigned, { ...plan.unassigned[0]!, orderId: 'a' }],
    }))
    expect(codes(both)).toContain('order-assigned-and-unassigned')
  })

  it('ловит навык и транспорт по исходным данным, а не по флагам плана', () => {
    const wrongSkill = patched((plan) => ({
      ...plan,
      routes: [
        { ...plan.routes[1]!, engineerId: 'e1' },
        { ...plan.routes[0]!, engineerId: 'e2' },
      ],
    }))
    expect(codes(wrongSkill)).toEqual([
      'skill',
      'assignment-explanation-mismatch',
      'skill',
      'assignment-explanation-mismatch',
      'metrics-mismatch',
      'metrics-mismatch',
    ])

    const footEngineers = [engineer({ id: 'e1', transport: 'foot' }), input.engineers[1]!]
    const carOrder = {
      ...input,
      orders: [order({ id: 'a', transport: 'car' }), ...input.orders.slice(1)],
      engineers: footEngineers,
    }
    expect(codes(valid, carOrder)).toContain('transport')
  })

  it('ловит расписание вне окна и смены и несогласованный переезд', () => {
    const early = patched((plan) =>
      withVisit(plan, 0, (visit) => ({ ...visit, startMin: 540, endMin: 600 })),
    )
    expect(codes(early)).toEqual([
      'assignment-explanation-mismatch',
      'start-mismatch',
      'wait-mismatch',
      'arrival-mismatch',
    ])

    // Расписание точное: задержка старта при открытом окне — нарушение.
    const delayed = patched((plan) =>
      withVisit(plan, 1, (visit) => ({
        ...visit,
        startMin: visit.arrivalMin + 5,
        waitMin: 5,
        endMin: visit.endMin + 5,
      })),
    )
    expect(codes(delayed)).toEqual(['assignment-explanation-mismatch', 'start-mismatch'])

    const lateShift = {
      ...input,
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 700 } }), input.engineers[1]!],
    }
    expect(codes(valid, lateShift)).toEqual(['end-after-shift'])

    const narrowWindow = {
      ...input,
      orders: [
        input.orders[0]!,
        order({ id: 'b', window: { start: 600, end: 660 } }),
        input.orders[2]!,
      ],
    }
    expect(codes(valid, narrowWindow)).toEqual(['start-after-window'])

    const tamperedTravel = patched((plan) =>
      withVisit(plan, 1, (visit) => ({
        ...visit,
        travel: { ...visit.travel, durationMin: 1 },
        arrivalMin: 661,
      })),
    )
    expect(codes(tamperedTravel)).toEqual([
      'assignment-explanation-mismatch',
      'travel-mismatch',
      'arrival-mismatch',
      'start-mismatch',
      'wait-mismatch',
    ])
  })

  it('ловит ожидание не по расписанию и не-числа', () => {
    const wait = patched((plan) => withVisit(plan, 0, (visit) => ({ ...visit, waitMin: -100 })))
    expect(codes(wait)).toEqual(['assignment-explanation-mismatch', 'wait-mismatch'])
    const nan = patched((plan) =>
      withVisit(plan, 0, (visit) => ({ ...visit, arrivalMin: Number.NaN })),
    )
    expect(codes(nan)).toContain('not-finite')
  })

  it('ловит пробег и метрики, посчитанные не по плану', () => {
    const distance = patched((plan) =>
      withFirstRoute(plan, (route) => ({ ...route, distanceM: 1 })),
    )
    expect(codes(distance)).toEqual(['route-distance-mismatch'])

    const metrics = patched((plan) => ({
      ...plan,
      metrics: { ...plan.metrics, engineersUsed: 2, distanceM: 0 },
    }))
    expect(codes(metrics)).toEqual(['metrics-mismatch', 'metrics-mismatch'])
  })

  it('сверяет метрики по инженерам: полнота, уникальность, число визитов', () => {
    const missing = patched((plan) => ({
      ...plan,
      metrics: { ...plan.metrics, perEngineer: plan.metrics.perEngineer.slice(1) },
    }))
    expect(codes(missing)).toEqual(['metrics-mismatch'])

    const duplicated = patched((plan) => ({
      ...plan,
      metrics: {
        ...plan.metrics,
        perEngineer: [...plan.metrics.perEngineer, plan.metrics.perEngineer[0]!],
      },
    }))
    expect(codes(duplicated)).toEqual(['metrics-mismatch'])

    const visits = patched((plan) => ({
      ...plan,
      metrics: {
        ...plan.metrics,
        perEngineer: [{ ...plan.metrics.perEngineer[0]!, visits: 1 }, plan.metrics.perEngineer[1]!],
      },
    }))
    expect(codes(visits)).toEqual(['metrics-mismatch'])
  })

  it('ловит неизвестных инженеров, лишние и отсутствующие маршруты', () => {
    const unknown = patched((plan) =>
      withFirstRoute(plan, (route) => ({ ...route, engineerId: 'ghost' })),
    )
    expect(codes(unknown)).toEqual([
      'unknown-engineer',
      'missing-route',
      'rejection-mismatch',
      'order-missing',
      'order-missing',
      'metrics-mismatch',
      'metrics-mismatch',
      'metrics-mismatch',
    ])

    const duplicate = patched((plan) => ({ ...plan, routes: [...plan.routes, plan.routes[1]!] }))
    expect(codes(duplicate)).toEqual(['duplicate-route'])
  })

  it('ловит подделку флагов приближения даже при согласованной подмене', () => {
    const route = patched((plan) => ({
      ...withFirstRoute(plan, (first) => ({ ...first, approximate: true })),
      metrics: { ...plan.metrics, approximate: true },
    }))
    expect(codes(route)).toEqual(['approximate-mismatch', 'metrics-mismatch'])

    const edge = patched((plan) => ({
      ...withFirstRoute(
        withVisit(plan, 0, (visit) => ({
          ...visit,
          travel: { ...visit.travel, approximate: true },
        })),
        (first) => ({ ...first, approximate: true }),
      ),
      metrics: { ...plan.metrics, approximate: true },
    }))
    expect(codes(edge)).toEqual([
      'assignment-explanation-mismatch',
      'travel-mismatch',
      'approximate-mismatch',
      'metrics-mismatch',
    ])
  })

  it('ловит сброшенный признак приближения у неназначенной заявки', () => {
    const approxInput = {
      orders: [order({ id: 'a', window: { start: 540, end: 550 } })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [1000, 30] }, true),
    }
    const plan = planBaseline(approxInput)
    expect(validatePlan(approxInput, plan)).toEqual([])
    const cleared: Plan = {
      ...plan,
      unassigned: [{ ...plan.unassigned[0]!, approximate: false }],
      metrics: { ...plan.metrics, approximate: false },
    }
    expect(validatePlan(approxInput, cleared).map((v) => v.code)).toEqual([
      'approximate-mismatch',
      'metrics-mismatch',
    ])
  })

  it('безусловно проверяет объяснения при уже приближённом назначенном маршруте', () => {
    const approxInput = {
      orders: [
        order({ id: 'late', window: { start: 660, end: 660 }, durationMin: 60 }),
        order({ id: 'early', window: { start: 600, end: 630 }, durationMin: 30 }),
      ],
      engineers: [engineer({ id: 'e1', shift: { start: 540, end: 720 } })],
      travel: tableTravel(
        {
          'office>late': [1000, 10],
          'office>early': [1000, 10],
          'early>late': [1000, 10],
          'late>early': [1000, 10],
        },
        true,
      ),
    }
    const plan = planBaseline(approxInput)
    expect(validatePlan(approxInput, plan)).toEqual([])

    const corrupted: Plan = {
      ...plan,
      unassigned: [
        {
          ...plan.unassigned[0]!,
          class: 'infeasible-in-plan',
          withSkill: 0,
          withSkillAndTransport: 0,
          rejections: [],
        },
      ],
    }
    expect(codes(corrupted, approxInput)).toEqual([
      'unassigned-count-mismatch',
      'unassigned-class-mismatch',
      'rejection-mismatch',
    ])
  })

  it('проверяет следующее объяснение, если первое добавило признак приближения', () => {
    const approxInput = {
      orders: [
        order({ id: 'a', window: { start: 540, end: 550 } }),
        order({ id: 'b', window: { start: 540, end: 550 } }),
      ],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [1000, 30], 'office>b': [1000, 30] }, true),
    }
    const plan = planBaseline(approxInput)
    const corrupted: Plan = {
      ...plan,
      unassigned: [plan.unassigned[0]!, { ...plan.unassigned[1]!, withSkill: 0 }],
    }
    expect(codes(corrupted, approxInput)).toContain('unassigned-count-mismatch')
  })

  it('сверяет объяснение неназначенной заявки с входом и итоговыми маршрутами', () => {
    const item = valid.unassigned[0]!
    const wrongClass = patched((plan) => ({
      ...plan,
      unassigned: [{ ...item, class: 'search-limit' }],
    }))
    expect(codes(wrongClass)).toEqual(['unassigned-class-mismatch'])

    const wrongCounts = patched((plan) => ({
      ...plan,
      unassigned: [{ ...item, withSkill: 1, withSkillAndTransport: 1 }],
    }))
    expect(codes(wrongCounts)).toEqual(['unassigned-count-mismatch'])

    const droppedRejection = patched((plan) => ({
      ...plan,
      unassigned: [{ ...item, rejections: item.rejections.slice(1) }],
    }))
    expect(codes(droppedRejection)).toEqual(['rejection-mismatch'])

    const wrongCode = patched((plan) => ({
      ...plan,
      unassigned: [
        {
          ...item,
          rejections: [
            { ...item.rejections[0]!, code: 'window', earliestStartMin: 1 },
            item.rejections[1]!,
          ],
        },
      ],
    }))
    expect(codes(wrongCode)).toEqual(['rejection-mismatch'])
  })

  it('не принимает infeasible-in-plan, если заявка помещается в конец итогового маршрута', () => {
    const fitsInput = {
      orders: [
        order({ id: 'c', window: { start: 540, end: 600 } }),
        order({ id: 'b', window: { start: 600, end: 660 }, durationMin: 10 }),
        order({ id: 'd', window: { start: 600, end: 700 }, durationMin: 10 }),
      ],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({
        'office>c': [3000, 30],
        'c>b': [6000, 60],
        'c>d': [500, 5],
        'd>b': [500, 5],
      }),
    }
    const plan = planBaseline(fitsInput)
    expect(validatePlan(fitsInput, plan)).toEqual([])
    const claimed: Plan = {
      ...plan,
      unassigned: [{ ...plan.unassigned[0]!, class: 'infeasible-in-plan' }],
    }
    expect(codes(claimed, fitsInput)).toEqual(['unassigned-class-mismatch'])
  })

  it('ловит неизвестный вид плана', () => {
    const unknownKind = patched((plan) => ({ ...plan, kind: 'draft' as Plan['kind'] }))
    expect(codes(unknownKind)).toEqual(['unknown-kind'])
  })

  it('независимо сверяет структурированное объяснение назначения', () => {
    const tampered = patched((plan) =>
      withVisit(plan, 0, (visit) => ({
        ...visit,
        explanation: { ...visit.explanation, engineerId: 'ghost' },
      })),
    )
    expect(codes(tampered)).toEqual(['assignment-explanation-mismatch'])
  })

  it('сравнивает поля объяснения назначения по значениям, а не порядку ключей', () => {
    const reordered = patched((plan) =>
      withFirstRoute(plan, (route) => ({
        ...route,
        visits: route.visits.map((visit) => {
          const explanation = visit.explanation
          const addedDistance =
            explanation.addedDistance.status === 'defined'
              ? { distanceM: explanation.addedDistance.distanceM, status: 'defined' as const }
              : {
                  reason: explanation.addedDistance.reason,
                  status: 'undefined' as const,
                }
          return {
            ...visit,
            explanation: {
              approximate: explanation.approximate,
              addedDistance,
              endMin: explanation.endMin,
              startMin: explanation.startMin,
              waitMin: explanation.waitMin,
              arrivalMin: explanation.arrivalMin,
              transportMatched: explanation.transportMatched,
              ...(explanation.requiredTransport === undefined
                ? {}
                : { requiredTransport: explanation.requiredTransport }),
              skillMatched: explanation.skillMatched,
              requiredSkill: explanation.requiredSkill,
              engineerId: explanation.engineerId,
            },
          }
        }),
      })),
    )
    expect(validatePlan(input, reordered)).toEqual([])
    expect(valid.routes[0]!.visits.map((visit) => visit.explanation.addedDistance.status)).toEqual([
      'defined',
      'defined',
    ])

    const undefinedInput = {
      orders: [order({ id: 'a' }), order({ id: 'b' })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [10, 1], 'a>b': [20, 1] }),
    }
    const undefinedPlan = planBaseline(undefinedInput)
    expect(undefinedPlan.routes[0]!.visits[0]!.explanation.addedDistance.status).toBe('undefined')
    const undefinedExplanation = undefinedPlan.routes[0]!.visits[0]!.explanation
    const undefinedAddedDistance = undefinedExplanation.addedDistance
    if (undefinedAddedDistance.status !== 'undefined') {
      throw new Error('ожидался неопределённый добавленный пробег')
    }
    const reorderedUndefined = withVisit(undefinedPlan, 0, (visit) => ({
      ...visit,
      explanation: {
        approximate: undefinedExplanation.approximate,
        addedDistance: {
          reason: undefinedAddedDistance.reason,
          status: undefinedAddedDistance.status,
        },
        endMin: undefinedExplanation.endMin,
        startMin: undefinedExplanation.startMin,
        waitMin: undefinedExplanation.waitMin,
        arrivalMin: undefinedExplanation.arrivalMin,
        transportMatched: undefinedExplanation.transportMatched,
        skillMatched: undefinedExplanation.skillMatched,
        requiredSkill: undefinedExplanation.requiredSkill,
        engineerId: undefinedExplanation.engineerId,
      },
    }))
    expect(validatePlan(undefinedInput, reorderedUndefined)).toEqual([])

    const changed = withVisit(reordered, 0, (visit) => ({
      ...visit,
      explanation: { ...visit.explanation, waitMin: visit.explanation.waitMin + 1 },
    }))
    expect(codes(changed)).toContain('assignment-explanation-mismatch')
  })

  it('ловит повторы идентификаторов во входных данных', () => {
    const duplicated = { ...input, orders: [...input.orders, order({ id: 'a' })] }
    expect(codes(valid, duplicated)).toEqual(['duplicate-order-id'])
  })
})

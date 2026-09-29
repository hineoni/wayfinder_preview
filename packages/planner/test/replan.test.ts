import { describe, expect, it } from 'vitest'
import { planBaseline } from '../src/baseline'
import type { PlanInput } from '../src/contracts'
import { continuePlanningDay, replanAfterEvent, replanForUrgentOrder } from '../src/replan'
import { engineer, noEquipment, order, tableTravel } from './fixtures'

function scenario(emergencyKits = 2): PlanInput {
  return {
    orders: [
      order({
        id: 'done',
        durationMin: 50,
        window: { start: 550, end: 600 },
        equipment: { ...noEquipment, 'emergency-kit': 1 },
      }),
      order({ id: 'future', window: { start: 700, end: 800 } }),
    ],
    engineers: [
      engineer({
        id: 'e1',
        skills: ['local', 'emergency'],
        equipment: { ...noEquipment, 'emergency-kit': emergencyKits },
      }),
    ],
    travel: tableTravel({
      'office>done': [100, 10],
      'done>future': [100, 10],
      'done>urgent': [100, 10],
      'urgent>future': [100, 10],
      'future>urgent': [100, 10],
    }),
  }
}

function urgent() {
  return {
    kind: 'urgent-order' as const,
    atMin: 600,
    order: order({
      id: 'urgent',
      skill: 'emergency',
      priority: 'emergency',
      availableFromMin: 600,
      durationMin: 60,
      window: { start: 610, end: 700 },
      equipment: { ...noEquipment, 'emergency-kit': 1 },
    }),
  }
}

describe('replanForUrgentOrder', () => {
  it('не превращает промежуточную паузу в поздний выезд при двух последовательных событиях', () => {
    const input: PlanInput = {
      orders: [
        order({ id: 'a' }),
        order({ id: 'b', window: { start: 700, end: 800 } }),
        order({ id: 'c', window: { start: 800, end: 900 } }),
      ],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [100, 20], 'a>b': [100, 10], 'b>c': [100, 10] }),
    }
    const first = replanAfterEvent(
      input,
      planBaseline(input),
      { kind: 'cancel-order', orderId: 'c', atMin: 680 },
      [{ orderId: 'a', status: 'completed' }],
    )
    expect(first.violations).toEqual([])
    expect(first.checkpoint?.plan.routes[0]?.visits[0]).toMatchObject({
      orderId: 'b',
      arrivalMin: 670,
      startMin: 700,
      waitMin: 30,
    })
    const second = continuePlanningDay(
      input,
      first,
      { kind: 'cancel-order', orderId: 'b', atMin: 690 },
      [],
    )
    expect(second.violations).toEqual([])
    expect(second.history).toContainEqual(
      expect.objectContaining({
        state: 'cancelled-waiting',
        visit: expect.objectContaining({ orderId: 'b', arrivalMin: 670 }),
      }),
    )
    expect(second.continuations[0]).toMatchObject({ pointId: 'b', freeAtMin: 690 })
  })

  it.each([570, 580, 590, 600])('учитывает поздний выезд 09:40 при событии в %s', (atMin) => {
    const input: PlanInput = {
      orders: [order({ id: 'first', window: { start: 600, end: 720 } })],
      engineers: [engineer({ id: 'e1', skills: ['local', 'emergency'] })],
      travel: tableTravel({
        'office>first': [1000, 20],
        'office>urgent': [100, 5],
        'urgent>first': [100, 5],
        'first>urgent': [100, 5],
      }),
    }
    const result = replanForUrgentOrder(
      input,
      planBaseline(input),
      {
        ...urgent(),
        atMin,
        order: {
          ...urgent().order,
          availableFromMin: atMin,
          equipment: noEquipment,
          durationMin: 10,
          window: { start: atMin, end: 900 },
        },
      },
      [],
    )
    expect(result.violations).toEqual([])
    const departed = atMin > 580
    expect(result.history).toMatchObject(
      departed
        ? [
            {
              state: atMin < 600 ? 'en-route' : 'in-progress',
              visit: { arrivalMin: 600, startMin: 600, waitMin: 0 },
            },
          ]
        : [],
    )
    expect(result.continuations[0]).toMatchObject({
      pointId: departed ? 'first' : 'office',
      freeAtMin: departed ? 660 : atMin,
    })
    expect(result.plan.routes[0]?.visits[0]?.orderId).toBe('urgent')
    expect(result.checkpoint?.plan.routes[0]?.visits[0]?.orderId).toBe(
      departed ? 'first' : 'urgent',
    )
    expect(result.checkpoint?.plan.routes[0]?.visits[0]?.arrivalMin).toBe(
      departed ? 600 : atMin + 5,
    )
  })

  it('не считает завершение фактом только по времени плана', () => {
    const input = scenario()
    expect(() => replanForUrgentOrder(input, planBaseline(input), urgent(), [])).toThrow(
      'Подтвердите выполнение заявки done',
    )
  })

  it('фиксирует подтверждённую историю, списывает комплект и назначает аварию не раньше события', () => {
    const input = scenario()
    const result = replanForUrgentOrder(input, planBaseline(input), urgent(), [
      { orderId: 'done', status: 'completed' },
    ])
    expect(result.violations).toEqual([])
    expect(result.history).toMatchObject([
      { engineerId: 'e1', state: 'completed', visit: { orderId: 'done' } },
    ])
    const emergency = result.plan.routes[0]?.visits.find((visit) => visit.orderId === 'urgent')
    expect(emergency?.startMin).toBeGreaterThanOrEqual(600)
    expect(result.equipment[0]).toMatchObject({
      actualAtEvent: { 'emergency-kit': 1 },
      availableAfterCommitments: { 'emergency-kit': 1 },
      afterPlan: { 'emergency-kit': 0 },
    })
    expect(result.dayMetrics.distanceM).toBe(
      result.dayMetrics.historyDistanceM + result.dayMetrics.remainingDistanceM,
    )
    expect(result.changes).toContainEqual(
      expect.objectContaining({ orderId: 'urgent', kind: 'new-assignment' }),
    )
  })

  it('не пополняет комплект при пересчёте и объясняет нехватку', () => {
    const input = scenario(1)
    const result = replanForUrgentOrder(input, planBaseline(input), urgent(), [
      { orderId: 'done', status: 'completed' },
    ])
    const unassigned = result.plan.unassigned.find((item) => item.orderId === 'urgent')
    expect(unassigned?.rejections).toContainEqual({
      engineerId: 'e1',
      code: 'equipment',
      equipment: 'emergency-kit',
      requiredUnits: 1,
      availableUnits: 0,
    })
    expect(result.equipment[0]?.actualAtEvent['emergency-kit']).toBe(0)
  })

  it('показывает малый сдвиг в диффе, но не считает заявку затронутой по порогу цели', () => {
    const input = scenario()
    const event = urgent()
    const result = replanForUrgentOrder(
      input,
      planBaseline(input),
      { ...event, order: { ...event.order, durationMin: 90 } },
      [{ orderId: 'done', status: 'completed' }],
    )
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        orderId: 'future',
        kind: 'time-changed',
        previousStartMin: 700,
        startMin: 710,
      }),
    )
    expect(result.affectedOrderCount).toBe(0)
  })

  it('отделяет фактический остаток от резерва ожидающего визита в продолжении дня', () => {
    const input: PlanInput = {
      orders: [
        order({
          id: 'waiting',
          window: { start: 650, end: 800 },
          equipment: { ...noEquipment, 'emergency-kit': 1 },
        }),
      ],
      engineers: [
        engineer({
          id: 'e1',
          deferFirstDeparture: false,
          skills: ['local', 'emergency'],
          equipment: { ...noEquipment, 'emergency-kit': 1 },
        }),
      ],
      travel: tableTravel({ 'office>waiting': [100, 10] }),
    }
    const result = replanForUrgentOrder(input, planBaseline(input), urgent(), [])
    expect(result.history[0]?.state).toBe('waiting')
    expect(result.equipment[0]).toMatchObject({
      actualAtEvent: { 'emergency-kit': 1 },
      availableAfterCommitments: { 'emergency-kit': 0 },
    })
    expect(
      result.plan.unassigned.find((item) => item.orderId === 'urgent')?.rejections[0],
    ).toMatchObject({
      code: 'equipment',
      availableUnits: 0,
    })
  })

  it('считает обе заявки затронутыми при перестановке с малым сдвигом времени', () => {
    const input: PlanInput = {
      orders: [
        order({ id: 'a', durationMin: 1, window: { start: 540, end: 720 } }),
        order({ id: 'b', durationMin: 1, window: { start: 540, end: 720 } }),
      ],
      engineers: [engineer({ id: 'e1', skills: ['local', 'emergency'] })],
      travel: tableTravel({
        'office>a': [0, 0],
        'a>b': [0, 0],
        'office>urgent': [0, 0],
        'urgent>b': [0, 0],
        'b>a': [0, 0],
      }),
    }
    const event = urgent()
    const result = replanForUrgentOrder(
      input,
      planBaseline(input),
      {
        ...event,
        atMin: 540,
        order: {
          ...event.order,
          pointId: 'urgent',
          availableFromMin: 540,
          durationMin: 1,
          window: { start: 540, end: 540 },
          equipment: noEquipment,
        },
      },
      [],
    )
    expect(result.affectedOrderCount).toBe(2)
    expect(result.changes.find((change) => change.orderId === 'a')).toMatchObject({
      timeChanged: true,
      reordered: true,
    })
    expect(result.changes.find((change) => change.orderId === 'b')).toMatchObject({
      reordered: true,
    })
  })
})

describe('replanAfterEvent', () => {
  it.each([700, 800])('сохраняет начало поздней смены при событии до неё (окно до %s)', (end) => {
    const input: PlanInput = {
      orders: [],
      engineers: [
        engineer({ id: 'late', shift: { start: 720, end: 1320 }, skills: ['emergency'] }),
      ],
      travel: tableTravel({ 'office>urgent': [1000, 10] }),
    }
    const event = urgent()
    const result = replanAfterEvent(
      input,
      planBaseline(input),
      {
        ...event,
        order: { ...event.order, equipment: noEquipment, window: { start: 600, end } },
      },
      [],
    )
    expect(result.violations).toEqual([])
    expect(result.continuations[0]?.freeAtMin).toBe(720)
    expect(result.plan.unassigned.map((item) => item.orderId)).toEqual(
      end === 700 ? ['urgent'] : [],
    )
    expect(result.plan.routes[0]?.visits[0]?.startMin).toBe(end === 700 ? undefined : 730)
  })

  it.each([
    [545, 'interrupted-en-route', 500],
    [550, 'interrupted-waiting', 1000],
    [560, 'interrupted-waiting', 1000],
  ] as const)(
    'сохраняет переезд при недоступности в %s и освобождает неначатую работу',
    (atMin, state, distanceM) => {
      const equipment = { ...noEquipment, router: 1 }
      const input: PlanInput = {
        orders: [order({ id: 'target', equipment, window: { start: 600, end: 800 } })],
        engineers: [
          engineer({ id: 'broken', equipment, deferFirstDeparture: false }),
          engineer({ id: 'reserve', equipment }),
        ],
        travel: tableTravel({ 'office>target': [1000, 10] }),
      }
      const result = replanAfterEvent(
        input,
        planBaseline(input),
        {
          kind: 'engineer-unavailable',
          engineerId: 'broken',
          atMin,
        },
        [],
      )
      expect(result.violations).toEqual([])
      expect(result.history).toHaveLength(1)
      expect(result.history[0]).toMatchObject({ engineerId: 'broken', state })
      expect(result.history[0]?.estimatedTravelledDistanceM).toBe(
        state === 'interrupted-en-route' ? 500 : undefined,
      )
      expect(result.plan.routes[0]?.visits.map((visit) => visit.orderId)).toEqual(['target'])
      expect(result.plan.routes[0]?.engineerId).toBe('reserve')
      expect(result.dayMetrics).toMatchObject({
        assigned: 1,
        engineersUsed: 2,
        historyDistanceM: distanceM,
        distanceM: distanceM + 1000,
      })
      expect(result.equipment[0]).toMatchObject({
        actualAtEvent: equipment,
        availableAfterCommitments: equipment,
        afterPlan: equipment,
      })
      expect(result.equipment[1]?.afterPlan.router).toBe(0)
    },
  )

  it('не отменяет уже выполненную заявку', () => {
    const input = scenario()
    expect(() =>
      replanAfterEvent(
        input,
        planBaseline(input),
        { kind: 'cancel-order', atMin: 600, orderId: 'done' },
        [{ orderId: 'done', status: 'completed' }],
      ),
    ).toThrow('Нельзя отменить уже выполненную заявку done')
  })

  it('удаляет будущую отменённую заявку и отражает отмену в диффе', () => {
    const input = scenario()
    const result = replanAfterEvent(
      input,
      planBaseline(input),
      { kind: 'cancel-order', atMin: 600, orderId: 'future' },
      [{ orderId: 'done', status: 'completed' }],
    )

    expect(result.violations).toEqual([])
    expect(result.plan.routes.flatMap((route) => route.visits)).not.toContainEqual(
      expect.objectContaining({ orderId: 'future' }),
    )
    expect(result.changes[0]).toEqual({ orderId: 'future', kind: 'cancelled' })
    expect(result.dayMetrics.assigned).toBe(1)
  })

  it('при отмене в пути доезжает до точки, не списывает оборудование и продолжает оттуда', () => {
    const input: PlanInput = {
      orders: [
        order({
          id: 'target',
          window: { start: 650, end: 800 },
          equipment: { ...noEquipment, router: 1 },
        }),
        order({ id: 'next', pointId: 'next', window: { start: 700, end: 900 } }),
      ],
      engineers: [engineer({ id: 'e1', equipment: { ...noEquipment, router: 1 } })],
      travel: tableTravel({
        'office>target': [100, 100],
        'target>next': [100, 10],
      }),
    }
    const result = replanAfterEvent(
      input,
      planBaseline(input),
      { kind: 'cancel-order', atMin: 600, orderId: 'target' },
      [],
    )

    expect(result.history[0]).toMatchObject({ state: 'cancelled-en-route' })
    expect(result.continuations[0]).toEqual({
      engineerId: 'e1',
      pointId: 'target',
      freeAtMin: 650,
    })
    expect(result.equipment[0]?.actualAtEvent.router).toBe(1)
    expect(result.equipment[0]?.availableAfterCommitments.router).toBe(1)
  })

  it('освобождает визиты недоступного инженера и переоткрывает начатую работу', () => {
    const input: PlanInput = {
      orders: [
        order({ id: 'active', durationMin: 60, window: { start: 540, end: 800 } }),
        order({ id: 'future', window: { start: 700, end: 900 } }),
      ],
      engineers: [
        engineer({ id: 'broken' }),
        engineer({ id: 'reserve', startPointId: 'reserve-office' }),
      ],
      travel: tableTravel({
        'office>active': [10, 10],
        'active>future': [10, 10],
        'reserve-office>active': [10, 10],
      }),
    }
    const previous = planBaseline(input)
    const result = replanAfterEvent(
      input,
      previous,
      { kind: 'engineer-unavailable', atMin: 580, engineerId: 'broken' },
      [],
    )

    expect(result.violations).toEqual([])
    expect(result.history).toContainEqual(
      expect.objectContaining({ engineerId: 'broken', state: 'interrupted' }),
    )
    expect(result.plan.routes.map((route) => route.engineerId)).toEqual(['reserve'])
    expect(result.plan.routes[0]?.visits.map((visit) => visit.orderId)).toContain('active')
    expect(result.changes).toContainEqual({ orderId: 'active', kind: 'interrupted' })
  })
})

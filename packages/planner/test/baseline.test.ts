import { describe, expect, it } from 'vitest'
import { planBaseline } from '../src/baseline'
import { engineer, order, tableTravel } from './fixtures'

const travel = tableTravel({
  'office>a': [1000, 10],
  'office>b': [2000, 20],
  'office>c': [3000, 30],
  'a>b': [500, 5],
  'a>c': [4000, 40],
  'b>a': [500, 5],
  'b>c': [1500, 15],
  'c>a': [4000, 40],
  'c>b': [1500, 15],
})

describe('planBaseline', () => {
  it('назначает по порядку поступления первому допустимому инженеру и только в конец маршрута', () => {
    const plan = planBaseline({
      orders: [
        order({ id: 'a', window: { start: 600, end: 720 } }),
        order({ id: 'b', window: { start: 600, end: 720 } }),
        order({ id: 'c', window: { start: 600, end: 620 } }),
      ],
      engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2' })],
      travel,
    })
    expect(plan.kind).toBe('baseline')
    expect(plan.routes.map((r) => r.visits.map((v) => v.orderId))).toEqual([['a', 'b'], ['c']])
    const e1 = plan.routes[0]
    expect(e1?.visits[1]).toMatchObject({ arrivalMin: 665, startMin: 665, endMin: 725 })
    expect(e1?.distanceM).toBe(1500)
    expect(plan.unassigned).toEqual([])
    expect(plan.metrics).toEqual({
      unassignedEmergency: 0,
      unassignedConnection: 0,
      unassignedTotal: 0,
      engineersUsed: 2,
      distanceM: 4500,
      approximate: false,
      perEngineer: [
        { engineerId: 'e1', distanceM: 1500, visits: 2 },
        { engineerId: 'e2', distanceM: 3000, visits: 1 },
      ],
    })
  })

  it('различает доказанную несовместимость и предел поиска базового', () => {
    const plan = planBaseline({
      orders: [
        order({ id: 'a', skill: 'emergency', priority: 'emergency' }),
        order({ id: 'b', transport: 'car' }),
        order({ id: 'c', window: { start: 540, end: 560 } }),
      ],
      engineers: [
        engineer({ id: 'walker', transport: 'foot', skills: ['local'] }),
        engineer({ id: 'driver', transport: 'car', skills: ['local'] }),
      ],
      travel,
    })
    expect(plan.routes.map((r) => r.visits.map((v) => v.orderId))).toEqual([[], ['b']])
    expect(plan.unassigned).toEqual([
      {
        orderId: 'a',
        class: 'incompatible',
        withSkill: 0,
        withSkillAndTransport: 0,
        rejections: [
          { engineerId: 'walker', code: 'skill' },
          { engineerId: 'driver', code: 'skill' },
        ],
        approximate: false,
      },
      {
        orderId: 'c',
        class: 'search-limit',
        withSkill: 2,
        withSkillAndTransport: 2,
        rejections: [
          { engineerId: 'walker', code: 'window', earliestStartMin: 570 },
          { engineerId: 'driver', code: 'window', earliestStartMin: 675 },
        ],
        approximate: false,
      },
    ])
    expect(plan.metrics.unassignedEmergency).toBe(1)
    expect(plan.metrics.unassignedTotal).toBe(2)
    expect(plan.metrics.engineersUsed).toBe(1)
  })

  it('объясняет отказ по концу итогового маршрута, а не по состоянию на момент отказа', () => {
    // A занимает 11:00–12:00; B (10:00–10:30) отвергнута после A; C дописана после отказа B.
    const plan = planBaseline({
      orders: [
        order({ id: 'a', window: { start: 660, end: 720 } }),
        order({ id: 'b', window: { start: 600, end: 630 }, durationMin: 10 }),
        order({ id: 'c', window: { start: 720, end: 800 }, durationMin: 30 }),
      ],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({
        'office>a': [1000, 10],
        'a>b': [500, 5],
        'a>c': [1000, 10],
        'c>b': [500, 5],
      }),
    })
    expect(plan.routes[0]?.visits.map((v) => v.orderId)).toEqual(['a', 'c'])
    expect(plan.unassigned).toEqual([
      {
        orderId: 'b',
        class: 'search-limit',
        withSkill: 1,
        withSkillAndTransport: 1,
        rejections: [{ engineerId: 'e1', code: 'window', earliestStartMin: 765 }],
        approximate: false,
      },
    ])
  })

  it('совместимый инженер без отказа: заявка помещается в конец итогового маршрута', () => {
    const plan = planBaseline({
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
    })
    expect(plan.routes[0]?.visits.map((v) => v.orderId)).toEqual(['c', 'd'])
    expect(plan.unassigned).toEqual([
      {
        orderId: 'b',
        class: 'search-limit',
        withSkill: 1,
        withSkillAndTransport: 1,
        rejections: [],
        approximate: false,
      },
    ])
  })

  it('помечает приближённые рёбра в маршруте и метриках', () => {
    const plan = planBaseline({
      orders: [order({ id: 'a' })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [1000, 10] }, true),
    })
    expect(plan.routes[0]?.approximate).toBe(true)
    expect(plan.metrics.approximate).toBe(true)
  })

  it('помечает план, если отказ опирается на приближённый переезд', () => {
    const plan = planBaseline({
      orders: [order({ id: 'a', window: { start: 540, end: 550 } })],
      engineers: [engineer({ id: 'e1' })],
      travel: tableTravel({ 'office>a': [1000, 30] }, true),
    })
    expect(plan.routes[0]?.visits).toEqual([])
    expect(plan.unassigned[0]?.approximate).toBe(true)
    expect(plan.unassigned[0]?.rejections[0]).toMatchObject({ code: 'window', approximate: true })
    expect(plan.metrics.approximate).toBe(true)
  })

  it('детерминирован', () => {
    const input = {
      orders: [order({ id: 'b' }), order({ id: 'a' }), order({ id: 'c' })],
      engineers: [engineer({ id: 'e2' }), engineer({ id: 'e1' })],
      travel,
    }
    expect(planBaseline(input)).toEqual(planBaseline(input))
  })
})

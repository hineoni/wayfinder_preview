import { describe, expect, it } from 'vitest'
import { assessDelay, assessReadiness, prepareEmergencyEquipment } from '../src/resilience'
import { planOptimized } from '../src/optimized'
import { continuePlanningDay, replanAfterEvent } from '../src/replan'
import { confirmCustomerTime, reconcileAgreements } from '../src/customer-agreements'
import { engineer, order, noEquipment, tableTravel } from './fixtures'

function example() {
  const input = {
    orders: [
      order({ id: 'done', pointId: 'office', window: { start: 540, end: 540 }, durationMin: 30 }),
      order({ id: 'busy', pointId: 'office', window: { start: 600, end: 600 }, durationMin: 100 }),
      order({
        id: 'client',
        pointId: 'office',
        window: { start: 730, end: 950 },
        durationMin: 30,
        skill: 'connection',
      }),
    ],
    engineers: [
      engineer({
        id: 'a',
        skills: ['local', 'connection', 'emergency'],
        equipment: { ...noEquipment, 'emergency-kit': 2 },
      }),
      engineer({ id: 'b', skills: ['emergency'] }),
    ],
    travel: tableTravel({}),
  }
  const plan = planOptimized(input).plan
  const urgent = order({
    id: 'urgent',
    pointId: 'office',
    skill: 'emergency',
    priority: 'emergency',
    durationMin: 100,
    equipment: { ...noEquipment, 'emergency-kit': 1 },
    availableFromMin: 650,
    window: { start: 680, end: 710 },
  })
  return { input, plan, event: { kind: 'urgent-order' as const, atMin: 650, order: urgent } }
}

describe('устойчивость дня', () => {
  it('смена исполнителя при том же времени не снимает клиентскую фиксацию', () => {
    const input = {
      orders: [order({ id: 'client', pointId: 'office', window: { start: 730, end: 900 } })],
      engineers: [engineer({ id: 'a' }), engineer({ id: 'b' })],
      travel: tableTravel({}),
    }
    const plan = planOptimized(input).plan
    const assigned = plan.routes.find((r) => r.visits.length)!.engineerId
    const queue = confirmCustomerTime([], plan, 'client')
    const result = replanAfterEvent(
      input,
      plan,
      { kind: 'engineer-unavailable', atMin: 600, engineerId: assigned },
      [],
      { promises: { client: 730 } },
    )
    expect(reconcileAgreements(queue, result)[0]).toMatchObject({
      status: 'pending',
      reason: 'engineer-changed',
      promisedStartMin: 730,
      startMin: 730,
    })
  })
  it('недоступность во время отменённого переезда не дописывает непройденное расстояние', () => {
    const input = {
      orders: [order({ id: 'visit', window: { start: 540, end: 800 } })],
      engineers: [engineer({ id: 'a' })],
      travel: tableTravel({ 'office>visit': [1000, 100] }),
    }
    const plan = planOptimized(input).plan
    const first = replanAfterEvent(
      input,
      plan,
      { kind: 'cancel-order', atMin: 560, orderId: 'visit' },
      [],
    )
    const second = continuePlanningDay(
      input,
      first,
      { kind: 'engineer-unavailable', atMin: 590, engineerId: 'a' },
      [],
    )
    expect(second.history).toHaveLength(1)
    expect(second.history[0]).toMatchObject({
      state: 'interrupted-en-route',
      recordedAtMin: 590,
      estimatedTravelledDistanceM: 500,
    })
    expect(second.dayMetrics.distanceM).toBe(500)
    expect(second.checkpoint?.orders).toEqual([])
  })
  it('переносит существующий запас до выезда, не теряет назначения и не мутирует вход', () => {
    const { input, plan } = example()
    const probes = [{ id: 'one', pointId: 'office', atMin: 620, windowMin: 40 }]
    const before = assessReadiness(input, plan, probes)
    expect(before.assigned).toBe(0)
    const result = prepareEmergencyEquipment(input, plan, probes)
    expect(result.after.withoutDisruption).toBe(1)
    expect(result.transfer).toEqual({ fromEngineerId: 'a', toEngineerId: 'b', units: 1 })
    expect(result.engineers.reduce((sum, e) => sum + e.equipment['emergency-kit'], 0)).toBe(2)
    expect(result.plan.routes.map((r) => r.visits.map((v) => [v.orderId, v.startMin]))).toEqual(
      plan.routes.map((r) => r.visits.map((v) => [v.orderId, v.startMin])),
    )
    expect(input.engineers[1]!.equipment['emergency-kit']).toBe(0)
    expect(result.checkedTransfers).toBeLessThanOrEqual(12)
  })

  it('задержка расходует ожидание, а затем приводит к явным нарушениям', () => {
    const { input, plan } = example()
    expect(
      assessDelay(input, plan, 'busy', 30).visits.find((v) => v.orderId === 'client')?.shiftMin,
    ).toBe(0)
    expect(
      assessDelay(input, plan, 'busy', 60).visits.find((v) => v.orderId === 'client')?.shiftMin,
    ).toBe(30)
    const lateInput = {
      ...input,
      orders: input.orders.map((o) =>
        o.id === 'client' ? { ...o, window: { start: 730, end: 740 } } : o,
      ),
    }
    expect(
      assessDelay(lateInput, plan, 'busy', 60).visits.find((v) => v.orderId === 'client')
        ?.windowMissed,
    ).toBe(true)
  })

  it('фиксированное клиентом время приводит к явному конфликту, а не скрытому переносу', () => {
    const { input, plan, event } = example()
    const queue = confirmCustomerTime([], plan, 'client')
    expect(queue[0]?.startMin).toBe(730)
    const result = replanAfterEvent(
      input,
      plan,
      event,
      [{ orderId: 'done', status: 'completed' }],
      { promises: { client: 730 } },
    )
    expect(result.promiseConflicts).toEqual(['client'])
    const released = replanAfterEvent(input, plan, event, [
      { orderId: 'done', status: 'completed' },
    ])
    expect(
      released.plan.routes.flatMap((r) => r.visits).find((v) => v.orderId === 'client')?.startMin,
    ).toBe(800)
    expect(reconcileAgreements(queue, released).find((a) => a.orderId === 'client')).toMatchObject({
      status: 'pending',
      previousStartMin: 730,
      startMin: 800,
    })
  })

  it('несколько событий сохраняют историю и списывают каждый комплект ровно один раз', () => {
    const { input, plan, event } = example()
    const first = replanAfterEvent(input, plan, event, [{ orderId: 'done', status: 'completed' }])
    const dayInput = { ...input, orders: [...input.orders, event.order] }
    const secondOrder = {
      ...event.order,
      id: 'second',
      availableFromMin: 810,
      window: { start: 810, end: 920 },
    }
    const second = continuePlanningDay(
      dayInput,
      first,
      { kind: 'urgent-order', atMin: 810, order: secondOrder },
      [
        { orderId: 'busy', status: 'completed' },
        { orderId: 'urgent', status: 'completed' },
      ],
    )
    expect(second.violations).toEqual([])
    expect(
      second.history
        .filter((h) => h.state === 'completed')
        .map((h) => h.visit.orderId)
        .toSorted(),
    ).toEqual(['busy', 'done', 'urgent'])
    expect(second.equipment.find((e) => e.engineerId === 'a')?.actualAtEvent['emergency-kit']).toBe(
      1,
    )
    expect(second.equipment.find((e) => e.engineerId === 'a')?.afterPlan['emergency-kit']).toBe(0)
    expect(second.dayMetrics.assigned).toBe(5)
    expect(() => continuePlanningDay(dayInput, first, { ...event, atMin: 640 }, [])).toThrow(
      'предшествовать',
    )
    expect(() => continuePlanningDay(dayInput, first, event, [])).toThrow('уже использован')
  })

  it('отмена и прерывание между событиями сохраняют собственное время истории', () => {
    const { input, plan, event } = example()
    const first = replanAfterEvent(input, plan, event, [{ orderId: 'done', status: 'completed' }])
    const dayInput = { ...input, orders: [...input.orders, event.order] }
    const second = continuePlanningDay(
      dayInput,
      first,
      { kind: 'cancel-order', atMin: 660, orderId: 'client' },
      [],
    )
    const third = continuePlanningDay(
      dayInput,
      second,
      { kind: 'engineer-unavailable', atMin: 680, engineerId: 'a' },
      [],
    )
    expect(third.history.find((h) => h.visit.orderId === 'busy')).toMatchObject({
      state: 'interrupted',
      recordedAtMin: 680,
    })
    expect(third.history.find((h) => h.visit.orderId === 'done')?.state).toBe('completed')
    expect(third.checkpoint?.orders.some((o) => o.id === 'client')).toBe(false)
    expect(third.checkpoint?.engineers.some((e) => e.id === 'a')).toBe(false)
    expect(third.plan.unassigned.some((o) => o.orderId === 'busy')).toBe(true)
  })
})

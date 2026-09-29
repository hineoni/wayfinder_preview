import { describe, expect, it } from 'vitest'
import { findAssignmentOptions } from '../src/assignment-options'
import { planBaseline } from '../src/baseline'
import { engineer, noEquipment, order, tableTravel } from './fixtures'

describe('проверяемые варианты назначения', () => {
  it('сначала находит назначение с исходным окном без предложения лишних ресурсов', () => {
    const input = {
      orders: [
        order({ id: 'late', pointId: 'office', window: { start: 900, end: 900 } }),
        order({ id: 'early', pointId: 'office', window: { start: 600, end: 600 } }),
      ],
      engineers: [engineer({ id: 'e' })],
      travel: tableTravel({}),
    }
    const options = findAssignmentOptions(input, planBaseline(input), 'early')
    expect(options.map((o) => o.kind)).toEqual(['existing'])
    if (options[0]!.kind === 'rejected') throw new Error('Ожидалось назначение')
    expect(options[0]!.startMin).toBe(600)
    expect(options[0]!.changes).toEqual([])
    expect(options[0]!.plan.unassigned).toEqual([])
  })
  it('расширение окна сохраняет прежние заявки и показывает сдвиг следующего визита', () => {
    const input = {
      orders: [
        order({ id: 'busy', pointId: 'office', window: { start: 540, end: 540 }, durationMin: 60 }),
        order({ id: 'next', pointId: 'office', window: { start: 620, end: 800 }, durationMin: 30 }),
        order({
          id: 'missed',
          pointId: 'office',
          window: { start: 540, end: 580 },
          durationMin: 60,
        }),
      ],
      engineers: [engineer({ id: 'e' })],
      travel: tableTravel({}),
    }
    const baseline = planBaseline(input)
    const before = structuredClone(baseline)
    const option = findAssignmentOptions(input, baseline, 'missed').find(
      (o) => o.kind === 'window',
    )!
    if (option.kind === 'rejected') throw new Error('Ожидалось назначение')
    expect(option.windowExtensionMin).toBe(30)
    expect(option.startMin).toBe(600)
    expect(option.changes).toEqual([{ orderId: 'next', previousStartMin: 620, startMin: 660 }])
    expect(option.plan.unassigned).toEqual([])
    expect(baseline).toEqual(before)
    expect(input.orders[2]!.window.end).toBe(580)
  })

  it('предлагает утренний комплект, но не подменяет квалификацию существующей бригады', () => {
    const input = {
      orders: [order({ id: 'a', pointId: 'office', equipment: { ...noEquipment, router: 1 } })],
      engineers: [engineer({ id: 'e' })],
      travel: tableTravel({}),
    }
    const options = findAssignmentOptions(input, planBaseline(input), 'a')
    const equipment = options.find((o) => o.kind !== 'rejected' && o.kind === 'equipment')
    expect(equipment?.kind !== 'rejected' && equipment?.extraEquipment?.router).toBe(1)
    const unqualified = { ...input, engineers: [engineer({ id: 'e', skills: ['emergency'] })] }
    const alternatives = findAssignmentOptions(unqualified, planBaseline(unqualified), 'a')
    expect(alternatives.map((o) => o.kind)).toEqual(['extra-engineer'])
    expect(alternatives[0]!.engineer.skills).toEqual(['local'])
    expect(input.engineers[0]!.equipment.router).toBe(0)
  })

  it('не предлагает непроверенный маршрут или перенос к единственному исполнителю', () => {
    const input = {
      orders: [order({ id: 'a' })],
      engineers: [engineer({ id: 'e' })],
      travel: tableTravel({}),
    }
    expect(findAssignmentOptions(input, planBaseline(input), 'a')).toEqual([])
    const reachable = { ...input, travel: tableTravel({ 'office>a': [10, 1] }) }
    expect(findAssignmentOptions(reachable, planBaseline(reachable), 'a')).toEqual([])
  })
})

describe('альтернативы назначенного визита', () => {
  it('сухой прогон сохраняет план, проверяет каждого совместимого инженера и возвращает отказы', () => {
    const input = {
      orders: [order({ id: 'a', equipment: { ...noEquipment, router: 1 } })],
      engineers: [
        engineer({ id: 'current', equipment: { ...noEquipment, router: 1 } }),
        engineer({ id: 'no-kit' }),
        engineer({ id: 'near', startPointId: 'near', equipment: { ...noEquipment, router: 1 } }),
        engineer({ id: 'far', startPointId: 'far', equipment: { ...noEquipment, router: 1 } }),
        engineer({ id: 'wrong-skill', skills: ['emergency'] }),
      ],
      travel: tableTravel({ 'office>a': [100, 10], 'near>a': [50, 5], 'far>a': [200, 20] }),
    }
    const plan = planBaseline(input)
    const before = structuredClone(plan)
    const options = findAssignmentOptions(input, plan, 'a')
    expect(options.map((item) => [item.engineer.id, item.kind])).toEqual([
      ['near', 'existing'],
      ['far', 'existing'],
      ['no-kit', 'rejected'],
    ])
    const near = options[0]!
    if (near.kind === 'rejected') throw new Error('Ожидалось назначение')
    expect(near.comparison.delta.distanceM).toBe(-50)
    expect(near.comparison.result).toBe('better')
    expect(near.comparison.decisive).toBe('distanceM')
    expect(near.plan.routes.find((route) => route.engineerId === 'current')?.visits).toEqual([])
    expect(near.plan.routes.find((route) => route.engineerId === 'near')?.visits[0]?.orderId).toBe(
      'a',
    )
    expect(plan).toEqual(before)
  })

  it('короткий перенос к свободной бригаде проигрывает по числу задействованных инженеров', () => {
    const input = {
      orders: [order({ id: 'a' }), order({ id: 'b', window: { start: 780, end: 900 } })],
      engineers: [engineer({ id: 'current' }), engineer({ id: 'idle', startPointId: 'near' })],
      travel: tableTravel({
        'office>a': [1000, 10],
        'a>b': [1000, 10],
        'office>b': [1000, 10],
        'near>a': [100, 1],
      }),
    }
    const [idle] = findAssignmentOptions(input, planBaseline(input), 'a')
    if (idle?.kind !== 'existing') throw new Error('Ожидалось назначение')
    expect(idle.comparison.delta.distanceM).toBe(-900)
    expect(idle.comparison.delta.engineersUsed).toBe(1)
    expect(idle.comparison.result).toBe('worse')
    expect(idle.comparison.decisive).toBe('engineersUsed')
  })
})

import { describe, expect, it } from 'vitest'
import { engineerLowerBound } from '../src/lower-bound'
import { planOptimized } from '../src/optimized'
import { engineer, order, tableTravel } from './fixtures'

describe('нижняя граница числа инженеров', () => {
  it('складывает работу и кратчайший подъезд и делит на смены', () => {
    const input = {
      orders: ['a', 'b', 'c'].map((id) =>
        order({ id, durationMin: 400, window: { start: 540, end: 1320 } }),
      ),
      engineers: ['e1', 'e2', 'e3'].map((id) => engineer({ id, shift: { start: 540, end: 1320 } })),
      travel: tableTravel({ 'office>a': [1, 10], 'office>b': [1, 10], 'office>c': [1, 10] }),
    }
    // 3 × (400 + 10) = 1230 мин больше одной смены 780 мин, но помещается в две.
    expect(engineerLowerBound(input)).toEqual({ engineers: 2, orders: 3 })
  })

  it('учитывает работу, которая при любом допустимом начале идёт одновременно', () => {
    const input = {
      orders: ['a', 'b', 'c'].map((id) =>
        order({ id, durationMin: 400, window: { start: 600, end: 720 } }),
      ),
      engineers: ['e1', 'e2', 'e3'].map((id) => engineer({ id })),
      travel: tableTravel({ 'office>a': [1, 10], 'office>b': [1, 10], 'office>c': [1, 10] }),
    }
    // Каждая работа идёт с 12:00 до 16:40 при любом начале в окне 10:00–12:00.
    expect(engineerLowerBound(input).engineers).toBe(3)
  })

  it('учитывает навык отдельно: аварии выполняют только аварийные бригады', () => {
    const input = {
      orders: [
        order({ id: 'x', skill: 'emergency', durationMin: 500 }),
        order({ id: 'y', skill: 'emergency', durationMin: 500 }),
      ],
      engineers: [
        engineer({ id: 'em1', skills: ['emergency'] }),
        engineer({ id: 'em2', skills: ['emergency'] }),
        engineer({ id: 'other' }),
      ],
      travel: tableTravel({ 'office>x': [1, 5], 'office>y': [1, 5] }),
    }
    expect(engineerLowerBound(input).engineers).toBe(2)
  })

  it('исключает заявки без совместимого инженера или без подъезда', () => {
    const input = {
      orders: [order({ id: 'a' }), order({ id: 'lost', skill: 'emergency' })],
      engineers: [engineer({ id: 'e' })],
      travel: tableTravel({ 'office>a': [1, 5] }),
    }
    expect(engineerLowerBound(input)).toEqual({ engineers: 1, orders: 1 })
  })

  it('не превышает число инженеров найденного плана со всеми заявками', () => {
    const points = ['a', 'b', 'c', 'd', 'e', 'f']
    const table: Record<string, readonly [number, number]> = {}
    for (const from of ['office', ...points])
      for (const to of points) if (from !== to) table[`${from}>${to}`] = [1000, 15]
    const input = {
      orders: points.map((id, index) =>
        order({ id, durationMin: 120, window: { start: 540 + index * 60, end: 1100 } }),
      ),
      engineers: ['e1', 'e2', 'e3', 'e4'].map((id) => engineer({ id })),
      travel: tableTravel(table),
    }
    const plan = planOptimized(input).plan
    expect(plan.metrics.unassignedTotal).toBe(0)
    expect(engineerLowerBound(input).engineers).toBeLessThanOrEqual(plan.metrics.engineersUsed)
  })
})

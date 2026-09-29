import { describe, expect, it } from 'vitest'
import { assignOrderManually } from '../src/manual-assignment'
import { planOptimized } from '../src/optimized'
import { validatePlan } from '../src/validator'
import { engineer, order, tableTravel } from './fixtures'

describe('ручное назначение', () => {
  const input = {
    engineers: [engineer({ id: 'e1' }), engineer({ id: 'e2' })],
    orders: [
      order({ id: 'a', pointId: 'a', window: { start: 540, end: 900 } }),
      order({ id: 'b', pointId: 'b', window: { start: 540, end: 900 } }),
    ],
    travel: tableTravel({
      'office>a': [1000, 10],
      'office>b': [1000, 10],
      'a>b': [1000, 10],
      'b>a': [1000, 10],
    }),
  } as const

  it('переносит заявку выбранному инженеру и выдаёт валидный план', () => {
    const initial = planOptimized(input).plan
    const assigned = assignOrderManually(input, initial, 'a', 'e2')

    expect(assigned.ok).toBe(true)
    if (!assigned.ok) return
    expect(
      assigned.plan.routes.find((route) => route.engineerId === 'e2')?.visits.map((v) => v.orderId),
    ).toContain('a')
    expect(validatePlan(input, assigned.plan)).toEqual([])
  })

  it('отклоняет невозможное назначение без частичного плана', () => {
    const incompatible = {
      ...input,
      engineers: [engineer({ id: 'e1', skills: ['connection'] })],
    }
    const initial = planOptimized(incompatible).plan

    expect(assignOrderManually(incompatible, initial, 'a', 'e1')).toEqual({
      ok: false,
      code: 'no-feasible-position',
    })
  })

  it('не требует допустимости временного маршрута без переносимой заявки', () => {
    const sparseInput = {
      engineers: [engineer({ id: 'e1' })],
      orders: [
        order({ id: 'a', window: { start: 540, end: 900 } }),
        order({ id: 'b', window: { start: 540, end: 900 } }),
      ],
      travel: tableTravel({ 'office>a': [1000, 10], 'a>b': [1000, 10] }),
    } as const
    const initial = planOptimized(sparseInput).plan

    const assigned = assignOrderManually(sparseInput, initial, 'a', 'e1')
    expect(assigned.ok).toBe(true)
    if (!assigned.ok) throw new Error('ожидалось допустимое назначение')
    expect(validatePlan(sparseInput, assigned.plan)).toEqual([])
  })
})

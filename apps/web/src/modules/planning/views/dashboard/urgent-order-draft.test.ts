import { describe, expect, it } from 'vitest'
import { isUrgentOrderDraftValid, type UrgentOrderDraft } from './urgent-order-draft'

const valid: UrgentOrderDraft = {
  id: 'U-CUSTOM',
  address: 'Новая точка',
  at: '13:30',
  windowStart: '14:00',
  windowEnd: '16:00',
  lat: '55.75',
  lon: '37.61',
}
const shift = { start: '09:00', end: '22:00' }

describe('черновик произвольной аварии', () => {
  it('отклоняет пустые координаты, но принимает явно введённый ноль', () => {
    expect(isUrgentOrderDraftValid({ ...valid, lat: ' ' }, shift, new Set())).toBe(false)
    expect(isUrgentOrderDraftValid({ ...valid, lon: '' }, shift, new Set())).toBe(false)
    expect(isUrgentOrderDraftValid({ ...valid, lat: '0', lon: '0' }, shift, new Set())).toBe(true)
  })

  it('разрешает окно шире смены и отклоняет обратные границы', () => {
    expect(
      isUrgentOrderDraftValid(
        { ...valid, windowStart: '00:01', windowEnd: '23:59' },
        shift,
        new Set(),
      ),
    ).toBe(true)
    expect(
      isUrgentOrderDraftValid(
        { ...valid, windowStart: '16:00', windowEnd: '14:00' },
        shift,
        new Set(),
      ),
    ).toBe(false)
  })

  it('требует уникальный ID и время события внутри смены', () => {
    expect(isUrgentOrderDraftValid(valid, shift, new Set(['U-CUSTOM']))).toBe(false)
    expect(isUrgentOrderDraftValid({ ...valid, at: '22:01' }, shift, new Set())).toBe(false)
  })
})

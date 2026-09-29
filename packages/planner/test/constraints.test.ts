import { describe, expect, it } from 'vitest'
import { checkAppend, cursorAfter, startCursor } from '../src/constraints'
import { engineer, noEquipment, order, tableTravel } from './fixtures'

const travel = tableTravel({
  'office>a': [5000, 20],
  'a>b': [3000, 15],
})

describe('checkAppend', () => {
  it('выезжает позже и прибывает к началу первого окна', () => {
    const e = engineer({ id: 'e1' })
    const check = checkAppend(
      e,
      startCursor(e),
      order({ id: 'a', window: { start: 600, end: 720 } }),
      travel,
    )
    expect(check).toEqual({
      ok: true,
      visit: {
        orderId: 'a',
        travel: { distanceM: 5000, durationMin: 20, approximate: false },
        arrivalMin: 600,
        startMin: 600,
        waitMin: 0,
        endMin: 660,
        equipmentRemaining: noEquipment,
      },
    })
  })

  it('продолжает от конца предыдущего визита', () => {
    const e = engineer({ id: 'e1' })
    const first = checkAppend(e, startCursor(e), order({ id: 'a' }), travel)
    if (!first.ok) throw new Error('первый визит должен быть допустим')
    const cursor = cursorAfter(first.visit, order({ id: 'a' }))
    const second = checkAppend(
      e,
      cursor,
      order({ id: 'b', window: { start: 600, end: 720 } }),
      travel,
    )
    expect(second.ok && second.visit.arrivalMin).toBe(675)
    expect(second.ok && second.visit.waitMin).toBe(0)
  })

  it('отклоняет по навыку раньше остальных проверок', () => {
    const e = engineer({ id: 'e1', skills: ['connection'] })
    const check = checkAppend(e, startCursor(e), order({ id: 'zzz', skill: 'local' }), travel)
    expect(check).toEqual({ ok: false, rejection: { engineerId: 'e1', code: 'skill' } })
  })

  it('оставляет промежуточную паузу даже после возвращения в стартовую точку', () => {
    const e = engineer({ id: 'e1' })
    const firstOrder = order({
      id: 'first',
      pointId: 'office',
      window: { start: 540, end: 600 },
      durationMin: 10,
    })
    const first = checkAppend(e, startCursor(e), firstOrder, travel)
    if (!first.ok) throw new Error('первый визит допустим')
    const next = checkAppend(e, cursorAfter(first.visit, firstOrder), order({ id: 'a' }), travel)
    expect(next.ok && next.visit).toMatchObject({ arrivalMin: 570, startMin: 600, waitMin: 30 })
  })

  it('отклоняет по транспорту, если заявка требует другой', () => {
    const e = engineer({ id: 'e1', transport: 'foot' })
    const check = checkAppend(e, startCursor(e), order({ id: 'a', transport: 'car' }), travel)
    expect(check).toEqual({ ok: false, rejection: { engineerId: 'e1', code: 'transport' } })
  })

  it('отклоняет недостижимую пару', () => {
    const e = engineer({ id: 'e1' })
    const check = checkAppend(e, startCursor(e), order({ id: 'nowhere' }), travel)
    expect(check).toEqual({ ok: false, rejection: { engineerId: 'e1', code: 'unreachable' } })
  })

  it('списывает дневной комплект и отклоняет заявку при нехватке', () => {
    const e = engineer({
      id: 'e1',
      equipment: { ...noEquipment, 'emergency-kit': 1 },
    })
    const emergency = order({
      id: 'a',
      equipment: { ...noEquipment, 'emergency-kit': 1 },
    })
    const first = checkAppend(e, startCursor(e), emergency, travel)
    expect(first.ok && first.visit.equipmentRemaining['emergency-kit']).toBe(0)
    if (!first.ok) throw new Error('первая заявка должна быть допустима')
    expect(
      checkAppend(e, cursorAfter(first.visit, emergency), order({ ...emergency, id: 'b' }), travel),
    ).toEqual({
      ok: false,
      rejection: {
        engineerId: 'e1',
        code: 'equipment',
        equipment: 'emergency-kit',
        requiredUnits: 1,
        availableUnits: 0,
      },
    })
  })

  it('отклоняет, если самое раннее начало позже конца окна', () => {
    const e = engineer({ id: 'e1' })
    const check = checkAppend(
      e,
      startCursor(e),
      order({ id: 'a', window: { start: 500, end: 550 } }),
      travel,
    )
    expect(check).toEqual({
      ok: false,
      rejection: { engineerId: 'e1', code: 'window', earliestStartMin: 560 },
    })
  })

  it('разрешает окончание работы после конца окна, но не после смены', () => {
    const e = engineer({ id: 'e1', shift: { start: 540, end: 700 } })
    const late = checkAppend(
      e,
      startCursor(e),
      order({ id: 'a', window: { start: 600, end: 720 }, durationMin: 90 }),
      travel,
    )
    expect(late.ok && late.visit.endMin).toBe(690)
    const tooLate = checkAppend(
      e,
      startCursor(e),
      order({ id: 'a', window: { start: 600, end: 720 }, durationMin: 120 }),
      travel,
    )
    expect(tooLate).toEqual({
      ok: false,
      rejection: { engineerId: 'e1', code: 'shift', earliestStartMin: 600 },
    })
  })

  it('включает границы окна и смены', () => {
    const e = engineer({ id: 'e1', shift: { start: 540, end: 620 } })
    const check = checkAppend(
      e,
      startCursor(e),
      order({ id: 'a', window: { start: 560, end: 560 }, durationMin: 60 }),
      travel,
    )
    expect(check.ok && check.visit).toMatchObject({
      arrivalMin: 560,
      waitMin: 0,
      startMin: 560,
      endMin: 620,
    })
  })
})

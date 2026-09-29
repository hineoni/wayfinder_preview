import { describe, expect, it } from 'vitest'
import type { Visit } from '@wayfinder/planner'
import { scheduleSegments, occupiedMinutes, reserveSummary } from './schedule-segments'
const visit: Visit = {
  orderId: 'test',
  arrivalMin: 560,
  startMin: 600,
  endMin: 700,
  waitMin: 40,
  travel: { durationMin: 20, distanceM: 5000, approximate: false },
  equipmentRemaining: { 'emergency-kit': 0, router: 0, 'tv-box': 0, 'cable-kit': 0 },
  explanation: {
    engineerId: 'crew',
    requiredSkill: 'emergency',
    skillMatched: true,
    transportMatched: true,
    arrivalMin: 560,
    waitMin: 40,
    startMin: 600,
    endMin: 700,
    addedDistance: { status: 'defined', distanceM: 5000 },
    approximate: false,
  },
}
describe('сегменты дневного расписания', () => {
  it('рисует поздний переезд прямо перед работой без утреннего ожидания', () => {
    expect(scheduleSegments({ ...visit, arrivalMin: 600, waitMin: 0 })).toEqual([
      { kind: 'travel', start: 580, end: 600 },
      { kind: 'work', start: 600, end: 700 },
    ])
  })
  it('считает паузы будущего плана и число бригад с ними, а не все свободные часы смены', () => {
    const route = { engineerId: 'crew', visits: [visit], distanceM: 5000, approximate: false }
    expect(
      reserveSummary({
        routes: [
          route,
          { ...route, engineerId: 'empty', visits: [] },
          { ...route, engineerId: 'no-wait', visits: [{ ...visit, waitMin: 0, arrivalMin: 600 }] },
        ],
      }),
    ).toEqual({ minutes: 40, crews: 1 })
    expect(reserveSummary({ routes: [] })).toEqual({ minutes: 0, crews: 0 })
  })
  it('обрезает прерванный переезд и исключает неначатые ожидание и работу', () => {
    expect(scheduleSegments(visit, 'interrupted-en-route', 550)).toEqual([
      { kind: 'travel', start: 540, end: 550 },
    ])
  })
  it('сохраняет весь переезд и только прошедшее ожидание недоступного инженера', () => {
    expect(scheduleSegments(visit, 'interrupted-waiting', 580)).toEqual([
      { kind: 'travel', start: 540, end: 560 },
      { kind: 'wait', start: 560, end: 580 },
    ])
  })
  it('разделяет переезд, ожидание и работу с исходными границами', () => {
    const segments = scheduleSegments(visit)
    expect(segments).toEqual([
      { kind: 'travel', start: 540, end: 560 },
      { kind: 'wait', start: 560, end: 600 },
      { kind: 'work', start: 600, end: 700 },
    ])
    expect(occupiedMinutes(segments)).toBe(160)
  })
  it('обрезает прерванную работу в момент события', () => {
    const segments = scheduleSegments(visit, 'interrupted', 650)
    expect(segments.at(-1)).toEqual({ kind: 'work', start: 600, end: 650 })
    expect(occupiedMinutes(segments)).toBe(110)
  })
  it('не рисует отменённую работу после ожидания', () => {
    expect(scheduleSegments(visit, 'cancelled-waiting', 580)).toEqual([
      { kind: 'travel', start: 540, end: 560 },
      { kind: 'wait', start: 560, end: 580 },
    ])
  })
  it('сохраняет обязательный переезд при отмене в пути, без ожидания и работы', () => {
    expect(scheduleSegments(visit, 'cancelled-en-route', 550)).toEqual([
      { kind: 'travel', start: 540, end: 560 },
    ])
  })
  it('показывает оставшуюся зафиксированную работу при событии во время визита', () => {
    expect(scheduleSegments(visit, 'in-progress', 650).at(-1)?.end).toBe(700)
  })
  it('не удваивает занятость пересекающихся интервалов', () => {
    expect(
      occupiedMinutes([
        { kind: 'work', start: 600, end: 700 },
        { kind: 'work', start: 650, end: 750 },
      ]),
    ).toBe(150)
    expect(occupiedMinutes([])).toBe(0)
  })
})

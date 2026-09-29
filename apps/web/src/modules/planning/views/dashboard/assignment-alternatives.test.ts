import { planBaseline, findAssignmentOptions, type Engineer, type Order } from '@wayfinder/planner'
import { describe, expect, it } from 'vitest'
import { alternativeText } from './assignment-alternatives'

const stock = { 'emergency-kit': 0, router: 0, 'tv-box': 0, 'cable-kit': 0 }
const order = (id: string, start: number): Order => ({
  id,
  pointId: id,
  durationMin: 60,
  availableFromMin: 540,
  window: { start, end: start + 120 },
  priority: 'normal',
  skill: 'local',
  equipment: stock,
})
const engineer = (id: string, startPointId: string): Engineer => ({
  id,
  name: `Бригада ${id}`,
  startPointId,
  shift: { start: 540, end: 1320 },
  skills: ['local'],
  transport: 'car',
  equipment: stock,
})
const legs: Record<string, number> = {
  'office>a': 1000,
  'a>b': 1000,
  'office>b': 1000,
  'near>a': 100,
}
const input = {
  orders: [order('a', 600), order('b', 780)],
  engineers: [engineer('current', 'office'), engineer('idle', 'near')],
  travel: {
    travel: (_: string, from: string, to: string) => {
      if (from === to) return { distanceM: 0, durationMin: 0, approximate: false }
      const distanceM = legs[`${from}>${to}`]
      return distanceM === undefined ? null : { distanceM, durationMin: 10, approximate: false }
    },
  },
}

describe('текст альтернатив назначения', () => {
  it('называет лишнюю бригаду раньше более короткого пробега', () => {
    const [option] = findAssignmentOptions(input, planBaseline(input), 'a')
    expect(alternativeText(option!)).toBe(
      'Бригада idle: ещё 1 задействованная бригада, хотя пробег -900 м',
    )
  })

  it('для остальных решений цели называет пробег, выигрыш и равенство', () => {
    const [option] = findAssignmentOptions(input, planBaseline(input), 'a')
    if (option?.kind !== 'existing') throw new Error('Ожидалось назначение')
    const shift = { orderId: 'b', previousStartMin: 780, startMin: 800 }
    const variant = (
      result: 'better' | 'equal' | 'worse',
      decisive: 'engineersUsed' | 'distanceM' | undefined,
      engineersUsed: number,
      distanceM: number,
      changes = [shift, shift],
    ) => ({
      ...option,
      changes,
      comparison: {
        ...option.comparison,
        result,
        decisive,
        delta: { ...option.comparison.delta, engineersUsed, distanceM },
      },
    })
    expect(alternativeText(variant('worse', 'distanceM', 0, 5600))).toBe(
      'Бригада idle: пробег +5,6 км; сдвиг времени у 2 визитов',
    )
    expect(alternativeText(variant('better', 'engineersUsed', -1, 300, [shift]))).toBe(
      'Бригада idle: на 1 бригаду меньше, пробег +300 м — лучше по цели плана; сдвиг времени у 1 визита',
    )
    expect(alternativeText(variant('equal', undefined, 0, 0, []))).toBe(
      'Бригада idle: равноценно по цели плана, пробег 0 м',
    )
  })
})

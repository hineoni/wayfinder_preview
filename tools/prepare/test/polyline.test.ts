import { describe, expect, it } from 'vitest'
import { decodePolyline } from '@wayfinder/dataset'
import { encodePolyline, joinSegments, simplifyLine } from '../src/polyline'
import { eulerianCircuit, legMatches } from '../src/routing'

describe('polyline', () => {
  it('кодирует и декодирует пример из спецификации', () => {
    const points = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ] as const
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(points.map((p) => [p[0], p[1]]))
  })

  it('склеивает шаги без дублирования стыков', () => {
    expect(
      joinSegments([
        [
          [1, 1],
          [2, 2],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
  })

  it('упрощает прямую до концов и сохраняет излом', () => {
    const straight = [
      [55.7, 37.6],
      [55.7, 37.601],
      [55.7, 37.602],
    ] as const
    expect(simplifyLine(straight, 5)).toEqual([
      [55.7, 37.6],
      [55.7, 37.602],
    ])
    const bent = [
      [55.7, 37.6],
      [55.701, 37.601],
      [55.7, 37.602],
    ] as const
    expect(simplifyLine(bent, 5)).toHaveLength(3)
  })
})

describe('eulerianCircuit', () => {
  it.each([2, 3, 5, 8])('покрывает все упорядоченные пары для n=%i ровно один раз', (n) => {
    const circuit = eulerianCircuit(n)
    expect(circuit).toHaveLength(n * (n - 1) + 1)
    const seen = new Set<string>()
    for (let i = 0; i + 1 < circuit.length; i += 1) {
      const key = `${circuit[i]}>${circuit[i + 1]}`
      expect(circuit[i]).not.toBe(circuit[i + 1])
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(n * (n - 1))
  })
})

describe('legMatches', () => {
  const table = {
    distances: [
      [0, 1000],
      [null, 0],
    ],
    durations: [
      [0, 120],
      [null, 0],
    ],
  }

  it('принимает leg в пределах допуска по расстоянию и времени', () => {
    expect(legMatches({ distance: 1005, duration: 123 }, table, 0, 1)).toBe(true)
  })

  it('отвергает совпадение расстояния при расхождении времени', () => {
    expect(legMatches({ distance: 1000, duration: 200 }, table, 0, 1)).toBe(false)
  })

  it('отвергает расхождение расстояния и недостижимую ячейку', () => {
    expect(legMatches({ distance: 1100, duration: 120 }, table, 0, 1)).toBe(false)
    expect(legMatches({ distance: 1000, duration: 120 }, table, 1, 0)).toBe(false)
  })
})

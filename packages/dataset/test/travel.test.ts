import { describe, expect, it } from 'vitest'
import type { PreparedMatrix, TravelModel } from '../src/prepared'
import { createMatrixTravel, graphForTransport } from '../src/travel'

const model: TravelModel = {
  publicTransport: { speedKmh: 18, transferMin: 10 },
  approximation: { factor: 1.3, speedKmh: { car: 30, bicycle: 15, foot: 5, public: 18 } },
}

function matrix(
  graph: PreparedMatrix['graph'],
  distanceM: (number | null)[][],
  durationS: (number | null)[][],
): PreparedMatrix {
  return {
    graph,
    source: { endpoint: 'test', fetchedAt: '2026-09-19T00:00:00Z', dataVersion: null },
    units: { distance: 'm', duration: 's' },
    snapDistanceM: distanceM.map(() => 0),
    distanceM,
    durationS,
    geometryGaps: [],
  }
}

const travel = createMatrixTravel({
  pointIds: ['a', 'b'],
  profiles: {
    car: matrix(
      'car',
      [
        [0, 3883.7],
        [null, 0],
      ],
      [
        [0, 496.5],
        [null, 0],
      ],
    ),
    bicycle: matrix(
      'bicycle',
      [
        [0, 3652],
        [3652, 0],
      ],
      [
        [0, 1320],
        [1320, 0],
      ],
    ),
    foot: matrix(
      'foot',
      [
        [0, 2413],
        [2413, 0],
      ],
      [
        [0, 1935],
        [1935, 0],
      ],
    ),
  },
  coordinates: new Map([
    ['a', { lat: 55.7522, lon: 37.6156 }],
    ['b', { lat: 55.76, lon: 37.635 }],
    ['c', { lat: 55.7, lon: 37.7 }],
  ]),
  model,
})

describe('createMatrixTravel', () => {
  it('округляет метры и минуты вверх, не помечает матричные рёбра приближёнными', () => {
    expect(travel.travel('car', 'a', 'b')).toEqual({
      distanceM: 3884,
      durationMin: 9,
      approximate: false,
    })
    expect(travel.travel('foot', 'a', 'b')).toEqual({
      distanceM: 2413,
      durationMin: 33,
      approximate: false,
    })
  })

  it('недостижимая пара графа остаётся недостижимой, одна точка — нулевой переезд', () => {
    expect(travel.travel('car', 'b', 'a')).toBeNull()
    expect(travel.travel('car', 'a', 'a')).toEqual({
      distanceM: 0,
      durationMin: 0,
      approximate: false,
    })
  })

  it('общественный транспорт: пешеходный путь, 18 км/ч плюс 10 минут', () => {
    expect(travel.travel('public', 'a', 'b')).toEqual({
      distanceM: 2413,
      durationMin: 19,
      approximate: false,
    })
  })

  it('точка вне матриц считается приближением и помечается', () => {
    const leg = travel.travel('car', 'a', 'c')
    expect(leg?.approximate).toBe(true)
    expect(leg?.distanceM).toBeGreaterThan(7000)
    expect(leg?.durationMin).toBe(Math.ceil(((leg?.distanceM ?? 0) / 1000 / 30) * 60))
    expect(() => travel.travel('car', 'a', 'unknown')).toThrow(/координат/)
  })
})

describe('graphForTransport', () => {
  it('автомобиль и велосипед — свои графы, пешком и общественный транспорт — foot', () => {
    expect(graphForTransport('car')).toBe('car')
    expect(graphForTransport('bicycle')).toBe('bicycle')
    expect(graphForTransport('foot')).toBe('foot')
    expect(graphForTransport('public')).toBe('foot')
  })
})

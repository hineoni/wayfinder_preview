import type { GeometryFile, LatLon } from '@wayfinder/dataset'
import { describe, expect, it } from 'vitest'
import { createEdgeResolver, midpointBearing } from './route-geometry'

// Дорога A → B с изломом только в графе car; foot-граф без геометрии этого ребра.
const geometry: GeometryFile = {
  formatVersion: 3,
  pointIds: ['A', 'B'],
  encoding: 'polyline5',
  profiles: {
    car: [
      [null, '_p~iF~ps|U_ulLnnqC_mqNvxq`@'],
      [null, null],
    ],
    bicycle: [
      [null, null],
      [null, null],
    ],
    foot: [
      [null, null],
      [null, null],
    ],
  },
}
const coordinates = new Map<string, LatLon>([
  ['A', [38.5, -120.2]],
  ['B', [43.252, -126.453]],
  ['X', [40, -120]],
])
const ab = { from: 'A', to: 'B', approximate: false }

describe('createEdgeResolver', () => {
  it('берёт дорогу по графу транспорта и прямую, если в графе геометрии нет', () => {
    const resolver = createEdgeResolver(geometry)
    const car = resolver.line(ab, 'car', coordinates)
    expect(car?.kind).toBe('road')
    expect(car?.points).toHaveLength(3)
    // Общественный транспорт считается по пешеходному графу, где этого ребра нет.
    expect(resolver.line(ab, 'public', coordinates)?.kind).toBe('straight')
  })

  it('приближённый переезд и точка вне матриц — прямая; неизвестная точка и петля — нет линии', () => {
    const resolver = createEdgeResolver(geometry)
    expect(resolver.line({ ...ab, approximate: true }, 'car', coordinates)?.kind).toBe('straight')
    expect(
      resolver.line({ from: 'A', to: 'X', approximate: false }, 'car', coordinates)?.kind,
    ).toBe('straight')
    expect(resolver.line({ from: 'A', to: 'Y', approximate: false }, 'car', coordinates)).toBe(
      undefined,
    )
    expect(resolver.line({ from: 'A', to: 'A', approximate: false }, 'car', coordinates)).toBe(
      undefined,
    )
  })

  it('без файла геометрии все рёбра прямые', () => {
    const resolver = createEdgeResolver(undefined)
    expect(resolver.line(ab, 'car', coordinates)).toEqual({
      kind: 'straight',
      points: [
        [38.5, -120.2],
        [43.252, -126.453],
      ],
    })
  })

  it('декодирует ребро один раз и склеивает соседние рёбра одного вида без разрыва', () => {
    const resolver = createEdgeResolver(geometry)
    const first = resolver.line(ab, 'car', coordinates)
    expect(resolver.line(ab, 'car', coordinates)?.points).toBe(first?.points)
    const lines = resolver.route(
      [ab, { from: 'B', to: 'X', approximate: false }, { from: 'X', to: 'A', approximate: false }],
      'car',
      coordinates,
    )
    expect(lines.road).toEqual([first?.points])
    // Прямая начинается с конца дороги, дальше — координаты точек.
    expect(lines.straight).toEqual([
      [
        [43.252, -126.453],
        [40, -120],
        [38.5, -120.2],
      ],
    ])
    // Склейка копирует точки: кеш декодера не мутируется.
    expect(first?.points).toHaveLength(3)
  })
})

describe('midpointBearing', () => {
  it('ставит точку в середину длины и берёт курс её отрезка', () => {
    // Короткий отрезок на север, затем длинный на восток: середина на восточном.
    const result = midpointBearing([
      [0, 0],
      [1, 0],
      [1, 3],
    ])
    expect(result?.at[0]).toBeCloseTo(1)
    expect(result?.at[1]).toBeCloseTo(1)
    expect(result?.bearing).toBeCloseTo(90)
  })

  it('отдаёт курс на юго-запад без отрицательных углов', () => {
    expect(
      midpointBearing([
        [1, 1],
        [0, 0],
      ])?.bearing,
    ).toBeCloseTo(225)
  })

  it('не ставит стрелку на вырожденное ребро', () => {
    expect(
      midpointBearing([
        [1, 1],
        [1, 1],
      ]),
    ).toBeUndefined()
  })
})

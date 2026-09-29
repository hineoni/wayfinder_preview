import {
  decodePolyline,
  graphForTransport,
  type GeometryFile,
  type LatLon,
  type TravelGraph,
} from '@wayfinder/dataset'
import type { Transport } from '@wayfinder/planner'

/** Состояние геометрии дорог для карты: до загрузки и при ошибке рёбра рисуются прямыми. */
export type GeometryState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly file: GeometryFile }
  | { readonly status: 'unavailable' }

export interface RouteEdge {
  readonly from: string
  readonly to: string
  /** Переезд посчитан приближением (точка вне матриц), а не по матрице и графу. */
  readonly approximate: boolean
}

interface EdgeLine {
  readonly kind: 'road' | 'straight'
  readonly points: LatLon[]
}

/** Ломаные маршрута: по дорогам и прямые там, где геометрии ребра нет или переезд приближённый. */
interface RouteLines {
  readonly road: LatLon[][]
  readonly straight: LatLon[][]
}

export type Coordinates = ReadonlyMap<string, LatLon>

export interface EdgeResolver {
  /** Линия одного ребра; `undefined`, если координаты точки неизвестны или ребро — петля. */
  line(edge: RouteEdge, transport: Transport, coordinates: Coordinates): EdgeLine | undefined
  /** Ломаные последовательности рёбер; соседние рёбра одного вида склеены в одну линию. */
  route(edges: readonly RouteEdge[], transport: Transport, coordinates: Coordinates): RouteLines
}

/**
 * Геометрия рёбер по файлу `<группа>.geometry.json`, граф выбирается по транспорту инженера.
 * Декодирует только запрошенные рёбра и держит их, пока жив resolver; без файла все рёбра — прямые.
 */
export function createEdgeResolver(geometry: GeometryFile | undefined): EdgeResolver {
  const index = new Map(geometry?.pointIds.map((pointId, i) => [pointId, i]) ?? [])
  const decoded = new Map<string, LatLon[]>()

  function road(graph: TravelGraph, from: string, to: string): LatLon[] | undefined {
    const i = index.get(from)
    const j = index.get(to)
    if (geometry === undefined || i === undefined || j === undefined) return undefined
    const key = `${graph}:${i}:${j}`
    const cached = decoded.get(key)
    if (cached !== undefined) return cached
    const encoded = geometry.profiles[graph][i]?.[j]
    if (encoded === null || encoded === undefined) return undefined
    const points = decodePolyline(encoded)
    decoded.set(key, points)
    return points
  }

  function line(
    edge: RouteEdge,
    transport: Transport,
    coordinates: Coordinates,
  ): EdgeLine | undefined {
    const a = coordinates.get(edge.from)
    const b = coordinates.get(edge.to)
    if (a === undefined || b === undefined || edge.from === edge.to) return undefined
    const points = edge.approximate
      ? undefined
      : road(graphForTransport(transport), edge.from, edge.to)
    return points === undefined ? { kind: 'straight', points: [a, b] } : { kind: 'road', points }
  }

  return {
    line,
    route(edges, transport, coordinates) {
      const road: LatLon[][] = []
      const straight: LatLon[][] = []
      let current: EdgeLine | undefined
      for (const edge of edges) {
        const resolved = line(edge, transport, coordinates)
        if (resolved === undefined) {
          current = undefined
          continue
        }
        if (current?.kind === resolved.kind) {
          current.points.push(...resolved.points.slice(1))
          continue
        }
        // Прямая продолжает конец дороги (точку привязки к графу), чтобы не было разрыва.
        const previousEnd = current?.points.at(-1)
        const points =
          resolved.kind === 'straight' && previousEnd !== undefined
            ? [previousEnd, ...resolved.points.slice(1)]
            : [...resolved.points]
        current = { kind: resolved.kind, points }
        if (resolved.kind === 'road') road.push(points)
        else straight.push(points)
      }
      return { road, straight }
    },
  }
}

/**
 * Середина ломаной по длине и курс в этой точке в градусах по часовой от севера.
 * Для стрелки направления движения на ребре; в пределах города долготу достаточно сжать по cos широты.
 */
export function midpointBearing(
  points: readonly LatLon[],
): { readonly at: LatLon; readonly bearing: number } | undefined {
  const scale = Math.cos(((points[0]?.[0] ?? 0) * Math.PI) / 180)
  const steps: { from: LatLon; to: LatLon; length: number }[] = []
  let total = 0
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if (from === undefined || to === undefined) continue
    const length = Math.hypot((to[1] - from[1]) * scale, to[0] - from[0])
    if (length === 0) continue
    steps.push({ from, to, length })
    total += length
  }
  let left = total / 2
  for (const { from, to, length } of steps) {
    if (left > length) {
      left -= length
      continue
    }
    const share = left / length
    const bearing = (Math.atan2((to[1] - from[1]) * scale, to[0] - from[0]) * 180) / Math.PI
    return {
      at: [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share],
      bearing: (bearing + 360) % 360,
    }
  }
  return undefined
}

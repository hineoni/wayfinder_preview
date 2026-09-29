import { decodePolyline } from '@wayfinder/dataset'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { LEG_TOLERANCE, REQUEST_INTERVAL_MS, USER_AGENT } from './config/common'
import { CACHE_DIR, readJson, sha256, writeJson } from './io'
import { encodePolyline, joinSegments } from './polyline'
import { Throttle } from './throttle'

export type LonLat = readonly [lon: number, lat: number]

export interface TableResult {
  readonly distances: (number | null)[][]
  readonly durations: (number | null)[][]
  readonly snapDistances: number[]
  readonly dataVersion: string | null
  /** Время получения таблицы от OSRM (из кеша, если ответ кеширован). */
  readonly fetchedAt: string
}

interface RouteLeg {
  readonly distance: number
  readonly duration: number
  /** Склеенная геометрия шагов, polyline5, без упрощения. */
  readonly geometry: string
}

interface ChainResult {
  readonly code: string
  readonly legs: RouteLeg[]
}

export interface MatrixWithGeometry extends TableResult {
  /** Геометрия ребра i→j; `null` — маршрута нет или leg не согласован с таблицей. */
  readonly geometry: (string | null)[][]
  readonly mismatches: { from: number; to: number; detail: string }[]
}

export interface RouterOptions {
  readonly offline: boolean
}

/** Максимум путевых точек в одном запросе /route публичного OSRM. */
const MAX_WAYPOINTS = 100

/**
 * Клиент OSRM: таблица и геометрия всех направленных пар по одному графу.
 * Геометрия собирается цепочками путевых точек по эйлерову обходу полного орграфа;
 * каждый leg сверяется с ячейкой таблицы того же графа. Ответы кешируются в обработанном виде.
 */
export class Router {
  private readonly throttle = new Throttle(REQUEST_INTERVAL_MS)
  requests = 0

  constructor(private readonly options: RouterOptions) {}

  async matrix(endpoint: string, coordinates: readonly LonLat[]): Promise<MatrixWithGeometry> {
    if (coordinates.length > MAX_WAYPOINTS) {
      throw new Error(`Таблица на ${coordinates.length} точек превышает лимит ${MAX_WAYPOINTS}`)
    }
    const table = await this.table(endpoint, coordinates)
    const n = coordinates.length
    const geometry: (string | null)[][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, (): string | null => null),
    )
    const mismatches: MatrixWithGeometry['mismatches'] = []
    const retry: [number, number][] = []

    const circuit = eulerianCircuit(n)
    for (let start = 0; start + 1 < circuit.length; start += MAX_WAYPOINTS - 1) {
      const chain = circuit.slice(start, start + MAX_WAYPOINTS)
      const result = await this.route(
        endpoint,
        chain.map((index) => coordinates[index] as LonLat),
      )
      for (let k = 0; k + 1 < chain.length; k += 1) {
        const from = chain[k] as number
        const to = chain[k + 1] as number
        const leg = result.legs[k]
        if (result.code !== 'Ok' || leg === undefined || !legMatches(leg, table, from, to)) {
          retry.push([from, to])
          continue
        }
        geometry[from]![to] = leg.geometry
      }
    }

    for (const [from, to] of retry) {
      if (table.distances[from]?.[to] === null) continue
      const result = await this.route(endpoint, [
        coordinates[from] as LonLat,
        coordinates[to] as LonLat,
      ])
      const leg = result.legs[0]
      if (result.code === 'Ok' && leg !== undefined && legMatches(leg, table, from, to)) {
        geometry[from]![to] = leg.geometry
      } else {
        mismatches.push({
          from,
          to,
          detail:
            `route ${result.code}: ${leg?.distance ?? '—'} м / ${leg?.duration ?? '—'} с против таблицы ` +
            `${table.distances[from]?.[to] ?? '—'} м / ${table.durations[from]?.[to] ?? '—'} с`,
        })
      }
    }
    return { ...table, geometry, mismatches }
  }

  private async table(endpoint: string, coordinates: readonly LonLat[]): Promise<TableResult> {
    const path = `/table/v1/driving/${formatCoordinates(coordinates)}?annotations=duration,distance`
    const { result, fetchedAt } = await this.cached(endpoint, path, async () => {
      const json = await this.fetchJson(endpoint + path)
      if (json['code'] !== 'Ok')
        throw new Error(`OSRM table ${String(json['code'])}: ${String(json['message'])}`)
      const sources = json['sources'] as { distance: number }[]
      return {
        distances: json['distances'] as (number | null)[][],
        durations: json['durations'] as (number | null)[][],
        snapDistances: sources.map((source) => Math.round(source.distance)),
        dataVersion: typeof json['data_version'] === 'string' ? json['data_version'] : null,
      }
    })
    return { ...result, fetchedAt }
  }

  private async route(endpoint: string, coordinates: readonly LonLat[]): Promise<ChainResult> {
    const path =
      `/route/v1/driving/${formatCoordinates(coordinates)}` +
      '?overview=false&steps=true&geometries=polyline&continue_straight=false&alternatives=false'
    const { result } = await this.cached(endpoint, path, async () => {
      const json = await this.fetchJson(endpoint + path)
      if (json['code'] === 'NoRoute') return { code: 'NoRoute', legs: [] }
      if (json['code'] !== 'Ok')
        throw new Error(`OSRM route ${String(json['code'])}: ${String(json['message'])}`)
      const route = (json['routes'] as { legs: RawLeg[] }[])[0]
      if (route === undefined) throw new Error('OSRM route Ok: отсутствует маршрут')
      return {
        code: 'Ok',
        legs: route.legs.map((leg) => ({
          distance: leg.distance,
          duration: leg.duration,
          geometry: encodePolyline(
            joinSegments(leg.steps.map((step) => decodePolyline(step.geometry))),
          ),
        })),
      }
    })
    // Старые версии могли закешировать ошибки сервера как отсутствие геометрии.
    if (result.code !== 'Ok' && result.code !== 'NoRoute') {
      throw new Error(`OSRM route: ошибочная запись кеша ${result.code}; удалите кеш этого запроса`)
    }
    return result
  }

  /**
   * Кеш обработанных ответов с временем получения. Записи старого формата без `fetchedAt`
   * получают время изменения файла кеша.
   */
  private async cached<T>(
    endpoint: string,
    path: string,
    load: () => Promise<T>,
  ): Promise<{ result: T; fetchedAt: string }> {
    const file = resolve(CACHE_DIR, 'routing', `${sha256(endpoint + path)}.json`)
    const cached = readJson(file) as { fetchedAt?: string; result: T } | null
    if (cached !== null) {
      const fetchedAt = cached.fetchedAt ?? statSync(file).mtime.toISOString()
      return { result: cached.result, fetchedAt }
    }
    if (this.options.offline)
      throw new Error(`Offline-режим: нет кеша маршрутизатора для ${endpoint}${path.slice(0, 60)}…`)
    const result = await load()
    const fetchedAt = new Date().toISOString()
    writeJson(file, { endpoint, path, fetchedAt, result })
    return { result, fetchedAt }
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    await this.throttle.wait()
    this.requests += 1
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    const text = await response.text()
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`OSRM ${response.status}: ответ не JSON (${text.slice(0, 120)})`)
    }
    if (!response.ok && !(response.status === 400 && json['code'] === 'NoRoute'))
      throw new Error(`OSRM ${response.status}: ${text.slice(0, 200)}`)
    return json
  }
}

interface RawLeg {
  readonly distance: number
  readonly duration: number
  readonly steps: { readonly geometry: string }[]
}

/** Leg маршрута согласован с ячейкой таблицы по расстоянию и по времени в пределах допуска. */
export function legMatches(
  leg: Pick<RouteLeg, 'distance' | 'duration'>,
  table: Pick<TableResult, 'distances' | 'durations'>,
  from: number,
  to: number,
): boolean {
  const distance = table.distances[from]?.[to]
  const duration = table.durations[from]?.[to]
  if (distance === null || distance === undefined || duration === null || duration === undefined)
    return false
  const distanceTolerance = Math.max(LEG_TOLERANCE.absoluteM, distance * LEG_TOLERANCE.relative)
  const durationTolerance = Math.max(LEG_TOLERANCE.absoluteS, duration * LEG_TOLERANCE.relative)
  return (
    Math.abs(leg.distance - distance) <= distanceTolerance &&
    Math.abs(leg.duration - duration) <= durationTolerance
  )
}

function formatCoordinates(coordinates: readonly LonLat[]): string {
  return coordinates.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';')
}

/**
 * Эйлеров обход полного орграфа на n вершинах (алгоритм Хирхольцера): последовательность вершин,
 * в которой каждая упорядоченная пара соседей встречается ровно один раз.
 */
export function eulerianCircuit(n: number): number[] {
  if (n < 2) return n === 1 ? [0] : []
  const next = Array.from({ length: n }, () => 0)
  const used = Array.from({ length: n }, () => Array.from({ length: n }, () => false))
  const stack = [0]
  const circuit: number[] = []
  while (stack.length > 0) {
    const v = stack[stack.length - 1] as number
    const row = used[v] as boolean[]
    let candidate = next[v] as number
    while (candidate < n && (candidate === v || row[candidate] === true)) candidate += 1
    next[v] = candidate
    if (candidate < n) {
      row[candidate] = true
      stack.push(candidate)
    } else {
      circuit.push(stack.pop() as number)
    }
  }
  return circuit.toReversed()
}

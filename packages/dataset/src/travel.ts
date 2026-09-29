import type { Transport, TravelLeg, TravelProvider } from '@wayfinder/planner'
import { haversineM, type GeoPoint } from './geo'
import type { PreparedMatrix, TravelModel } from './prepared'

export type TravelGraph = 'car' | 'bicycle' | 'foot'

/** Граф OSRM для транспорта: общественный транспорт считается по пешеходному графу. */
export function graphForTransport(transport: Transport): TravelGraph {
  return transport === 'public' ? 'foot' : transport
}

export interface MatrixTravelOptions {
  readonly pointIds: readonly string[]
  readonly profiles: {
    readonly car: PreparedMatrix
    readonly bicycle: PreparedMatrix
    readonly foot: PreparedMatrix
  }
  /** Координаты всех точек сценария; нужны для приближения точек вне матриц. */
  readonly coordinates: ReadonlyMap<string, GeoPoint>
  readonly model: TravelModel
}

/**
 * Провайдер переездов по подготовленным матрицам. Общественный транспорт считается по графу foot:
 * расстояние пешеходного пути, время по условной скорости плюс надбавка на переезд.
 * Пара с точкой вне матриц считается приближением «гаверсинус × factor» и помечается.
 */
export function createMatrixTravel(options: MatrixTravelOptions): TravelProvider {
  const index = new Map(options.pointIds.map((pointId, i) => [pointId, i]))
  const { publicTransport, approximation } = options.model

  const approximate = (transport: Transport, from: string, to: string): TravelLeg => {
    const a = options.coordinates.get(from)
    const b = options.coordinates.get(to)
    if (a === undefined || b === undefined) {
      throw new Error(`Нет координат для переезда ${from} → ${to}`)
    }
    const distanceM = Math.round(haversineM(a, b) * approximation.factor)
    return {
      distanceM,
      durationMin: minutesFor(
        distanceM,
        approximation.speedKmh[transport],
        transport === 'public' ? publicTransport.transferMin : 0,
      ),
      approximate: true,
    }
  }

  return {
    travel(transport, from, to) {
      if (from === to) return { distanceM: 0, durationMin: 0, approximate: false }
      const i = index.get(from)
      const j = index.get(to)
      if (i === undefined || j === undefined) return approximate(transport, from, to)
      const graph = graphForTransport(transport)
      if (transport === 'public') {
        const foot = fromMatrix(options.profiles[graph], i, j)
        if (foot === null) return null
        return {
          distanceM: foot.distanceM,
          durationMin: minutesFor(
            foot.distanceM,
            publicTransport.speedKmh,
            publicTransport.transferMin,
          ),
          approximate: false,
        }
      }
      return fromMatrix(options.profiles[graph], i, j)
    },
  }
}

function fromMatrix(matrix: PreparedMatrix, i: number, j: number): TravelLeg | null {
  const distanceM = matrix.distanceM[i]?.[j]
  const durationS = matrix.durationS[i]?.[j]
  if (
    distanceM === null ||
    distanceM === undefined ||
    durationS === null ||
    durationS === undefined
  ) {
    return null
  }
  return {
    distanceM: Math.round(distanceM),
    durationMin: Math.ceil(durationS / 60),
    approximate: false,
  }
}

function minutesFor(distanceM: number, speedKmh: number, extraMin: number): number {
  return Math.ceil((distanceM / 1000 / speedKmh) * 60 + extraMin)
}

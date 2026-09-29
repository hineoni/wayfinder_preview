import type { LatLon } from '@wayfinder/dataset'

/** Кодер Google polyline, точность 5 знаков; декодер живёт в `@wayfinder/dataset`. */
export function encodePolyline(points: readonly LatLon[]): string {
  let output = ''
  let prevLat = 0
  let prevLon = 0
  for (const [lat, lon] of points) {
    const roundedLat = Math.round(lat * 1e5)
    const roundedLon = Math.round(lon * 1e5)
    output += encodeValue(roundedLat - prevLat) + encodeValue(roundedLon - prevLon)
    prevLat = roundedLat
    prevLon = roundedLon
  }
  return output
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let output = ''
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  output += String.fromCharCode(v + 63)
  return output
}

/** Склейка геометрий шагов одного leg: совпадающие стыки не дублируются. */
export function joinSegments(segments: readonly (readonly LatLon[])[]): LatLon[] {
  const result: LatLon[] = []
  for (const segment of segments) {
    for (const point of segment) {
      const last = result[result.length - 1]
      if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue
      result.push(point)
    }
  }
  return result
}

/** Дуглас — Пекер в метрах по локальной равноугольной проекции. */
export function simplifyLine(points: readonly LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return [...points]
  const keep = Array.from({ length: points.length }, () => false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    let maxDistance = 0
    let maxIndex = -1
    for (let i = first + 1; i < last; i += 1) {
      const distance = pointToSegmentM(
        points[i] as LatLon,
        points[first] as LatLon,
        points[last] as LatLon,
      )
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = i
      }
    }
    if (maxDistance > toleranceM && maxIndex > 0) {
      keep[maxIndex] = true
      stack.push([first, maxIndex], [maxIndex, last])
    }
  }
  return points.filter((_, index) => keep[index])
}

const METERS_PER_DEGREE = 111_320

function pointToSegmentM(point: LatLon, a: LatLon, b: LatLon): number {
  const scale = Math.cos((a[0] * Math.PI) / 180)
  const px = (point[1] - a[1]) * scale * METERS_PER_DEGREE
  const py = (point[0] - a[0]) * METERS_PER_DEGREE
  const bx = (b[1] - a[1]) * scale * METERS_PER_DEGREE
  const by = (b[0] - a[0]) * METERS_PER_DEGREE
  const lengthSq = bx * bx + by * by
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq))
  const dx = px - t * bx
  const dy = py - t * by
  return Math.sqrt(dx * dx + dy * dy)
}

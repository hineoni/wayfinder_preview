/** Точка полилинии как [lat, lon]. */
export type LatLon = readonly [lat: number, lon: number]

/** Декодер Google polyline с точностью 5 знаков: формат `<группа>.geometry.json`. */
export function decodePolyline(text: string): LatLon[] {
  const points: LatLon[] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < text.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = text.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do {
      byte = text.charCodeAt(index) - 63
      index += 1
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lon += result & 1 ? ~(result >> 1) : result >> 1
    points.push([lat / 1e5, lon / 1e5])
  }
  return points
}

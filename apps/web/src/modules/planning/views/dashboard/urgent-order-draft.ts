import { parseClock } from '@wayfinder/dataset'

export interface UrgentOrderDraft {
  readonly id: string
  readonly address: string
  readonly at: string
  readonly windowStart: string
  readonly windowEnd: string
  readonly lat: string
  readonly lon: string
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export function isUrgentOrderDraftValid(
  value: UrgentOrderDraft,
  shift: { readonly start: string; readonly end: string },
  existingOrderIds: ReadonlySet<string>,
): boolean {
  if (
    !CLOCK.test(value.at) ||
    !CLOCK.test(value.windowStart) ||
    !CLOCK.test(value.windowEnd) ||
    value.id.trim() === '' ||
    value.address.trim() === '' ||
    value.lat.trim() === '' ||
    value.lon.trim() === '' ||
    existingOrderIds.has(value.id.trim())
  ) {
    return false
  }
  const eventAt = parseClock(value.at)
  const windowStart = parseClock(value.windowStart)
  const windowEnd = parseClock(value.windowEnd)
  const lat = Number(value.lat)
  const lon = Number(value.lon)
  return (
    eventAt >= parseClock(shift.start) &&
    eventAt <= parseClock(shift.end) &&
    windowStart <= windowEnd &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
  )
}

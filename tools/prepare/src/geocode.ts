import { resolve } from 'node:path'
import { addressQueries, parseAddress, normalizeStreet, type ParsedAddress } from './address'
import { NOMINATIM_URL, REQUEST_INTERVAL_MS, USER_AGENT } from './config/common'
import { CACHE_DIR, readJson, writeJson } from './io'
import { Throttle } from './throttle'

/** Часть ответа Nominatim, которую храним в кеше. */
interface NominatimHit {
  readonly lat: string
  readonly lon: string
  readonly display_name: string
  readonly osm_type: string
  readonly osm_id: number
  readonly category: string
  readonly type: string
  readonly address: Readonly<Record<string, string>>
}

export interface GeocodeResult {
  readonly lat: number
  readonly lon: number
  /** house — дом совпал полностью; block — тот же номер, другой корпус/строение; street — только улица. */
  readonly precision: 'house' | 'block' | 'street' | 'locality'
  readonly query: string
  readonly displayName: string
  readonly osm: { readonly type: string; readonly id: number } | null
}

export interface GeocoderOptions {
  readonly offline: boolean
}

const CACHE_FILE = resolve(CACHE_DIR, 'geocode.json')
const HIT_FIELDS = [
  'lat',
  'lon',
  'display_name',
  'osm_type',
  'osm_id',
  'category',
  'type',
  'address',
] as const

/**
 * Одноразовое геокодирование через Nominatim с кешем в datasets/prepared/cache/geocode.json.
 * Не чаще одного запроса в секунду; в offline-режиме промах кеша — ошибка.
 */
export class Geocoder {
  private readonly cache: Record<string, NominatimHit[]>
  private readonly throttle = new Throttle(REQUEST_INTERVAL_MS)
  requests = 0

  constructor(private readonly options: GeocoderOptions) {
    this.cache = (readJson(CACHE_FILE) as Record<string, NominatimHit[]> | null) ?? {}
  }

  /** Лучший результат: дом, иначе улица. Центр населённого пункта не принимается. */
  async geocode(raw: string): Promise<GeocodeResult> {
    const parsed = parseAddress(raw)
    let blockLevel: GeocodeResult | null = null
    let streetLevel: GeocodeResult | null = null
    for (const query of addressQueries(parsed)) {
      const hits = await this.search(query)
      for (const hit of hits) {
        if (!matchesCity(hit, parsed.city)) continue
        if (!matchesStreet(hit, parsed)) continue
        const precision = precisionOf(hit, parsed.house)
        if (precision === 'locality') continue
        const result = toResult(hit, query, precision)
        if (precision === 'house') return result
        if (precision === 'block') blockLevel ??= result
        else streetLevel ??= result
      }
    }
    if (blockLevel !== null) return blockLevel
    if (streetLevel !== null) return streetLevel
    throw new Error(`Адрес не найден: «${raw}» (запросы: ${addressQueries(parsed).join(' | ')})`)
  }

  private async search(query: string): Promise<NominatimHit[]> {
    const cached = this.cache[query]
    if (cached !== undefined) return cached
    if (this.options.offline) throw new Error(`Offline-режим: нет кеша геокодера для «${query}»`)
    await this.throttle.wait()
    const url = new URL('/search', NOMINATIM_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '5')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('countrycodes', 'ru')
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru' },
    })
    this.requests += 1
    if (!response.ok) throw new Error(`Nominatim ${response.status} для «${query}»`)
    const hits = ((await response.json()) as Record<string, unknown>[]).map(trimHit)
    this.cache[query] = hits
    writeJson(CACHE_FILE, this.cache)
    return hits
  }
}

function trimHit(hit: Record<string, unknown>): NominatimHit {
  const trimmed: Record<string, unknown> = {}
  for (const field of HIT_FIELDS) trimmed[field] = hit[field] ?? null
  return trimmed as unknown as NominatimHit
}

/** Дом засчитывается только при полном совпадении номера; совпадение без корпуса и строения — уровень block. */
function precisionOf(hit: NominatimHit, house: string | null): GeocodeResult['precision'] {
  const found = hit.address['house_number']
  if (found !== undefined && house !== null) {
    if (sameHouseNumber(found, house)) return 'house'
    if (baseNumber(found) === baseNumber(house)) return 'block'
    // Квартальная адресация: OSM хранит только корпус («к5»), квартал — отдельный объект.
    if (canonicalHouse(house).split(' ').includes(canonicalHouse(found))) return 'block'
  }
  if (hit.address['road'] !== undefined || hit.category === 'highway') return 'street'
  return 'locality'
}

/** Полное совпадение дома с корпусом и строением: «1 с1» ≠ «1 к1» ≠ «1». Регистр и пробелы не важны. */
function canonicalHouse(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*(?:корп\.?|к\.?)\s*(?=\d)/gu, ' к')
    .replace(/\s*(?:стр\.?|строение|с\.?)\s*(?=\d)/gu, ' с')
    .replace(/\s+/g, ' ')
    .trim()
}

function baseNumber(text: string): string {
  return canonicalHouse(text).split(' ')[0] ?? ''
}

function sameHouseNumber(found: string, requested: string): boolean {
  return canonicalHouse(found) === canonicalHouse(requested)
}

function matchesCity(hit: NominatimHit, city: string): boolean {
  const fields = [
    'city',
    'town',
    'village',
    'municipality',
    'county',
    'state',
    'city_district',
  ] as const
  const expected = city.toLowerCase()
  return fields.some((field) => hit.address[field]?.toLowerCase().includes(expected) ?? false)
}

/** Проверяется сам адрес ответа, а не текст запроса: геокодер допускает нечёткий поиск. */
function matchesStreet(hit: NominatimHit, requested: ParsedAddress): boolean {
  const road =
    hit.address['road'] ??
    (hit.address['locality']?.startsWith('квартал ') ? hit.address['locality'] : undefined) ??
    (hit.category === 'highway' ? hit.display_name.split(',')[0] : undefined)
  if (road === undefined) return false
  // У дублёра сохраняется адрес основной улицы; остальные уточнения не отбрасываем.
  const quarter = /^квартал\s+(.+?)\s+(\d+\S*)$/iu.exec(road)
  if (
    quarter &&
    (requested.house === null ||
      !canonicalHouse(requested.house).startsWith(`${quarter[2]!.toLowerCase()} `))
  )
    return false
  const found = normalizeStreet((quarter?.[1] ?? road).replace(/\s*\(дубл[её]р\)/giu, ''))
  const normalize = (name: string) =>
    name
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/(\d+)-(?:го|й|я)/gu, '$1')
      .split(/\s+/u)
      .toSorted()
      .join(' ')
  return (
    found.streetType === requested.streetType &&
    normalize(found.streetName) === normalize(requested.streetName)
  )
}

function toResult(
  hit: NominatimHit,
  query: string,
  precision: GeocodeResult['precision'],
): GeocodeResult {
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    precision,
    query,
    displayName: hit.display_name,
    osm: typeof hit.osm_id === 'number' ? { type: hit.osm_type, id: hit.osm_id } : null,
  }
}

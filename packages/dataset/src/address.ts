/**
 * Нормализация адресов источника для геокодера. Исходная строка сохраняется отдельно;
 * здесь только приведение сокращений и порядка частей к форме, которую понимает Nominatim.
 */

export interface ParsedAddress {
  readonly city: string
  readonly locality: string | null
  /** Название без типа, например «Волгоградский» или «11-я Текстильщиков». */
  readonly streetName: string
  /** Полный тип улицы («улица», «проспект»…) или `null`, если тип не распознан. */
  readonly streetType: string | null
  /** Дом с корпусом и строением в виде «128 к5», «83 с4»; `null`, если дом не распознан. */
  readonly house: string | null
}

const CITIES = ['Москва', 'Домодедово', 'Кашира', 'Ступино'] as const

const STREET_TYPES: readonly { readonly short: readonly string[]; readonly full: string }[] = [
  { short: ['ул', 'улица'], full: 'улица' },
  { short: ['пр-кт', 'пр-т', 'просп', 'проспект'], full: 'проспект' },
  { short: ['пер', 'переулок'], full: 'переулок' },
  { short: ['наб', 'набережная'], full: 'набережная' },
  { short: ['б-р', 'бул', 'бульвар'], full: 'бульвар' },
  { short: ['проезд', 'пр-зд', 'пр-д'], full: 'проезд' },
  { short: ['ш', 'шоссе'], full: 'шоссе' },
  { short: ['пл', 'площадь'], full: 'площадь' },
  { short: ['туп', 'тупик'], full: 'тупик' },
  { short: ['аллея'], full: 'аллея' },
]

const CITY_PATTERN = new RegExp(
  `(?:^|[\\s,])(?:г\\.?\\s*|город\\s+)?(${CITIES.join('|')})(?=$|[\\s,])`,
  'iu',
)

export function parseAddress(raw: string): ParsedAddress {
  let text = raw.replace(/\s+/g, ' ').trim()

  let houseText: string | null = null
  const houseMatch = /(?:^|[\s,])д\.?\s*([^,]*\S)\s*$/iu.exec(text)
  if (houseMatch !== null && houseMatch[1] !== undefined) {
    houseText = houseMatch[1]
    text = text.slice(0, houseMatch.index)
  }

  let city: string | null = null
  let locality: string | null = null
  const streetParts: string[] = []
  for (const part of text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')) {
    if (/^(обл\.?|область|МО)(?=$|[\s.])/iu.test(part) || part.toLowerCase().endsWith('область')) {
      continue
    }
    const localityMatch = /^(?:пгт|пос|дер|п|с|д)\.\s*(.+)$/iu.exec(part)
    if (localityMatch !== null && localityMatch[1] !== undefined && city !== null) {
      locality = localityMatch[1].trim()
      continue
    }
    const cityMatch = CITY_PATTERN.exec(part)
    if (cityMatch !== null && city === null) {
      city = canonicalCity(cityMatch[1] ?? '')
      const rest = (
        part.slice(0, cityMatch.index) +
        ' ' +
        part.slice(cityMatch.index + cityMatch[0].length)
      )
        .replace(/^(?:\s*(?:город|г\.|г(?=\s))\s*)+/iu, '')
        .trim()
      if (rest !== '') streetParts.push(rest)
      continue
    }
    streetParts.push(part)
  }
  if (city === null) throw new Error(`Не распознан город в адресе «${raw}»`)
  let streetText = streetParts.join(' ')
  // Квартальная адресация («б-р.Самаркандский Квартал 137а, д. к5»): квартал — часть номера дома.
  const quarter = /^(.*?)\s*квартал\s+(\S+)\s*$/iu.exec(streetText)
  if (quarter !== null && quarter[1] !== undefined && quarter[2] !== undefined) {
    streetText = quarter[1]
    houseText = `${quarter[2]} ${houseText ?? ''}`.trim()
  }
  const { streetName, streetType } = normalizeStreet(streetText)
  if (streetName === '') throw new Error(`Не распознана улица в адресе «${raw}»`)
  const house = houseText !== null && /^\d/u.test(houseText) ? normalizeHouse(houseText) : null
  return { city, locality, streetName, streetType, house }
}

function canonicalCity(name: string): string {
  const lower = name.toLowerCase()
  return CITIES.find((city) => city.toLowerCase() === lower) ?? name
}

function normalizeHouse(text: string): string {
  return text
    .replace(/\s*(?:корп\.?|к\.?)\s*(?=\d)/giu, ' к')
    .replace(/\s*(?:стр\.?|строение|с\.?)\s*(?=\d)/giu, ' с')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeStreet(text: string): { streetName: string; streetType: string | null } {
  const tokens = text
    .replace(/\.(?=\S)/g, '. ')
    .split(/\s+/)
    .filter((token) => token !== '')
  let streetType: string | null = null
  const nameTokens: string[] = []
  for (const token of tokens) {
    const bare = token.replace(/\.$/, '').toLowerCase()
    const type: (typeof STREET_TYPES)[number] | undefined =
      streetType === null ? STREET_TYPES.find((item) => item.short.includes(bare)) : undefined
    if (type !== undefined) {
      streetType = type.full
      continue
    }
    nameTokens.push(token.replace(/\.$/, ''))
  }
  let streetName = nameTokens.join(' ').trim()
  const ordinal = /^(.*?)\s(\d+-[йя])$/u.exec(streetName)
  if (ordinal !== null) streetName = `${ordinal[2]} ${ordinal[1]}`
  return { streetName, streetType }
}

/** Формы улицы для запроса: «Название тип» и «тип Название» (порядковое число остаётся первым). */
export function streetForms(parsed: ParsedAddress): string[] {
  if (parsed.streetType === null) return [parsed.streetName]
  const ordinal = /^(\d+-[йя])\s+(.+)$/u.exec(parsed.streetName)
  const typeFirst =
    ordinal === null
      ? `${parsed.streetType} ${parsed.streetName}`
      : `${ordinal[1]} ${parsed.streetType} ${ordinal[2]}`
  return [`${parsed.streetName} ${parsed.streetType}`, typeFirst]
}

/** Варианты запросов от самого точного к менее точному: дом с корпусом и строением → без строения → номер → улица. */
export function addressQueries(parsed: ParsedAddress): string[] {
  const queries: string[] = []
  const push = (query: string) => {
    if (!queries.includes(query)) queries.push(query)
  }
  // Населённый пункт внутри города (пгт) Nominatim часто не знает: сначала с ним, затем без него.
  const localities = parsed.locality === null ? [null] : [parsed.locality, null]
  const places = localities.flatMap((locality) =>
    streetForms(parsed).map((street) =>
      [parsed.city, locality, street].filter((part) => part !== null).join(', '),
    ),
  )
  if (parsed.house !== null) {
    const withoutBuilding = parsed.house.replace(/\s+с\d+\w*$/u, '')
    const numberOnly = parsed.house.split(' ')[0] ?? parsed.house
    for (const house of [parsed.house, withoutBuilding, numberOnly]) {
      for (const place of places) push(`${place}, ${house}`)
    }
  }
  for (const place of places) push(place)
  return queries
}

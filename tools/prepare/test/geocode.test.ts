import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Geocoder } from '../src/geocode'
import { addressQueries, parseAddress } from '../src/address'
import { CACHE_DIR, PREPARED_DIR, readJson, writeJson } from '../src/io'
import { GROUPS, parsePreparedDataset } from '@wayfinder/dataset'

vi.mock(import('../src/io'), async (original) => ({
  ...(await original()),
  readJson: vi.fn<typeof readJson>(),
  writeJson: vi.fn<typeof writeJson>(),
}))

const raw = 'Город Москва, ул.Советская, д. 10'
function cacheFor(road: string) {
  return Object.fromEntries(
    addressQueries(parseAddress(raw)).map((query) => [
      query,
      [
        {
          lat: '55.75',
          lon: '37.61',
          display_name: `10, ${road}, Москва`,
          osm_type: 'way',
          osm_id: 1,
          category: 'building',
          type: 'yes',
          address: { city: 'Москва', road, house_number: '10' },
        },
      ],
    ]),
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Сеть запрещена')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('проверка адреса геокодера', () => {
  it.each(['Советский проезд', 'Советская набережная', 'Другая улица'])(
    'отклоняет совпавший дом на другой улице: %s',
    async (road) => {
      vi.mocked(readJson).mockReturnValue(cacheFor(road))
      await expect(new Geocoder({ offline: true }).geocode(raw)).rejects.toThrow('Адрес не найден')
      expect(writeJson).not.toHaveBeenCalled()
    },
  )
  it('принимает ту же улицу с другим порядком слов', async () => {
    vi.mocked(readJson).mockReturnValue(cacheFor('Советская улица'))
    await expect(new Geocoder({ offline: true }).geocode(raw)).resolves.toMatchObject({
      precision: 'house',
    })
  })
  it('сохраняет координаты подготовленных адресов при проверке локального кеша', async () => {
    vi.mocked(readJson).mockReturnValue(
      JSON.parse(readFileSync(resolve(CACHE_DIR, 'geocode.json'), 'utf8')) as unknown,
    )
    const geocoder = new Geocoder({ offline: true })
    for (const group of GROUPS) {
      const dataset = parsePreparedDataset(
        JSON.parse(readFileSync(resolve(PREPARED_DIR, `${group}.json`), 'utf8')) as unknown,
      )
      for (const point of dataset.points) {
        await expect(geocoder.geocode(point.address)).resolves.toMatchObject({
          lat: point.lat,
          lon: point.lon,
          precision: point.precision,
        })
      }
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(writeJson).not.toHaveBeenCalled()
  })
})

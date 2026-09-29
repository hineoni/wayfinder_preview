import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../src/routing'
import { readJson, writeJson } from '../src/io'

vi.mock(import('../src/io'), async (original) => ({
  ...(await original()),
  readJson: vi.fn<typeof readJson>(),
  writeJson: vi.fn<typeof writeJson>(),
}))
vi.mock('../src/throttle', () => ({
  Throttle: class {
    async wait() {}
  },
}))
const table = {
  distances: [
    [0, 100],
    [100, 0],
  ],
  durations: [
    [0, 10],
    [10, 0],
  ],
  snapDistances: [0, 0],
  dataVersion: null,
}
const coordinates = [
  [37, 55],
  [37.1, 55.1],
] as const
beforeEach(() => {
  vi.mocked(readJson).mockReturnValue(null)
  vi.stubGlobal('fetch', vi.fn<typeof fetch>())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

function responses(code: string, status: number) {
  vi.mocked(fetch).mockImplementation(async (url) =>
    (url instanceof Request ? url.url : url.toString()).includes('/table/')
      ? new Response(
          JSON.stringify({ code: 'Ok', sources: [{ distance: 0 }, { distance: 0 }], ...table }),
        )
      : new Response(JSON.stringify({ code, message: 'test error' }), { status }),
  )
}
describe('ошибки маршрутизатора', () => {
  it.each([
    [400, 'InvalidQuery'],
    [200, 'InvalidQuery'],
    [503, 'NoRoute'],
  ])('не кеширует ошибку %s / %s и не повторяет её по рёбрам', async (status, code) => {
    responses(code, status)
    await expect(
      new Router({ offline: false }).matrix('https://routing.invalid', coordinates),
    ).rejects.toThrow('OSRM')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(writeJson).toHaveBeenCalledTimes(1) // Только успешная таблица.
  })
  it('сохраняет обработку реальной недостижимости NoRoute', async () => {
    responses('NoRoute', 400)
    const result = await new Router({ offline: false }).matrix(
      'https://routing.invalid',
      coordinates,
    )
    expect(result.mismatches).toHaveLength(2)
  })
  it('отклоняет ошибку в старом кеше без сетевых запросов', async () => {
    vi.mocked(readJson)
      .mockReturnValueOnce({ fetchedAt: '2026-09-21', result: table })
      .mockReturnValue({ fetchedAt: '2026-09-21', result: { code: 'InvalidQuery', legs: [] } })
    await expect(
      new Router({ offline: true }).matrix('https://routing.invalid', coordinates),
    ).rejects.toThrow('ошибочная запись кеша')
    expect(fetch).not.toHaveBeenCalled()
    expect(writeJson).not.toHaveBeenCalled()
  })
})

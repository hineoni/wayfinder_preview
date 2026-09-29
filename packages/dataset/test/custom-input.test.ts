import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planBaseline, validatePlan } from '@wayfinder/planner'
import { CustomInputError, importCustomScenario, parsePreparedDataset, toPlanInput } from '../src'

const base = parsePreparedDataset(JSON.parse(readFileSync('datasets/prepared/east.json', 'utf8')))
const json = readFileSync('datasets/samples/scenario.json', 'utf8')
const csv = new TextDecoder('windows-1251').decode(readFileSync('datasets/samples/orders.csv'))
function input() {
  return JSON.parse(json) as {
    orders: Record<string, unknown>[]
    engineers: Record<string, unknown>[]
  }
}
function errors(data: ReturnType<typeof input>) {
  try {
    importCustomScenario(JSON.stringify(data), 'test.json', base)
  } catch (cause) {
    if (cause instanceof CustomInputError) return cause.issues
    throw cause
  }
  throw new Error('ожидалась ошибка')
}
describe('импорт своих данных', () => {
  it.each([
    ['orders.csv', csv],
    ['scenario.json', json],
  ])('разбирает пример %s и строит проверенный план', (file, text) => {
    const dataset = importCustomScenario(text, file, base)
    expect(dataset.orders).toHaveLength(8)
    expect(dataset.engineers).toHaveLength(file.endsWith('csv') ? base.engineers.length : 3)
    expect(dataset.travel).toBe(base.travel)
    expect(dataset.events).toEqual([])
    const planInput = toPlanInput(dataset)
    const plan = planBaseline(planInput)
    expect(validatePlan(planInput, plan)).toEqual([])
    expect(plan.routes.some((route) => route.visits.length > 0)).toBe(true)
  })
  it('принимает минимальные поля ТЗ без категорий кейса', () => {
    const data = input()
    for (const order of data.orders) {
      delete order.bkType
      delete order.hdType
    }
    expect(importCustomScenario(JSON.stringify(data), 'minimal.json', base).orders).toHaveLength(8)
  })
  it('CSV показывает физическую строку после многострочного поля', () => {
    const address = String(input().orders[0]!.address)
    const multiline = csv
      .replace(address, `"${address}\n"`)
      .replace(String(input().orders[1]!.id), String(input().orders[0]!.id))
    expect(() => importCustomScenario(multiline, 'test.csv', base)).toThrow(/строка 4.*повтор ID/)
  })
  it('незакрытая кавычка CSV сообщает строку', () => {
    expect(() => importCustomScenario(csv + '\n"', 'test.csv', base)).toThrow(/строка .*незакрытая/)
  })
  it('собирает несколько ошибок с индексами записей', () => {
    const data = input()
    data.orders[1]!.id = data.orders[0]!.id
    data.orders[2]!.window = { start: '01:00', end: '02:00' }
    expect(errors(data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: 'orders[2]',
          message: expect.stringContaining('повтор ID'),
        }),
        expect.objectContaining({ location: 'orders[3]', message: expect.stringContaining('вне') }),
      ]),
    )
  })
  it('отклоняет неизвестную категорию и неверную смену инженера', () => {
    const data = input()
    data.orders[0]!.bkType = 'Новая категория'
    expect(errors(data)[0]?.location).toBe('orders[1].bkType')
    const shifted = input()
    shifted.engineers[0]!.shift = { start: '23:00', end: '09:00' }
    expect(errors(shifted)[0]?.location).toBe('engineers[1]')
  })
  it('новые точки вне матриц дают приближённый план', () => {
    const data = input()
    data.orders[0]!.lat = 55.75
    data.orders[0]!.lon = 37.7
    data.orders = data.orders.slice(0, 1)
    const dataset = importCustomScenario(JSON.stringify(data), 'new.json', base)
    expect(dataset.points.length).toBeGreaterThan(base.points.length)
    expect(dataset.travel.pointIds).not.toContain(dataset.orders[0]?.pointId)
    const planInput = toPlanInput(dataset)
    const plan = planBaseline(planInput)
    expect(validatePlan(planInput, plan)).toEqual([])
    expect(plan.metrics.approximate).toBe(true)
  })
  it('CSV без координат сопоставляет адрес, неизвестный адрес отклоняет целиком', () => {
    const withoutCoordinates = csv
      .split(/\r?\n/)
      .map((line, index) => (index === 0 ? line : line.replace(/;[^;]*;[^;]*$/, ';;')))
      .join('\r\n')
    expect(importCustomScenario(withoutCoordinates, 'test.csv', base).orders).toHaveLength(8)
    const address = String(input().orders[0]!.address)
    expect(() =>
      importCustomScenario(
        withoutCoordinates.replace(address, 'Неизвестный адрес'),
        'test.csv',
        base,
      ),
    ).toThrow(/строка 2.*адрес не найден/)
  })
  it('неверная дата CSV сообщает строку и не изменяет базовый набор', () => {
    const count = base.orders.length
    expect(() =>
      importCustomScenario(csv.replace('17.08.2026', 'не дата'), 'test.csv', base),
    ).toThrow(/строка 2.*дата/)
    expect(base.orders).toHaveLength(count)
  })
})

// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import DayRuler from './day-ruler.vue'
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
it('закрепляет детали нажатой точки и сбрасывает их при смене данных', async () => {
  const visit = {
    key: 'one',
    startMin: 600,
    endMin: 660,
    row: 0,
    color: '#abcd00',
    title: 'Работа',
    address: 'Улица Первая',
    orderId: '1',
  }
  const visits = ref([visit])
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(DayRuler, {
        start: 540,
        end: 1320,
        atMin: 810,
        visits: visits.value,
        rows: [{ name: 'Бригада Один', color: '#abcd00' }],
      }),
  })
  app.mount(host)
  const point = host.querySelector<HTMLButtonElement>('.day-ruler__point')!
  expect(point.getAttribute('aria-label')).toContain('По плану 10:00–11:00')
  point.click()
  await nextTick()
  expect(host.querySelector('.day-ruler__details')?.textContent).toContain('Улица Первая')
  expect(point.getAttribute('aria-pressed')).toBe('true')
  visits.value = [{ ...visit, address: 'Улица Вторая' }]
  await nextTick()
  expect(host.querySelector('.day-ruler__details')).toBeNull()
  expect(point.getAttribute('aria-pressed')).toBe('false')
})

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import AppOnboarding from './app-onboarding.vue'

let app: App | undefined
const storageKey = 'wayfinder-onboarding-v1'
const ready = ref(true)
const screen = ref<'plan' | 'events' | 'analysis'>('plan')
const tour = ref<InstanceType<typeof AppOnboarding>>()

beforeEach(() => {
  ready.value = true
  screen.value = 'plan'
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.hidden ? [] : [new DOMRect(20, 20, 100, 44)]) as unknown as DOMRectList
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(20, 20, 100, 44),
  )
  HTMLElement.prototype.scrollIntoView = vi.fn<HTMLElement['scrollIntoView']>()
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})
function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    setup: () => () =>
      h('div', [
        h('button', { 'data-tour': 'help', onClick: () => tour.value?.open() }, 'Повторить'),
        h(
          'nav',
          { 'data-tour': 'navigation' },
          ['plan', 'events', 'analysis'].map((value) =>
            h(
              'button',
              {
                'data-nav-value': value,
                onClick: () => {
                  screen.value = value as typeof screen.value
                },
              },
              value,
            ),
          ),
        ),
        h('section', { 'data-tour': 'scenarios' }, 'Территории'),
        h(AppOnboarding, { ref: tour, ready: ready.value, screen: screen.value }),
      ]),
  })
  app.mount(host)
  return host
}
function button(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>('.onboarding button')].find(
    (el) => el.textContent?.trim() === text,
  )
  if (!match) throw new Error(`Нет кнопки: ${text}`)
  return match
}
async function click(text: string) {
  button(text).click()
  await nextTick()
  await nextTick()
}
async function start() {
  mount()
  await nextTick()
  await click('Пройти обучение')
}

it('предлагает тур после загрузки и запоминает отказ; повторный запуск доступен', async () => {
  ready.value = false
  const host = mount()
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  ready.value = true
  await nextTick()
  await nextTick()
  expect(document.body.textContent).toContain('Первый день в WayFinder?')
  await click('Пропустить')
  expect(localStorage.getItem(storageKey)).toBe('skipped')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  app?.unmount()
  host.remove()
  mount()
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  document.querySelector<HTMLButtonElement>('[data-tour="help"]')!.click()
  await nextTick()
  expect(document.body.textContent).toContain('Первый день в WayFinder?')
})

it('ждёт настоящего действия: не кликает навигацию и не предлагает Далее на первом шаге', async () => {
  await start()
  const plan = document.querySelector<HTMLButtonElement>('[data-nav-value="plan"]')!
  const nativeAction = vi.fn<() => void>()
  plan.addEventListener('click', nativeAction)
  expect(document.body.textContent).toContain('Шаг 1 из')
  expect(() => button('Далее')).toThrow('Нет кнопки: Далее')
  expect(nativeAction).not.toHaveBeenCalled()
  document.querySelector<HTMLButtonElement>('[data-nav-value="events"]')!.click()
  await nextTick()
  expect(document.body.textContent).toContain('Шаг 1 из')
  plan.click()
  await nextTick()
  await nextTick()
  expect(nativeAction).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Шаг 2 из'))
  expect(screen.value).toBe('plan')
})

it('при возврате просит пользователя открыть раздел, не меняя его автоматически', async () => {
  screen.value = 'analysis'
  await start()
  await click('Пропустить шаг')
  expect(screen.value).toBe('analysis')
  expect(document.body.textContent).toContain('Откройте раздел «План»')
  document.querySelector<HTMLButtonElement>('[data-nav-value="plan"]')!.click()
  await nextTick()
  await nextTick()
  expect(screen.value).toBe('plan')
  expect(document.body.textContent).toContain('Шаг 2 из')
  expect(document.body.textContent).toContain('Данные для расчёта')
})

it('держит Tab в шаге, закрывается по Escape и возвращает доступ к странице и фокус', async () => {
  await start()
  const plan = document.querySelector<HTMLButtonElement>('[data-nav-value="plan"]')!
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  )
  expect(document.activeElement).toBe(plan)
  expect(document.querySelector<HTMLElement>('[data-nav-value="events"]')!.inert).toBe(true)
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector<HTMLElement>('[data-nav-value="events"]')!.inert).not.toBe(true)
  expect(document.activeElement).toBe(document.querySelector('[data-tour="help"]'))
})

it('работает при запрещённом localStorage и не застревает без целевого элемента', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  await start()
  await click('Пропустить шаг')
  await click('Далее')
  expect(document.body.textContent).toContain('Этот элемент недоступен')
  await click('Пропустить шаг')
  expect(document.body.textContent).toContain('Шаг 4 из')
})

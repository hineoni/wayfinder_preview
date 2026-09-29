// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import UiCopyValue from './ui-copy-value.vue'
import UiChoiceList from './ui-choice-list.vue'
import UiCombobox from './ui-combobox.vue'
import UiTimeField from './ui-time-field.vue'
import UiSegmented from './ui-segmented.vue'

let app: App | undefined
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})
function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render })
  app.mount(host)
  return host
}

describe('управление кастомными полями', () => {
  it('копирует только номер, сбрасывает подтверждение для новой заявки и сообщает ошибку', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const value = ref('74198')
      const host = mount(() => h(UiCopyValue, { label: 'Номер заявки', value: value.value }))
      host.querySelector<HTMLButtonElement>('button')!.click()
      await vi.waitFor(() => expect(host.textContent).toContain('Скопировано'))
      expect(writeText).toHaveBeenCalledWith('74198')
      value.value = '24980'
      await nextTick()
      expect(host.textContent).not.toContain('Скопировано')
      writeText.mockRejectedValueOnce(new Error('Denied'))
      host.querySelector<HTMLButtonElement>('button')!.click()
      await vi.waitFor(() => expect(host.textContent).toContain('Не удалось скопировать'))
      expect(host.querySelector('code')?.textContent).toBe('24980')
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('меняет время стрелкой и очищает модель при удалении сегмента', async () => {
    const time = ref('13:30')
    const host = mount(() =>
      h(UiTimeField, {
        modelValue: time.value,
        label: 'Время события',
        'onUpdate:modelValue': (value) => {
          time.value = value
        },
      }),
    )
    await nextTick()
    const hour = host.querySelector<HTMLElement>('[data-reka-time-field-segment="hour"]')!
    expect(hour).not.toBeNull()
    hour.focus()
    hour.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(time.value).toBe('14:30')
    hour.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await nextTick()
    expect(time.value).toBe('01:30')
    hour.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await nextTick()
    expect(time.value).toBe('')
  })

  it('не снимает обязательный выбор повторным нажатием и блокирует disabled', async () => {
    const value = ref('first')
    const disabled = ref(false)
    const host = mount(() =>
      h(UiSegmented, {
        modelValue: value.value,
        label: 'Вариант',
        disabled: disabled.value,
        options: [
          { value: 'first', label: 'Первый' },
          { value: 'second', label: 'Второй' },
        ],
        'onUpdate:modelValue': (next) => {
          value.value = next
        },
      }),
    )
    const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios[1]!.click()
    await nextTick()
    expect(value.value).toBe('second')
    radios[1]!.click()
    await nextTick()
    expect(value.value).toBe('second')
    disabled.value = true
    await nextTick()
    radios[0]!.click()
    expect(value.value).toBe('second')
  })

  it('находит вариант поиском и выбирает его с клавиатуры', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    })
    const value = ref<string>()
    const host = mount(() =>
      h(UiCombobox, {
        modelValue: value.value,
        label: 'Адрес',
        options: [
          { value: 'one', label: 'Волгоградский проспект, 128' },
          { value: 'two', label: 'Рязанский проспект, 10', description: 'Заявка № 42' },
        ],
        'onUpdate:modelValue': (next) => {
          value.value = next
        },
      }),
    )
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!
    input.focus()
    input.value = '42'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(1))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(value.value).toBe('two'))
    await vi.waitFor(() => expect(input.value).toBe('Рязанский проспект, 10'))
  })

  it('выбирает бригаду из списка вариантов', async () => {
    const value = ref<string>()
    const host = mount(() =>
      h(UiChoiceList, {
        modelValue: value.value,
        label: 'Бригада',
        options: [
          { value: 'E01', label: 'Бригада 1', description: 'Автомобиль', color: '#7fd3b2' },
          { value: 'E02', label: 'Бригада 2', description: 'Пешком' },
        ],
        'onUpdate:modelValue': (next) => {
          value.value = next
        },
      }),
    )
    const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(radios[0]?.textContent).toContain('Автомобиль')
    radios[1]!.click()
    await nextTick()
    expect(value.value).toBe('E02')
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true')
  })
})

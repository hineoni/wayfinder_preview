import { effectScope, ref, watch } from 'vue'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'wayfinder-theme'

function initialTheme(): Theme {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

const theme = ref<Theme>(initialTheme())
let applied = false

/**
 * Текущая тема интерфейса. Первый вызов связывает её с `data-theme` на <html> и сохраняет выбор;
 * до загрузки скрипта тему выставляет инлайн-скрипт в index.html, чтобы не было вспышки.
 */
export function useTheme() {
  if (!applied) {
    applied = true
    effectScope(true).run(() =>
      watch(
        theme,
        (value) => {
          document.documentElement.dataset.theme = value
          globalThis.localStorage?.setItem(STORAGE_KEY, value)
        },
        { immediate: true },
      ),
    )
  }
  return theme
}

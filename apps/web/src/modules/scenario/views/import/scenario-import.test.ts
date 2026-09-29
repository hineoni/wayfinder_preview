// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import { parsePreparedDataset, type PreparedDataset } from '@wayfinder/dataset'
import ScenarioImport from './scenario-import.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
it('публикует только по кнопке, отклоняет битый файл и отбрасывает устаревшее чтение', async () => {
  const base = parsePreparedDataset(JSON.parse(readFileSync('datasets/prepared/east.json', 'utf8')))
  const bytes = readFileSync('datasets/samples/scenario.json')
  const onBuild = vi.fn<(dataset: PreparedDataset) => void>()
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(ScenarioImport, { base, busy: false, onBuild }) })
  app.mount(host)
  const input = host.querySelector('input')!
  const button = host.querySelector('button')!
  function choose(name: string, arrayBuffer: () => Promise<Uint8Array>) {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, arrayBuffer }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  let resolveOld!: (value: Uint8Array) => void
  choose(
    'old.json',
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  choose('scenario.json', async () => bytes)
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  expect(onBuild).not.toHaveBeenCalled()
  button.click()
  expect(onBuild).toHaveBeenCalledTimes(1)
  choose('broken.json', async () => new TextEncoder().encode('{'))
  await vi.waitFor(() => expect(host.textContent).toContain('Прежний план сохранён'))
  resolveOld(bytes)
  await vi.waitFor(() => expect(button.disabled).toBe(true))
  expect(onBuild).toHaveBeenCalledTimes(1)
})

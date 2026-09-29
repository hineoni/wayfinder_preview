import vue from '@vitejs/plugin-vue'
import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const preparedDir = fileURLToPath(new URL('../../datasets/prepared', import.meta.url))
const geometryUrl = /\/geometry\/([a-z-]+\.geometry\.json)(?:\?.*)?$/

/** Файлы `<группа>.geometry.json` отдаются статикой из `geometry/`, а не попадают в JS-чанк. */
function geometryAssets(): Plugin {
  const files = () => readdirSync(preparedDir).filter((name) => name.endsWith('.geometry.json'))
  return {
    name: 'wayfinder-geometry-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = geometryUrl.exec(request.url ?? '')?.[1]
        if (name === undefined || !files().includes(name)) return next()
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-cache')
        createReadStream(resolve(preparedDir, name)).on('error', next).pipe(response)
      })
    },
    generateBundle() {
      for (const name of files()) {
        this.emitFile({
          type: 'asset',
          fileName: `geometry/${name}`,
          source: readFileSync(resolve(preparedDir, name)),
        })
      }
    },
  }
}

export default defineConfig({
  base: process.env['VITE_BASE_PATH'] || '/',
  plugins: [vue(), geometryAssets()],
  build: {
    target: 'es2022',
    // Библиотеки меняются реже кода приложения: отдельные чанки кешируются между сборками.
    rollupOptions: {
      output: { manualChunks: { leaflet: ['leaflet'], vue: ['vue', 'pinia', 'reka-ui'] } },
    },
  },
})

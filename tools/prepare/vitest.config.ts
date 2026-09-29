import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'prepare',
    include: ['test/**/*.test.ts'],
  },
})

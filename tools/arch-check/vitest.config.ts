import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'arch-check',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
})

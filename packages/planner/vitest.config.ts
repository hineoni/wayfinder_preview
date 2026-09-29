import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'planner',
    include: ['test/**/*.test.ts'],
  },
})

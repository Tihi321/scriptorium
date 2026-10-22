import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // most tests start an engine with real timers and files: on a loaded machine they are slow, not wrong
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 8
  }
})

import { defineConfig } from 'vitest/config'

// The restart-recovery test on its own: it kills and restarts real engine processes, so no other test file runs next to it.
export default defineConfig({
  test: {
    include: ['tests/recovery.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    maxWorkers: 1
  }
})

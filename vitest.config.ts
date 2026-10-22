import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // the recovery test spawns two engine processes with real timers: it runs alone, after the rest (`yarn test:recovery`, see vitest.recovery.config.ts)
    exclude: [...configDefaults.exclude, 'tests/recovery.test.ts'],
    environment: 'node',
    // most tests start an engine with real timers and files: on a loaded machine they are slow, not wrong
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 8
  }
})

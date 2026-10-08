import { defineConfig } from '@playwright/test'

/**
 * Smoke test of the real app: Electron main, preload, the engine (with a mock provider) and the renderer.
 * Run `npm run build` first. `npm run test:electron` does both.
 */
export default defineConfig({
  testDir: 'tests/renderer',
  testMatch: '*.electron.spec.ts',
  testIgnore: 'packaged.electron.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  outputDir: '.claude/temp/pw-results-electron'
})

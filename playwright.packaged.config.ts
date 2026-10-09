import { defineConfig } from '@playwright/test'

/** Smoke test of the packaged app in dist/win-unpacked. `npm run test:packaged` builds it first. */
export default defineConfig({
  testDir: 'tests/renderer',
  testMatch: 'packaged.electron.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  outputDir: '.claude/temp/pw-results-packaged'
})

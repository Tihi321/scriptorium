import { defineConfig } from '@playwright/test'

/** Smoke test of the renderer against the dev harness (fake engine) in a browser. */
export default defineConfig({
  testDir: 'tests/renderer',
  testMatch: '*.spec.ts',
  testIgnore: '*.electron.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '.claude/temp/pw-results',
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1500, height: 950 } },
  webServer: {
    command: 'npx vite --config vite.ui.config.ts --port 5199 --strictPort',
    url: 'http://localhost:5199/?demo',
    reuseExistingServer: true,
    timeout: 60_000
  }
})

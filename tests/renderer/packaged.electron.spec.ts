import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { parseMd } from '../../src/shared/md'
import { writeMd } from '../../src/engine/store/atomic'
import { ROLES } from '../../src/shared/schemas'

/**
 * Smoke test of the packaged app (`npm run dist:dir` output, dist/win-unpacked). It never runs the NSIS installer.
 * Run through `npm run test:packaged`, which builds the unpacked app first.
 */
const root = path.resolve(__dirname, '../..')
const exe = path.join(root, 'dist/win-unpacked/Scriptorium.exe')
const appDir = path.join(root, 'dist/win-unpacked/resources/app')
const published = path.join(root, '.claude/temp/p3-toddler-5')
const SLUG = 'the-moon-s-blanket'

let app: ElectronApplication
let page: Page
let dataDir: string
let userData: string

/** Runs the packaged Scriptorium.exe as plain Node (ELECTRON_RUN_AS_NODE). */
function asNode(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(exe, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60_000 })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

test.beforeAll(async () => {
  test.skip(!existsSync(exe), 'run `npm run dist:dir` first')
  test.skip(!existsSync(published), 'needs .claude/temp/p3-toddler-5 (a data folder with a published book)')
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'scrip-packaged-data-'))
  userData = await mkdtemp(path.join(os.tmpdir(), 'scrip-packaged-user-'))
  // only the books and a mock provider are pre-written; everything else must come from the packaged seed
  await cp(path.join(published, 'books'), path.join(dataDir, 'books'), { recursive: true })
  await rm(path.join(dataDir, 'books', SLUG, 'out', 'cover.png'), { force: true })
  const bookFile = path.join(dataDir, 'books', SLUG, 'book.md')
  const book = parseMd(await readFile(bookFile, 'utf8'))
  await writeMd(bookFile, { ...(book.data as Record<string, unknown>), cover_png: 'pending' }, book.body)
  await writeMd(
    path.join(dataDir, 'config', 'providers.md'),
    { kind: 'providers', providers: [{ id: 'loc', kind: 'mock', local: true, concurrency: 4, models: [{ id: 'm1', family: 'loc' }] }] },
    'test providers\n'
  )
  await writeMd(
    path.join(dataDir, 'config', 'roles.md'),
    { kind: 'roles', embeddings: 'loc/m1', roles: Object.fromEntries(ROLES.map((r) => [r, { models: ['loc/m1'] }])) },
    'test roles\n'
  )
  await writeMd(path.join(dataDir, 'config', 'factory.md'), { kind: 'factory', paused: true, max_books_in_progress: 1, idea_low_water_mark: 2, max_attempts: 2 }, 'factory\n')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
})

test('the packaged engine loads @napi-rs/keyring and sqlite-vec from the unpacked package', async () => {
  const keyring = asNode([
    '-e',
    `const { Entry } = require(${JSON.stringify(path.join(appDir, 'node_modules/@napi-rs/keyring'))}); const v = new Entry('scriptorium-packaged-check', 'nobody').getPassword(); console.log('KEYRING_OK ' + typeof Entry + ' ' + v)`
  ])
  expect(keyring.out).toContain('KEYRING_OK function')

  // the engine's own reindex command: opens index/library.sqlite and loads vec0.dll through sqlite-vec
  const reindex = asNode([path.join(appDir, 'out/engine/index.js'), 'reindex', '--data', dataDir])
  expect(reindex.out).toContain('file(s) indexed')
  expect(reindex.status).toBe(0)
  expect((await stat(path.join(dataDir, 'index', 'library.sqlite'))).size).toBeGreaterThan(0)
})

test('the packaged app seeds the data folder, starts the engine, shows the agents and renders a cover', async () => {
  app = await electron.launch({
    executablePath: exe,
    args: ['--data', dataDir, `--user-data-dir=${userData}`],
    env: { ...process.env, SCRIPTORIUM_NO_LOGIN_ITEM: '1', SCRIPTORIUM_NO_TRAY: '1', ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await expect(page.locator('.office-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { __office?: { agentCount(): number } }).__office?.agentCount() ?? 0), { timeout: 30_000 })
    .toBe(17)
  await expect(page.getByTestId('statusbar')).toContainText('engine')

  // seed copied from resources/seed
  for (const rel of ['topics.md', 'config/quality.md', 'config/budget.md', 'config/settings.md']) expect(existsSync(path.join(dataDir, rel)), rel).toBe(true)
  expect((await readdir(path.join(dataDir, 'agents'))).length).toBeGreaterThan(5)
  expect((await readdir(path.join(dataDir, 'prompts'))).length).toBeGreaterThan(0)

  // the cover left pending is rendered by the packaged main process
  const cover = path.join(dataDir, 'books', SLUG, 'out', 'cover.png')
  await expect.poll(() => existsSync(cover), { timeout: 60_000 }).toBe(true)
  await expect
    .poll(async () => (parseMd(await readFile(path.join(dataDir, 'books', SLUG, 'book.md'), 'utf8')).data as { cover_png?: string }).cover_png, { timeout: 30_000 })
    .toBe('done')
  expect((await stat(cover)).size).toBeGreaterThan(1000)

  await mkdir(path.join(root, '.claude/temp'), { recursive: true })
  await page.getByTestId('tab-library').click()
  await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(root, '.claude/temp/p10-packaged.png') })
})

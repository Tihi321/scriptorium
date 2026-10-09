import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMd } from '../../src/shared/md'
import { writeMd } from '../../src/engine/store/atomic'
import { ROLES } from '../../src/shared/schemas'

const root = path.resolve(__dirname, '../..')
const published = path.join(root, '.claude/temp/p3-toddler-5')
const SLUG = 'the-moon-s-blanket'
const TOPIC = 'jfic-bedtime-and-dreams'

interface Dbg {
  __office: { agentCount(): number; agentPos(id: string): { x: number; y: number } | null; debug(): { id: string; state?: string }[] }
  scriptorium: { readFile(rel: string): Promise<string | null>; tailFile(rel: string, from: number): Promise<{ text: string; size: number } | null> }
}

let app: ElectronApplication
let page: Page
let dataDir: string
let userData: string

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(root, 'out/main/index.js')), 'run `npm run build` first')
  test.skip(!existsSync(published), 'needs .claude/temp/p3-toddler-5 (a data folder with a published book)')
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'scrip-electron-data-'))
  userData = await mkdtemp(path.join(os.tmpdir(), 'scrip-electron-user-'))
  // a data folder with a published book, and only a mock provider
  await cp(published, dataDir, { recursive: true })
  await rm(path.join(dataDir, 'jobs'), { recursive: true, force: true })
  await rm(path.join(dataDir, 'logs'), { recursive: true, force: true })
  for (const d of ['jobs/queued', 'jobs/running', 'jobs/done', 'jobs/failed']) await mkdir(path.join(dataDir, d), { recursive: true })
  await writeMd(
    path.join(dataDir, 'config', 'providers.md'),
    { kind: 'providers', providers: [{ id: 'loc', kind: 'mock', local: true, concurrency: 4, models: [{ id: 'm1', family: 'loc' }] }] },
    'test providers\n'
  )
  await writeMd(path.join(dataDir, 'config', 'roles.md'), { kind: 'roles', roles: Object.fromEntries(ROLES.map((r) => [r, { models: ['loc/m1'] }])) }, 'test roles\n')
  await writeMd(path.join(dataDir, 'config', 'factory.md'), { kind: 'factory', paused: false, max_books_in_progress: 1, idea_low_water_mark: 2, max_attempts: 2 }, 'factory\n')

  app = await electron.launch({
    args: [path.join(root, 'out/main/index.js'), '--data', dataDir, `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...process.env, SCRIPTORIUM_NO_LOGIN_ITEM: '1', ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
})

test('the real app: office, agents at work, terminal from real logs, pause all, library, reader and rating', async () => {
  // the office renders with the real engine's agents
  await expect(page.locator('.office-canvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Dbg).__office?.agentCount() ?? 0), { timeout: 30_000 }).toBe(17)
  await expect(page.getByTestId('statusbar')).toContainText('engine')
  await expect(page.getByTestId('whiteboard')).toContainText('Moon')

  // main's file reads only serve the data folder
  const reads = await page.evaluate(async () => {
    const api = (globalThis as unknown as Dbg).scriptorium
    return {
      inside: await api.readFile('config/factory.md'),
      parent: await api.readFile('../package.json'),
      absolute: await api.readFile('C:\\Windows\\win.ini'),
      tail: await api.tailFile('config/factory.md', -10)
    }
  })
  expect(reads.inside).toContain('kind: factory')
  expect(reads.parent).toBeNull()
  expect(reads.absolute).toBeNull()
  expect(reads.tail?.size).toBeGreaterThan(10)

  // switch a topic on from the library: agents start working
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId(`shelf-${TOPIC}`)).toContainText("The Moon's Blanket")
  // the list has 400+ topics in sections: find the topic with the filter box
  await page.getByTestId('topic-filter').fill('fic-fantasy-cozy')
  const other = page.getByTestId('topic-fic-fantasy-cozy')
  if (!(await other.isChecked())) await other.click()
  await expect(other).toBeChecked({ timeout: 15_000 })
  await page.getByTestId('tab-office').click()
  await expect(page.getByTestId('count-working')).not.toContainText('working 0', { timeout: 60_000 })

  // an agent that works has a log: click it and read it in the terminal
  const findWorking = () =>
    page.evaluate(() => (globalThis as unknown as Dbg).__office.debug().find((r) => r.state === 'working' || r.state === 'reviewing')?.id ?? '')
  await expect.poll(findWorking, { timeout: 60_000 }).not.toBe('')
  const workingId = await findWorking()
  expect(workingId).not.toBe('')
  await expect.poll(async () => (await page.evaluate((id) => (globalThis as unknown as Dbg).scriptorium.readFile(`logs/agents/${id}.md`), workingId)) ?? '', { timeout: 30_000 }).toContain(' job `')
  const pos = (await page.evaluate((id) => (globalThis as unknown as Dbg).__office.agentPos(id), workingId))!
  const box = (await page.locator('.office-canvas canvas').boundingBox())!
  await page.mouse.click(box.x + pos.x, box.y + pos.y)
  await expect(page.getByTestId('terminal')).toBeVisible()
  await expect(page.getByTestId('terminal-log')).toContainText('requested by', { timeout: 20_000 })
  await expect(page.getByTestId('job-block').first()).toBeVisible()
  await page.waitForTimeout(1000) // let the canvas settle after the terminal opened
  await page.screenshot({ path: path.join(root, '.claude/temp/p4-electron.png') })

  // pause all reaches the engine and is saved
  await page.getByTestId('pause-all').click()
  await expect(page.getByTestId('pause-all')).toHaveText('Resume all')
  await expect
    .poll(async () => (parseMd(await readFile(path.join(dataDir, 'config', 'factory.md'), 'utf8')).data as { paused?: boolean }).paused, { timeout: 15_000 })
    .toBe(true)
  await page.getByTestId('pause-all').click()
  await expect(page.getByTestId('pause-all')).toHaveText('Pause all')

  // the "Ask researcher" box reaches the engine: a research job for the chosen book appears (the mock model can't answer it, so it may end in failed/)
  await page.getByTestId('ask-question').fill('How long did a ship take from Lisbon to Goa?')
  await page.getByTestId('ask-book').selectOption(SLUG)
  await page.getByTestId('ask-send').click()
  await expect
    .poll(
      async () => {
        const found: string[] = []
        for (const state of ['queued', 'running', 'done', 'failed']) {
          const dir = path.join(dataDir, 'jobs', state)
          if (existsSync(dir)) found.push(...(await readdir(dir)).filter((f) => f.startsWith(`research--${SLUG}--`)))
        }
        return found.length
      },
      { timeout: 20_000 }
    )
    .toBe(1)

  // the library: the published book's card, the reader and a rating
  await page.getByTestId('tab-library').click()
  await page.getByTestId(`shelf-book-${SLUG}`).click()
  await expect(page.getByTestId('card-title')).toHaveText("The Moon's Blanket")
  await expect(page.locator('[data-testid=book-card] img.card-cover')).toBeVisible()
  expect(await page.locator('[data-testid=book-card] img.card-cover').evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(50)
  await page.screenshot({ path: path.join(root, '.claude/temp/p5-electron-card.png') })
  await page.getByTestId('card-read').click()
  const reader = page.frameLocator('[data-testid=reader-frame]')
  await expect(reader.getByRole('heading', { name: "The Moon's Blanket" }).first()).toBeVisible({ timeout: 15_000 })
  await reader.getByRole('link', { name: /moon|chapter|blanket/i }).last().click()
  await expect(reader.locator('p').first()).toBeVisible()
  const chapterText = await reader.locator('body').innerText()
  expect(chapterText.length).toBeGreaterThan(200)
  await page.screenshot({ path: path.join(root, '.claude/temp/p5-electron-reader.png') })
  await page.getByTestId('reader-back').click()
  await page.getByTestId('rate-4').click()
  await page.getByTestId('rate-note').fill('Lovely, read it twice.')
  await page.getByTestId('rate-save').click()
  await expect
    .poll(async () => (parseMd(await readFile(path.join(dataDir, 'books', SLUG, 'book.md'), 'utf8')).data as { rating?: number }).rating, { timeout: 15_000 })
    .toBe(4)
  await expect(page.getByTestId('card-rating')).toHaveText('★★★★')
  await page.getByTestId('card-close').click()
  await page.screenshot({ path: path.join(root, '.claude/temp/p5-electron-library.png') })
})

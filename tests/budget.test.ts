import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Budget, SUMMARY_MARKER, dayKey, monthKey } from '../src/engine/budget/spend'
import type { SpendEntry } from '../src/engine/budget/spend'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { parseMd } from '../src/shared/md'
import { seedDir } from './helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-budget-'))
  await initDataFolder(dir, seedDir)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const entry = (time: Date, cost: number, extra: Partial<SpendEntry> = {}): SpendEntry => ({
  time,
  agent: 'writer-mara-quill',
  book: 'silver-inn',
  role: 'writer',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  tokensIn: 1000,
  tokensCached: 200,
  tokensOut: 300,
  costUsd: cost,
  ms: 1500,
  ...extra
})

describe('Budget', () => {
  it('reads the seed caps: 40 a month, 5 a day, warn at 0.8', async () => {
    const b = new Budget(dir)
    await b.load()
    expect(b.caps).toMatchObject({ monthly_cap_usd: 40, daily_cap_usd: 5, per_book_cap_usd: null, warn_at: 0.8 })
  })

  it('appends rows, and rebuilds the same totals from the files', async () => {
    const now = new Date(2026, 9, 8, 12, 0, 0)
    const b = new Budget(dir, {}, () => now)
    await b.load()
    await b.record(entry(now, 0.25))
    await b.record(entry(new Date(2026, 9, 8, 13, 0, 0), 0.5, { book: 'other', role: 'line-editor' }))
    await b.record(entry(new Date(2026, 9, 7, 13, 0, 0), 1))
    expect(b.spentToday()).toBeCloseTo(0.75)
    expect(b.spentMonth()).toBeCloseTo(1.75)
    expect(b.spentBook('silver-inn')).toBeCloseTo(1.25)

    const again = new Budget(dir, {}, () => now)
    await again.load()
    expect(again.spentToday()).toBeCloseTo(0.75)
    expect(again.spentMonth()).toBeCloseTo(1.75)
    expect(again.spentBook('other')).toBeCloseTo(0.5)
    const file = await readFile(path.join(dir, 'logs', 'spend', `${monthKey(now)}.md`), 'utf8')
    expect(file).toContain('| time | agent | book | role | provider | model |')
    expect(file.split('\n').filter((l) => l.includes('deepseek-v4-flash')).length).toBe(3)
  })

  it('uses local time for the day and month boundaries', async () => {
    const lateEvening = new Date(2026, 9, 31, 23, 59, 0)
    const justAfter = new Date(2026, 10, 1, 0, 1, 0)
    expect(dayKey(lateEvening)).toBe('2026-10-31')
    expect(monthKey(justAfter)).toBe('2026-11')
    let now = lateEvening
    const b = new Budget(dir, {}, () => now)
    await b.load()
    await b.record(entry(lateEvening, 2))
    expect(b.spentToday()).toBe(2)
    now = justAfter
    expect(b.spentToday()).toBe(0)
    expect(b.spentMonth()).toBe(0)
    await b.record(entry(justAfter, 1))
    expect(b.spentMonth()).toBe(1)
    const files = await readFile(path.join(dir, 'logs', 'spend', '2026-11.md'), 'utf8')
    expect(files).toContain('2026-11-01T00:01:00')
  })

  it('refuses a reservation that would cross the daily, monthly or book cap', async () => {
    const now = new Date(2026, 9, 8, 12)
    const b = new Budget(dir, {}, () => now)
    await b.load()
    b.caps = { ...b.caps, daily_cap_usd: 5, monthly_cap_usd: 40, per_book_cap_usd: 3 }
    await b.record(entry(now, 4))
    const r1 = b.reserve(0.5, 'x')
    expect(r1.ok).toBe(true)
    const r2 = b.reserve(0.6, 'x') // 4 + 0.5 reserved + 0.6 > 5
    expect(r2).toMatchObject({ ok: false, cap: 'daily' })
    if (r1.ok) b.release(r1.reservation)
    expect(b.reserve(0.6, 'x').ok).toBe(true)
    // book cap: silver-inn already has 4 USD, cap 3
    expect(b.reserve(0.01, 'silver-inn')).toMatchObject({ ok: false, cap: 'book' })
    // monthly
    b.caps = { ...b.caps, daily_cap_usd: 100, monthly_cap_usd: 4.2, per_book_cap_usd: null }
    expect(b.reserve(0.5, 'x')).toMatchObject({ ok: false, cap: 'monthly' })
  })

  it('isExhausted is true once spend reaches a cap', async () => {
    const now = new Date(2026, 9, 8, 12)
    const b = new Budget(dir, {}, () => now)
    await b.load()
    expect(b.isExhausted().ok).toBe(true)
    await b.record(entry(now, 5))
    expect(b.isExhausted()).toMatchObject({ ok: false, cap: 'daily' })
  })

  it('warns once at 80 percent of a cap', async () => {
    const now = new Date(2026, 9, 8, 12)
    const warnings: string[] = []
    const b = new Budget(dir, { onWarn: (m) => warnings.push(m) }, () => now)
    await b.load()
    await b.record(entry(now, 3))
    expect(warnings).toEqual([])
    await b.record(entry(now, 1.5)) // 4.5 of 5
    await b.record(entry(now, 0.1))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/daily/)
  })

  it('records local models with cost 0 and tokens, and they never count toward caps', async () => {
    const now = new Date(2026, 9, 8, 12)
    const b = new Budget(dir, {}, () => now)
    await b.load()
    await b.record(entry(now, 0, { provider: 'lmstudio', model: 'qwen', tokensIn: 5000, tokensOut: 4000, ms: 90_000 }))
    expect(b.spentToday()).toBe(0)
    expect(b.summaryText()).toContain('lmstudio/qwen: 0.0000 USD, 5000 in / 4000 out tokens, 1 requests, 90.0 s')
  })

  it('writes the summary below the marker and never touches what is above it', async () => {
    const now = new Date(2026, 9, 8, 12)
    const file = path.join(dir, 'config', 'budget.md')
    const mine = '---\nkind: budget\nmonthly_cap_usd: 40 # my note\ndaily_cap_usd: 5\nper_book_cap_usd: null\nwarn_at: 0.8\n---\n# Budget\n\nMy own text.\n\n'
    await writeFile(file, mine)
    const b = new Budget(dir, {}, () => now)
    await b.load()
    await b.record(entry(now, 0.5))
    await b.writeSummary()
    let text = await readFile(file, 'utf8')
    expect(text.startsWith(mine)).toBe(true)
    expect(text).toContain(SUMMARY_MARKER)
    expect(text).toContain('Today (2026-10-08): 0.5000 of 5 USD')

    // the user edits the text above while the engine runs: the engine re-reads before writing
    await writeFile(file, text.replace('My own text.', 'My edited text.'))
    await b.record(entry(now, 0.25))
    await b.writeSummary()
    text = await readFile(file, 'utf8')
    expect(text).toContain('My edited text.')
    expect(text).toContain('0.7500 of 5 USD')
    expect(text.split(SUMMARY_MARKER)).toHaveLength(2)
    expect(parseMd(text).data).toMatchObject({ monthly_cap_usd: 40 })
  })
})

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATA_LAYOUT, initDataFolder, resolveDataDir } from '../src/engine/store/dataFolder'
import { watchDataFolder } from '../src/engine/store/watcher'
import type { WatchEvent } from '../src/engine/store/watcher'
import { parseMdWith } from '../src/shared/md'
import { budgetSchema, CONFIG_FILES, schemasByKind } from '../src/shared/schemas'

const seedDir = path.resolve(__dirname, '../seed')
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-data-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('resolveDataDir', () => {
  const home = path.join(os.tmpdir(), 'fake-home')
  it('prefers --data, then SCRIPTORIUM_DATA, then ~/Scriptorium', () => {
    const env = { SCRIPTORIUM_DATA: path.join(dir, 'env') }
    expect(resolveDataDir({ argv: ['--data', path.join(dir, 'arg')], env, homedir: home })).toBe(path.join(dir, 'arg'))
    expect(resolveDataDir({ argv: [`--data=${path.join(dir, 'eq')}`], env, homedir: home })).toBe(path.join(dir, 'eq'))
    expect(resolveDataDir({ argv: [], env, homedir: home })).toBe(path.join(dir, 'env'))
    expect(resolveDataDir({ argv: [], env: {}, homedir: home })).toBe(path.join(home, 'Scriptorium'))
  })
})

describe('initDataFolder', () => {
  it('creates the full layout and copies the seed', async () => {
    const data = path.join(dir, 'data')
    const res = await initDataFolder(data, seedDir)
    for (const rel of DATA_LAYOUT) expect(existsSync(path.join(data, ...rel.split('/')))).toBe(true)
    expect(existsSync(path.join(data, 'topics.md'))).toBe(true)
    for (const name of CONFIG_FILES) {
      const text = await readFile(path.join(data, 'config', `${name}.md`), 'utf8')
      expect(() => parseMdWith(text, schemasByKind[name])).not.toThrow()
    }
    const budget = parseMdWith(await readFile(path.join(data, 'config', 'budget.md'), 'utf8'), budgetSchema)
    expect(budget.data).toMatchObject({ monthly_cap_usd: 40, daily_cap_usd: 5, warn_at: 0.8 })
    expect(res.copied.length).toBeGreaterThanOrEqual(8)
  })

  it('never overwrites an existing file', async () => {
    const data = path.join(dir, 'data')
    await initDataFolder(data, seedDir)
    const mine = path.join(data, 'config', 'budget.md')
    await writeFile(mine, '---\nkind: budget\nmonthly_cap_usd: 1\ndaily_cap_usd: 1\n---\nmine\n')
    const again = await initDataFolder(data, seedDir)
    expect(await readFile(mine, 'utf8')).toContain('mine')
    expect(again.copied).toEqual([])
    expect(again.skipped).toContain('config/budget.md')
  })
})

describe('watchDataFolder', () => {
  it('emits typed events and ignores tmp files', async () => {
    const data = path.join(dir, 'data')
    await initDataFolder(data, seedDir)
    const events: WatchEvent[] = []
    const w = watchDataFolder(data, (e) => events.push(e), { debounceMs: 50 })
    await w.ready
    await writeFile(path.join(data, 'ideas', 'x.md.tmp-abc'), 'tmp')
    await writeFile(path.join(data, 'ideas', 'x.md'), '---\nkind: idea\n---\n')
    await writeFile(path.join(data, 'topics.md'), '---\nkind: topics\n---\nchanged\n')
    const deadline = Date.now() + 8000
    while (events.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    await w.close()
    expect(events.map((e) => `${e.kind}:${e.change}:${e.rel}`).sort()).toEqual([
      'idea:add:ideas/x.md',
      'topics:change:topics.md'
    ])
  })
})

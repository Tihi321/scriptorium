import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelRegistry } from '../src/engine/models/registry'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { migrateAcpProvider, migrateAntigravityClient, migrateClientProvider, migrateFallbacks, migrateSeedPrompts } from '../src/engine/store/migrations'
import { SEED_HISTORY, seedHash } from '../src/engine/store/seedHistory'
import { parseMd } from '../src/shared/md'
import { seedDir } from './helpers'

const dirs: string[] = []
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'scrip-mig-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

/** A providers.md from before the client provider: only a mock-free OpenAI provider and the search providers. */
const OLD_PROVIDERS = [
  '---',
  'kind: providers',
  'providers:',
  '  - id: lmstudio',
  '    kind: openai-compat',
  '    local: true',
  '    base_url: http://localhost:1234/v1',
  '    models: []',
  '  # my own note about search',
  '  - id: tavily',
  '    kind: search',
  '    engine: tavily',
  '    price_per_request: 0.008',
  'search_order: [tavily, wikipedia]',
  '---',
  '# Providers',
  ''
]

const providersFolder = async (lines: string[], eol = '\n') => {
  const dir = await tmp()
  await mkdir(path.join(dir, 'config'), { recursive: true })
  await writeFile(path.join(dir, 'config', 'providers.md'), lines.join(eol))
  return dir
}

describe('migrateClientProvider', () => {
  it('adds the client provider before the first search provider, keeps comments and CRLF, and is idempotent', async () => {
    const dir = await providersFolder(OLD_PROVIDERS, '\r\n')
    const res = await migrateClientProvider(dir, seedDir)
    expect(res.changes).toEqual(['config/providers.md: added the client provider (client/claude-code, switched off, context 200000)'])
    const text = await readFile(path.join(dir, 'config', 'providers.md'), 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/) // every line break is still CRLF
    const lines = text.split('\r\n')
    const at = lines.indexOf('  - id: client')
    expect(at).toBeGreaterThan(0)
    expect(lines[at - 2]).toMatch(/^ {2}# Claude Code/) // the seed's two comment lines come with it
    expect(lines.indexOf('  # my own note about search')).toBeGreaterThan(at)
    expect(lines.indexOf('  - id: tavily')).toBeGreaterThan(at)
    expect(lines.slice(at, at + 12).join('\n')).toContain('context: 200000')
    expect(lines.slice(at, at + 4)).toContain('    enabled: false')
    expect(lines).toContain('# Providers')
    expect((await migrateClientProvider(dir, seedDir)).changes).toEqual([])
    expect(await readFile(path.join(dir, 'config', 'providers.md'), 'utf8')).toBe(text)
  })

  it('works without a seed (the built-in block) and without search providers', async () => {
    const dir = await providersFolder(['---', 'kind: providers', 'providers:', '  - id: a', '    kind: openai-compat', '    models: []', 'search_order: []', '---', 'x', ''])
    expect((await migrateClientProvider(dir, undefined)).changes).toHaveLength(1)
    const text = await readFile(path.join(dir, 'config', 'providers.md'), 'utf8')
    expect(text.indexOf('- id: client')).toBeLessThan(text.indexOf('search_order:'))
    expect(text.indexOf('- id: a')).toBeLessThan(text.indexOf('- id: client'))
  })

  it('gives an existing client model a context, and leaves a context the user set', async () => {
    const withClient = (extra: string[]) => [
      ...OLD_PROVIDERS.slice(0, 8),
      '  - id: client',
      '    kind: client',
      '    enabled: true',
      '    models:',
      '      - id: claude-code',
      '        family: claude',
      ...extra,
      '        vision: true',
      ...OLD_PROVIDERS.slice(8)
    ]
    const bare = await providersFolder(withClient([]))
    expect((await migrateClientProvider(bare, seedDir)).changes).toEqual(['config/providers.md: client/claude-code got context 200000 (the window of Claude)'])
    const text = await readFile(path.join(bare, 'config', 'providers.md'), 'utf8')
    expect(text).toContain('        family: claude\n        context: 200000\n        vision: true')
    expect(text).toContain('    enabled: true') // a provider the user switched on stays on
    expect((await migrateClientProvider(bare, seedDir)).changes).toEqual([])
    const own = await providersFolder(withClient(['        context: 100000']))
    expect((await migrateClientProvider(own, seedDir)).changes).toEqual([])
    expect(await readFile(path.join(own, 'config', 'providers.md'), 'utf8')).toContain('context: 100000')
  })

  it('does not touch a folder without providers.md', async () => {
    const dir = await tmp()
    expect((await migrateClientProvider(dir, seedDir)).changes).toEqual([])
    expect(existsSync(path.join(dir, 'config'))).toBe(false)
  })

  it('the registry loads the migrated file: client/claude-code has the window and is switched off', async () => {
    const dir = await providersFolder(OLD_PROVIDERS)
    await migrateClientProvider(dir, seedDir)
    await writeFile(path.join(dir, 'config', 'roles.md'), ['---', 'kind: roles', 'roles: {}', '---', ''].join('\n'))
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    expect(registry.getModel('client/claude-code')?.context).toBe(200000)
    expect(registry.providers.get('client')?.available).toBe(false)
  })

  it('initDataFolder logs the migration once on an old folder, and nothing the second time', async () => {
    const dir = await tmp()
    await initDataFolder(dir, seedDir)
    const file = path.join(dir, 'config', 'providers.md')
    const text = await readFile(file, 'utf8')
    const from = text.indexOf('  # Claude Code')
    const to = text.indexOf('  # Search services')
    expect(from).toBeGreaterThan(0)
    await writeFile(file, text.slice(0, from) + text.slice(to))
    const first = await initDataFolder(dir, seedDir)
    expect(first.migrated.filter((m) => m.includes('client provider'))).toHaveLength(1)
    expect((await initDataFolder(dir, seedDir)).migrated).toEqual([])
  })
})

describe('migrateSeedPrompts', () => {
  const REL = 'prompts/writer/draft.md'
  const setup = async (data: string | null, history: string[]) => {
    const dataDir = await tmp()
    const seed = await tmp()
    await mkdir(path.join(seed, 'prompts', 'writer'), { recursive: true })
    await mkdir(path.join(dataDir, 'prompts', 'writer'), { recursive: true })
    await writeFile(path.join(seed, REL), 'The new prompt.\nSecond line.\n')
    if (data !== null) await writeFile(path.join(dataDir, REL), data)
    return { dataDir, seed, history: { [REL]: [...history, seedHash('The new prompt.\nSecond line.\n')] } }
  }
  const OLD = 'The old prompt.\nSecond line.\n'

  it('upgrades an unedited earlier version and keeps the file\'s line endings', async () => {
    const lf = await setup(OLD, [seedHash(OLD)])
    expect((await migrateSeedPrompts(lf.dataDir, lf.seed, lf.history)).changes).toEqual([`${REL}: upgraded to the current seed version (it was an unedited earlier version)`])
    expect(await readFile(path.join(lf.dataDir, REL), 'utf8')).toBe('The new prompt.\nSecond line.\n')
    const crlf = await setup(OLD.replace(/\n/g, '\r\n'), [seedHash(OLD)])
    await migrateSeedPrompts(crlf.dataDir, crlf.seed, crlf.history)
    expect(await readFile(path.join(crlf.dataDir, REL), 'utf8')).toBe('The new prompt.\r\nSecond line.\r\n')
    expect((await migrateSeedPrompts(crlf.dataDir, crlf.seed, crlf.history)).changes).toEqual([]) // now current
  })

  it('keeps an edited file, leaves the current version, and leaves a missing file to the copy', async () => {
    const edited = await setup('My own words.\n', [seedHash(OLD)])
    expect((await migrateSeedPrompts(edited.dataDir, edited.seed, edited.history)).changes).toEqual([])
    expect(await readFile(path.join(edited.dataDir, REL), 'utf8')).toBe('My own words.\n')
    const current = await setup('The new prompt.\nSecond line.\n', [seedHash(OLD)])
    expect((await migrateSeedPrompts(current.dataDir, current.seed, current.history)).changes).toEqual([])
    const missing = await setup(null, [seedHash(OLD)])
    expect((await migrateSeedPrompts(missing.dataDir, missing.seed, missing.history)).changes).toEqual([])
    expect(existsSync(path.join(missing.dataDir, REL))).toBe(false)
  })

  it('without a seed nothing happens', async () => {
    const dir = await tmp()
    expect((await migrateSeedPrompts(dir, undefined)).changes).toEqual([])
  })
})

describe('the seed history', () => {
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...(await walk(p)))
      else out.push(p)
    }
    return out
  }

  it('has the current version of every seed prompt and template (run `yarn seed:hashes` after editing one)', async () => {
    const missing: string[] = []
    for (const sub of ['prompts', 'templates']) {
      for (const file of await walk(path.join(seedDir, sub))) {
        const rel = path.relative(seedDir, file).split(path.sep).join('/')
        if (!SEED_HISTORY[rel]?.includes(seedHash(await readFile(file, 'utf8')))) missing.push(rel)
      }
    }
    expect(missing, 'run `yarn seed:hashes`').toEqual([])
  })
})

describe('migrateFallbacks (SCP-19)', () => {
  const oldSettings = (extra: string[], body = ['# Settings', '', 'My own note.', '', '## Default models', '', 'old text about `default_paid_model`.', '', '## Mine', '', 'Keep this.', '']) =>
    ['---', 'kind: settings', 'kindle_address: me@kindle.com', 'default_paid_model: deepseek/deepseek-v4-pro', 'default_strata_model: strata/qwen3.8-flash-next', 'default_lmstudio_model: lmstudio/gemma', ...extra, 'lmstudio_parallel: 2', '---', ...body].join('\n')
  const settingsFolder = async (text: string) => {
    const dir = await tmp()
    await mkdir(path.join(dir, 'config'), { recursive: true })
    await writeFile(path.join(dir, 'config', 'settings.md'), text)
    return dir
  }
  const read = async (dir: string) => parseMd(await readFile(path.join(dir, 'config', 'settings.md'), 'utf8'))

  it('an empty model_order gives paid, strata, lmstudio, not shared; the old keys go and the body section is replaced', async () => {
    const dir = await settingsFolder(oldSettings(['model_order: []']))
    const r = await migrateFallbacks(dir, seedDir)
    expect(r.changes).toHaveLength(1)
    const doc = await read(dir)
    expect(doc.data).toMatchObject({ kindle_address: 'me@kindle.com', lmstudio_parallel: 2, fallbacks: ['deepseek/deepseek-v4-pro', 'strata/qwen3.8-flash-next', 'lmstudio/gemma'], fallback_shared: false })
    for (const k of ['default_paid_model', 'default_strata_model', 'default_lmstudio_model', 'model_order']) expect(doc.data).not.toHaveProperty(k)
    expect(doc.body).toContain('My own note.')
    expect(doc.body).toContain('Keep this.')
    expect(doc.body).toContain('`fallbacks` is the list of models')
    expect(doc.body).not.toContain('old text about')
    expect(doc.body.match(/## Default models/g)).toHaveLength(1)
  })

  it('model_order [paid, lmstudio, strata] gives that order and turns the shared order on', async () => {
    const dir = await settingsFolder(oldSettings(['model_order: [paid, lmstudio, strata]']))
    await migrateFallbacks(dir, seedDir)
    expect((await read(dir)).data).toMatchObject({ fallbacks: ['deepseek/deepseek-v4-pro', 'lmstudio/gemma', 'strata/qwen3.8-flash-next'], fallback_shared: true })
  })

  it('a group model_order leaves out goes last; a missing default model is the seed one', async () => {
    const dir = await settingsFolder(['---', 'kind: settings', 'default_lmstudio_model: lmstudio/gemma', 'model_order: [lmstudio]', '---', '# Settings', ''].join('\n'))
    await migrateFallbacks(dir, seedDir)
    expect((await read(dir)).data).toMatchObject({ fallbacks: ['lmstudio/gemma', 'deepseek/deepseek-flash', 'strata/qwen3.8-flash-next'], fallback_shared: true })
  })

  it('leaves a migrated file, a file without the old keys and a missing file alone', async () => {
    const text = ['---', 'kind: settings', 'fallbacks:', '  - a/b', 'fallback_shared: true', '---', '# Settings', '', '## Default models', '', 'mine', ''].join('\n')
    const dir = await settingsFolder(text)
    expect((await migrateFallbacks(dir, seedDir)).changes).toEqual([])
    expect(await readFile(path.join(dir, 'config', 'settings.md'), 'utf8')).toBe(text)
    const bare = await settingsFolder(['---', 'kind: settings', '---', '# Settings', ''].join('\n'))
    expect((await migrateFallbacks(bare, seedDir)).changes).toEqual([])
    expect((await migrateFallbacks(await tmp(), seedDir)).changes).toEqual([])
    // running it twice on an old file changes nothing the second time
    const old = await settingsFolder(oldSettings(['model_order: []']))
    expect((await migrateFallbacks(old, seedDir)).changes).toHaveLength(1)
    expect((await migrateFallbacks(old, seedDir)).changes).toEqual([])
  })

  it('without a seed the body stays as it is, and initDataFolder migrates an old folder once', async () => {
    const dir = await settingsFolder(oldSettings(['model_order: []']))
    await migrateFallbacks(dir, undefined)
    const doc = await read(dir)
    expect(doc.data.fallbacks).toHaveLength(3)
    expect(doc.body).toContain('old text about')
    const old = await settingsFolder(oldSettings(['model_order: [strata]']))
    const first = await initDataFolder(old, seedDir)
    expect(first.migrated.filter((l) => l.includes('fallbacks'))).toHaveLength(1)
    expect((await read(old)).data).toMatchObject({ fallbacks: ['strata/qwen3.8-flash-next', 'deepseek/deepseek-v4-pro', 'lmstudio/gemma'], fallback_shared: true })
    expect((await initDataFolder(old, seedDir)).migrated.filter((l) => l.includes('fallbacks'))).toHaveLength(0)
  })
})

describe('migrateAcpProvider (SCP-44)', () => {
  it('adds the acp provider once, before the client provider, keeps comments and CRLF, and the registry loads it switched off', async () => {
    const withClient = [...OLD_PROVIDERS.slice(0, 8), '  # my client note', '  - id: client', '    kind: client', '    models: []', ...OLD_PROVIDERS.slice(8)]
    const dir = await providersFolder(withClient, '\r\n')
    const res = await migrateAcpProvider(dir, seedDir)
    expect(res.changes).toEqual(['config/providers.md: added the acp provider (the ACP proxy at http://127.0.0.1:7461/v1, switched off)'])
    const file = path.join(dir, 'config', 'providers.md')
    const text = await readFile(file, 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    const ids = [...text.matchAll(/^ {2}- id: (\S+)/gm)].map((m) => m[1])
    expect(ids).toEqual(['lmstudio', 'acp', 'client', 'tavily'])
    expect(text).toContain('  # my client note')
    expect(text).toContain('  # my own note about search')
    expect((await migrateAcpProvider(dir, seedDir)).changes).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(text)
    await writeFile(path.join(dir, 'config', 'roles.md'), ['---', 'kind: roles', 'roles: {}', '---', ''].join('\n'))
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await registry.load()
    expect(registry.providers.get('acp')).toMatchObject({ enabled: false, local: true, baseUrl: 'http://127.0.0.1:7461/v1', concurrency: 2, jsonSchema: false, discover: true, custom: false, name: 'ACP proxy', available: false })
    expect(registry.kindOf('acp/any')).toBe('acp')
  })

  it('works without a seed, leaves a folder that has an acp provider, and does not touch a folder without the file', async () => {
    const dir = await providersFolder(OLD_PROVIDERS)
    expect((await migrateAcpProvider(dir, undefined)).changes).toHaveLength(1)
    const text = await readFile(path.join(dir, 'config', 'providers.md'), 'utf8')
    expect(text.indexOf('- id: acp')).toBeLessThan(text.indexOf('- id: tavily'))
    expect((await migrateAcpProvider(dir, undefined)).changes).toEqual([])
    const own = await providersFolder([...OLD_PROVIDERS.slice(0, 8), '  - id: acp', '    name: Mine', '    custom: true', '    kind: openai-compat', '    base_url: http://localhost:9/v1', '    models: []', ...OLD_PROVIDERS.slice(8)])
    expect((await migrateAcpProvider(own, seedDir)).changes).toEqual([])
    expect(await readFile(path.join(own, 'config', 'providers.md'), 'utf8')).toContain('name: Mine')
    const none = await tmp()
    expect((await migrateAcpProvider(none, seedDir)).changes).toEqual([])
    expect(existsSync(path.join(none, 'config'))).toBe(false)
  })

  it('initDataFolder adds it to an old folder once, and a fresh folder has it from the seed', async () => {
    const fresh = await tmp()
    const first = await initDataFolder(fresh, seedDir)
    expect(first.migrated.filter((m) => /acp|antigravity/.test(m))).toEqual([])
    const file = path.join(fresh, 'config', 'providers.md')
    const seedText = await readFile(file, 'utf8')
    expect(seedText).toContain('  - id: acp')
    expect(seedText).toContain('      - id: antigravity')
    const from = seedText.indexOf('  # The ACP proxy')
    const to = seedText.indexOf('  # Claude Code')
    expect(from).toBeGreaterThan(0)
    await writeFile(file, seedText.slice(0, from) + seedText.slice(to))
    const again = await initDataFolder(fresh, seedDir)
    expect(again.migrated).toEqual(['config/providers.md: added the acp provider (the ACP proxy at http://127.0.0.1:7461/v1, switched off)'])
    expect((await initDataFolder(fresh, seedDir)).migrated).toEqual([])
  })
})

describe('migrateAntigravityClient (SCP-44)', () => {
  const withClient = (models: string[]) => [...OLD_PROVIDERS.slice(0, 8), '  - id: client', '    kind: client', '    enabled: true', '    models:', ...models, ...OLD_PROVIDERS.slice(8)]

  it('adds the antigravity model after claude-code once, and leaves a folder that has it or has no client provider', async () => {
    const dir = await providersFolder(withClient(['      - id: claude-code', '        family: claude', '        context: 200000', '        vision: true']))
    expect((await migrateAntigravityClient(dir)).changes).toEqual(['config/providers.md: added the client/antigravity model (context 1000000)'])
    const file = path.join(dir, 'config', 'providers.md')
    const text = await readFile(file, 'utf8')
    expect(text).toContain('        vision: true\n      # Antigravity CLI as a client')
    expect(text).toContain('      - id: antigravity\n        family: gemini\n        context: 1000000\n        vision: true\n  # my own note about search')
    expect(text).toContain('    enabled: true') // a provider the user switched on stays on
    expect((await migrateAntigravityClient(dir)).changes).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(text)
    const registry = new ModelRegistry(dir, { keys: () => undefined })
    await writeFile(path.join(dir, 'config', 'roles.md'), ['---', 'kind: roles', 'roles: {}', '---', ''].join('\n'))
    await registry.load()
    expect(registry.getModel('client/antigravity')?.context).toBe(1000000)
    expect(registry.getModel('client/claude-code')?.context).toBe(200000)
    const has = await providersFolder(withClient(['      - id: claude-code', '      - id: antigravity', '        context: 5']))
    expect((await migrateAntigravityClient(has)).changes).toEqual([])
    expect((await migrateAntigravityClient(await providersFolder(OLD_PROVIDERS))).changes).toEqual([])
    expect((await migrateAntigravityClient(await tmp())).changes).toEqual([])
  })
})

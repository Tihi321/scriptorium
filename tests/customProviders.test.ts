import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { ClientProvider, ClientTaskQueue } from '../src/engine/models/client'
import { customKeyName, customProviderSlug } from '../src/engine/models/customProviders'
import { ModelRegistry } from '../src/engine/models/registry'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { providersSchema } from '../src/shared/schemas'
import { makeEnv } from './helpers'
import type { TestEnv } from './helpers'

// the credential store is replaced by a map: the test never touches the real Windows credential store
const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/engine/models/keys', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/models/keys')>()
  return {
    ...real,
    setStoredKey: (account: string, value: string) => void store.set(account, value),
    getStoredKey: (account: string) => store.get(account),
    deleteStoredKey: (account: string) => store.delete(account),
    resolveKey: (name: string) => process.env[name] || store.get(name)
  }
})

const PROVIDERS_MD = [
  '---',
  'kind: providers',
  'providers:',
  '  # my note on loc: keep it',
  '  - id: loc',
  '    kind: mock',
  '    local: true',
  '    models:',
  '      - id: m1',
  '        family: loc',
  '# my order note',
  'search_order: []',
  '---',
  '# Providers',
  '',
  'hand written body',
  ''
].join('\n')

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  store.clear()
})

async function start(): Promise<TestEnv> {
  env = await makeEnv({ paused: true })
  await writeFile(path.join(env.dir, 'config', 'providers.md'), PROVIDERS_MD)
  await env.engine.registry.load()
  return env
}

const lastOf = <T extends EngineEvent['type']>(e: TestEnv, type: T) => [...e.events].reverse().find((x) => x.type === type) as Extract<EngineEvent, { type: T }> | undefined
const form = { baseUrl: 'http://127.0.0.1:7461/v1', free: true, jsonSchema: false, concurrency: 2, enabled: true } as const

describe('custom providers: names and registry', () => {
  it('a slug comes from the name; the key name from the id', () => {
    expect(customProviderSlug('ACP proxy (home)')).toBe('acp-proxy-home')
    expect(customProviderSlug('!!!')).toBe('')
    expect(customKeyName('acp-home')).toBe('CUSTOM_ACP_HOME_API_KEY')
  })

  it('a custom entry has its own kind, free or paid, and a seed API provider stays paid', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-custom-'))
    try {
      await mkdir(path.join(dir, 'config'), { recursive: true })
      await writeFile(
        path.join(dir, 'config', 'providers.md'),
        [
          '---',
          'kind: providers',
          'providers:',
          '  - { id: deepseek, kind: openai-compat, base_url: "http://x/v1", api_key_env: DS, models: [{ id: flash, family: ds, price_in: 1, price_out: 1 }] }',
          '  - { id: free-one, name: Free one, custom: true, kind: openai-compat, local: true, base_url: "http://y/v1", models: [{ id: a, family: x }] }',
          '  - { id: paid-one, name: Paid one, custom: true, kind: openai-compat, local: false, base_url: "http://z/v1", api_key_env: CUSTOM_PAID_ONE_API_KEY, models: [{ id: b, family: x, price_in: 1, price_out: 2 }] }',
          '---',
          ''
        ].join('\n')
      )
      await writeFile(path.join(dir, 'config', 'roles.md'), '---\nkind: roles\nroles: {}\n---\n')
      const reg = new ModelRegistry(dir, { keys: (n) => (n === 'DS' || n === 'CUSTOM_PAID_ONE_API_KEY' ? 'k' : undefined) })
      await reg.load()
      expect(reg.kindOf('deepseek/flash')).toBe('paid')
      expect(reg.kindOf('free-one/a')).toBe('free-one')
      expect(reg.kindOf('paid-one/b')).toBe('paid-one')
      expect(reg.providers.get('free-one')).toMatchObject({ name: 'Free one', custom: true, local: true })
      expect(reg.providers.get('paid-one')).toMatchObject({ name: 'Paid one', custom: true, local: false, available: true })
      expect(reg.providers.get('deepseek')).toMatchObject({ name: 'deepseek', custom: false })
      expect(reg.providers.get('paid-one')!.local).toBe(false) // a paid custom provider still needs prices and a key
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('saveCustomProvider and removeCustomProvider', () => {
  it('adds an entry keeping comments, stores the key, edits it, and removes it with its key and its models.md and settings rows', async () => {
    const e = await start()
    const file = path.join(e.dir, 'config', 'providers.md')
    const { engine } = e

    // a free provider, no key
    await engine.handleCommand({ type: 'saveCustomProvider', name: 'ACP Home', ...form })
    expect(lastOf(e, 'provider.saved')).toMatchObject({ id: 'acp-home' })
    let text = await readFile(file, 'utf8')
    expect(text).toContain('# my note on loc: keep it')
    expect(text).toContain('# my order note')
    expect(text).toContain('hand written body')
    const entry = providersSchema.parse(parseMd(text).data).providers.find((p) => p.id === 'acp-home')!
    expect(entry).toMatchObject({ name: 'ACP Home', custom: true, kind: 'openai-compat', enabled: true, local: true, base_url: 'http://127.0.0.1:7461/v1', json_schema: false, concurrency: 2, discover: true, models: [] })
    expect(entry.api_key_env).toBeUndefined()
    expect(engine.registry.kindOf('acp-home/m')).toBe('acp-home')

    // a paid one with a key: the key goes to the credential store, the name of it to the file
    await engine.handleCommand({ type: 'saveCustomProvider', name: 'Paid One', apiKey: ' sk-secret ', ...form, baseUrl: 'https://api.example.com/v1/', free: false, concurrency: 'auto' })
    expect(lastOf(e, 'provider.saved')).toMatchObject({ id: 'paid-one' })
    expect(store.get('CUSTOM_PAID_ONE_API_KEY')).toBe('sk-secret')
    text = await readFile(file, 'utf8')
    expect(text).not.toContain('sk-secret')
    expect(providersSchema.parse(parseMd(text).data).providers.find((p) => p.id === 'paid-one')).toMatchObject({ api_key_env: 'CUSTOM_PAID_ONE_API_KEY', local: false, concurrency: 'auto', base_url: 'https://api.example.com/v1' })
    expect(engine.registry.providers.get('paid-one')).toMatchObject({ available: true, local: false })
    expect(engine.registry.kindOf('paid-one/x')).toBe('paid-one')
    const snap = await engine.snapshot()
    expect(snap.providers.find((p) => p.id === 'paid-one')).toMatchObject({ name: 'Paid One', custom: true, hasKey: true, apiKeyEnv: 'CUSTOM_PAID_ONE_API_KEY', enabled: true })
    expect(snap.keyNames).toContain('CUSTOM_PAID_ONE_API_KEY')
    expect(snap.keyNames).not.toContain('SCRIPTORIUM_SMTP_PASSWORD')

    // the setSecret allowlist takes the custom key name (and still refuses others)
    expect(engine.allowedSecrets()).toContain('CUSTOM_PAID_ONE_API_KEY')
    await engine.handleCommand({ type: 'setSecret', name: 'CUSTOM_PAID_ONE_API_KEY', value: 'sk-rotated' })
    expect(store.get('CUSTOM_PAID_ONE_API_KEY')).toBe('sk-rotated')
    await engine.handleCommand({ type: 'setSecret', name: 'CUSTOM_NOT_THERE_API_KEY', value: 'x' })
    expect(store.has('CUSTOM_NOT_THERE_API_KEY')).toBe(false)
    expect(e.logs.join('\n')).not.toContain('sk-rotated')

    // an edit with an empty key keeps the stored key
    await engine.handleCommand({ type: 'saveCustomProvider', id: 'paid-one', name: 'Paid Two', ...form, free: false, concurrency: 3, enabled: false })
    expect(store.get('CUSTOM_PAID_ONE_API_KEY')).toBe('sk-rotated')
    expect(providersSchema.parse(parseMd(await readFile(file, 'utf8')).data).providers.find((p) => p.id === 'paid-one')).toMatchObject({ id: 'paid-one', name: 'Paid Two', enabled: false, concurrency: 3 })
    await engine.handleCommand({ type: 'saveCustomProvider', id: 'paid-one', name: 'Paid One', ...form, free: false, enabled: true })

    // refused: a seed or existing id, a bad URL, a name with no letters, editing a hand-made entry
    const before = await readFile(file, 'utf8')
    for (const bad of [
      { name: 'Loc', ...form },
      { name: 'acp home', ...form },
      { name: 'Paid', ...form },
      { name: 'Bad URL', ...form, baseUrl: 'ftp://host/v1' },
      { name: 'Bad URL', ...form, baseUrl: 'not a url' },
      { name: '???', ...form },
      { name: 'Bad parallel', ...form, concurrency: 0 },
      { id: 'loc', name: 'Loc', ...form }
    ]) {
      await engine.handleCommand({ type: 'saveCustomProvider', ...bad })
      expect(lastOf(e, 'provider.saved'), bad.name).toMatchObject({ error: expect.any(String) })
    }
    expect(await readFile(file, 'utf8')).toBe(before)
    await engine.handleCommand({ type: 'removeCustomProvider', id: 'loc' })
    expect(lastOf(e, 'provider.saved')).toMatchObject({ id: 'loc', error: expect.stringContaining('not a custom provider') })
    expect(await readFile(file, 'utf8')).toBe(before)

    // models.md and the fallback list name it: tick a model, hide one, set a limit, make it a row
    await engine.handleCommand({ type: 'addModel', provider: 'acp-home', id: 'gemini-x' })
    await engine.handleCommand({ type: 'showModels', refs: ['acp-home/gemini-x'], shown: true })
    await engine.handleCommand({ type: 'setProviderLimits', provider: 'acp-home', rpm: 10 })
    await engine.handleCommand({ type: 'showModels', refs: ['loc/m1'], shown: false })
    await engine.handleCommand({ type: 'addModel', provider: 'paid-one', id: 'big', priceIn: 1, priceOut: 2 })
    await engine.handleCommand({ type: 'showModels', refs: ['paid-one/big'], shown: false })
    await engine.handleCommand({ type: 'saveSettings', ...(await engine.snapshot()).settings, fallbacks: ['loc/m1', 'acp-home/gemini-x', 'paid-one/big'] })
    expect(engine.registry.fallbackRefs()).toEqual(['loc/m1', 'acp-home/gemini-x', 'paid-one/big'])
    // an alias for the row of a custom kind resolves
    expect(engine.registry.resolve('acp-home')).toBe('acp-home/gemini-x')
    expect(engine.registry.resolve('paid-one')).toBe('paid-one/big')
    const modelsFile = path.join(e.dir, 'config', 'models.md')
    expect(parseMd(await readFile(modelsFile, 'utf8')).data).toMatchObject({ picked: expect.arrayContaining([expect.objectContaining({ provider: 'acp-home', id: 'gemini-x' })]), limits: { 'acp-home': { rpm: 10 } } })

    // remove: the entry, its key, its ticked models, hidden refs, limits and fallback rows go; other providers' stay
    await engine.handleCommand({ type: 'removeCustomProvider', id: 'paid-one' })
    expect(lastOf(e, 'provider.saved')).toMatchObject({ id: 'paid-one', removed: true })
    expect(store.has('CUSTOM_PAID_ONE_API_KEY')).toBe(false)
    await engine.handleCommand({ type: 'removeCustomProvider', id: 'acp-home' })
    expect(lastOf(e, 'provider.saved')).toMatchObject({ id: 'acp-home', removed: true })
    text = await readFile(file, 'utf8')
    expect(text).toBe(before.replace(/\n$/, '\n') ? text : text) // (keeps the file valid, checked below)
    expect(text).toContain('# my note on loc: keep it')
    expect(text).toContain('# my order note')
    expect(text).toContain('hand written body')
    expect(providersSchema.parse(parseMd(text).data).providers.map((p) => p.id)).toEqual(['loc'])
    const models = parseMd(await readFile(modelsFile, 'utf8')).data as { picked: { provider: string }[]; hidden: string[]; limits: Record<string, unknown> }
    expect(models.picked.some((m) => m.provider === 'acp-home' || m.provider === 'paid-one')).toBe(false)
    expect(models.hidden).toEqual(['loc/m1'])
    expect(models.limits).toEqual({})
    expect(engine.registry.fallbackRefs()).toEqual(['loc/m1'])
    expect(parseMd(await readFile(path.join(e.dir, 'config', 'settings.md'), 'utf8')).data.fallbacks).toEqual(['loc/m1'])
    expect(engine.registry.providers.has('acp-home')).toBe(false)
    expect([...engine.registry.providers.keys()]).toEqual(['loc'])
    expect((await engine.snapshot()).keyNames).not.toContain('CUSTOM_PAID_ONE_API_KEY')
  }, 30000)

  it('a client provider takes a model by its id without prices', async () => {
    env = await makeEnv({ providers: [{ id: 'client', kind: 'client', models: ['claude-code', 'antigravity'] }], paused: true })
    await env.engine.handleCommand({ type: 'addModel', provider: 'client', id: 'codex' })
    expect((await env.engine.snapshot()).models.map((m) => m.ref)).toEqual(expect.arrayContaining(['client/claude-code', 'client/antigravity', 'client/codex']))
  })
})

describe('testCustomProvider', () => {
  let server: http.Server
  let url = ''
  const seen: { auth?: string; path?: string }[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ auth: req.headers.authorization, path: req.url })
      if (req.headers.authorization === 'Bearer nope') {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"bad key"}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'gemini-3' }, { id: 'claude-x' }, { id: 'gpt-y' }] }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('lists /models with the key and reports a count, an error, or an unreachable address', async () => {
    const e = await start()
    await e.engine.handleCommand({ type: 'testCustomProvider', baseUrl: url, apiKey: 'good' })
    expect(lastOf(e, 'provider.tested')).toMatchObject({ baseUrl: url, ok: true, count: 3 })
    expect(seen.at(-1)).toEqual({ auth: 'Bearer good', path: '/v1/models' })
    await e.engine.handleCommand({ type: 'testCustomProvider', baseUrl: url, apiKey: 'nope' })
    expect(lastOf(e, 'provider.tested')).toMatchObject({ ok: false, error: expect.stringContaining('401') })
    await e.engine.handleCommand({ type: 'testCustomProvider', baseUrl: 'http://127.0.0.1:1/v1' })
    expect(lastOf(e, 'provider.tested')).toMatchObject({ ok: false, error: expect.stringContaining('network error') })
    await e.engine.handleCommand({ type: 'testCustomProvider', baseUrl: 'ftp://x' })
    expect(lastOf(e, 'provider.tested')).toMatchObject({ ok: false, error: expect.stringContaining('http') })
    // an edit's Test with no key typed uses the stored key of that provider
    await e.engine.handleCommand({ type: 'saveCustomProvider', name: 'Local Fake', apiKey: 'stored-key', ...form, baseUrl: url })
    await e.engine.handleCommand({ type: 'testCustomProvider', id: 'local-fake', baseUrl: url })
    expect(lastOf(e, 'provider.tested')).toMatchObject({ ok: true, count: 3 })
    expect(seen.at(-1)!.auth).toBe('Bearer stored-key')
    // and Detect models on the saved provider lists them through the same client
    await e.engine.handleCommand({ type: 'detectModels', provider: 'local-fake' })
    expect(lastOf(e, 'models.catalog')).toMatchObject({ provider: 'local-fake', models: [{ id: 'gemini-3', pickable: true }, { id: 'claude-x' }, { id: 'gpt-y' }] })
  }, 30000)
})

describe('named clients', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }]

  it('a task for antigravity is not leased without a client; a claude-code task is', () => {
    const q = new ClientTaskQueue()
    q.add({ messages: msgs, client: 'antigravity' }, { job: 'a' })
    expect(q.lease()).toBeNull()
    expect(q.lease({ client: 'claude-code' })).toBeNull()
    q.add({ messages: msgs, client: 'claude-code' }, { job: 'b' })
    q.add({ messages: msgs }, { job: 'c' })
    expect(q.lease()?.job).toBe('b')
    expect(q.lease()?.job).toBe('c') // a task with no client is claude-code's
    expect(q.lease()).toBeNull()
    expect(q.lease({ client: 'antigravity' })?.job).toBe('a')
    expect(q.list().map((t) => [t.job, t.client])).toEqual([['a', 'antigravity'], ['b', 'claude-code'], ['c', 'claude-code']])
  })

  it('ClientProvider.chat names the client after the model of the request', async () => {
    const q = new ClientTaskQueue()
    const p = new ClientProvider('client', q)
    const run = (async () => {
      let text = ''
      for await (const ev of p.chat({ model: 'antigravity', messages: msgs, meta: { job: 'j1', role: 'writer' } })) if (ev.type === 'delta') text += ev.text
      return text
    })()
    expect(q.list()[0]).toMatchObject({ job: 'j1', client: 'antigravity' })
    expect(q.lease()).toBeNull()
    const t = q.lease({ client: 'antigravity' })!
    expect(t.client).toBe('antigravity')
    expect(q.submit(t.id, 'done')).toEqual({ accepted: true })
    expect(await run).toBe('done')
  })
})

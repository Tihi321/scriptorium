import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientTaskQueue } from '../src/engine/models/client'
import { ModelRegistry } from '../src/engine/models/registry'
import { humanizeProblem, newNames, numberTokens } from '../src/engine/pipeline/humanizerHandlers'
import { ClientSearchProvider } from '../src/engine/research/clientSearch'
import { SearchService } from '../src/engine/research/service'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { migrateClientSearch } from '../src/engine/store/migrations'
import { parseMd } from '../src/shared/md'
import { providersSchema } from '../src/shared/schemas'
import { seedDir, sleep, waitFor } from './helpers'

const dirs: string[] = []
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'scrip-cs-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const answer = (n: number) =>
  JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ title: `Page ${i}`, url: `https://example.org/p${i}`, content: `Excerpt ${i}: the harbour handled 1,200 ships in 2024.`, published: '2026-10-14' })) })

describe('client web search: a task for the MCP client', () => {
  it('a query is a searcher task; the client answers it and the results come back as notes material', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientSearchProvider({ queue, waitMs: 60_000 })
    const pending = provider.search('Port of Split ship traffic', { limit: 2, news: true, days: 3, book: 'b1', agent: 'noor' })
    const listed = await waitFor(() => (queue.list().length ? queue.list() : null))
    expect(listed[0]).toMatchObject({ role: 'searcher', task: 'web_search', book: 'b1', agent: 'noor', unit: 'Port of Split ship traffic', state: 'waiting' })
    const t = queue.lease({ role: 'searcher' })!
    expect(t.schema).toBeTruthy()
    const text = t.messages.map((m) => m.content).join('\n')
    expect(text).toMatch(/Port of Split ship traffic/)
    expect(text).toMatch(/search the web yourself/i)
    expect(text).toMatch(/up to 2 results/)
    expect(text).toMatch(/last 3 days/)
    expect(text).toMatch(/1500 characters/)
    expect(queue.state(t.id)).toBe('leased')
    expect(queue.submit(t.id, answer(3)).accepted).toBe(true)
    const results = await pending
    expect(results).toHaveLength(2) // the limit
    expect(results[0]).toMatchObject({ url: 'https://example.org/p0', content: expect.stringContaining('1,200 ships') })
    expect(results[0]!.title).toContain('2026-10-14')
    expect(queue.state(t.id)).toBe('gone')
  })

  it('the submit schema refuses a bad answer, which stays leased, and the fixed one is taken', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientSearchProvider({ queue, waitMs: 60_000 })
    const pending = provider.search('q')
    const t = (await waitFor(() => queue.lease({ role: 'searcher' })))!
    for (const bad of ['no json at all', '{"results": "x"}', '{"results":[{"title":"t","url":"https://a.org"}]}', '{"results":[{"title":"t","url":"not a url","content":"c"}]}', '{}']) {
      const res = queue.submit(t.id, bad)
      expect(res.accepted, bad).toBe(false)
    }
    expect(queue.state(t.id)).toBe('leased')
    expect(queue.submit(t.id, JSON.stringify({ results: [] })).accepted).toBe(true) // nothing found is a valid answer
    expect(await pending).toEqual([])
  })

  it('a task nobody takes ends in a timeout, the next provider is used, and the task is gone', async () => {
    const queue = new ClientTaskQueue()
    const logs: string[] = []
    const client = new ClientSearchProvider({ id: 'client-search', queue, waitMs: 80 })
    const calls: string[] = []
    const next = { id: 'wikipedia', pricePerRequest: 0, search: async () => (calls.push('next'), [{ title: 'W', url: 'https://w.org/x', snippet: 's', content: 'c' }]) }
    const svc = new SearchService({ registry: undefined as unknown as ModelRegistry, providers: [client, next], log: (m) => logs.push(m) })
    const out = await svc.search('anything', { book: 'b1' })
    expect(out?.provider).toBe('wikipedia')
    expect(calls).toEqual(['next'])
    expect(logs.join('\n')).toMatch(/client-search failed: no client took the web search task/)
    expect(queue.list()).toEqual([])
  })

  it('a task a client has taken is waited for past the wait time, and a released one times out', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientSearchProvider({ queue, waitMs: 100 })
    const pending = provider.search('q')
    const t = (await waitFor(() => queue.lease({ role: 'searcher' })))!
    await sleep(350) // more than three wait times, but the task is leased
    expect(queue.state(t.id)).toBe('leased')
    expect(queue.submit(t.id, answer(1)).accepted).toBe(true)
    expect(await pending).toHaveLength(1)
    const second = provider.search('q2')
    const t2 = (await waitFor(() => queue.lease({ role: 'searcher' })))!
    queue.release(t2.id)
    await expect(second).rejects.toThrow(/no client took/)
  })

  it('an abort drops the task', async () => {
    const queue = new ClientTaskQueue()
    const provider = new ClientSearchProvider({ queue, waitMs: 60_000 })
    const ac = new AbortController()
    const pending = provider.search('q', { signal: ac.signal })
    await waitFor(() => queue.list().length)
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.list()).toEqual([])
  })

  it('the provider from providers.md uses the engine queue and wait_minutes, ahead of wikipedia', async () => {
    const dir = await tmp()
    await initDataFolder(dir, seedDir)
    const file = path.join(dir, 'config', 'providers.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('wait_minutes: 10', 'wait_minutes: 0.002'))
    const queue = new ClientTaskQueue()
    const registry = new ModelRegistry(dir, { keys: () => undefined, clientQueue: queue })
    await registry.load()
    expect(registry.searchOrder.slice(0, 3)).toEqual(['tavily', 'client-search', 'wikipedia'])
    const svc = new SearchService({ registry, clientQueue: queue })
    expect(svc.providers().map((p) => p.id)).toEqual(['client-search', 'wikipedia']) // tavily has no key
    // answered by a client
    const pending = svc.search('q', { book: 'bk' })
    const t = (await waitFor(() => queue.lease({ role: 'searcher', book: 'bk' })))!
    queue.submit(t.id, answer(1))
    expect((await pending)?.provider).toBe('client-search')
    // not taken: 0.002 minutes is 120 ms, then Wikipedia gets the question
    const fetched: string[] = []
    const fetchImpl = (async (url: string) => {
      fetched.push(String(url))
      return new Response(JSON.stringify({ query: { search: [] } }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const svc2 = new SearchService({ registry, clientQueue: queue, fetchImpl })
    expect(await svc2.search('nothing here')).toBeNull()
    expect(fetched.length).toBeGreaterThan(0) // the next provider was asked
    expect(queue.list()).toEqual([])
  })
})

const OLD_PROVIDERS = [
  '---',
  'kind: providers',
  'providers:',
  '  - id: client',
  '    kind: client',
  '    enabled: false',
  '    models:',
  '      - id: claude-code',
  '        context: 200000',
  '  - id: tavily',
  '    kind: search',
  '    engine: tavily',
  '    api_key_env: TAVILY_API_KEY',
  '  - id: wikipedia',
  '    kind: search',
  '    engine: wikipedia',
  '  - id: brave',
  '    kind: search',
  '    engine: brave',
  '    enabled: false',
  '# my own order',
  'search_order: [tavily, wikipedia, brave]',
  '---',
  '# Providers',
  ''
]

async function oldFolder(eol: string, order = 'search_order: [tavily, wikipedia, brave]') {
  const dir = await tmp()
  await initDataFolder(dir, seedDir)
  const text = OLD_PROVIDERS.map((l) => (l.startsWith('search_order') ? order : l)).join(eol)
  await writeFile(path.join(dir, 'config', 'providers.md'), text)
  return { dir, text, file: path.join(dir, 'config', 'providers.md') }
}

describe('migration: the client search provider for an existing data folder', () => {
  it('adds the entry and the search_order slot after tavily, keeps everything else, and does it once', async () => {
    const { dir, text, file } = await oldFolder('\n')
    const first = await initDataFolder(dir, seedDir)
    expect(first.migrated).toEqual([expect.stringMatching(/providers\.md: added the client web search provider.*search_order after tavily/)])
    const after = await readFile(file, 'utf8')
    const parsed = providersSchema.parse(parseMd(after).data)
    expect(parsed.search_order).toEqual(['tavily', 'client-search', 'wikipedia', 'brave'])
    expect(parsed.providers.find((p) => p.id === 'client-search')).toMatchObject({ kind: 'search', engine: 'client', enabled: true, wait_minutes: 10 })
    expect(parsed.providers.map((p) => p.id)).toEqual(['client', 'tavily', 'wikipedia', 'brave', 'client-search'])
    expect(after).toContain('# my own order')
    expect(after.startsWith(text.slice(0, text.indexOf('# my own order')))).toBe(true)
    const second = await initDataFolder(dir, seedDir)
    expect(second.migrated).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(after)
  })

  it('puts it first without tavily, keeps CRLF, and leaves a folder with its own entry, a fresh folder and an empty folder alone', async () => {
    const crlf = await oldFolder('\r\n', 'search_order: [wikipedia, brave]')
    expect((await migrateClientSearch(crlf.dir)).changes).toHaveLength(1)
    const text = await readFile(crlf.file, 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(providersSchema.parse(parseMd(text).data).search_order).toEqual(['client-search', 'wikipedia', 'brave'])
    expect((await migrateClientSearch(crlf.dir)).changes).toEqual([])
    // a search_order in another notation is left, the provider is still added
    const block = await oldFolder('\n', 'search_order:\n  - tavily')
    expect((await migrateClientSearch(block.dir)).changes).toHaveLength(1)
    expect(providersSchema.parse(parseMd(await readFile(block.file, 'utf8')).data).search_order).toEqual(['tavily'])
    // the seed has it already
    const fresh = await tmp()
    expect((await initDataFolder(fresh, seedDir)).migrated).toEqual([])
    // the owner's own entry of the engine is theirs
    const own = await oldFolder('\n')
    await writeFile(own.file, own.text.replace('  - id: brave', '  - id: mine\n    kind: search\n    engine: client\n  - id: brave'))
    expect((await migrateClientSearch(own.dir)).changes).toEqual([])
    expect((await migrateClientSearch(await tmp())).changes).toEqual([])
  })
})

describe('humanizer guards (SCP-13)', () => {
  const body = (extra = '') =>
    `Mara knelt by the window in Split and counted the flowerpots, all 7 of them. The key lay under the third flowerpot, just as Bram had said in 1998. "I shall not go," said Mr Voss. ${extra} ` +
    'The harbour was quiet and the lamps burned low while the night went on and on, slow and grey and patient, for another long hour or so before the first boat.'
  const bible = '## Characters\n### Mara Quill\n### Mr Voss\n### Bram Holt\n## Places\n### Split\n'

  it('a clean rewrite passes: other words, same dashes, numbers and names (sentence openers are not names)', () => {
    const revised = body().replace('knelt by the window', 'crouched at the sill').replace('The harbour was quiet', 'Quiet filled the harbour')
    expect(humanizeProblem(body(), revised, { bible })).toBeNull()
    expect(humanizeProblem(body(), `Then ${revised}`, { bible })).toBeNull()
  })

  it('refuses more em dashes than the original, and lets the same number stay', () => {
    expect(humanizeProblem(body(), body().replace('the lamps burned low while', 'the lamps — burned low — while'), { bible })).toMatch(/em dashes \(0 before, 2 after\)/)
    const withDash = body('She waited — and waited.')
    expect(humanizeProblem(withDash, withDash.replace('lamps', 'lanterns'), { bible })).toBeNull()
    expect(humanizeProblem(withDash, withDash.replace('waited — and', 'waited, and'), { bible })).toBeNull() // fewer is fine
  })

  it('refuses a number or a year that is dropped, changed or added', () => {
    expect(humanizeProblem(body(), body().replace('1998', '1999'), { bible })).toMatch(/numbers changed \(lost 1998, added 1999\)/)
    expect(humanizeProblem(body(), body().replace(', all 7 of them', ''), { bible })).toMatch(/lost 7/)
    expect(humanizeProblem(body(), body().replace('the first boat', 'the first of 3 boats'), { bible })).toMatch(/added 3/)
    expect(numberTokens('about 1,200 ships, 2.5 times in 2024 [3]')).toEqual(new Set(['1,200', '2.5', '2024']))
  })

  it('refuses a capitalised name that is neither in the chapter nor the bible, and accepts the bible names', () => {
    expect(humanizeProblem(body(), body().replace('Bram had said', 'Dolores had said'), { bible })).toMatch(/name.*Dolores/)
    expect(humanizeProblem(body(), body().replace('in Split', 'in Zagreb'), { bible })).toMatch(/Zagreb/)
    // a name of the bible that the chapter did not use is allowed
    expect(humanizeProblem(body(), body().replace('Bram had said', 'Quill had said'), { bible })).toBeNull()
    expect(humanizeProblem(body(), body().replace('Bram had said', 'Quill had said'))).toMatch(/Quill/) // without the bible it is new
  })

  it('newNames skips sentence starts, quotations and "I", and strips possessives', () => {
    expect(newNames('Rain fell. "Well," said Tom. I saw Tom\'s dog. Then Rourke came.', 'Tom dog saw said well rain fell then came')).toEqual(['Rourke'])
    expect(newNames('Captain Rourke came.', 'came')).toEqual(['Rourke'])
    expect(newNames('He met Ana-Marija at Easter.', 'He met ana-marija')).toEqual(['Easter'])
  })
})

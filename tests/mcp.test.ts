import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpConfig, startMcpServer } from '../src/engine/mcp/server'
import type { McpHandle } from '../src/engine/mcp/server'
import { writeMd } from '../src/engine/store/atomic'
import { acquireEngineLock } from '../src/engine/store/dataFolder'
import { parseMd } from '../src/shared/md'
import { makeEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
let mcp: McpHandle | null = null
const clients: Client[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined)
  await mcp?.close()
  mcp = null
  await env?.cleanup()
  env = undefined
})

async function start(token?: string) {
  env = await makeEnv({ paused: true })
  mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: (m) => env!.logs.push(m), token })
  expect(mcp).not.toBeNull()
  return mcp!
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined))
  clients.push(client)
  return client
}

/** Calls a tool and parses its JSON text (or returns the plain error text). */
async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] }
  const raw = r.content[0]!.text
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    /* plain text */
  }
  return { isError: r.isError === true, data: data as any, raw } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A raw request, so the Host header can be chosen. */
function rawRequest(url: string, headers: Record<string, string>, body = '{}'): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function makeBook(e: TestEnv, slug = 'demo-book', stage = 'published') {
  await e.engine.books.create(slug, { title: 'Demo Book', stage, format: 'novel', target_words: 5000 }, '')
  await writeFile(e.engine.books.file(slug, 'pitch.md'), '---\nkind: pitch\n---\nA pitch about a bell.\n')
  await e.engine.books.writeChapter(slug, { n: 1, title: 'The Bell', round: 0, body: 'It rang once.' })
}

describe('MCP server', () => {
  it('lists the tools, and none of the ones that are not exposed', async () => {
    const h = await start()
    const c = await connect(h.url)
    const names = (await c.listTools()).tools.map((t) => t.name)
    for (const n of ['factory_status', 'list_books', 'get_book', 'read_book_file', 'list_stories', 'get_story', 'add_story', 'update_story', 'list_series', 'get_series', 'add_series', 'update_series', 'adapt_book', 'add_book_note', 'set_factory_paused', 'hire_agent', 'set_model', 'assign_agent', 'retry_book', 'reopen_book', 'list_client_tasks', 'get_client_task', 'submit_client_task', 'release_client_task', 'wait_for_book', 'get_script', 'get_screenplay', 'build_vn_pack', 'get_vn_pack', 'refresh_factbase']) {
      expect(names).toContain(n)
    }
    for (const n of ['set_secret', 'send_to_kindle', 'save_settings', 'stop_now', 'detect_models']) expect(names).not.toContain(n)
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('adds, lists, reads and updates a story', async () => {
    const h = await start()
    const c = await connect(h.url)
    const added = await call(c, 'add_story', {
      title: 'The Bell',
      premise: 'A bell under the sea.',
      characters: [{ name: 'Mara', role: 'hero', description: 'Freckled.' }],
      sections: [{ heading: 'Themes', text: 'Loss.' }]
    })
    expect(added.isError).toBe(false)
    expect(added.data.slug).toBe('the-bell')
    expect(added.data.file).toBe('ideas/the-bell.md')
    const list = await call(c, 'list_stories')
    expect(list.data.map((s: { slug: string }) => s.slug)).toEqual(['the-bell'])
    const got = await call(c, 'get_story', { story: 'the-bell' })
    expect(got.data.brief.characters[0].name).toBe('Mara')
    expect(got.data.titleFixed).toBe(true)
    // merge: add a character, keep the rest
    const upd = await call(c, 'update_story', { story: 'the-bell', add_characters: [{ name: 'Bram', role: 'fisherman' }], plot: 'She follows a map.' })
    expect(upd.isError).toBe(false)
    expect(upd.data.story.brief.characters.map((x: { name: string }) => x.name)).toEqual(['Mara', 'Bram'])
    expect(upd.data.story.brief.premise).toBe('A bell under the sea.')
    expect(upd.data.story.brief.plot).toBe('She follows a map.')
    // bad input is a tool error, not a crash
    expect((await call(c, 'add_story', {})).isError).toBe(true)
    expect((await call(c, 'add_story', { title: 'X', format: 'no-such-format' })).raw).toMatch(/unknown format/)
    expect((await call(c, 'add_story', { title: 'X', topic: 'no-such-topic' })).raw).toMatch(/unknown topic/)
    expect((await call(c, 'update_story', { story: 'nope', plot: 'x' })).raw).toMatch(/no story/)
  })

  it('makes a series, adds numbered books to it, and shows the books with stage and score', async () => {
    const h = await start()
    const c = await connect(h.url)
    expect((await call(c, 'list_series')).data).toEqual([])
    expect((await call(c, 'add_series', { title: ' ' })).isError).toBe(true)
    expect((await call(c, 'add_series', { title: 'X', format: 'no-such-format' })).raw).toMatch(/unknown format/)
    const added = await call(c, 'add_series', {
      title: 'The Ninth Hour',
      premise: 'A fraternity hides behind Paris.',
      characters: [{ name: 'Dec', role: 'locksmith' }],
      setting: 'Paris',
      style: 'Comic',
      genre: 'Mystery'
    })
    expect(added.isError).toBe(false)
    expect(added.data).toMatchObject({ slug: 'the-ninth-hour', file: 'series/the-ninth-hour.md' })
    expect((await readFile(path.join(env!.dir, 'series', 'the-ninth-hour.md'), 'utf8'))).toContain('kind: series')

    // an unknown series is a tool error; books are numbered in the order they are added
    expect((await call(c, 'add_story', { title: 'Lost', series: 'nope' })).raw).toMatch(/unknown series/)
    const one = await call(c, 'add_story', { title: 'Case One', premise: 'x', series: 'the-ninth-hour' })
    const two = await call(c, 'add_story', { title: 'Case Two', premise: 'y', series: 'the-ninth-hour' })
    expect(one.isError).toBe(false)
    expect(one.data.story).toMatchObject({ series: 'the-ninth-hour', seriesIndex: 1 })
    expect(two.data.story).toMatchObject({ series: 'the-ninth-hour', seriesIndex: 2 })
    // a started book of the series counts, and shows its stage and score
    await env!.engine.books.create('case-zero', { title: 'Case Zero', stage: 'published', format: 'novel', target_words: 5000, series: 'the-ninth-hour', series_index: 3, score: 8.5 }, '')
    const three = await call(c, 'add_story', { title: 'Case Three', premise: 'z', series: 'the-ninth-hour' })
    expect(three.data.story.seriesIndex).toBe(4)

    const got = await call(c, 'get_series', { series: 'the-ninth-hour' })
    expect(got.data).toMatchObject({ slug: 'the-ninth-hour', title: 'The Ninth Hour', genre: 'Mystery' })
    expect(got.data.brief.characters[0].name).toBe('Dec')
    expect(got.data.books.map((b: { slug: string; index: number; kind: string; stage: string; score: number | null }) => [b.slug, b.index, b.kind, b.stage, b.score])).toEqual([
      ['case-one', 1, 'story', 'story', null],
      ['case-two', 2, 'story', 'story', null],
      ['case-zero', 3, 'book', 'published', 8.5],
      ['case-three', 4, 'story', 'story', null]
    ])
    expect((await call(c, 'list_series')).data[0]).toMatchObject({ slug: 'the-ninth-hour', books: [{ slug: 'case-one' }, { slug: 'case-two' }, { slug: 'case-zero', score: 8.5 }, { slug: 'case-three' }] })
    expect((await call(c, 'get_series', { series: 'nope' })).raw).toMatch(/no series/)
    expect((await call(c, 'list_stories')).data.find((s: { slug: string }) => s.slug === 'case-two')).toMatchObject({ series: 'the-ninth-hour', seriesIndex: 2 })

    // update: merge the cast, keep the rest
    const upd = await call(c, 'update_series', { series: 'the-ninth-hour', add_characters: [{ name: 'Ines', role: 'restorer' }], premise: 'New arc.' })
    expect(upd.isError).toBe(false)
    expect(upd.data.series.brief.characters.map((x: { name: string }) => x.name)).toEqual(['Dec', 'Ines'])
    expect(upd.data.series.brief).toMatchObject({ premise: 'New arc.', setting: 'Paris', style: 'Comic' })
    expect(upd.data.series.books).toHaveLength(4)
    expect((await call(c, 'update_series', { series: 'nope', premise: 'x' })).raw).toMatch(/no series/)

    // update_story moves a story to a series (renumbered) and out of it
    const solo = await call(c, 'add_story', { title: 'Solo', premise: 's' })
    expect(solo.data.story.series).toBeUndefined()
    const moved = await call(c, 'update_story', { story: 'solo', series: 'the-ninth-hour' })
    expect(moved.data.story).toMatchObject({ series: 'the-ninth-hour', seriesIndex: 5 })
    const out = await call(c, 'update_story', { story: 'solo', series: '' })
    expect(out.data.story.series).toBeUndefined()
    expect((await call(c, 'update_story', { story: 'solo', series: 'nope' })).raw).toMatch(/unknown series/)
  })

  it('refuses to update a used story', async () => {
    const h = await start()
    const c = await connect(h.url)
    const added = await call(c, 'add_story', { title: 'Used One', premise: 'x' })
    const idea = (await env!.engine.ideas.list()).find((i) => i.slug === added.data.slug)!
    await env!.engine.ideas.markUsed(idea, 'some-book')
    const r = await call(c, 'update_story', { story: 'used-one', plot: 'new' })
    expect(r.isError).toBe(true)
    expect(r.raw).toMatch(/already used/)
    expect((await call(c, 'list_stories')).data).toEqual([])
    expect((await call(c, 'list_stories', { status: 'used' })).data.map((s: { slug: string }) => s.slug)).toEqual(['used-one'])
  })

  it('reports the factory status and the books', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!)
    const st = await call(c, 'factory_status')
    expect(st.data.paused).toBe(true)
    expect(st.data.booksByStage).toEqual({ published: 1 })
    expect(st.data.spend.dailyCap).toBeGreaterThan(0)
    const rows = await call(c, 'list_books')
    expect(rows.data[0]).toMatchObject({ slug: 'demo-book', stage: 'published', chaptersWritten: 1, words: 3 })
    expect((await call(c, 'list_books', { stage: 'failed' })).data).toEqual([])
    const book = await call(c, 'get_book', { book: 'demo-book' })
    expect(book.data.title).toBe('Demo Book')
    expect(book.data).not.toHaveProperty('readerPages')
    expect(book.data).toHaveProperty('brief')
    expect((await call(c, 'get_book', { book: 'missing' })).isError).toBe(true)
  })

  it('reads book files, and only inside the book folder', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!)
    expect((await call(c, 'read_book_file', { book: 'demo-book', file: 'pitch' })).raw).toContain('A pitch about a bell.')
    expect((await call(c, 'read_book_file', { book: 'demo-book', file: 'chapter', chapter: 1 })).raw).toContain('It rang once.')
    expect((await call(c, 'read_book_file', { book: 'demo-book', file: 'chapter', chapter: 9 })).isError).toBe(true)
    expect((await call(c, 'read_book_file', { book: 'demo-book', file: 'chapter' })).isError).toBe(true)
    expect((await call(c, 'read_book_file', { book: 'demo-book', file: 'outline' })).raw).toMatch(/no outline yet/)
    // a long book's bible is the files under bible/ one after the other
    await mkdir(env!.engine.books.file('demo-book', 'bible', 'characters'), { recursive: true })
    await writeFile(env!.engine.books.file('demo-book', 'bible', 'characters', 'mara.md'), '---\nkind: character\nname: Mara\n---\nMara is twelve.\n')
    await writeFile(env!.engine.books.file('demo-book', 'bible', 'style.md'), '---\nkind: style\n---\nSalty.\n')
    const bible = await call(c, 'read_book_file', { book: 'demo-book', file: 'bible' })
    expect(bible.raw).toContain('Mara is twelve.')
    expect(bible.raw).toContain('Salty.')
    // paths that leave the book
    for (const book of ['../ideas', '..', 'a/b', 'a\\b', '/etc', 'C:\\x', '']) {
      const r = await call(c, 'read_book_file', { book, file: 'pitch' })
      expect(r.isError).toBe(true)
    }
    await writeFile(path.join(env!.dir, 'secret.md'), 'top secret')
    expect((await call(c, 'read_book_file', { book: '../', file: 'pitch' })).raw).not.toContain('top secret')
  })

  it('checks input before commands and returns fresh state', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!)
    await makeBook(env!, 'running-book', 'drafting')
    const paused = await call(c, 'set_book_paused', { book: 'demo-book', paused: true })
    expect(paused.data.paused).toBe(true)
    expect((await call(c, 'add_book_note', { book: 'demo-book', text: 'More salt.', chapter: 1 })).data.notes).toContain('More salt.')
    expect((await call(c, 'add_book_note', { book: 'demo-book', text: 'x', chapter: 7 })).isError).toBe(true)
    expect((await call(c, 'add_book_note', { book: 'demo-book', text: 'x', rewrite: true })).isError).toBe(true)
    expect((await call(c, 'rate_book', { book: 'demo-book', rating: 4, note: 'good' })).data.rating).toBe(4)
    expect((await call(c, 'rate_book', { book: 'demo-book', rating: 9 })).isError).toBe(true)
    expect((await call(c, 'retry_book', { book: 'demo-book' })).raw).toMatch(/not a failed book/)
    expect((await call(c, 'rename_book', { book: 'running-book', title: 'New' })).raw).toMatch(/not published/)
    expect((await call(c, 'hire_agent', { role: 'no-such-role' })).raw).toMatch(/unknown role/)
    const hired = await call(c, 'hire_agent', { role: 'writer', name: 'Wren' })
    expect(hired.data[0].role).toBe('writer')
    expect((await call(c, 'list_agents')).data.map((a: { id: string }) => a.id)).toContain(hired.data[0].id)
    expect((await call(c, 'assign_agent', { agent: hired.data[0].id, book: 'demo-book' })).raw).toMatch(/not a book in progress/)
    expect((await call(c, 'assign_agent', { agent: hired.data[0].id, book: 'running-book' })).data.pin).toBe('running-book')
    expect((await call(c, 'set_agent_paused', { agent: hired.data[0].id, paused: true })).data.paused).toBe(true)
    expect((await call(c, 'set_model', { model: 'nope/nope', agent: hired.data[0].id })).raw).toMatch(/unknown model/)
    expect((await call(c, 'set_model', { model: null })).raw).toMatch(/exactly one/)
    expect((await call(c, 'fire_agent', { agent: 'nobody' })).isError).toBe(true)
    expect((await call(c, 'set_factory_paused', { paused: false })).data.paused).toBe(false)
    const topic = await call(c, 'add_topic', { name: 'Sea tales', kind: 'fiction' })
    expect(topic.data[0].name).toBe('Sea tales')
    expect((await call(c, 'set_topic_active', { id: 'no-such', active: true })).isError).toBe(true)
    expect((await call(c, 'set_topic_active', { id: topic.data[0].id, active: false })).data[0].active).toBe(false)
  })

  it('needs the bearer token when one is set', async () => {
    const h = await start('s3cret')
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    const host = new URL(h.url).host
    expect(await rawRequest(h.url, { host }, init)).toBe(401)
    expect(await rawRequest(h.url, { host, authorization: 'Bearer wrong' }, init)).toBe(401)
    expect(await rawRequest(h.url, { host, authorization: 'Bearer s3cret' }, init)).toBe(200)
    await expect(connect(h.url)).rejects.toThrow()
    const c = await connect(h.url, 's3cret')
    expect((await c.listTools()).tools.length).toBeGreaterThan(10)
  })

  it('refuses a foreign Host or Origin, and other paths', async () => {
    const h = await start()
    const port = String(h.port)
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    expect(await rawRequest(h.url, { host: `evil.example:${port}` }, init)).toBe(403)
    expect(await rawRequest(h.url, { host: '127.0.0.1' }, init)).toBe(403)
    expect(await rawRequest(h.url, { host: `127.0.0.1:${port}`, origin: 'http://evil.example' }, init)).toBe(403)
    expect(await rawRequest(h.url, { host: `localhost:${port}`, origin: `http://localhost:${port}` }, init)).toBe(200)
    expect(await rawRequest(h.url.replace('/mcp', '/other'), { host: `127.0.0.1:${port}` }, init)).toBe(404)
  })

  it('warns and goes on when the port is taken, and keeps the host on loopback', async () => {
    const h = await start()
    const second = await startMcpServer({ engine: env!.engine, config: { enabled: true, host: '127.0.0.1', port: h.port, tokenEnv: 'X' }, log: () => undefined })
    expect(second).toBeNull()
    expect(env!.events.some((e) => e.type === 'engine.warning' && /already in use/.test(e.message))).toBe(true)
    const lan = await startMcpServer({ engine: env!.engine, config: { enabled: true, host: '0.0.0.0', port: 0, tokenEnv: 'X' }, log: (m) => env!.logs.push(m) })
    expect(lan!.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(env!.logs.some((m) => /not a loopback address/.test(m))).toBe(true)
    await lan!.close()
  })

  it('reads config/mcp.md and the flags', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-mcpcfg-'))
    try {
      expect(await loadMcpConfig(dir, [], () => undefined)).toEqual({ enabled: true, host: '127.0.0.1', port: 7341, tokenEnv: 'SCRIPTORIUM_MCP_TOKEN' })
      await mkdir(path.join(dir, 'config'))
      await writeFile(path.join(dir, 'config', 'mcp.md'), '---\nkind: mcp\nenabled: false\nport: 7400\ntoken_env: MY_TOKEN\n---\ntext\n')
      expect(await loadMcpConfig(dir, [], () => undefined)).toMatchObject({ enabled: false, port: 7400, tokenEnv: 'MY_TOKEN' })
      expect((await loadMcpConfig(dir, ['--mcp', '--mcp-port', '0'], () => undefined))).toMatchObject({ enabled: true, port: 0 })
      expect((await loadMcpConfig(dir, ['--mcp', '--no-mcp'], () => undefined)).enabled).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the snapshot carries the MCP url once it is set', async () => {
    const h = await start()
    expect((await env!.engine.snapshot()).mcp).toBeNull()
    env!.engine.setMcpUrl(h.url)
    expect((await env!.engine.snapshot()).mcp).toEqual({ url: h.url })
    expect(env!.events.some((e) => e.type === 'mcp.updated')).toBe(true)
  })
})

describe('engine lock', () => {
  it('refuses a second engine on a folder while the first one lives, and replaces a stale lock', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-lock-'))
    try {
      await mkdir(path.join(dir, 'index'))
      // a live process that is not this one: the parent process
      const other = process.ppid
      await writeFile(path.join(dir, 'index', 'engine.lock'), JSON.stringify({ pid: other, started: 'earlier' }))
      await expect(acquireEngineLock(dir)).rejects.toThrow(new RegExp(`pid ${other}`))
      // a live pid from a lock written before the last boot: another process got the pid, so the lock is stale
      await writeFile(path.join(dir, 'index', 'engine.lock'), JSON.stringify({ pid: other, started: new Date(Date.now() - os.uptime() * 1000 - 60_000).toISOString() }))
      await (await acquireEngineLock(dir)).release()
      // a pid that is not running: replaced
      await writeFile(path.join(dir, 'index', 'engine.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, started: 'earlier' }))
      const lock = await acquireEngineLock(dir)
      expect(JSON.parse(await readFile(lock.file, 'utf8')).pid).toBe(process.pid)
      // our own lock again (a restart in the same process) is fine, and a live other pid still refuses
      await acquireEngineLock(dir)
      await lock.release()
      await expect(readFile(lock.file, 'utf8')).rejects.toThrow()
      // an unreadable lock is replaced too
      await writeFile(lock.file, 'garbage')
      await (await acquireEngineLock(dir)).release()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('MCP client tasks and reopen_book', () => {
  it('lists the client task tools and reopen_book', async () => {
    const h = await start()
    const c = await connect(h.url)
    const names = (await c.listTools()).tools.map((t) => t.name)
    for (const n of ['list_client_tasks', 'get_client_task', 'submit_client_task', 'release_client_task', 'reopen_book']) expect(names).toContain(n)
  })

  it('get_client_task and list_client_tasks take a named client: no client means claude-code (SCP-44)', async () => {
    env = await makeEnv({ providers: [{ id: 'client', kind: 'client', models: ['claude-code', 'antigravity'] }], paused: true })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    const q = env.engine.clientQueue
    const msgs = [{ role: 'user' as const, content: 'go' }]
    q.add({ messages: msgs, client: 'antigravity' }, { job: 'ag1', role: 'writer', book: 'b' })
    expect((await call(c, 'get_client_task')).data).toEqual({ none: true, waiting: 0 })
    expect((await call(c, 'get_client_task', { client: 'claude-code' })).data).toEqual({ none: true, waiting: 0 })
    q.add({ messages: msgs, client: 'claude-code' }, { job: 'cc1', role: 'writer', book: 'b' })
    const all = (await call(c, 'list_client_tasks')).data
    expect(all).toMatchObject({ waiting: 2, tasks: [{ id: 'ag1#1', client: 'antigravity' }, { id: 'cc1#1', client: 'claude-code' }] })
    expect((await call(c, 'list_client_tasks', { client: 'antigravity' })).data).toMatchObject({ waiting: 1, leased: 0, tasks: [{ id: 'ag1#1' }] })
    const cc = (await call(c, 'get_client_task')).data
    expect(cc).toMatchObject({ taskId: 'cc1#1', meta: { client: 'claude-code' } })
    const ag = (await call(c, 'get_client_task', { client: 'antigravity' })).data
    expect(ag).toMatchObject({ taskId: 'ag1#1', meta: { client: 'antigravity' } })
    expect((await call(c, 'get_client_task', { client: 'antigravity' })).data).toEqual({ none: true, waiting: 0 })
  })

  it('takes a model request, answers it over MCP, and the job completes', async () => {
    env = await makeEnv({ providers: [{ id: 'client', kind: 'client', models: ['claude-code'] }], roles: { writer: ['client/claude-code'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    const taskSchema = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }
    env.engine.scheduler.register('t', async (ctx) => {
      const r = await ctx.chat({
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'system', content: 'Be kind.' },
          { role: 'user', content: 'Name the book.' }
        ],
        schema: taskSchema,
        maxTokens: 300
      })
      const plain = await ctx.chat({ messages: [{ role: 'user', content: 'One more line.' }] })
      return { result: `${r.text} | ${plain.text}` }
    })
    expect((await call(c, 'get_client_task')).data).toEqual({ none: true, waiting: 0 })
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    const listed = await waitFor(async () => {
      const r = await call(c, 'list_client_tasks')
      return r.data.waiting === 1 ? r.data : null
    })
    expect(listed).toMatchObject({ waiting: 1, leased: 0, tasks: [{ id: 'b1--t--u1--r0#1', state: 'waiting', role: 'writer', book: 'b1' }] })
    expect((await call(c, 'factory_status')).data.clientTasks).toEqual({ waiting: 1, leased: 0 })
    expect((await call(c, 'get_client_task', { book: 'other' })).data).toEqual({ none: true, waiting: 1 })

    const got = (await call(c, 'get_client_task', { role: 'writer', task: 't' })).data
    expect(got).toMatchObject({
      taskId: 'b1--t--u1--r0#1',
      meta: { job: 'b1--t--u1--r0', call: 1, role: 'writer', task: 't', book: 'b1', agent: 'writer-ann', unit: 'u1' },
      system: 'Be brief.\n\nBe kind.',
      user: 'Name the book.',
      schema: taskSchema,
      maxTokens: 300,
      output: 'Reply with one JSON object that matches `schema`. No prose, no code fence.',
      leaseMinutes: 30
    })
    // two system messages and one user message: no `messages`, so the prompt is sent once
    expect(got).not.toHaveProperty('messages')
    expect((await call(c, 'factory_status')).data.clientTasks).toEqual({ waiting: 0, leased: 1 })
    // a bad answer comes back with its problems and keeps the task; give it back and take it again
    const bad = await call(c, 'submit_client_task', { taskId: got.taskId, text: '{"name": "x"}' })
    expect(bad.isError).toBe(false)
    expect(bad.data).toEqual({ accepted: false, problems: ['title: missing (required)'] })
    expect((await call(c, 'release_client_task', { taskId: got.taskId })).data).toEqual({ released: true })
    expect((await call(c, 'release_client_task', { taskId: 'nope#1' })).data).toEqual({ released: false })
    const again = (await call(c, 'get_client_task')).data
    expect(again.taskId).toBe(got.taskId)
    expect((await call(c, 'submit_client_task', { taskId: again.taskId, text: '{"title": "The Bell"}' })).data).toEqual({ accepted: true })
    expect((await call(c, 'submit_client_task', { taskId: again.taskId, text: '{"title": "The Bell"}' })).data.problems[0]).toMatch(/task not found/)

    // the second request of the job: prose, a single message, no schema
    const second = await waitFor(async () => {
      const r = await call(c, 'get_client_task')
      return r.data.taskId ? r.data : null
    })
    expect(second).toMatchObject({ taskId: 'b1--t--u1--r0#2', system: '', user: 'One more line.', output: 'Reply with the text only: no preamble, no notes, no code fence.' })
    expect(second).not.toHaveProperty('schema')
    expect(second).not.toHaveProperty('messages')
    expect((await call(c, 'submit_client_task', { taskId: second.taskId, text: 'The end.' })).data).toEqual({ accepted: true })
    await waitFor(async () => (await readdir(path.join(env!.dir, 'jobs', 'done'))).includes('b1--t--u1--r0.md'))
    expect((await call(c, 'factory_status')).data.clientTasks).toEqual({ waiting: 0, leased: 0 })
  })

  it('reopen_book refuses a book that is not rejected, a bad mode and unwritten chapters', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!)
    await makeBook(env!, 'running-book', 'drafting')
    await makeBook(env!, 'rejected-book', 'rejected')
    expect((await call(c, 'reopen_book', { book: 'demo-book', mode: 'rewrite' })).raw).toMatch(/give the chapters to rewrite/)
    expect((await call(c, 'reopen_book', { book: 'running-book', mode: 'review' })).raw).toMatch(/not a rejected or published book \(stage: drafting\)/)
    expect((await call(c, 'reopen_book', { book: 'nobody', mode: 'review' })).raw).toMatch(/no book/)
    expect((await call(c, 'reopen_book', { book: 'rejected-book', mode: 'redo' })).isError).toBe(true)
    expect((await call(c, 'reopen_book', { book: 'rejected-book', mode: 'review', chapters: [1] })).raw).toMatch(/only apply to mode rewrite/)
    expect((await call(c, 'reopen_book', { book: 'rejected-book', mode: 'rewrite', chapters: [4] })).raw).toMatch(/chapter 4 of "rejected-book" is not written/)
    // nothing changed
    expect((await env!.engine.books.read('rejected-book'))!.data).toMatchObject({ stage: 'rejected', round: 0, extra_rounds: 0 })
    expect((await env!.engine.books.read('demo-book'))!.data.stage).toBe('published')
  })
})

describe('MCP book models', () => {
  it('add_story with models is stored in the story, set_book_model checks its input, and a model can be removed', async () => {
    env = await makeEnv({ providers: [{ id: 'loc', local: true, models: ['m1'] }, { id: 'client', kind: 'client', models: ['claude-code'] }], roles: { writer: ['loc/m1'] }, paused: true })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    const added = await call(c, 'add_story', { title: 'The Bell', premise: 'A bell.', models: { writer: 'client/claude-code' } })
    expect(added.isError).toBe(false)
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', 'the-bell.md'), 'utf8')).data.role_models).toEqual({ writer: 'client/claude-code' })
    expect((await call(c, 'get_story', { story: 'the-bell' })).data.brief.models).toEqual({ writer: 'client/claude-code' })
    expect((await call(c, 'add_story', { title: 'X', models: { writer: 'nope/nope' } })).raw).toMatch(/unknown model/)
    expect((await call(c, 'add_story', { title: 'X', models: { nobody: 'loc/m1' } })).raw).toMatch(/unknown role/)
    const upd = await call(c, 'update_story', { story: 'the-bell', models: {} })
    expect(upd.isError).toBe(false)
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', 'the-bell.md'), 'utf8')).data.role_models).toBeUndefined()

    await makeBook(env, 'running-book', 'drafting')
    await makeBook(env, 'rejected-book', 'rejected')
    await makeBook(env, 'done-book', 'published')
    const set = await call(c, 'set_book_model', { book: 'running-book', role: 'writer', model: 'client/claude-code' })
    expect(set.isError).toBe(false)
    expect(set.data.roleModels).toEqual({ writer: 'client/claude-code' })
    expect((await env.engine.books.read('running-book'))!.data.role_models).toEqual({ writer: 'client/claude-code' })
    expect((await call(c, 'set_book_model', { book: 'rejected-book', role: 'writer', model: 'loc/m1' })).data.roleModels).toEqual({ writer: 'loc/m1' })
    expect((await call(c, 'set_book_model', { book: 'done-book', role: 'writer', model: 'loc/m1' })).raw).toMatch(/published/)
    expect((await call(c, 'set_book_model', { book: 'running-book', role: 'writer', model: 'nope/nope' })).raw).toMatch(/unknown model/)
    expect((await call(c, 'set_book_model', { book: 'running-book', role: 'nobody', model: 'loc/m1' })).raw).toMatch(/unknown role/)
    expect((await call(c, 'set_book_model', { book: 'nobody', role: 'writer', model: null })).isError).toBe(true)
    expect((await call(c, 'set_book_model', { book: 'running-book', role: 'writer', model: null })).data.roleModels).toEqual({})
  })

  it('add_story humanize:false is stored in the story and shown by get_story; update_story can set it back; the humanizer role takes a book model', async () => {
    env = await makeEnv({ providers: [{ id: 'loc', local: true, models: ['m1'] }, { id: 'client', kind: 'client', models: ['claude-code'] }], roles: { writer: ['loc/m1'] }, paused: true })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    const tool = (await c.listTools()).tools.find((t) => t.name === 'add_story')!
    expect(Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)).toContain('humanize')
    // not given, or true: the story has no humanize field (the format decides)
    await call(c, 'add_story', { title: 'Plain', premise: 'A bell.' })
    await call(c, 'add_story', { title: 'Explicit', premise: 'A bell.', humanize: true })
    for (const slug of ['plain', 'explicit']) expect(parseMd(await readFile(path.join(env.dir, 'ideas', `${slug}.md`), 'utf8')).data.humanize).toBeUndefined()
    const added = await call(c, 'add_story', { title: 'The Bell', premise: 'A bell.', humanize: false })
    expect(added.isError).toBe(false)
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', 'the-bell.md'), 'utf8')).data.humanize).toBe(false)
    expect((await call(c, 'get_story', { story: 'the-bell' })).data.brief.humanize).toBe(false)
    // an edit of another field keeps it; humanize:true clears it
    await call(c, 'update_story', { story: 'the-bell', plot: 'She rings it.' })
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', 'the-bell.md'), 'utf8')).data.humanize).toBe(false)
    await call(c, 'update_story', { story: 'the-bell', humanize: true })
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', 'the-bell.md'), 'utf8')).data.humanize).toBeUndefined()
    // a book can have its own humanizer model
    await makeBook(env, 'running-book', 'drafting')
    expect((await call(c, 'set_book_model', { book: 'running-book', role: 'humanizer', model: 'client/claude-code' })).data.roleModels).toEqual({ humanizer: 'client/claude-code' })
    expect((await call(c, 'add_story', { title: 'Y', models: { humanizer: 'client/claude-code' } })).isError).toBe(false)
  })

  it('adapt_book makes a story from a published book, and refuses what cannot be adapted', async () => {
    env = await makeEnv({ providers: [{ id: 'loc', local: true, models: ['m1'] }], roles: { writer: ['loc/m1'] }, paused: true })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    await makeBook(env, 'demo-book')
    await makeBook(env, 'half-done', 'drafting')
    expect((await call(c, 'adapt_book', { book: 'nope', format: 'visual-novel' })).raw).toMatch(/no book "nope"/)
    expect((await call(c, 'adapt_book', { book: 'half-done', format: 'visual-novel' })).raw).toMatch(/not published yet/)
    expect((await call(c, 'adapt_book', { book: 'demo-book', format: 'novel' })).raw).toMatch(/not a script format/)
    const ok = await call(c, 'adapt_book', { book: 'demo-book', format: 'choice-visual-novel', notes: 'Keep the bell.' })
    expect(ok.isError).toBe(false)
    expect(ok.data.story).toMatchObject({ format: 'choice-visual-novel', sourceBook: 'demo-book', titleFixed: true })
    const file = parseMd(await readFile(path.join(env.dir, 'ideas', `${ok.data.slug}.md`), 'utf8'))
    expect(file.data).toMatchObject({ source_book: 'demo-book', format: 'choice-visual-novel', title: 'Demo Book' })
    expect(file.body).toContain('Keep the bell.')
    expect((await call(c, 'adapt_book', { book: 'demo-book', format: 'choice-visual-novel' })).raw).toMatch(/already waiting/)
    // a screenplay format is a script format too: the story names the medium
    const film = await call(c, 'adapt_book', { book: 'demo-book', format: 'short-film', title: 'Demo, the Film' })
    expect(film.isError).toBe(false)
    expect(film.data.story).toMatchObject({ format: 'short-film', sourceBook: 'demo-book', title: 'Demo, the Film' })
    expect(parseMd(await readFile(path.join(env.dir, 'ideas', `${film.data.slug}.md`), 'utf8')).body).toContain('screenplay adapted from the owner')
    expect((await call(c, 'adapt_book', { book: 'demo-book', format: 'visual-novel', models: { writer: 'no/such' } })).isError).toBe(true)
  })
})

describe('MCP newspaper', () => {
  const article = (e: TestEnv, slug: string, o: Record<string, unknown> = {}) =>
    e.engine.books.create(slug, { title: slug, stage: 'published', format: 'article', article: true, nonfiction: true, target_words: 900, topic: 'news-technology', topic_name: 'Technology', author: 'Mara Quill', headline: `Headline of ${slug}`, standfirst: `Standfirst of ${slug}`, published: '2026-10-19T09:00:00.000Z', ...o }, '')

  it('lists list_articles, and add_story takes the article formats with a newspaper section only', async () => {
    const h = await start()
    const c = await connect(h.url)
    expect((await c.listTools()).tools.map((t) => t.name)).toContain('list_articles')
    const ok = await call(c, 'add_story', { premise: 'The new EU rules on AI.', format: 'article', topic: 'news-technology' })
    expect(ok.isError).toBe(false)
    expect(ok.data.story).toMatchObject({ format: 'article', topic: 'news-technology' })
    expect((await call(c, 'add_story', { premise: 'A feature with no section.', format: 'feature-article' })).isError).toBe(false)
    expect((await call(c, 'add_story', { premise: 'x', format: 'article', topic: 'fic-mystery-cozy' })).raw).toMatch(/article format.*not a newspaper section|articles go in a newspaper section/)
    expect((await call(c, 'add_story', { premise: 'x', format: 'short-story', topic: 'news-science' })).raw).toMatch(/newspaper section.*must be an article format/)
    expect((await call(c, 'add_topic', { name: 'Gardening news', kind: 'article' })).isError).toBe(false)
    expect((await call(c, 'list_topics')).data.find((t: { id: string }) => t.id === 'my-gardening-news')).toMatchObject({ kind: 'article' })
    // a story can be changed into an unfitting pair neither
    expect((await call(c, 'update_story', { story: ok.data.slug, topic: 'fic-mystery-cozy' })).isError).toBe(true)
  })

  it('shows the published articles newest first, by section and date, and the books list has a medium filter', async () => {
    const h = await start()
    const c = await connect(h.url)
    await article(env!, 'chips', { published: '2026-10-19T09:00:00.000Z' })
    await article(env!, 'quake', { topic: 'news-science', topic_name: 'Science', published: '2026-10-20T08:00:00.000Z' })
    await article(env!, 'old-one', { published: '2026-10-10T08:00:00.000Z' })
    await article(env!, 'in-progress', { stage: 'drafting', published: undefined })
    await makeBook(env!, 'a-book', 'published')
    const all = await call(c, 'list_articles')
    expect(all.data.map((a: { slug: string }) => a.slug)).toEqual(['quake', 'chips', 'old-one'])
    expect(all.data[0]).toMatchObject({ headline: 'Headline of quake', standfirst: 'Standfirst of quake', section: 'Science', sectionId: 'news-science', byline: 'Mara Quill', stage: 'published' })
    expect((await call(c, 'list_articles', { section: 'news-technology' })).data.map((a: { slug: string }) => a.slug)).toEqual(['chips', 'old-one'])
    expect((await call(c, 'list_articles', { section: 'science' })).data.map((a: { slug: string }) => a.slug)).toEqual(['quake'])
    expect((await call(c, 'list_articles', { since: '2026-10-19' })).data.map((a: { slug: string }) => a.slug)).toEqual(['quake', 'chips'])
    expect((await call(c, 'list_articles', { section: 'World' })).data).toEqual([])
    expect((await call(c, 'list_articles', { stage: 'all' })).data.map((a: { slug: string }) => a.slug)).toContain('in-progress')
    expect((await call(c, 'list_articles', { since: 'yesterday-ish' })).raw).toMatch(/not a date/)
    const books = await call(c, 'list_books', { medium: 'book' })
    expect(books.data.map((b: { slug: string }) => b.slug)).toEqual(['a-book'])
    expect(books.data[0].medium).toBe('book')
    expect((await call(c, 'list_books', { medium: 'article' })).data.map((b: { slug: string }) => b.slug).sort()).toEqual(['chips', 'in-progress', 'old-one', 'quake'])
    expect((await call(c, 'list_books')).data).toHaveLength(5)
    // an article is not a book that can be adapted, and the factory status shows the article limit
    expect((await call(c, 'adapt_book', { book: 'chips', format: 'visual-novel' })).raw).toMatch(/newspaper article/)
    expect((await call(c, 'factory_status')).data.maxArticlesInProgress).toBe(3)
  })
})

describe('MCP: the prompt once, waiting for a book, absolute paths, book models and reopening', () => {
  const clientEnv = async () => {
    env = await makeEnv({ providers: [{ id: 'client', kind: 'client', models: ['claude-code'] }], roles: { writer: ['client/claude-code'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    return connect(mcp!.url)
  }

  it('a follow-up round sends the conversation in messages (without the system turns) and only the last turn in user', async () => {
    const c = await clientEnv()
    env!.engine.scheduler.register('t', async (ctx) => {
      const r = await ctx.chat({
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Name the book.' },
          { role: 'assistant', content: 'It is called X.' },
          { role: 'user', content: 'Fix the title.' }
        ]
      })
      return { result: r.text }
    })
    await env!.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    const got = await waitFor(async () => {
      const r = await call(c, 'get_client_task')
      return r.data.taskId ? r.data : null
    })
    expect(got.system).toBe('Be brief.')
    expect(got.user).toBe('Fix the title.')
    expect(got.messages).toEqual([
      { role: 'user', content: 'Name the book.' },
      { role: 'assistant', content: 'It is called X.' },
      { role: 'user', content: 'Fix the title.' }
    ])
    expect((await call(c, 'submit_client_task', { taskId: got.taskId, text: 'Done.' })).data).toEqual({ accepted: true })
  })

  it('wait_for_book: a story without a book times out, an unknown slug is an error, a book that gets published returns at once', async () => {
    const h = await start()
    const c = await connect(h.url)
    await call(c, 'add_story', { title: 'The Bell', premise: 'A bell under the sea.' })
    const t0 = Date.now()
    const waited = await call(c, 'wait_for_book', { slug: 'the-bell', timeout_seconds: 1 })
    expect(waited.isError).toBe(false)
    expect(waited.data).toMatchObject({ done: false, reason: 'timeout', story: 'the-bell', book: null, stage: null, clientTasks: { waiting: 0, leased: 0 } })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    expect((await call(c, 'wait_for_book', { slug: 'nope', timeout_seconds: 1 })).raw).toMatch(/no book or story "nope"/)

    await makeBook(env!, 'wb', 'drafting')
    const pending = call(c, 'wait_for_book', { slug: 'wb', timeout_seconds: 30 })
    await new Promise((r) => setTimeout(r, 300))
    await env!.engine.books.update('wb', () => ({ stage: 'published' }))
    const done = await pending
    expect(done.data).toMatchObject({ done: true, reason: 'published', book: 'wb', story: null, title: 'Demo Book', stage: 'published', chaptersWritten: 1, folder: path.join(env!.dir, 'books', 'wb') })
    expect(done.data.waitedMs).toBeLessThan(2500)
  })

  it('wait_for_book returns when a model request of the book waits for the client', async () => {
    const c = await clientEnv()
    await makeBook(env!, 'b1', 'drafting')
    env!.engine.scheduler.register('t', async (ctx) => ({ result: (await ctx.chat({ messages: [{ role: 'user', content: 'Say hi.' }] })).text }))
    await env!.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    await waitFor(async () => (await call(c, 'list_client_tasks')).data.waiting === 1, 8000, 'the waiting task')
    const r = await call(c, 'wait_for_book', { slug: 'b1', timeout_seconds: 30 })
    expect(r.data).toMatchObject({ done: false, reason: 'client-task', book: 'b1', stage: 'drafting', clientTasks: { waiting: 1, leased: 0 } })
    // with stop_on_client_task false it waits for the timeout
    expect((await call(c, 'wait_for_book', { slug: 'b1', timeout_seconds: 1, stop_on_client_task: false })).data).toMatchObject({ reason: 'timeout' })
    const task = (await call(c, 'get_client_task')).data
    await call(c, 'submit_client_task', { taskId: task.taskId, text: 'hi' })
  })

  it('paths are absolute: dataDir in factory_status, the folder in list_books, paths in get_book', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!, 'demo-book', 'published')
    expect((await call(c, 'factory_status')).data.dataDir).toBe(env!.dir)
    const folder = path.join(env!.dir, 'books', 'demo-book')
    expect((await call(c, 'list_books')).data[0].folder).toBe(folder)
    const got = (await call(c, 'get_book', { book: 'demo-book' })).data
    expect(got.paths).toMatchObject({ dataDir: env!.dir, folder, chapters: path.join(folder, 'chapters'), epub: null, coverPng: null, readerDir: null, articlePage: null, articleMarkdown: null })
    await mkdir(path.join(folder, 'out'), { recursive: true })
    await writeFile(path.join(folder, 'out', 'demo-book.epub'), 'x')
    expect((await call(c, 'get_book', { book: 'demo-book' })).data.paths.epub).toBe(path.join(folder, 'out', 'demo-book.epub'))
    expect((await call(c, 'get_book', { book: 'demo-book' })).data.epub).toBe('books/demo-book/out/demo-book.epub') // the relative field stays
  })

  it('a book model can be set on any stage, and cleared on a published book', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!, 'pub', 'published')
    await makeBook(env!, 'bad', 'failed')
    const set = await call(c, 'set_book_model', { book: 'bad', role: 'writer', model: 'loc/m1' })
    expect(set.isError).toBe(false)
    expect(set.data.roleModels).toEqual({ writer: 'loc/m1' })
    expect((await call(c, 'set_book_model', { book: 'pub', role: 'writer', model: 'loc/m1' })).data.roleModels).toEqual({ writer: 'loc/m1' })
    const cleared = await call(c, 'set_book_model', { book: 'pub', role: 'writer', model: null })
    expect(cleared.isError).toBe(false)
    expect(cleared.data.roleModels).toEqual({})
    expect((await engineBook('pub')).data.role_models).toEqual({})
  })

  it('reopen_book takes a published book and refuses one in progress', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!, 'pub', 'published')
    await makeBook(env!, 'wip', 'drafting')
    expect((await call(c, 'reopen_book', { book: 'wip', mode: 'review' })).raw).toMatch(/not a rejected or published book/)
    const r = await call(c, 'reopen_book', { book: 'pub', mode: 'review' })
    expect(r.isError).toBe(false)
    expect(r.data.stage).toBe('reviewing')
    expect((await engineBook('pub')).data).toMatchObject({ round: 1, reopened_from: 'published', extra_rounds: 1 })
  })

  it('get_script returns the parsed script of a script book and refuses a prose book', async () => {
    const h = await start()
    const c = await connect(h.url)
    await env!.engine.books.create('vn', { title: 'The Lighthouse Letters', author: 'Mara Quill', genre: 'Mystery', format: 'choice-visual-novel', stage: 'drafting', target_words: 5000, script: true }, '')
    await writeFile(
      env!.engine.books.file('vn', 'outline.md'),
      ['---', 'kind: outline', 'chapters:', '  - { n: 1, title: The Late Boat, summary: s, choices: [{ text: Wait, to: 2 }] }', '  - { n: 2, title: The End, summary: s, ending: "quiet" }', '---', 'Outline', ''].join('\n')
    )
    await mkdir(path.join(env!.engine.books.dir('vn'), 'bible'), { recursive: true })
    await writeFile(
      env!.engine.books.file('vn', 'bible', 'bible.md'),
      ['---', 'kind: bible', '---', '## Characters', '- **Mara**: Seventeen, small and wiry. Voice: short sentences', '', '## Places', '- **The harbour wall**: A long stone pier at dusk.', '', '## Style', 'Moody and rain-soaked.', ''].join('\n')
    )
    await env!.engine.books.writeChapter('vn', { n: 1, title: 'The Late Boat', round: 0, body: 'SCENE: The harbour wall, dusk\nRain needles the grey water.\nON SCREEN: Mara (worried)\nMARA (worried): He is late.\nFootsteps.\n---\n' })
    await env!.engine.books.writeChapter('vn', { n: 2, title: 'The End', round: 0, body: 'SCENE: The kitchen, night\nA low room.\nMARA: Home.\n' })
    const all = (await call(c, 'get_script', { book: 'vn' })).data
    expect(all).toMatchObject({
      slug: 'vn',
      title: 'The Lighthouse Letters',
      author: 'Mara Quill',
      style: 'Moody and rain-soaked.',
      characters: [{ name: 'Mara', looks: 'Seventeen, small and wiry.', voice: 'short sentences' }],
      places: [{ name: 'The harbour wall', looks: 'A long stone pier at dusk.' }]
    })
    expect(all.chapters).toHaveLength(2)
    expect(all.chapters[0]).toMatchObject({ n: 1, title: 'The Late Boat', choices: [{ text: 'Wait', to: 2 }], ending: null })
    expect(all.chapters[0].scenes[0]).toMatchObject({ place: 'The harbour wall', time: 'dusk', background: 'Rain needles the grey water.' })
    expect(all.chapters[1]).toMatchObject({ n: 2, ending: 'quiet', choices: [] })
    const one = (await call(c, 'get_script', { book: 'vn', chapter: 2 })).data
    expect(one.chapters.map((x: { n: number }) => x.n)).toEqual([2])
    expect((await call(c, 'get_script', { book: 'vn', chapter: 5 })).raw).toMatch(/not written/)
    await makeBook(env!, 'prose', 'published')
    expect((await call(c, 'get_script', { book: 'prose' })).raw).toMatch(/not a visual novel script \(its format is novel\)/)
  })

  it('add_story takes puzzles, and get_script returns the puzzle beats and the puzzles of bible/puzzles.md', async () => {
    const h = await start()
    const c = await connect(h.url)
    const core = { format: 1, kind: 'murdle', size: 3, clues: [{ id: 'c1', type: 'not', a: 's1', b: 'w1' }], murder: { place: 'p1', answer: { suspect: 's1', weapon: 'w1', place: 'p1' } } }
    const added = await call(c, 'add_story', {
      title: 'The Dinner Party',
      premise: 'A body in the library.',
      format: 'mystery-puzzle-visual-novel',
      puzzles: [{ key: 'dinner', kind: 'murdle', core, names: { s1: 'Colonel Ash', w1: 'rope', p1: 'library' }, text: { c1: 'Colonel Ash did not have the rope.', murder: 'The body was found in the library.' } }]
    })
    expect(added.isError).toBe(false)
    const idea = parseMd(await readFile(path.join(env!.dir, 'ideas', `${added.data.slug}.md`), 'utf8'))
    expect(idea.data.puzzles).toEqual([expect.objectContaining({ key: 'dinner', kind: 'murdle', names: { s1: 'Colonel Ash', w1: 'rope', p1: 'library' } })])
    expect(idea.body).not.toContain('Colonel Ash did not have the rope') // the puzzles are data, not text of the brief
    expect((await call(c, 'add_story', { title: 'Bad', puzzles: [{ key: 'bad key' }] })).isError).toBe(true)

    await env!.engine.books.create('mystery', { title: 'The Dinner Party', format: 'mystery-puzzle-visual-novel', stage: 'drafting', target_words: 5000, script: true, puzzles: true }, '')
    await mkdir(path.join(env!.engine.books.dir('mystery'), 'bible'), { recursive: true })
    await writeFile(env!.engine.books.file('mystery', 'bible', 'bible.md'), ['---', 'kind: bible', '---', '## Characters', '- **Miss Cole**: A cook. Aliases: the cook. Voice: calm', ''].join('\n'))
    await writeMd(env!.engine.books.file('mystery', 'bible', 'puzzles.md'), { kind: 'puzzles', puzzles: [{ key: 'dinner', kind: 'murdle', chapter: 1, core, names: { s1: 'Colonel Ash' }, text: { c1: 'Colonel Ash did not have the rope.' }, clueAt: { c1: 1 } }] }, '\nPuzzles\n')
    await env!.engine.books.writeChapter('mystery', {
      n: 1,
      title: 'The Body',
      round: 0,
      body: 'SCENE: The library, night\nCLUE: dinner/c1: Colonel Ash had left the rope on the shelf.\nEVIDENCE: watch: A watch, stopped at 9:10.\nPUZZLE: dinner (murdle)\nTESTIMONY: Miss Cole\nTHE COOK: I was in the garden.\nMISS COLE (calm): I saw nothing.\nEND TESTIMONY\n'
    })
    const out = (await call(c, 'get_script', { book: 'mystery' })).data
    expect(out.puzzles).toEqual([expect.objectContaining({ key: 'dinner', chapter: 1, names: { s1: 'Colonel Ash' }, clueAt: { c1: 1 } })])
    expect(out.puzzles[0].core).toMatchObject({ format: 1, kind: 'murdle' })
    expect(out.chapters[0].scenes[0].beats).toEqual([
      { type: 'clue', puzzle: 'dinner', clue: 'c1', text: 'Colonel Ash had left the rope on the shelf.' },
      { type: 'evidence', key: 'watch', text: 'A watch, stopped at 9:10.' },
      { type: 'puzzle', puzzle: 'dinner', kind: 'murdle' },
      {
        type: 'testimony',
        witness: 'Miss Cole',
        statements: [
          { n: 1, speaker: 'Miss Cole', expression: '', text: 'I was in the garden.', alias: 'the cook' },
          { n: 2, speaker: 'Miss Cole', expression: 'calm', text: 'I saw nothing.' }
        ]
      }
    ])
  })

  it('get_screenplay returns the parsed screenplay of a screenplay book, get_script refuses it, and get_screenplay refuses the others', async () => {
    const h = await start()
    const c = await connect(h.url)
    await env!.engine.books.create('film', { title: 'The Late Boat', author: 'Mara Quill', genre: 'Drama', format: 'short-film', stage: 'drafting', target_words: 600, script: true, screenplay: true }, '')
    await writeFile(
      env!.engine.books.file('film', 'outline.md'),
      ['---', 'kind: outline', 'chapters:', '  - { n: 1, title: The Wait, summary: s, source_chapters: [1, 2] }', '  - { n: 2, title: The Boat, summary: s }', '---', 'Outline', ''].join('\n')
    )
    await mkdir(path.join(env!.engine.books.dir('film'), 'bible'), { recursive: true })
    await writeFile(
      env!.engine.books.file('film', 'bible', 'bible.md'),
      ['---', 'kind: bible', '---', '## Characters', '- **Mara**: Seventeen, small and wiry. Voice: a girl, dry, quick', '', '## Places', '- **The harbour wall**: A long stone pier at dusk.', '', '## Style', 'Moody and rain-soaked.', ''].join('\n')
    )
    await env!.engine.books.writeChapter('film', {
      n: 1,
      title: 'The Wait',
      round: 0,
      body: 'SCENE: The harbour wall, dusk\nRain falls.\nMUSIC: slow piano\nSHOT (wide, static, 6s): The pier.\nNARRATOR: Every evening, Mara waited.\nSHOT (close-up, 4s): Mara.\nON SCREEN: Mara (raincoat)\nMARA (worried): He is late.\nMUSIC: stop\n'
    })
    await env!.engine.books.writeChapter('film', { n: 2, title: 'The Boat', round: 0, body: 'SCENE: The harbour wall, night\nSHOT (medium, 5s): The boat arrives.\nTITLE: The End\n' })
    const all = (await call(c, 'get_screenplay', { book: 'film' })).data
    expect(all).toMatchObject({
      slug: 'film',
      title: 'The Late Boat',
      format: 'short-film',
      aspect: '16:9',
      style: 'Moody and rain-soaked.',
      runtimeSeconds: 6 + 4 + 5 + 3,
      runtimeRange: [60, 180],
      characters: [{ name: 'Mara', voice: 'a girl, dry, quick' }],
      places: [{ name: 'The harbour wall' }],
      music: [{ id: 'm1', description: 'slow piano', from: 'ch01.s01.sh01', to: 'ch01.s01.sh02' }]
    })
    expect(all.chapters[0]).toMatchObject({ n: 1, title: 'The Wait', sourceChapters: [1, 2] })
    expect(all.chapters[0].scenes[0]).toMatchObject({ id: 'ch01.s01', place: 'The harbour wall', time: 'dusk', background: 'Rain falls.' })
    const shots = all.chapters[0].scenes[0].shots
    expect(shots.map((x: { id: string }) => x.id)).toEqual(['ch01.s01.sh01', 'ch01.s01.sh02'])
    expect(shots[0]).toMatchObject({ framing: 'wide', move: 'static', seconds: 6, lines: [{ speaker: 'Narrator', kind: 'voice-over' }] })
    expect(shots[1].cast).toEqual([{ name: 'Mara', look: 'raincoat' }])
    expect(shots[1]).not.toHaveProperty('music')
    expect(all.chapters[1].scenes[0].shots[1]).toMatchObject({ id: 'ch02.s01.sh02', title: 'The End', seconds: 3 })
    const one = (await call(c, 'get_screenplay', { book: 'film', chapter: 2 })).data
    expect(one.chapters.map((x: { n: number }) => x.n)).toEqual([2])
    expect((await call(c, 'get_screenplay', { book: 'film', chapter: 5 })).raw).toMatch(/not written/)
    expect((await call(c, 'get_script', { book: 'film' })).raw).toMatch(/is a screenplay.*use get_screenplay/)
    // a vertical film, from the brief or the style
    await writeFile(env!.engine.books.file('film', 'bible', 'bible.md'), ['---', 'kind: bible', '---', '## Characters', '- **Mara**: Small.', '', '## Style', 'Vertical video, rain-soaked.', ''].join('\n'))
    expect((await call(c, 'get_screenplay', { book: 'film' })).data.aspect).toBe('9:16')
    await makeBook(env!, 'prose', 'published')
    expect((await call(c, 'get_screenplay', { book: 'prose' })).raw).toMatch(/not a screenplay \(its format is novel\)/)
    await env!.engine.books.create('vn', { title: 'VN', format: 'visual-novel', stage: 'drafting', target_words: 5000, script: true }, '')
    expect((await call(c, 'get_screenplay', { book: 'vn' })).raw).toMatch(/visual novel script, use get_script/)
  })

  it('build_vn_pack writes the pack and catalog, get_vn_pack reads them back with a stale check, and both refuse the wrong books', async () => {
    const h = await start()
    const c = await connect(h.url)
    await env!.engine.books.create(
      'soother',
      { title: 'The Soother', author: 'Culo', genre: 'Fantasy', format: 'visual-novel', stage: 'published', target_words: 800, script: true, blurb: 'A soother falls into Dragon Land.' },
      ''
    )
    await writeMd(
      env!.engine.books.file('soother', 'bible', 'bible.md'),
      { kind: 'bible' },
      ['## Characters', '- **Petra**: Six years old, a yellow raincoat. Aliases: the girl. Voice: bright', '- **Mango**: A small orange dragon. Voice: chatty', '', '## Places', '- **Petra’s garden**: A small cottage garden.', '', '## Style', 'Warm and giggly.'].join('\n')
    )
    await writeMd(env!.engine.books.file('soother', 'outline.md'), { kind: 'outline', chapters: [{ n: 1, title: 'The Throw', summary: 'Petra throws it.' }] }, '\n1. **The Throw**: Petra throws it.\n')
    await env!.engine.books.writeChapter('soother', {
      n: 1,
      title: 'The Throw',
      round: 0,
      body: ['SCENE: Petra’s garden, morning', 'Narration: The sun is warm.', 'ON SCREEN: Petra (yellow raincoat)', 'AMBIENCE: birds', 'PETRA (grumpy): Pip will not stop crying.', 'CG: the soother over the mountains', 'THE GIRL (worried): Oops.'].join('\n')
    })

    const built = (await call(c, 'build_vn_pack', { book: 'soother' })).data
    expect(built).toMatchObject({ book: 'soother', lang: 'en', chapters: 1, scenes: 1, beats: 4, characters: 2, places: 1, puzzles: 0 })
    expect(built.packHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(built.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(built.packPath).toMatch(/vn[\\/]pack\.json$/)
    expect(built.textPath).toMatch(/vn[\\/]text[\\/]en\.json$/)
    expect(built.warnings).toEqual([])
    expect(parseMd(await readFile(env!.engine.books.file('soother', 'book.md'), 'utf8')).data.vn_version).toBe(2)

    const got = (await call(c, 'get_vn_pack', { book: 'soother' })).data
    expect(got.packHash).toBe(built.packHash)
    expect(got.sourceHash).toBe(built.sourceHash)
    expect(got.packVersion).toBe(2)
    expect(got.stale).toBe(false)
    expect(got.problems).toEqual([])
    expect(got.warnings).toEqual([])
    expect(got.pack.book).toMatchObject({ slug: 'soother', kind: 'linear', primaryLang: 'en' })
    expect(got.pack.characters[0]).toMatchObject({ key: 'petra', aliasKeys: ['petra#1'] })
    expect(got.pack.chapters[0].scenes[0].beats.find((b: { type: string; aliasKey?: string }) => b.type === 'line' && b.aliasKey)).toMatchObject({ speakerKey: 'petra', aliasKey: 'petra#1' })
    expect(got.text.characterNames['petra#1']).toBe('the girl')
    expect(got.text.beats['ch01.s01.b001']).toBe('The sun is warm.')

    // a chapter edit makes the pack stale: reported, not ignored
    await env!.engine.books.writeChapter('soother', { n: 1, title: 'The Throw', round: 0, body: 'SCENE: Petra’s garden, morning\nPETRA: One more line.' })
    const stale = (await call(c, 'get_vn_pack', { book: 'soother' })).data
    expect(stale.stale).toBe(true)
    expect(stale.warnings.join(' ')).toMatch(/stale/)

    // refusals: a prose book, a screenplay, and a visual novel with no pack yet
    await makeBook(env!, 'prose', 'published')
    expect((await call(c, 'build_vn_pack', { book: 'prose' })).raw).toMatch(/not a visual novel script \(its format is novel\)/)
    expect((await call(c, 'get_vn_pack', { book: 'prose' })).raw).toMatch(/not a visual novel script/)
    await env!.engine.books.create('film', { title: 'Film', format: 'short-film', stage: 'published', target_words: 600, script: true, screenplay: true }, '')
    expect((await call(c, 'build_vn_pack', { book: 'film' })).raw).toMatch(/is a screenplay/)
    expect((await call(c, 'get_vn_pack', { book: 'film' })).raw).toMatch(/is a screenplay/)
    await env!.engine.books.create('vn2', { title: 'VN 2', format: 'visual-novel', stage: 'drafting', target_words: 5000, script: true }, '')
    expect((await call(c, 'get_vn_pack', { book: 'vn2' })).raw).toMatch(/run build_vn_pack first/)
  })

  it('refresh_factbase refuses a fiction book', async () => {
    const h = await start()
    const c = await connect(h.url)
    await makeBook(env!, 'prose', 'published')
    const r = await call(c, 'refresh_factbase', { book: 'prose' })
    expect(r.isError).toBe(true)
    expect(r.raw).toMatch(/not a non-fiction/)
  })
})

/** book.md of a book in the current test environment. */
async function engineBook(slug: string) {
  return parseMd(await readFile(path.join(env!.dir, 'books', slug, 'book.md'), 'utf8'))
}

describe('MCP: exclusive pins and what blocks the factory', () => {
  it('assign_agent {exclusive: true} shows pinExclusive, and freeing the agent clears it', async () => {
    env = await makeEnv({ paused: true, roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    await makeBook(env, 'b1', 'drafting')
    const plain = await call(c, 'assign_agent', { agent: 'writer-ann', book: 'b1' })
    expect(plain.data).toMatchObject({ pin: 'b1', pinExclusive: false })
    const exclusive = await call(c, 'assign_agent', { agent: 'writer-ann', book: 'b1', exclusive: true })
    expect(exclusive.data).toMatchObject({ pin: 'b1', pinExclusive: true })
    expect((await call(c, 'list_agents')).data[0]).toMatchObject({ pinExclusive: true })
    const freed = await call(c, 'assign_agent', { agent: 'writer-ann', book: null })
    expect(freed.data).toMatchObject({ pin: null, pinExclusive: false })
  })

  it('factory_status lists the providers, the embeddings server, and the jobs no model can take', async () => {
    env = await makeEnv({ roles: { writer: ['loc/m1'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    mcp = await startMcpServer({ engine: env.engine, config: { enabled: true, host: '127.0.0.1', port: 0, tokenEnv: 'SCRIPTORIUM_TEST_MCP_TOKEN_UNSET' }, log: () => undefined })
    const c = await connect(mcp!.url)
    const idle = (await call(c, 'factory_status')).data
    expect(idle.blocked).toEqual([])
    expect(idle.lastResort).toBeNull()
    expect(idle.providers).toEqual([{ id: 'loc', dayFull: false, resetsAt: null, down: false }])
    expect(idle.embeddings).toBeNull() // the test config has no embedding model
    env.engine.scheduler.register('t', async () => ({ result: 'ok' }))
    env.engine.router.limiter.markDayFull(env.engine.registry.providers.get('loc')!)
    await env.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    const status = await waitFor(async () => {
      const s = (await call(c, 'factory_status')).data
      return s.blocked.length ? s : null
    }, 5000, 'a blocked job')
    expect(status.blocked).toEqual([{ job: 'b1--t--u1--r0', role: 'writer', agent: 'writer-ann', reason: expect.stringContaining('loc/m1: used up its requests for today') }])
    expect(status.providers[0]).toMatchObject({ id: 'loc', dayFull: true, down: false, resetsAt: expect.stringMatching(/T00:00:00\.000Z$/) })
  })
})

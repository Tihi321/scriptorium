import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpConfig, startMcpServer } from '../src/engine/mcp/server'
import type { McpHandle } from '../src/engine/mcp/server'
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
    for (const n of ['factory_status', 'list_books', 'get_book', 'read_book_file', 'list_stories', 'get_story', 'add_story', 'update_story', 'add_book_note', 'set_factory_paused', 'hire_agent', 'set_model', 'assign_agent', 'retry_book', 'reopen_book', 'list_client_tasks', 'get_client_task', 'submit_client_task', 'release_client_task']) {
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
    expect(got.messages).toHaveLength(3)
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
    expect((await call(c, 'reopen_book', { book: 'demo-book', mode: 'rewrite' })).raw).toMatch(/not a rejected book \(stage: published\)/)
    expect((await call(c, 'reopen_book', { book: 'running-book', mode: 'review' })).raw).toMatch(/not a rejected book \(stage: drafting\)/)
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
})

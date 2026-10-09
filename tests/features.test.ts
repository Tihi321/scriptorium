import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import nodemailer from 'nodemailer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseMd } from '../src/shared/md'
import type { BookSummary, EngineEvent, SnapshotEvent } from '../src/shared/protocol'
import { makePipelineEnv, sleep, waitFor } from './helpers'

let env: Awaited<ReturnType<typeof makePipelineEnv>>
let slug = ''
const sent: Record<string, unknown>[] = []

beforeAll(async () => {
  env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' }, {
    mailTransport: () => {
      const t = nodemailer.createTransport({ jsonTransport: true })
      const real = t.sendMail.bind(t)
      t.sendMail = (async (m: unknown) => {
        const info = await real(m as never)
        sent.push(JSON.parse(String((info as { message: string }).message)))
        return info
      }) as typeof t.sendMail
      return t
    }
  })
  slug = (await waitFor(async () => {
    const b = (await env.engine.snapshot()).books.find((x) => x.stage === 'published')
    return b?.slug ?? null
  }, 60000, 'published book'))!
}, 90000)
afterAll(async () => {
  await env?.cleanup()
})

const last = <T extends EngineEvent['type']>(type: T) => [...env.events].reverse().find((e) => e.type === type) as Extract<EngineEvent, { type: T }> | undefined

describe('snapshot', () => {
  it('has agents with resolved models, books, topics, models, role defaults and settings', async () => {
    const snap: SnapshotEvent = await env.engine.snapshot()
    expect(snap.paused).toBe(false)
    expect(snap.agents.length).toBe(17)
    const writer = snap.agents.find((a) => a.role === 'writer')!
    expect(writer).toMatchObject({ model: null, resolvedModel: 'w/writer-model' })
    expect(snap.agents.find((a) => a.role === 'line-editor')!.resolvedModel).toBe('r/review-model')
    expect(snap.roleDefaults).toMatchObject({ writer: 'w/writer-model', 'line-editor': 'r/review-model' })
    expect(snap.models).toContainEqual({ ref: 'w/writer-model', provider: 'w', model: 'writer-model', family: 'wfam', local: true, enabled: true })
    const book = snap.books.find((b) => b.slug === slug)!
    expect(book).toMatchObject({
      title: 'The Sleepy Fox',
      stage: 'published',
      format: 'bedtime-toddler',
      kind: 'juvenile-fiction',
      topic: { id: 'jfic-bedtime-and-dreams', name: 'Bedtime & Dreams' },
      rating: null,
      epub: `books/${slug}/out/${slug}.epub`,
      readerDir: `books/${slug}/out/reader`,
      coverPng: null
    })
    expect(book.words).toBeGreaterThan(250)
    expect(book.score).toBeGreaterThanOrEqual(7)
    expect(book.scores.age_fit).toBe(8)
    expect(book.publishedAt).toBeTruthy()
    expect(snap.topics.find((t) => t.id === 'jfic-bedtime-and-dreams')).toMatchObject({ active: true, done: 1, inProgress: 0, section: 'Juvenile Fiction', kind: 'juvenile-fiction' })
    expect(snap.settings).toMatchObject({ smtpPort: 587, smtpSecure: false })
    expect(snap.secretsSet).not.toContain('nothing')
  })

  it('a running job shows task and book on the agent', async () => {
    // the mock is fast, so look at the agent.state events that carried a task
    const withTask = env.events.filter((e) => e.type === 'agent.state' && e.task && e.book)
    expect(withTask.length).toBeGreaterThan(5)
  })
})

describe('commands', () => {
  it('rate writes rating and rating_note to book.md and emits book.updated', async () => {
    await env.engine.handleCommand({ type: 'rate', book: slug, rating: 4, note: 'Lovely, a bit short.' })
    const md = parseMd(await readFile(path.join(env.dir, 'books', slug, 'book.md'), 'utf8'))
    expect(md.data).toMatchObject({ rating: 4, rating_note: 'Lovely, a bit short.' })
    const upd = await waitFor(() => [...env.events].reverse().find((e) => e.type === 'book.updated' && e.book.rating === 4), 3000, 'book.updated')
    expect((upd as { book: BookSummary }).book.ratingNote).toBe('Lovely, a bit short.')
    await env.engine.handleCommand({ type: 'rate', book: slug, rating: 9 }) // out of range: ignored
    expect(parseMd(await readFile(path.join(env.dir, 'books', slug, 'book.md'), 'utf8')).data.rating).toBe(4)
  })

  it('setTopicActive writes topics.md and emits topics.updated', async () => {
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'fic-fantasy-epic', active: true })
    expect(await readFile(path.join(env.dir, 'topics.md'), 'utf8')).toMatch(/\| fic-fantasy-epic\s+\| Fantasy \/ Epic\s+\| fiction\s+\| yes/)
    await waitFor(() => env.events.find((e) => e.type === 'topics.updated' && e.topics.find((t) => t.id === 'fic-fantasy-epic')?.active), 3000, 'topics.updated')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'fic-fantasy-epic', active: false })
  })

  it('addIdea creates an idea file in ideas/', async () => {
    await env.engine.handleCommand({ type: 'addIdea', text: 'A lighthouse keeper who collects sleepy songs\nShe trades them for stars.', topic: 'jfic-bedtime-and-dreams' })
    const idea = (await env.engine.ideas.list()).find((i) => i.title.startsWith('A lighthouse keeper'))!
    expect(idea.data).toMatchObject({ source: 'user', status: 'open', topic: 'jfic-bedtime-and-dreams' })
    expect(idea.body).toContain('She trades them for stars.')
  })

  it('saveSettings writes config/settings.md, keeping the text below', async () => {
    await env.engine.handleCommand({ type: 'saveSettings', kindleAddress: ' me_1@kindle.com ', fromAddress: 'me@example.com', smtpHost: 'smtp.example.com', smtpPort: 465, smtpUser: 'me', smtpSecure: true })
    const md = parseMd(await readFile(path.join(env.dir, 'config', 'settings.md'), 'utf8'))
    expect(md.data).toMatchObject({ kind: 'settings', kindle_address: 'me_1@kindle.com', from_address: 'me@example.com', smtp_host: 'smtp.example.com', smtp_port: 465, smtp_user: 'me', smtp_secure: true })
    expect(md.body).toContain('Sending books to your Kindle')
    expect((await env.engine.snapshot()).settings).toMatchObject({ kindleAddress: 'me_1@kindle.com', smtpPort: 465, smtpSecure: true })
  })

  it('setSecret only accepts the allowlist and never logs a value', async () => {
    const allowed = env.engine.allowedSecrets()
    expect(allowed).toContain('SCRIPTORIUM_SMTP_PASSWORD')
    expect(allowed.every((n) => n === 'SCRIPTORIUM_SMTP_PASSWORD' || /^[A-Z][A-Z0-9_]*$/.test(n))).toBe(true)
    await env.engine.handleCommand({ type: 'setSecret', name: 'PATH', value: 'super-secret-value' })
    await env.engine.handleCommand({ type: 'setSecret', name: 'SOMETHING_ELSE', value: 'super-secret-value' })
    expect(env.logs.some((l) => l.includes('is not a name the app may store'))).toBe(true)
    expect(env.logs.join('\n')).not.toContain('super-secret-value')
    expect(env.events.some((e) => e.type === 'secrets.updated')).toBe(false)
  })

  it('setModel with null clears an agent override', async () => {
    const agent = (await env.engine.snapshot()).agents.find((a) => a.role === 'writer')!
    await env.engine.handleCommand({ type: 'setModel', agent: agent.id, model: 'r/review-model' })
    expect((await env.engine.snapshot()).agents.find((a) => a.id === agent.id)).toMatchObject({ model: 'r/review-model', resolvedModel: 'r/review-model' })
    await env.engine.handleCommand({ type: 'setModel', agent: agent.id, model: null })
    expect((await env.engine.snapshot()).agents.find((a) => a.id === agent.id)).toMatchObject({ model: null, resolvedModel: 'w/writer-model' })
  })

  it('hire, fire and pause all send agent.hired, agent.removed and factory.paused', async () => {
    await env.engine.handleCommand({ type: 'hire', role: 'writer', name: 'Newcomer Pen' })
    const hired = await waitFor(() => last('agent.hired'), 3000, 'agent.hired')
    expect(hired.agent).toMatchObject({ id: 'writer-newcomer-pen', role: 'writer', resolvedModel: 'w/writer-model', state: 'idle' })
    await env.engine.handleCommand({ type: 'fire', agent: 'writer-newcomer-pen', now: true })
    await waitFor(() => env.events.find((e) => e.type === 'agent.removed' && e.agent === 'writer-newcomer-pen'), 3000, 'agent.removed')
    await env.engine.handleCommand({ type: 'pauseAll' })
    expect(await waitFor(() => last('factory.paused'), 2000, 'factory.paused')).toMatchObject({ paused: true })
    await env.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(() => env.events.filter((e) => e.type === 'factory.paused').length >= 2, 2000, 'second factory.paused')
  })
})

describe('Send to Kindle', () => {
  it('fails clearly without settings, then mails the EPUB with the JSON transport', async () => {
    await env.engine.handleCommand({ type: 'saveSettings', kindleAddress: '', fromAddress: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpSecure: false })
    await env.engine.handleCommand({ type: 'sendToKindle', book: slug })
    expect(last('kindle.sent')).toMatchObject({ book: slug, ok: false, error: expect.stringContaining('Kindle address') })
    await env.engine.handleCommand({ type: 'sendToKindle', book: 'no-such-book' })
    expect(last('kindle.sent')).toMatchObject({ ok: false, error: expect.stringContaining('no book') })

    await env.engine.handleCommand({ type: 'saveSettings', kindleAddress: 'me_1@kindle.com', fromAddress: 'me@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'me', smtpSecure: false })
    await env.engine.handleCommand({ type: 'sendToKindle', book: slug })
    expect(last('kindle.sent')).toMatchObject({ book: slug, ok: true })
    expect(sent).toHaveLength(1)
    const mail = sent[0] as { to: { address: string }[]; from: { address: string }; subject: string; attachments: { filename: string; contentType: string; content: string }[] }
    expect(mail.to[0]!.address).toBe('me_1@kindle.com')
    expect(mail.from.address).toBe('me@example.com')
    expect(mail.subject).toBe('The Sleepy Fox')
    expect(mail.attachments[0]).toMatchObject({ filename: `${slug}.epub`, contentType: 'application/epub+zip' })
    // the attachment is the real EPUB: a zip that starts with PK
    expect(Buffer.from(mail.attachments[0]!.content, 'base64').subarray(0, 2).toString()).toBe('PK')
  })

  it('reports a transport failure without leaking anything', async () => {
    const { Engine } = await import('../src/engine/engine')
    const again = new Engine({
      dataDir: env.dir,
      emit: (e) => events2.push(e),
      registry: { mock: env.mock },
      discover: false,
      mailTransport: () => ({ sendMail: async () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:587')) }) as never
    })
    const events2: EngineEvent[] = []
    await again.start()
    try {
      await again.handleCommand({ type: 'sendToKindle', book: slug })
      expect(events2.find((e) => e.type === 'kindle.sent')).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') })
    } finally {
      await again.stop()
    }
  })
})

describe('reader', () => {
  it('writes books/<slug>/out/reader with an index, chapters, CSS and a cover page', async () => {
    const dir = path.join(env.dir, 'books', slug, 'out', 'reader')
    for (const f of ['index.html', 'style.css', 'cover.xhtml', 'title.xhtml', 'chapter-01.xhtml']) expect(existsSync(path.join(dir, f)), f).toBe(true)
    const index = await readFile(path.join(dir, 'index.html'), 'utf8')
    expect(index).toContain('href="chapter-01.xhtml"')
    expect(index).toContain('The Sleepy Fox')
    const ch = await readFile(path.join(dir, 'chapter-01.xhtml'), 'utf8')
    expect(ch).toContain('<p>')
    expect(ch).toContain('href="style.css"')
  })

  it('rebuild-reader writes it again for existing books', async () => {
    const { rebuildReader } = await import('../src/engine/cli')
    const { rm } = await import('node:fs/promises')
    await rm(path.join(env.dir, 'books', slug, 'out', 'reader'), { recursive: true, force: true })
    await sleep(10)
    expect(await rebuildReader(['--data', env.dir])).toBe(0)
    expect(existsSync(path.join(env.dir, 'books', slug, 'out', 'reader', 'index.html'))).toBe(true)
  })
})

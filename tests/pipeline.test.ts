import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { advance } from '../src/engine/pipeline/advance'
import type { BookState, ReviewSummary } from '../src/engine/pipeline/advance'
import { decide, weightedScore } from '../src/engine/pipeline/scoring'
import { markdownToXhtml } from '../src/engine/publish/xhtml'
import { parseTopics } from '../src/engine/store/topics'
import { parseMd } from '../src/shared/md'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, sleep, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const parseMdFile = async (f: string) => parseMd(await readFile(f, 'utf8'))
const bookMd = async (e: Env, slug: string) => parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8'))
const firstBook = async (e: Env) => (await readdir(path.join(e.dir, 'books')))[0]
const stageOf = async (e: Env) => {
  try {
    const slug = await firstBook(e)
    return slug ? (await bookMd(e, slug)).data.stage : undefined
  } catch {
    return undefined // the book folder exists but book.md is not written yet
  }
}
const waitStage = (e: Env, stage: string, ms = 60000) => waitFor(async () => ((await stageOf(e)) === stage ? await firstBook(e) : null), ms, `stage ${stage}`)

/** Checks tags are balanced and attributes quoted: enough to catch bad XHTML. */
function assertWellFormed(xml: string, name: string): void {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '').replace(/<!--[\s\S]*?-->/g, '')
  const stack: string[] = []
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    const [, close, tag, , self] = m
    if (self) continue
    if (close) expect(stack.pop(), `${name}: closing </${tag}>`).toBe(tag)
    else stack.push(tag!)
  }
  expect(stack, `${name}: unclosed tags`).toEqual([])
  expect(body.replace(/<[^>]*>/g, ''), `${name}: stray ampersand or angle bracket`).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)|[<>]/i)
}

async function checkEpub(file: string, opts: { chapters: number; title: string; author: string; coverImage?: boolean }) {
  const buf = await readFile(file)
  // mimetype is the first entry and stored uncompressed
  expect(buf.readUInt32LE(0)).toBe(0x04034b50)
  expect(buf.readUInt16LE(8)).toBe(0) // compression method 0 = stored
  expect(buf.subarray(30, 38).toString()).toBe('mimetype')
  expect(buf.subarray(38, 38 + 20).toString()).toBe('application/epub+zip')
  const zip = await JSZip.loadAsync(buf)
  expect(Object.keys(zip.files)[0]).toBe('mimetype')
  expect(Object.keys(zip.files).filter((f) => f.endsWith('/'))).toEqual([])
  const container = await zip.file('META-INF/container.xml')!.async('string')
  assertWellFormed(container, 'container.xml')
  expect(container).toContain('full-path="OEBPS/content.opf"')
  const opf = await zip.file('OEBPS/content.opf')!.async('string')
  assertWellFormed(opf, 'content.opf')
  expect(opf).toContain('version="3.0"')
  expect(opf).toContain(`<dc:title>${opts.title}</dc:title>`)
  expect(opf).toContain(`<dc:creator id="creator">${opts.author}</dc:creator>`)
  expect(opf).toContain('<dc:language>en</dc:language>')
  expect(opf).toMatch(/<dc:subject>.+<\/dc:subject>/)
  expect(opf).toMatch(/<dc:description>.{10,}<\/dc:description>/)
  expect(opf).toMatch(/<dc:identifier id="book-id">urn:uuid:[0-9a-f-]{36}<\/dc:identifier>/)
  expect(opf).toMatch(/<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/)
  expect(opf).toContain('<dc:contributor id="contributor">Scriptorium (AI)</dc:contributor>')
  expect(opf).toContain('properties="nav"')
  expect(!!zip.file('OEBPS/images/cover.png')).toBe(!!opts.coverImage)
  expect(opf.includes('properties="cover-image"')).toBe(!!opts.coverImage)
  // every manifest item exists, every spine item is in the manifest
  const hrefs = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)].map((m) => ({ id: m[1]!, href: m[2]! }))
  for (const h of hrefs) expect(zip.file(`OEBPS/${h.href}`), h.href).toBeTruthy()
  for (const s of opf.matchAll(/<itemref idref="([^"]+)"/g)) expect(hrefs.some((h) => h.id === s[1])).toBe(true)
  const chapterFiles = Object.keys(zip.files).filter((f) => /OEBPS\/chapter-\d+\.xhtml$/.test(f))
  expect(chapterFiles).toHaveLength(opts.chapters)
  for (const f of ['OEBPS/nav.xhtml', 'OEBPS/title.xhtml', 'OEBPS/cover.xhtml', ...chapterFiles]) assertWellFormed(await zip.file(f)!.async('string'), f)
  const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
  expect(nav).toContain('epub:type="toc"')
  expect((await zip.file('OEBPS/title.xhtml')!.async('string'))).toContain('Written by an AI writer')
  return zip
}

describe('bedtime story, mock e2e', () => {
  it('an empty folder with one active topic runs to a published book with a valid EPUB and updated counts', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', maxBooks: 1 })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)

    expect(data.length_gate).toMatchObject({ status: 'ok' })
    expect(data).toMatchObject({ format: 'bedtime-toddler', topic: 'jfic-bedtime-and-dreams', age_band: '2-4', round: 0, stage: 'published', title: 'The Sleepy Fox', cover_png: 'pending' })
    expect(data.author).toBe(data.writer_agent === 'writer-mara-quill' ? 'Mara Quill' : 'Tobias Wren')
    expect(data.writer_family).toBe('wfam')
    expect(data.score).toBeGreaterThanOrEqual(7)
    expect(data.uuid).toMatch(/^[0-9a-f-]{36}$/)
    // "how it was made": a line per job with model and prompt version
    const made = await env.engine.books.readMade(slug) as { task: string; model: string; prompt_version: string; role: string }[]
    expect(data.jobs).toBe(made.length)
    expect(data.models).toMatchObject({ 'w/writer-model': expect.any(Number), 'r/review-model': 8 })
    expect(made.map((m) => m.task)).toEqual(expect.arrayContaining(['start_book', 'pitch', 'outline', 'draft_chapter', 'review', 'publish']))
    expect(made.filter((m) => m.task === 'review')).toHaveLength(8)
    for (const m of made) expect(m.prompt_version, m.task).toMatch(/^[0-9a-f]{8}$/)
    expect(made.find((m) => m.task === 'draft_chapter')!.model).toBe('w/writer-model')
    expect(made.filter((m) => m.task === 'review').every((m) => m.model === 'r/review-model')).toBe(true) // a different family than the writer

    const dirOf = (...p: string[]) => path.join(env!.dir, 'books', slug, ...p)
    for (const f of ['pitch.md', 'outline.md', 'bible/bible.md', 'chapters/ch-01.md', 'cover-brief.md', 'illustration-briefs.md', 'out/cover.html', `out/${slug}.epub`]) {
      expect(existsSync(dirOf(f)), f).toBe(true)
    }
    expect((await readdir(dirOf('reviews'))).sort()).toEqual(
      ['child-safety-reviewer', 'continuity-checker', 'copy-editor', 'beta-reader', 'developmental-editor', 'line-editor', 'originality-checker', 'read-aloud-reviewer'].sort().map((r) => `book-${r}-r0.md`).sort()
    )
    expect(await readFile(dirOf('out', 'cover.html'), 'utf8')).toMatch(/The Sleepy Fox[\s\S]*(Mara Quill|Tobias Wren)[\s\S]*Bedtime/)

    await checkEpub(dirOf('out', `${slug}.epub`), { chapters: 1, title: 'The Sleepy Fox', author: data.author as string })

    // topics.md: one done, the count of books in progress matches the folders, nothing else changed.
    // The factory starts the next book as soon as this one is published, so freeze it first (pause all, let running jobs end) to read a consistent state.
    await env.engine.handleCommand({ type: 'pauseAll' })
    await waitFor(() => env!.engine.scheduler.runningJobs().length === 0, 20000, 'running jobs to end')
    const rows = parseTopics(await readFile(path.join(env.dir, 'topics.md'), 'utf8'))
    const row = rows.find((r) => r.id === 'jfic-bedtime-and-dreams')!
    let started = 0
    for (const s of await readdir(path.join(env.dir, 'books'))) if (!['published', 'rejected', 'failed'].includes(await bookMd(env, s).then((b) => String(b.data.stage), () => 'new'))) started++
    expect(row).toMatchObject({ active: true, done: 1, inProgress: started, target: 5 })
    expect(rows.filter((r) => r.active)).toHaveLength(1)
    // the idea bucket was filled by the idea generator (the first book started from the topic, before any idea existed)
    const ideas = await env.engine.ideas.list()
    expect(ideas.length).toBeGreaterThanOrEqual(3)
    expect(ideas.every((i) => i.data.source === 'generated')).toBe(true)
    expect(env.events.some((e) => e.type === 'book.stage' && e.stage === 'published')).toBe(true)
    // headless engine: no renderer, so the PNG is pending
    expect(env.events.some((e) => e.type === 'cover.render')).toBe(false)
  }, 90000)

  it('a chapter book gets several chapters, all in the EPUB', async () => {
    env = await makePipelineEnv({ activate: ['jfic-chapter-books-everyday-adventures'], format: 'chapter-book' })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)
    expect(data.format).toBe('chapter-book')
    const chapters = (await readdir(path.join(env.dir, 'books', slug, 'chapters'))).filter((f) => f.endsWith('.md'))
    expect(chapters.length).toBeGreaterThanOrEqual(6)
    await checkEpub(path.join(env.dir, 'books', slug, 'out', `${slug}.epub`), { chapters: chapters.length, title: 'The Sleepy Fox', author: data.author as string })
    // the writer of the first chapter wrote them all (agent hint)
    const agents = new Set(((await env.engine.books.readMade(slug)) as unknown as { task: string; agent: string }[]).filter((m) => m.task === 'draft_chapter').map((m) => m.agent))
    expect(agents.size).toBe(1)
    expect(env.counters.calls.draft_chapter).toBe(chapters.length)
  }, 90000)

  it('a revise round: the notes are merged, the chapter is rewritten, round 1 passes', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', revise: { 'line-editor': [0], 'read-aloud-reviewer': [0] } })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)
    expect(data.round).toBe(1)
    expect(data.rounds).toBe(1)
    expect(env.counters.calls.rewrite_chapter).toBe(1)
    expect(env.counters.calls['review:line-editor']).toBe(2)
    const ch = parseMd(await readFile(path.join(env.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(ch.data.round).toBe(1)
    expect(existsSync(path.join(env.dir, 'books', slug, 'chapters', 'history', 'ch-01-r0.md'))).toBe(true)
    expect(existsSync(path.join(env.dir, 'books', slug, 'reviews', 'book-line-editor-r1.md'))).toBe(true)
    // the rewrite job saw the merged notes of both reviewers
    const rewriteJob = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--rewrite--ch01--r1.md`), 'utf8'))
    expect(rewriteJob.body).toContain('line editor')
    expect(rewriteJob.body).toContain('read aloud reviewer')
  }, 90000)

  it('length gate: a draft far under the range gets one rewrite with a length note before the reviews', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', shortDrafts: true })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)
    expect(data.length_gate).toMatchObject({ status: 'done', words_before: 60 })
    expect(data.round).toBe(0) // the length rewrite is not a review round
    const job = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--rewrite--ch01--len.md`), 'utf8'))
    expect(job.body).toMatch(/60 words.*300 to 800 words/)
    expect(job.body).toContain('too short')
    const ch = parseMd(await readFile(path.join(env.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(ch.data.fixes).toEqual(['len'])
    expect(Number(ch.data.words)).toBeGreaterThanOrEqual(255)
    expect(env.counters.calls.rewrite_chapter).toBe(1)
    // the reviews came after the rewrite
    const rewritten = (await parseMdFile(path.join(env.dir, 'jobs', 'done', `${slug}--rewrite--ch01--len.md`))).data.finished as string
    const review = (await parseMdFile(path.join(env.dir, 'jobs', 'done', `${slug}--review--line-editor--r0.md`))).data
    expect(Date.parse(String(review.created))).toBeGreaterThanOrEqual(Date.parse(rewritten) - 5)
  }, 90000)

  it('a forced must-pass failure (child safety) ends in rejected, with the reasons and no EPUB', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', revise: { 'child-safety-reviewer': [0, 1, 2] } })
    const slug = (await waitStage(env, 'rejected'))!
    const { data } = await bookMd(env, slug)
    expect(data.round).toBe(2)
    expect(String((data.reasons as string[]).join(' '))).toMatch(/must-pass gate failed: child-safety-reviewer/)
    expect(existsSync(path.join(env.dir, 'books', slug, 'out', `${slug}.epub`))).toBe(false)
    expect(env.counters.calls.publish ?? 0).toBe(0) // no LLM call for a rejection
    const row = parseTopics(await readFile(path.join(env.dir, 'topics.md'), 'utf8')).find((r) => r.id === 'jfic-bedtime-and-dreams')!
    expect(row).toMatchObject({ done: 0, inProgress: 0 })
    // the folder stays: pitch, chapters and reviews are still there
    expect(existsSync(path.join(env.dir, 'books', slug, 'reviews', 'book-child-safety-reviewer-r2.md'))).toBe(true)
  }, 90000)
})

describe('choosing what to write', () => {
  it('your ideas are picked before generated ones', async () => {
    env = await makePipelineEnv({
      activate: ['jfic-bedtime-and-dreams'],
      format: 'bedtime-toddler',
      beforeStart: async (dir) => {
        const { IdeaStore } = await import('../src/engine/store/ideas')
        const store = new IdeaStore(dir)
        await store.create({ title: 'Generated Old Idea', pitch: 'generated earlier', topic: 'jfic-bedtime-and-dreams', source: 'generated' })
        await sleep(20)
        // a plain text file, no frontmatter at all
        await writeFile(path.join(dir, 'ideas', 'my-own.md'), 'The Hedgehog Who Counted Stars\n\nA hedgehog counts stars until she falls asleep.\n')
      }
    })
    const slug = (await waitFor(async () => (await firstBook(env!)) ?? null, 30000, 'first book'))!
    const { data } = await bookMd(env, slug)
    expect(data.idea).toBe('my-own')
    const mine = (await env.engine.ideas.list()).find((i) => i.slug === 'my-own')!
    expect(mine.data).toMatchObject({ status: 'used', book: slug, source: 'user' })
    expect(mine.title).toBe('The Hedgehog Who Counted Stars')
  }, 90000)

  it('does nothing and warns once when no topic is active and there is no idea', async () => {
    env = await makePipelineEnv({})
    await sleep(900) // several factory ticks
    expect(await readdir(path.join(env.dir, 'books'))).toEqual([])
    expect(await readdir(path.join(env.dir, 'jobs', 'queued'))).toEqual([])
    const warnings = env.events.filter((e) => e.type === 'engine.warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('no topic is active') })
    expect(env.logs.filter((l) => l.includes('no topic is active'))).toHaveLength(1)
  })

  it('does not start more books than max_books_in_progress', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams', 'jfic-bedtime-moon-and-stars'], format: 'bedtime-toddler', maxBooks: 2 })
    await waitFor(async () => (await readdir(path.join(env!.dir, 'books'))).length >= 2, 30000, 'two books')
    await sleep(500)
    // with 2 in progress at the same time, no third book starts before one is done
    // a folder whose book.md is not written yet counts as open
    const stages = await Promise.all((await readdir(path.join(env.dir, 'books'))).map(async (s) => (await bookMd(env!, s).then((b) => b.data.stage, () => 'new'))))
    const open = stages.filter((s) => s !== 'published' && s !== 'rejected').length
    expect(open).toBeLessThanOrEqual(2)
  }, 60000)
})

describe('cover rendering', () => {
  it('asks Electron for a PNG, then rebuilds the EPUB with the image', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', coverRenderer: true })
    const e = env
    // a fake renderer: writes a PNG and answers with the command
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    let handled = 0
    const timer = setInterval(() => {
      const req = e.events.filter((x) => x.type === 'cover.render')[handled]
      if (req && req.type === 'cover.render') {
        handled++
        void writeFile(req.outPath, png).then(() => e.engine.handleCommand({ type: 'coverRendered', book: req.book, ok: true }))
      }
    }, 20)
    try {
      const slug = (await waitStage(e, 'published'))!
      const req = await waitFor(() => e.events.find((x) => x.type === 'cover.render'), 10000, 'cover.render event')
      expect(req).toMatchObject({ type: 'cover.render', book: slug, width: 1600, height: 2560 })
      expect((req as { htmlPath: string }).htmlPath).toBe(path.join(e.dir, 'books', slug, 'out', 'cover.html'))
      await waitFor(async () => (await bookMd(e, slug)).data.cover_png === 'done', 10000, 'cover done')
      const { data } = await bookMd(e, slug)
      await checkEpub(path.join(e.dir, 'books', slug, 'out', `${slug}.epub`), { chapters: 1, title: 'The Sleepy Fox', author: data.author as string, coverImage: true })
    } finally {
      clearInterval(timer)
    }
  }, 90000)

  it('on start, covers that are still pending are requested again', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const slug = (await waitStage(env, 'published'))!
    const dir = env.dir
    await env.engine.stop()
    // restart the same folder with a renderer available
    const { Engine } = await import('../src/engine/engine')
    const events: unknown[] = []
    const again = new Engine({ dataDir: dir, emit: (x) => events.push(x), registry: { mock: env.mock }, discover: false, coverRenderer: true, pollMs: 30, tickMs: 100 })
    await again.start()
    try {
      expect(events).toContainEqual(expect.objectContaining({ type: 'cover.render', book: slug }))
    } finally {
      await again.stop()
    }
  }, 90000)
})

describe('pure parts', () => {
  const format = formatEntrySchema.parse({ id: 'f', name: 'F', enabled: true, juvenile: true, read_aloud: true, words: [100, 200], chapters: [2, 2] })
  const quality = qualitySchema.parse({ kind: 'quality', max_rounds: 2 })
  const base = (over: Partial<BookState> = {}): BookState => ({
    slug: 'b',
    stage: 'new',
    round: 0,
    rewriteChapters: [],
    writerFamily: 'wfam',
    writerAgent: 'writer-x',
    format,
    quality,
    hasPitch: false,
    outlineChapters: null,
    chapters: new Map(),
    outlineRound: 0,
    acts: [],
    actReviewFiles: new Set(),
    outlineReview: null,
    chapterChecks: new Map(),
    settled: new Set(),
    actSummaries: new Set(),
    actReviews: new Set(),
    repetitionReport: false,
    fixes: new Map(),
    totalWords: 150,
    lengthGate: { status: 'ok' },
    reviews: new Map(),
    failedJobs: [],
    ...quietResearchState(),
    ...over
  })

  it('advance walks pitch, outline, drafting, reviews, rewrite and publish with deterministic ids', () => {
    expect(advance(base()).jobs.map((j) => j.id)).toEqual(['b--pitch--book--r0'])
    expect(advance(base({ hasPitch: true })).jobs.map((j) => j.id)).toEqual(['b--outline--book--r0'])
    const drafting = advance(base({ hasPitch: true, outlineChapters: 2, chapters: new Map([[1, 0]]) }))
    expect(drafting.jobs.map((j) => j.id)).toEqual(['b--draft--ch02--r0'])
    expect(drafting.jobs[0]!.agent_hint).toBe('writer-x')
    const all = new Map([[1, 0], [2, 0]])
    const reviewing = advance(base({ hasPitch: true, outlineChapters: 2, chapters: all }))
    expect(reviewing.jobs.map((j) => j.role).sort()).toEqual(['beta-reader', 'child-safety-reviewer', 'continuity-checker', 'copy-editor', 'developmental-editor', 'line-editor', 'originality-checker', 'read-aloud-reviewer'])
    expect(reviewing.jobs.every((j) => j.avoid_family === 'wfam')).toBe(true)
    // same input, same output
    expect(advance(base({ hasPitch: true, outlineChapters: 2, chapters: all }))).toEqual(reviewing)
    // all pass: publish
    const reviews = new Map<string, ReviewSummary>(reviewing.jobs.map((j) => [`${j.role}:0`, { verdict: 'pass', chapters: [] }]))
    expect(advance(base({ hasPitch: true, outlineChapters: 2, chapters: all, reviews })).jobs.map((j) => j.id)).toEqual(['b--publish--book--r0'])
    // one revise naming chapter 2: rewrite only chapter 2, round 1
    reviews.set('line-editor:0', { verdict: 'revise', chapters: [2] })
    const rewrite = advance(base({ hasPitch: true, outlineChapters: 2, chapters: all, reviews }))
    expect(rewrite.patch).toMatchObject({ stage: 'rewriting', round: 1, rewrite_chapters: [2] })
    expect(rewrite.jobs.map((j) => j.id)).toEqual(['b--rewrite--ch02--r1'])
    // at the last round a revise no longer rewrites
    const r2 = new Map<string, ReviewSummary>(reviewing.jobs.map((j) => [`${j.role}:2`, { verdict: 'revise', chapters: [] }]))
    expect(advance(base({ stage: 'reviewing', round: 2, hasPitch: true, outlineChapters: 2, chapters: new Map([[1, 2], [2, 2]]), reviews: r2 })).jobs.map((j) => j.id)).toEqual(['b--publish--book--r2'])
    // terminal and failed
    expect(advance(base({ stage: 'published' }))).toEqual({ patch: {}, jobs: [] })
    expect(advance(base({ failedJobs: ['b--pitch--book--r0'] })).patch).toMatchObject({ stage: 'failed' })
  })

  it('scoring: weights, must-pass gates and the threshold', () => {
    const r = (role: string, verdict: 'pass' | 'revise', scores: Record<string, number>) => ({ role, verdict, scores, notes: 'n' })
    const reviews = [r('line-editor', 'pass', { prose: 8 }), r('beta-reader', 'pass', { enjoyment: 6, genre_fit: 6 }), r('child-safety-reviewer', 'pass', { age_fit: 10 })]
    const q = qualitySchema.parse({ kind: 'quality', threshold: 7, weights: { prose: 2, age_fit: 1, enjoyment: 1, genre_fit: 1 } })
    expect(weightedScore(reviews, q.weights).score).toBeCloseTo((8 * 2 + 6 + 6 + 10) / 5, 2)
    expect(decide(reviews, q)).toMatchObject({ publish: true })
    const low = decide([r('line-editor', 'pass', { prose: 5 })], q)
    expect(low.publish).toBe(false)
    expect(low.reasons[0]).toMatch(/below the threshold/)
    const gate = decide([r('child-safety-reviewer', 'revise', { age_fit: 9 }), r('line-editor', 'pass', { prose: 9 })], q)
    expect(gate.publish).toBe(false)
    expect(gate.reasons[0]).toMatch(/must-pass gate failed: child-safety-reviewer/)
  })

  it('markdown to XHTML escapes, closes tags and handles scene breaks', () => {
    const html = markdownToXhtml('One *soft* & **big** day.\nNext line.\n\n---\n\n"Hi," said <Fox>.')
    expect(html).toBe('<p>One <em>soft</em> &amp; <strong>big</strong> day.<br/>Next line.</p>\n<hr class="scene-break"/>\n<p>&quot;Hi,&quot; said &lt;Fox&gt;.</p>')
  })
})

describe('topics.md', () => {
  const text = `---
kind: topics
---
# Topics

Some text I wrote.

## Fiction

| id     | topic         | kind    | active | target | done | in progress |
|--------|---------------|---------|--------|--------|------|-------------|
| a-one  | Alpha / One   | fiction |  Y     |   3    |      |             |
| a-two  |Alpha / Two|fiction|x||1|2|
| a-three | Alpha Three | fiction | no | 5 | | |

## Other

id | topic | kind | active | target | done | in progress
--- | --- | --- | --- | --- | --- | ---
b-one | Beta | nonfiction | yes |  |  |
`

  it('parses aligned and sloppy tables and every yes/no spelling', () => {
    const rows = parseTopics(text)
    expect(rows.map((r) => [r.id, r.active, r.target, r.done, r.inProgress, r.section])).toEqual([
      ['a-one', true, 3, 0, 0, 'Fiction'],
      ['a-two', true, 0, 1, 2, 'Fiction'],
      ['a-three', false, 5, 0, 0, 'Fiction'],
      ['b-one', true, 0, 0, 0, 'Other']
    ])
  })

  it('updates only the count cells and keeps everything else byte for byte', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-topics-'))
    try {
      const { TopicsFile } = await import('../src/engine/store/topics')
      await writeFile(path.join(dir, 'topics.md'), text)
      const t = new TopicsFile(dir)
      await Promise.all([t.adjust('a-one', { inProgress: 1 }), t.adjust('a-one', { inProgress: 1 }), t.adjust('a-two', { done: 1, inProgress: -1 }), t.adjust('b-one', { inProgress: 1 })])
      expect(await t.adjust('nope', { done: 1 })).toBe(false)
      const next = await readFile(path.join(dir, 'topics.md'), 'utf8')
      const rows = parseTopics(next)
      expect(rows.find((r) => r.id === 'a-one')).toMatchObject({ inProgress: 2, done: 0, active: true, target: 3 })
      expect(rows.find((r) => r.id === 'a-two')).toMatchObject({ done: 2, inProgress: 1 })
      expect(rows.find((r) => r.id === 'b-one')).toMatchObject({ inProgress: 1 })
      // everything outside the changed cells is untouched
      const a = text.split('\n')
      const b = next.split('\n')
      expect(b).toHaveLength(a.length)
      const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0)
      expect(changed.length).toBe(3)
      expect(b[a.indexOf('| a-one  | Alpha / One   | fiction |  Y     |   3    |      |             |')]).toContain('|  Y     |   3    |')
      // the rows keep their width where the number fits
      expect(b[a.findIndex((l) => l.startsWith('| a-one'))]!.length).toBe(a.find((l) => l.startsWith('| a-one'))!.length)
      await t.setActive('a-three', true)
      expect(parseTopics(await readFile(path.join(dir, 'topics.md'), 'utf8')).find((r) => r.id === 'a-three')!.active).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the seed list has 250 to 450 rows, all inactive, with unique ids and the expected kinds', async () => {
    const rows = parseTopics(await readFile(path.resolve(__dirname, '../seed/topics.md'), 'utf8'))
    expect(rows.length).toBeGreaterThanOrEqual(250)
    expect(rows.length).toBeLessThanOrEqual(450)
    expect(rows.every((r) => !r.active)).toBe(true)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.topic.toLowerCase())).size).toBe(rows.length) // names are unique too, they show in the UI
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['fiction', 'juvenile-fiction', 'juvenile-nonfiction', 'nonfiction']))
    for (const id of ['jfic-bedtime-and-dreams', 'jfic-chapter-books-everyday-adventures', 'jfic-bedtime-moon-and-stars']) expect(rows.some((r) => r.id === id), id).toBe(true)
  })
})

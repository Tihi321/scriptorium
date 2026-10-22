import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { advance } from '../src/engine/pipeline/advance'
import { retryStage } from '../src/engine/pipeline/pipeline'
import type { BookState, ReviewSummary } from '../src/engine/pipeline/advance'
import { decide, weightedScore } from '../src/engine/pipeline/scoring'
import { ancestors, chapterPlace, checkBranches } from '../src/engine/pipeline/branches'
import { choicesHtml, markdownToXhtml, scriptToXhtml } from '../src/engine/publish/xhtml'
import { writeMd } from '../src/engine/store/atomic'
import { parseTopics } from '../src/engine/store/topics'
import { parseMd } from '../src/shared/md'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { ProviderError } from '../src/engine/models/types'
import { makePipelineEnv, quietResearchState, sleep, waitFor } from './helpers'
import type { TestEnv } from './helpers'

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
/** One book only: the topic is switched off once the first book exists, so the factory starts no second one that would race with the test. */
const oneBookOnly = async (e: Env) => {
  await waitFor(async () => (await readdir(path.join(e.dir, 'books'))).length > 0, 30000, 'the first book')
  await e.engine.handleCommand({ type: 'setTopicActive', id: 'jfic-bedtime-and-dreams', active: false })
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
    expect(data.author).toBe({ 'writer-elena-rook': 'Elena Rook', 'writer-mara-quill': 'Mara Quill', 'writer-tobias-wren': 'Tobias Wren' }[data.writer_agent as string])
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
    expect(await readFile(dirOf('out', 'cover.html'), 'utf8')).toMatch(/The Sleepy Fox[\s\S]*(Elena Rook|Mara Quill|Tobias Wren)[\s\S]*Bedtime/)

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

  it('a book whose job failed for good can be retried and continues from the stage it failed in', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', maxBooks: 1 })
    const e = env
    const down = e.mock.on({ task: 'review' }, () => {
      throw new ProviderError('reviewer model down', 400, false)
    })
    const failedSlug = async () => {
      for (const s of await readdir(path.join(e.dir, 'books'))) if ((await bookMd(e, s).then((b) => b.data.stage, () => null)) === 'failed') return s
      return null
    }
    const slug = (await waitFor(failedSlug, 60000, 'a failed book'))!
    await e.engine.handleCommand({ type: 'pauseAll' })
    await waitFor(() => e.engine.scheduler.runningJobs().length === 0, 20000, 'running jobs to end')
    const failed = await bookMd(e, slug)
    expect(failed.data).toMatchObject({ stage: 'failed', failed_from: 'reviewing' })
    const failedJobs = (await readdir(path.join(e.dir, 'jobs', 'failed'))).filter((f) => f.startsWith(`${slug}--review--`))
    expect(failedJobs.length).toBeGreaterThan(0)

    down()
    await e.engine.handleCommand({ type: 'retryBook', book: slug })
    const retried = await bookMd(e, slug)
    expect(retried.data.stage).toBe('reviewing')
    expect(retried.data.failed_from).toBeUndefined()
    expect(retried.data.reasons).toEqual([])
    expect((await readdir(path.join(e.dir, 'jobs', 'failed'))).filter((f) => f.startsWith(`${slug}--`))).toEqual([])
    const requeued = await parseMdFile(path.join(e.dir, 'jobs', 'queued', failedJobs[0]!))
    expect(requeued.data).toMatchObject({ attempts: 0, failure: null })
    expect(requeued.body).not.toMatch(/## (Request|Failed)/)
    // retrying a book that isn't failed does nothing
    await e.engine.handleCommand({ type: 'retryBook', book: slug })
    expect(e.logs.some((l) => l.includes(`retryBook: "${slug}" is not a failed book`))).toBe(true)

    await e.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => (await bookMd(e, slug)).data.stage === 'published', 60000, 'the retried book published')
  }, 120000)

  it('an outline one chapter short is asked for again with the count, not failed', async () => {
    env = await makePipelineEnv({ activate: ['jfic-chapter-books-everyday-adventures'], format: 'chapter-book', shortOutline: true })
    const e = env
    const slug = (await waitFor(async () => {
      for (const s of await readdir(path.join(e.dir, 'books'))) if (existsSync(path.join(e.dir, 'books', s, 'outline.md'))) return s
      return null
    }, 60000, 'an outline'))!
    const outline = await parseMdFile(path.join(e.dir, 'books', slug, 'outline.md'))
    expect((outline.data.chapters as unknown[]).length).toBe(6)
    const doneFile = path.join(e.dir, 'jobs', 'done', `${slug}--outline--book--r0.md`)
    await waitFor(() => existsSync(doneFile), 20000, 'the outline job done')
    const job = await readFile(doneFile, 'utf8')
    expect(job).toContain('This outline has 5 chapter(s), but this format needs 6 to 10')
  }, 90000)

  it('a draft can be read while it is written; your notes reach the writers, and a note can rewrite a chapter', async () => {
    env = await makePipelineEnv({ activate: ['jfic-chapter-books-everyday-adventures'], format: 'chapter-book' })
    const e = env
    const slug = (await waitFor(async () => {
      for (const s of await readdir(path.join(e.dir, 'books'))) if (existsSync(path.join(e.dir, 'books', s, 'chapters', 'ch-01.md'))) return s
      return null
    }, 60000, 'chapter 1'))!
    // stop writing: the book's jobs wait, running ones finish
    await e.engine.handleCommand({ type: 'pauseBook', book: slug, paused: true })
    await waitFor(() => e.engine.scheduler.runningJobs().every((j) => !j.jobId.startsWith(`${slug}--`)), 20000, 'the book idle')
    const summary = [...e.events].reverse().find((x) => x.type === 'book.updated' && x.book.slug === slug)
    expect(summary).toMatchObject({ book: { chaptersPlanned: 6, targetWords: expect.any(Number), paused: true } })
    expect((summary as Extract<typeof summary, { type: 'book.updated' }>)!.book.team.length).toBeGreaterThan(0)

    await e.engine.handleCommand({ type: 'readDraft', book: slug })
    const ready = [...e.events].reverse().find((x) => x.type === 'draft.ready')
    expect(ready).toMatchObject({ book: slug, dir: `books/${slug}/out/draft`, notes: '' })
    expect(ready).toMatchObject({ pages: expect.arrayContaining([{ file: 'chapter-01.xhtml', title: expect.stringMatching(/^Chapter 1: /), n: 1 }, expect.objectContaining({ title: 'Still to come' })]) })
    const index = await readFile(path.join(e.dir, 'books', slug, 'out', 'draft', 'index.html'), 'utf8')
    expect(index).toContain('Still to come')

    await e.engine.handleCommand({ type: 'addBookNote', book: slug, text: 'More owls, please.', chapter: 1, rewrite: true })
    expect(await readFile(path.join(e.dir, 'books', slug, 'notes.md'), 'utf8')).toMatch(/\(chapter 1\): More owls, please\./)
    const noteJob = (await readdir(path.join(e.dir, 'jobs', 'queued'))).find((f) => /--rewrite--ch01--note\d+\.md$/.test(f))!
    expect(noteJob).toBeTruthy()
    expect([...e.events].reverse().find((x) => x.type === 'draft.ready')).toMatchObject({ notes: expect.stringContaining('More owls') })
    await sleep(300)
    expect(existsSync(path.join(e.dir, 'jobs', 'queued', noteJob))).toBe(true) // still waiting: the book is paused

    await e.engine.handleCommand({ type: 'pauseBook', book: slug, paused: false })
    await waitFor(() => existsSync(path.join(e.dir, 'jobs', 'done', noteJob)), 30000, 'the note rewrite')
    expect(await readFile(path.join(e.dir, 'jobs', 'done', noteJob), 'utf8')).toContain("From the book's owner, who read the draft (this comes first): More owls, please.")
    // chapters drafted after the note see it
    await waitStage(e, 'published', 90000)
    const drafts = (await readdir(path.join(e.dir, 'jobs', 'done'))).filter((f) => f.startsWith(`${slug}--draft--`))
    const texts = await Promise.all(drafts.map((f) => readFile(path.join(e.dir, 'jobs', 'done', f), 'utf8')))
    expect(texts.some((t) => t.includes("## Notes from the book's owner") && t.includes('More owls, please.'))).toBe(true)
  }, 150000)

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

  it('a visual novel topic is written as a script and laid out as one in the EPUB', async () => {
    env = await makePipelineEnv({
      activate: ['vn-mystery'],
      format: 'visual-novel',
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'visual-novel' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)
    expect(data).toMatchObject({ format: 'visual-novel', topic: 'vn-mystery', script: true })
    // the writer got the script prompt, the line editor its visual novel review
    const draft = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--draft--ch01--r0.md`), 'utf8'))
    expect(draft.body).toContain('visual novel script')
    expect(draft.body).toContain('ON SCREEN:')
    const review = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--review--line-editor--r0.md`), 'utf8'))
    expect(review.body).toContain('line editor of a visual novel')
    const zip = await JSZip.loadAsync(await readFile(path.join(env.dir, 'books', slug, 'out', `${slug}.epub`)))
    const ch = await zip.file(Object.keys(zip.files).find((f) => /chapter-?0*1\.xhtml$/.test(f))!)!.async('string')
    expect(ch).toContain('class="vn-')
    expect(await readFile(path.join(env.dir, 'books', slug, 'out', 'reader', 'chapter-01.xhtml'), 'utf8')).toContain('class="vn-')
  }, 90000)

  it('a children\'s visual story with choices branches: writers see their path, chapters end with choice links', async () => {
    env = await makePipelineEnv({
      activate: ['jvn-animal-friends'],
      format: 'kids-choice-visual-story',
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'kids-choice-visual-story' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    const slug = (await waitStage(env, 'published'))!
    const { data } = await bookMd(env, slug)
    expect(data).toMatchObject({ format: 'kids-choice-visual-story', script: true, age_band: '6-9' })
    // the map: 1 -> 2, 3; 2 -> 4; 3 and 4 are endings
    const outline = await parseMdFile(path.join(env.dir, 'books', slug, 'outline.md'))
    const chapters = outline.data.chapters as { choices?: { to: number }[]; ending?: string }[]
    expect(chapters.map((c) => c.choices?.map((x) => x.to) ?? c.ending)).toEqual([[2, 3], [4], 'happy: the fox sleeps', 'happy: the fox sleeps'])
    expect(outline.body).toContain('Choices: "Go the way of part 2" (to chapter 2)')
    // the writer of chapter 4 saw only the path to it (1 and 2), and was told how readers get there and that it is an ending
    const draft = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--draft--ch04--r0.md`), 'utf8')).body
    expect(draft).toContain('### Chapter 2:')
    expect(draft).not.toContain('### Chapter 3:')
    expect(draft).toContain('Readers come into this chapter from: chapter 2, after choosing "Go the way of part 4".')
    expect(draft).toContain('This chapter is an ending')
    // reviewers (child safety too) read every path with the choices after each chapter
    for (const role of ['line-editor', 'child-safety-reviewer']) {
      const review = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--review--${role}--r0.md`), 'utf8')).body
      expect(review).toContain('This book is a story with choices')
      expect(review).toContain('[Choices: "Go the way of part 2" (to chapter 2); "Go the way of part 3" (to chapter 3)]')
    }
    const zip = await checkEpub(path.join(env.dir, 'books', slug, 'out', `${slug}.epub`), { chapters: 4, title: 'The Sleepy Fox', author: data.author as string })
    const ch1 = await zip.file('OEBPS/chapter-01.xhtml')!.async('string')
    expect(ch1).toContain('<li><a href="chapter-02.xhtml">Go the way of part 2</a></li>')
    expect(ch1).toContain('class="vn-')
    expect(await zip.file('OEBPS/chapter-03.xhtml')!.async('string')).toContain('<div class="the-end">')
    const reader1 = await readFile(path.join(env.dir, 'books', slug, 'out', 'reader', 'chapter-01.xhtml'), 'utf8')
    expect(reader1).toContain('href="chapter-03.xhtml"')
    expect(reader1).not.toContain('Next chapter')
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

  it('a rejected book is reopened for a rewrite round, rejected again, then reopened for a review round and published', async () => {
    // child safety says revise in rounds 0-3: the book is rejected at round 2 (the format's limit), and again at round 3 after the reopened rewrite
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', maxBooks: 1, revise: { 'child-safety-reviewer': [0, 1, 2, 3] } })
    const e = env
    await oneBookOnly(e)
    const slug = (await waitStage(e, 'rejected'))!
    // freeze the factory (it would start the next book) and let running jobs end
    await e.engine.handleCommand({ type: 'pauseAll' })
    await waitFor(() => e.engine.scheduler.runningJobs().length === 0, 20000, 'running jobs to end')
    expect((await bookMd(e, slug)).data).toMatchObject({ stage: 'rejected', round: 2 })
    const topicRow = async () => parseTopics(await readFile(path.join(e.dir, 'topics.md'), 'utf8')).find((r) => r.id === 'jfic-bedtime-and-dreams')!
    const rejectedInProgress = (await topicRow()).inProgress

    // a chapter that is not in the book is refused (nothing changes)
    await e.engine.handleCommand({ type: 'reopenBook', book: slug, mode: 'rewrite', chapters: [9] })
    expect(e.logs.some((l) => l.includes('reopenBook:') && l.includes('not in the book'))).toBe(true)
    expect((await bookMd(e, slug)).data.stage).toBe('rejected')

    // round 3: rewrite chapter 1
    await e.engine.handleCommand({ type: 'reopenBook', book: slug, mode: 'rewrite', chapters: [1] })
    const reopened = (await bookMd(e, slug)).data
    expect(reopened).toMatchObject({ stage: 'rewriting', round: 3, extra_rounds: 1, rewrite_chapters: [1], reasons: [] })
    expect(reopened.score).toBeUndefined()
    expect((await topicRow()).inProgress).toBe(rejectedInProgress + 1)
    expect(e.events.some((ev) => ev.type === 'book.stage' && ev.book === slug && ev.stage === 'rewriting')).toBe(true)
    // reopening a book that is no longer rejected does nothing
    await e.engine.handleCommand({ type: 'reopenBook', book: slug, mode: 'review' })
    expect(e.logs.some((l) => l.includes(`reopenBook: "${slug}" is not a rejected or published book`))).toBe(true)
    await e.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => {
      const d = (await bookMd(e, slug)).data
      return d.stage === 'rejected' && d.round === 3
    }, 60000, 'the book rejected again at round 3')
    // the rewrite ran as new jobs of round 3, and the reviews of round 3 exist
    expect(existsSync(path.join(e.dir, 'jobs', 'done', `${slug}--rewrite--ch01--r3.md`))).toBe(true)
    expect(existsSync(path.join(e.dir, 'books', slug, 'reviews', 'book-child-safety-reviewer-r3.md'))).toBe(true)
    expect(String(((await bookMd(e, slug)).data.reasons as string[]).join(' '))).toMatch(/must-pass gate failed: child-safety-reviewer/)

    // round 4: a review only, no rewrite. Child safety passes in round 4, so the book is published
    await e.engine.handleCommand({ type: 'pauseAll' })
    await waitFor(() => e.engine.scheduler.runningJobs().length === 0, 20000, 'running jobs to end')
    await e.engine.handleCommand({ type: 'reopenBook', book: slug, mode: 'review' })
    expect((await bookMd(e, slug)).data).toMatchObject({ stage: 'reviewing', round: 4, extra_rounds: 2 })
    await e.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => (await bookMd(e, slug)).data.stage === 'published', 60000, 'the book published at round 4')
    expect(existsSync(path.join(e.dir, 'jobs', 'done', `${slug}--rewrite--ch01--r4.md`))).toBe(false) // a review round rewrites nothing
    expect(existsSync(path.join(e.dir, 'books', slug, 'out', `${slug}.epub`))).toBe(true)
    expect((await bookMd(e, slug)).data.rounds).toBe(4)
  }, 180000)

  it('a published book is reopened for the chapters its reviews named, and published again', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', maxBooks: 1 })
    const e = env
    await oneBookOnly(e)
    const slug = (await waitStage(e, 'published'))!
    await e.engine.handleCommand({ type: 'pauseAll' })
    await waitFor(() => e.engine.scheduler.runningJobs().length === 0, 20000, 'running jobs to end')
    const topicRow = async () => parseTopics(await readFile(path.join(e.dir, 'topics.md'), 'utf8')).find((r) => r.id === 'jfic-bedtime-and-dreams')!
    const before = await topicRow()
    const was = (await bookMd(e, slug)).data
    expect(was.stage).toBe('published')
    const epub = path.join(e.dir, 'books', slug, 'out', `${slug}.epub`)
    expect(existsSync(epub)).toBe(true)

    // no chapters given and none named by the last reviews: refused, nothing changes
    expect(await e.engine.reopenBook(slug, 'rewrite')).toMatch(/give the chapters to rewrite/)
    expect((await bookMd(e, slug)).data.stage).toBe('published')
    expect(await topicRow()).toEqual(before)

    // a review of the last round names chapter 1 (even a pass can): that chapter is rewritten
    const reviews = path.join(e.dir, 'books', slug, 'reviews')
    const file = (await readdir(reviews)).find((f) => f.endsWith(`-r${was.round}.md`))!
    const doc = await parseMdFile(path.join(reviews, file))
    await writeMd(path.join(reviews, file), { ...doc.data, chapters: [1] }, doc.body)
    expect(await e.engine.reopenBook(slug, 'rewrite')).toBeNull()
    const round = Number(was.round) + 1
    expect((await bookMd(e, slug)).data).toMatchObject({ stage: 'rewriting', round, rewrite_chapters: [1], reopened_from: 'published', published_before: was.published, extra_rounds: 1 })
    const after = await topicRow()
    expect(after.done).toBe(before.done - 1)
    expect(after.inProgress).toBe(before.inProgress + 1)
    expect(existsSync(epub)).toBe(true) // the old EPUB stays until the book is published again
    await e.engine.handleCommand({ type: 'resumeAll' })
    await waitFor(async () => {
      const d = (await bookMd(e, slug)).data
      return d.stage === 'published' && d.round === round
    }, 60000, 'the book published again')
    expect(existsSync(path.join(e.dir, 'jobs', 'done', `${slug}--rewrite--ch01--r${round}.md`))).toBe(true)
    expect((await topicRow()).done).toBe(before.done)
  }, 180000)
})

describe('choosing what to write', () => {
  it('a story with role models starts a book that carries them in book.md', async () => {
    env = await makePipelineEnv({
      activate: ['jfic-bedtime-and-dreams'],
      format: 'bedtime-toddler',
      beforeStart: async (dir) => {
        const { IdeaStore } = await import('../src/engine/store/ideas')
        await new IdeaStore(dir).createStory({ title: 'The Bell Fox', premise: 'A fox rings a bell.', plot: '', characters: [], setting: '', style: '', sections: [], models: { writer: 'w/writer-model' } })
      }
    })
    const slug = (await waitFor(async () => (await firstBook(env!)) ?? null, 30000, 'first book'))!
    const data = (await waitFor(async () => (await bookMd(env!, slug).catch(() => null))?.data.title ? (await bookMd(env!, slug)).data : null, 30000, 'book.md')) as Record<string, unknown>
    expect(data.role_models).toEqual({ writer: 'w/writer-model' })
    expect(data.title).toBe('The Bell Fox')
    expect(parseMd(await readFile(path.join(env.dir, 'books', slug, 'brief.md'), 'utf8')).data.role_models).toEqual({ writer: 'w/writer-model' })
  }, 90000)

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

/** A fake cover renderer: writes a 1x1 PNG for every `cover.render` and answers. `stop` waits for the answers still on their way. */
function fakeCoverRenderer(e: TestEnv) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const answers: Promise<void>[] = []
  let seen = 0
  const timer = setInterval(() => {
    const reqs = e.events.filter((x) => x.type === 'cover.render')
    for (; seen < reqs.length; seen++) {
      const req = reqs[seen]
      if (req?.type === 'cover.render') answers.push(writeFile(req.outPath, png).then(() => e.engine.handleCommand({ type: 'coverRendered', book: req.book, ok: true })))
    }
  }, 20)
  return {
    /** How many renders were asked for this book. */
    renders: (book: string) => e.events.filter((x) => x.type === 'cover.render' && x.book === book).length,
    async stop() {
      clearInterval(timer)
      await Promise.all(answers)
    }
  }
}

describe('cover rendering', () => {
  it('asks Electron for a PNG, then rebuilds the EPUB with the image', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', coverRenderer: true })
    const e = env
    const renderer = fakeCoverRenderer(e)
    try {
      const slug = (await waitStage(e, 'published'))!
      const req = await waitFor(() => e.events.find((x) => x.type === 'cover.render'), 10000, 'cover.render event')
      expect(req).toMatchObject({ type: 'cover.render', book: slug, width: 1600, height: 2560 })
      expect((req as { htmlPath: string }).htmlPath).toBe(path.join(e.dir, 'books', slug, 'out', 'cover.html'))
      await waitFor(async () => (await bookMd(e, slug)).data.cover_png === 'done', 10000, 'cover done')
      const { data } = await bookMd(e, slug)
      await checkEpub(path.join(e.dir, 'books', slug, 'out', `${slug}.epub`), { chapters: 1, title: 'The Sleepy Fox', author: data.author as string, coverImage: true })
    } finally {
      await renderer.stop()
    }
  }, 90000)

  it('renames a published book and remakes its cover, EPUB and reader', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', coverRenderer: true })
    const e = env
    const renderer = fakeCoverRenderer(e)
    try {
      const slug = (await waitStage(e, 'published'))!
      await waitFor(async () => (await bookMd(e, slug)).data.cover_png === 'done', 10000, 'first cover done')
      const out = path.join(e.dir, 'books', slug, 'out')

      // only a published book can be renamed, and not to an empty title
      await e.engine.handleCommand({ type: 'renameBook', book: 'no-such-book', title: 'X' })
      await e.engine.handleCommand({ type: 'renameBook', book: slug, title: '   ' })
      expect((await bookMd(e, slug)).data.title).toBe('The Sleepy Fox')
      expect(renderer.renders(slug)).toBe(1)

      await e.engine.handleCommand({ type: 'renameBook', book: slug, title: '  The   Drowsy Fox ' })
      const { data } = await bookMd(e, slug)
      expect(data.title).toBe('The Drowsy Fox')
      expect(await readFile(path.join(out, 'cover.html'), 'utf8')).toContain('The Drowsy Fox')
      expect(renderer.renders(slug)).toBe(2)
      await waitFor(async () => (await bookMd(e, slug)).data.cover_png === 'done', 10000, 'second cover done')
      // the folder and the EPUB file name stay
      await checkEpub(path.join(out, `${slug}.epub`), { chapters: 1, title: 'The Drowsy Fox', author: data.author as string, coverImage: true })
      expect(await readFile(path.join(out, 'reader', 'index.html'), 'utf8')).toContain('The Drowsy Fox')
      expect(e.events).toContainEqual(expect.objectContaining({ type: 'book.updated', book: expect.objectContaining({ title: 'The Drowsy Fox' }) }))

      await e.engine.handleCommand({ type: 'regenerateCover', book: slug })
      expect(renderer.renders(slug)).toBe(3)
      await waitFor(async () => (await bookMd(e, slug)).data.cover_png === 'done', 10000, 'third cover done')
    } finally {
      await renderer.stop()
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
    expect(advance(base({ stage: 'rewriting', failedJobs: ['b--rewrite--ch02--r1'] })).patch).toMatchObject({ stage: 'failed', failed_from: 'rewriting' })
    // a retry continues from the recorded stage; books failed before it was recorded get a guess from the job ids
    expect(retryStage('rewriting', [])).toBe('rewriting')
    expect(retryStage(undefined, ['b--rewrite--ch02--r1'])).toBe('rewriting')
    expect(retryStage(undefined, ['b--rewrite--ch02--len'])).toBe('drafting')
    expect(retryStage(undefined, ['b--review--line-editor--r0'])).toBe('reviewing')
    expect(retryStage(undefined, ['b--publish--book--r1'])).toBe('publishing')
    expect(retryStage(undefined, ['b--check--ch03--r0'])).toBe('drafting')
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

  it('a story with choices: the chapter map is cleaned and checked, and its chapters end with links', () => {
    const ch = (n: number, choices: { text: string; to: number }[] = [], ending = '') => ({ n, title: `C${n}`, summary: 'x', choices, ending })
    const map = checkBranches([
      ch(1, [{ text: 'Left', to: 2 }, { text: 'Right', to: 3 }, { text: 'Back', to: 1 }, { text: 'Nowhere', to: 9 }]),
      ch(2, [{ text: 'On', to: 4 }, { text: 'On again', to: 4 }]),
      ch(3, [{ text: 'Meet', to: 4 }, { text: 'Stop', to: 5 }]),
      ch(4, [], 'happy'),
      ch(5)
    ])
    expect(map.map((c) => c.choices?.map((x) => x.to) ?? c.ending)).toEqual([[2, 3], [4], [4, 5], 'happy', 'an ending'])
    expect([...ancestors(map, 4)].sort()).toEqual([1, 2, 3])
    expect(chapterPlace(map, 4).ways_in).toBe('Readers come into this chapter from: chapter 2, after choosing "On"; chapter 3, after choosing "Meet".')
    expect(() => checkBranches([ch(1, [{ text: 'A', to: 3 }]), ch(2), ch(3)])).toThrow(/no choice leads to chapter\(s\) 2/)
    expect(() => checkBranches([ch(1, [{ text: 'A', to: 2 }]), ch(2)])).toThrow(/at least two endings/)
    expect(() => checkBranches([ch(1, [{ text: 'A', to: 2 }]), ch(2, [{ text: 'B', to: 3 }]), ch(3, [{ text: 'C', to: 4 }]), ch(4)])).toThrow()
    expect(choicesHtml({ choices: [{ text: 'Open the *door*', to: 2 }] })).toContain('<li><a href="chapter-02.xhtml">Open the <em>door</em></a></li>')
    expect(choicesHtml({ ending: 'happy' })).toContain('<a href="chapter-01.xhtml">')
    expect(choicesHtml({})).toBe('')
  })

  it('a visual novel script becomes scene headings, cast lines, speaker lines and narration', () => {
    const script = [
      'SCENE: The harbour wall, dusk',
      'Rain needles the grey water.',
      'ON SCREEN: Mara (soaked raincoat, worried), Tomas',
      'MARA (worried): You came back. *Finally.*',
      "TOMAS: I said I would, didn't I?",
      '**ZOË O\'NEIL** (quietly): Both of you <inside>.',
      '',
      '---',
      '## The lighthouse',
      'Note: this is narration, not a speaker.'
    ].join('\n')
    expect(scriptToXhtml(script).split('\n')).toEqual([
      '<h3 class="vn-scene">The harbour wall, dusk</h3>',
      '<p class="vn-narration">Rain needles the grey water.</p>',
      '<p class="vn-cast"><span class="vn-label">On screen:</span> Mara (soaked raincoat, worried), Tomas</p>',
      '<p class="vn-line"><span class="vn-speaker">MARA</span> <span class="vn-how">(worried)</span> You came back. <em>Finally.</em></p>',
      "<p class=\"vn-line\"><span class=\"vn-speaker\">TOMAS</span> I said I would, didn't I?</p>",
      '<p class="vn-line"><span class="vn-speaker">ZOË O\'NEIL</span> <span class="vn-how">(quietly)</span> Both of you &lt;inside&gt;.</p>',
      '<hr class="scene-break"/>',
      '<h3 class="vn-scene">The lighthouse</h3>',
      '<p class="vn-narration">Note: this is narration, not a speaker.</p>'
    ])
    expect(markdownToXhtml('MARA: Hi.', { script: true })).toContain('vn-speaker')
    expect(markdownToXhtml('MARA: Hi.')).toBe('<p>MARA: Hi.</p>')
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

  it('adds your own topics to a My topics table and keeps the rest of the file', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-topics-'))
    try {
      const { TopicsFile } = await import('../src/engine/store/topics')
      const crlf = text.replace(/\n/g, '\r\n')
      await writeFile(path.join(dir, 'topics.md'), crlf)
      const t = new TopicsFile(dir)
      expect(await t.add({ name: 'Dragons | Who\nBake', kind: 'juvenile-fiction', target: 3 })).toBe('my-dragons-who-bake')
      expect(await t.add({ name: 'Dragons who bake', kind: 'Fiction', active: false })).toBe('my-dragons-who-bake-2')
      expect(await t.add({ name: '  ', kind: 'fiction' })).toBeNull()
      expect(await t.add({ name: 'Poems', kind: 'poetry' })).toBeNull()
      const next = await readFile(path.join(dir, 'topics.md'), 'utf8')
      expect(next.startsWith(crlf.trimEnd())).toBe(true) // the old text is untouched, the line endings kept
      expect(next.replace(/\r\n/g, '').includes('\n')).toBe(false)
      const mine = parseTopics(next).filter((r) => r.section === 'My topics')
      expect(mine.map((r) => [r.id, r.topic, r.kind, r.active, r.target])).toEqual([
        ['my-dragons-who-bake', 'Dragons Who Bake', 'juvenile-fiction', true, 3],
        ['my-dragons-who-bake-2', 'Dragons who bake', 'fiction', false, 0]
      ])
      // the counts the engine keeps work on the new rows too
      expect(await t.adjust('my-dragons-who-bake', { inProgress: 1 })).toBe(true)
      expect(parseTopics(await readFile(path.join(dir, 'topics.md'), 'utf8')).find((r) => r.id === 'my-dragons-who-bake')!.inProgress).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the seed list has 250 to 500 rows, all inactive, with unique ids and the expected kinds', async () => {
    const rows = parseTopics(await readFile(path.resolve(__dirname, '../seed/topics.md'), 'utf8'))
    expect(rows.length).toBeGreaterThanOrEqual(250)
    expect(rows.length).toBeLessThanOrEqual(500)
    expect(rows.every((r) => !r.active)).toBe(true)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.topic.toLowerCase())).size).toBe(rows.length) // names are unique too, they show in the UI
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['fiction', 'juvenile-fiction', 'juvenile-nonfiction', 'nonfiction', 'visual-novel', 'juvenile-visual-novel', 'interactive-fiction', 'juvenile-interactive-fiction', 'article', 'video', 'juvenile-video']))
    expect(rows.filter((r) => r.kind === 'article').length).toBe(8)
    for (const id of ['jfic-bedtime-and-dreams', 'jfic-chapter-books-everyday-adventures', 'jfic-bedtime-moon-and-stars']) expect(rows.some((r) => r.id === id), id).toBe(true)
  })
})

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { afterAll, describe, expect, it } from 'vitest'
import { advance, reviewersFor } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { FactBase, buildReferences, citedNumbers, numberedNoteText } from '../src/engine/memory/factbase'
import { BookStore } from '../src/engine/pipeline/books'
import { candidateFacts } from '../src/engine/pipeline/nfcontext'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { parseMd } from '../src/shared/md'
import { parseTopics } from '../src/engine/store/topics'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'
import type { NoteFile } from '../src/engine/research/notes'

const format = (extra: Record<string, unknown> = {}) =>
  formatEntrySchema.parse({ id: 'nf', name: 'NF', enabled: true, nonfiction: true, kinds: ['nonfiction'], words: [5000, 15000], chapters: [5, 10], ...extra })

function state(over: Partial<BookState> = {}): BookState {
  return {
    slug: 'b',
    stage: 'drafting',
    round: 0,
    rewriteChapters: [],
    writerFamily: null,
    writerAgent: null,
    format: format(),
    quality: qualitySchema.parse({ kind: 'quality' }),
    hasPitch: true,
    outlineChapters: 3,
    outlineRound: 0,
    acts: [],
    chapters: new Map(),
    fixes: new Map(),
    totalWords: 0,
    lengthGate: null,
    reviews: new Map(),
    actReviewFiles: new Set(),
    outlineReview: null,
    chapterChecks: new Map(),
    settled: new Set(),
    actSummaries: new Set(),
    actReviews: new Set(),
    repetitionReport: false,
    failedJobs: [],
    nonfiction: true,
    factbase: new Set<number>(),
    ...quietResearchState(),
    ...over
  }
}

describe('the non-fiction plan (pure)', () => {
  it('the fact-checker reviews a non-fiction book instead of the continuity checker, and its job has its own task', () => {
    expect(reviewersFor(format())).toEqual(['fact-checker', 'developmental-editor', 'line-editor', 'copy-editor', 'beta-reader', 'originality-checker'])
    expect(reviewersFor(format({ juvenile: true }))).toContain('child-safety-reviewer')
    expect(reviewersFor(formatEntrySchema.parse({ id: 'f', name: 'F', words: [100, 200], kinds: ['fiction'] }))).not.toContain('fact-checker')
    const s = state({ chapters: new Map([[1, 0], [2, 0], [3, 0]]), totalWords: 6000, lengthGate: { status: 'ok' }, stage: 'drafting', factbase: new Set([1, 2, 3]) })
    const jobs = advance(s).jobs
    const fc = jobs.find((j) => j.role === 'fact-checker')
    expect(fc).toMatchObject({ task: 'fact_check', unit: 'book', round: 0 })
    expect(jobs.find((j) => j.role === 'line-editor')?.task).toBe('review')
  })

  it('before each chapter: the writer\'s research prep, then the archivist\'s fact step, then the draft', () => {
    const prepOn = { prepEnabled: true }
    expect(advance(state(prepOn)).jobs[0]).toMatchObject({ task: 'research_prep', unit: 'ch01' })
    const asked = state({ ...prepOn, prep: new Map([[1, ['research--b--abc--r0']]]), researchPending: new Set(['research--b--abc--r0']) })
    expect(advance(asked).jobs).toEqual([]) // waiting for the researcher
    const answered = state({ ...prepOn, prep: new Map([[1, ['research--b--abc--r0']]]) })
    expect(advance(answered).jobs[0]).toMatchObject({ task: 'factbase_update', role: 'archivist', unit: 'ch01', locks: ['bible:b'] })
    const withFacts = state({ ...prepOn, prep: new Map([[1, ['x']]]), factbase: new Set([1]) })
    expect(advance(withFacts).jobs[0]).toMatchObject({ task: 'draft_chapter', unit: 'ch01' })
    // a fiction book has no fact step
    const fiction = state({ ...prepOn, format: formatEntrySchema.parse({ id: 'f', name: 'F', words: [100, 200], kinds: ['fiction'], chapters: [3, 3] }), nonfiction: false, prep: new Map([[1, []]]) })
    expect(advance(fiction).jobs[0]!.task).toBe('draft_chapter')
  })
})

describe('the fact base', () => {
  it('cites source numbers, numbers the sources once, and writes the notes with [n] instead of URLs', () => {
    expect(citedNumbers('A fact [2]. More [1][3] and [2, 4]. Not a cite [x] or [].')).toEqual([1, 2, 3, 4])
    const sources = [{ n: 1, url: 'https://a.test/x', title: 'A', retrieved: '2026-01-01' }]
    expect(numberedNoteText('- Fact one (source: https://a.test/x, 2026-01-01)\n- Fact two (source: none, the model\'s own knowledge, 2026-01-01; unverified)', sources)).toBe('- Fact one [1]\n- Fact two (unverified, no source)')
    const note = (over: Partial<NoteFile>): NoteFile => ({ file: 'f.md', book: 'b', slug: 'f', question: 'q', unverified: false, body: '', created: '2026-01-01', sources: [], ...over })
    const n1 = note({ body: '# q\n\n- The press used metal type (source: https://a.test/x, 2026-01-01)\n- Another one (source: https://b.test/y, 2026-01-01)', sources: [{ url: 'https://a.test/x', title: 'A', retrieved: '2026-01-01' }, { url: 'https://b.test/y', title: 'B', retrieved: '2026-01-01' }] })
    const n2 = note({ file: 'g.md', unverified: true, body: '- Maybe (source: none, the model\'s own knowledge, 2026-01-01; unverified)' })
    const list = [{ n: 1, url: 'https://a.test/x', title: 'A', retrieved: '2026-01-01' }, { n: 2, url: 'https://b.test/y', title: 'B', retrieved: '2026-01-01' }]
    expect(candidateFacts([n1, n2], list)).toEqual([
      { fact: 'The press used metal type', sources: [1] },
      { fact: 'Another one', sources: [2] }
    ])
  })

  it('references list only the sources the chapters cite, in number order', async () => {
    const dir = path.join(process.cwd(), '.claude', 'temp', 'nf-unit')
    const { rm, mkdir } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const books = new BookStore(dir)
    await books.create('b', { title: 'B', format: 'nf', target_words: 5000, nonfiction: true })
    await books.writeChapter('b', { n: 1, title: 'One', round: 0, body: 'Metal type was cast in moulds [3]. Paper came from China [1].' })
    await books.writeChapter('b', { n: 2, title: 'Two', round: 0, body: 'Presses spread [3][3].' })
    const fb = new FactBase(books)
    const note = (url: string, title: string): NoteFile => ({ file: `${title}.md`, book: 'b', slug: title, question: title, unverified: false, body: '', created: '2026-02-03', sources: [{ url, title, retrieved: '2026-02-03' }] })
    await fb.syncSources('b', [note('https://a.test/1', 'Paper'), note('https://a.test/2', 'Ink'), note('https://a.test/3', 'Type')])
    await fb.syncSources('b', [note('https://a.test/1', 'Paper')]) // numbers never change
    expect((await fb.sources('b')).map((s) => s.n)).toEqual([1, 2, 3])
    const refs = await buildReferences(books, fb, 'b')
    expect(refs?.title).toBe('References')
    expect(refs!.body).toContain('[1] Paper. https://a.test/1')
    expect(refs!.body).toContain('[3] Type. https://a.test/3')
    expect(refs!.body).not.toContain('https://a.test/2')
    expect(refs!.body.indexOf('[1]')).toBeLessThan(refs!.body.indexOf('[3]'))
    await rm(dir, { recursive: true, force: true })
  })
})

type Env = Awaited<ReturnType<typeof makePipelineEnv>>

/** Starts a data folder on the mock provider, lets `setup` script it, then switches the non-fiction topic on. */
async function runBook(o: Parameters<typeof makePipelineEnv>[0], setup?: (env: Env) => void): Promise<{ env: Env; slug: string }> {
  const env = await makePipelineEnv({ format: 'nonfiction-short', citations: true, ...o, activate: [] })
  setup?.(env)
  await env.engine.handleCommand({ type: 'setTopicActive', id: 'his-books-and-printing', active: true })
  const slug = await waitFor(async () => (await readdir(path.join(env.dir, 'books')))[0] ?? null, 20000, 'the book folder')
  await waitFor(() => existsSync(path.join(env.dir, 'books', slug, 'book.md')), 20000, 'book.md')
  // one book only: switch the topic off so the factory starts no second one
  await env.engine.handleCommand({ type: 'setTopicActive', id: 'his-books-and-printing', active: false })
  return { env, slug }
}
const finished = (env: Env, slug: string) => waitFor(async () => (await env.engine.snapshot()).books.find((b) => b.slug === slug && ['published', 'rejected', 'failed'].includes(b.stage)), 90000, 'the book to finish')

describe('a non-fiction book on the mock provider', () => {
  let env: Env
  let slug = ''
  const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)
  afterAll(async () => {
    await env?.cleanup()
  })

  it('is researched per chapter, gets a fact base, passes the fact check and publishes with a references chapter in the EPUB', async () => {
    ;({ env, slug } = await runBook({}))
    const book = await finished(env, slug)
    expect(book.stage).toBe('published')
    const doc = parseMd(await readFile(dirOf('book.md'), 'utf8'))
    expect(doc.data).toMatchObject({ nonfiction: true, format: 'nonfiction-short', stage: 'published' })

    // research for every chapter: the architect's plan (non-fiction always asks), one prep per chapter, and notes with sources
    const outline = parseMd(await readFile(dirOf('outline.md'), 'utf8'))
    const chapters = (outline.data.chapters as unknown[]).length
    expect(chapters).toBe(5)
    for (let n = 1; n <= chapters; n++) expect(existsSync(dirOf('reports', `prep-ch-0${n}.md`)), `prep for chapter ${n}`).toBe(true)
    const plan = parseMd(await readFile(dirOf('research-plan.md'), 'utf8'))
    expect(plan.data.needs_research).toBe(true)
    expect((plan.data.questions as unknown[]).length).toBeGreaterThanOrEqual(2)
    const notes = (await readdir(dirOf('research'))).filter((f) => f.endsWith('.md'))
    expect(notes.length).toBeGreaterThanOrEqual(chapters)
    for (const f of notes) expect(parseMd(await readFile(dirOf('research', f), 'utf8')).data.sources as unknown[], f).not.toHaveLength(0)

    // the fact base instead of a story bible
    for (const f of ['thesis.md', 'terms.md', 'sources.md', 'facts.md']) expect(existsSync(dirOf('factbase', f)), f).toBe(true)
    expect(existsSync(dirOf('bible'))).toBe(false)
    const facts = parseMd(await readFile(dirOf('factbase', 'facts.md'), 'utf8')).data.chapters as Record<string, { fact: string; sources: number[] }[]>
    expect(Object.keys(facts)).toHaveLength(chapters)
    for (const list of Object.values(facts)) {
      expect(list.length).toBeGreaterThan(0)
      for (const f of list) expect(f.sources.length).toBeGreaterThan(0)
    }
    const sources = parseMd(await readFile(dirOf('factbase', 'sources.md'), 'utf8')).data.sources as { n: number; url: string }[]
    expect(sources.map((s) => s.url)).toContain('https://example.test/sea-routes')

    // the writer's context came from the fact base: key facts and numbered sources are listed in the draft job
    const draftJob = await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--draft--ch02--r0.md`), 'utf8')
    expect(draftJob).toContain('## Key facts for this chapter (cite them with their source numbers)')
    expect(draftJob).toContain('## Numbered sources you may cite')
    expect(draftJob).toContain('[1] Sea routes. https://example.test/sea-routes')
    expect(draftJob).toContain('## Pitch, argument, audience and style')
    await env.engine.logs.flush()
    const log = await readFile(dirOf('log.md'), 'utf8')
    expect(log.split('\n## ').find((b) => b.includes(`${slug}--draft--ch02--r0`))).toMatch(/- key facts of chapter 2 \(\d+ tokens\)/)

    // the fact-checker ran (its own job) and passed, the other reviewers used the non-fiction reviewer set
    const review = parseMd(await readFile(dirOf('reviews', 'book-fact-checker-r0.md'), 'utf8'))
    expect(review.data).toMatchObject({ role: 'fact-checker', verdict: 'pass' })
    expect(existsSync(dirOf('reviews', 'book-continuity-checker-r0.md'))).toBe(false)
    expect(existsSync(path.join(env.dir, 'jobs', 'done', `${slug}--review--fact-checker--r0.md`))).toBe(true)

    // the EPUB ends with a references chapter built from the sources the text cites
    const buf = await readFile(dirOf('out', `${slug}.epub`))
    const zip = await JSZip.loadAsync(buf)
    const names = Object.keys(zip.files)
    expect(names).toContain('OEBPS/chapter-06.xhtml')
    const refs = await zip.file('OEBPS/chapter-06.xhtml')!.async('string')
    expect(refs).toContain('<h2>References</h2>')
    expect(refs).toContain('https://example.test/sea-routes')
    expect(refs).toContain('[1]')
    expect(await zip.file('OEBPS/chapter-02.xhtml')!.async('string')).toContain('[1]')
    expect(await zip.file('OEBPS/nav.xhtml')!.async('string')).toContain('References')
    expect(await zip.file('OEBPS/content.opf')!.async('string')).toContain('chapter-06.xhtml')
    // and so does the reader
    const reader = await readFile(dirOf('out', 'reader', 'chapter-06.xhtml'), 'utf8')
    expect(reader).toContain('References')
    expect(reader).toContain('https://example.test/sea-routes')
    expect(await readFile(dirOf('out', 'reader', 'index.html'), 'utf8')).toContain('chapter-06.xhtml')
    expect(book.words).toBeGreaterThan(4000)
  }, 150000)
})

describe('a failed fact check sends the chapter back', () => {
  let env: Env
  afterAll(async () => {
    await env?.cleanup()
  })

  it('lists the claims for the rewrite of that chapter only, then passes on the second round', async () => {
    const rewriteNotes: { chapter: number; text: string }[] = []
    const run = await runBook(
      { factClaims: { 0: [{ chapter: 2, claim: 'The first press was built in 1440 by a goldsmith' }, { chapter: 2, claim: 'Printing began in Europe', problem: 'contradicted' }] } },
      (e) => {
        e.mock.on({ task: 'rewrite_chapter' }, (req) => {
          const text = req.messages.filter((m) => m.role === 'user').pop()!.content
          rewriteNotes.push({ chapter: Number(/Rewrite chapter (\d+) of/.exec(text)?.[1] ?? 0), text })
          return 'The press spread across the cities of Europe, and the facts in the notes say so [1]. '.repeat(40)
        })
      }
    )
    env = run.env
    const slug = run.slug
    const book = await finished(env, slug)
    expect(book.stage).toBe('published')
    const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)
    const r0 = parseMd(await readFile(dirOf('reviews', 'book-fact-checker-r0.md'), 'utf8'))
    expect(r0.data).toMatchObject({ verdict: 'revise', chapters: [2] })
    expect((r0.data.claims as { problem: string }[]).map((c) => c.problem)).toEqual(['unsourced', 'contradicted'])
    expect(r0.body).toContain('The first press was built in 1440')
    expect(r0.body).toContain('contradicted')
    // only chapter 2 was rewritten, and the writer got the claims
    expect(parseMd(await readFile(dirOf('book.md'), 'utf8')).data.rewrite_chapters).toEqual([2])
    expect(rewriteNotes.map((x) => x.chapter)).toEqual([2])
    expect(rewriteNotes[0]!.text).toContain('From the fact checker')
    expect(rewriteNotes[0]!.text).toContain('The first press was built in 1440')
    const r1 = parseMd(await readFile(dirOf('reviews', 'book-fact-checker-r1.md'), 'utf8'))
    expect(r1.data).toMatchObject({ verdict: 'pass', round: 1 })
    const chapter = parseMd(await readFile(dirOf('chapters', 'ch-02.md'), 'utf8'))
    expect(chapter.data.round).toBe(1)
  }, 150000)
})

describe('a chapter without a source cannot pass', () => {
  let env: Env
  afterAll(async () => {
    await env?.cleanup()
  })

  it('a book whose chapters cite nothing is rejected by the fact-checker after the last round, with the reason', async () => {
    const run = await runBook({ citations: false })
    env = run.env
    const slug = run.slug
    const book = await finished(env, slug)
    expect(book.stage).toBe('rejected')
    const doc = parseMd(await readFile(path.join(env.dir, 'books', slug, 'book.md'), 'utf8'))
    expect((doc.data.reasons as string[]).join(' ')).toMatch(/must-pass gate failed: fact-checker/)
    const r0 = parseMd(await readFile(path.join(env.dir, 'books', slug, 'reviews', 'book-fact-checker-r0.md'), 'utf8'))
    expect(r0.data.verdict).toBe('revise')
    expect((r0.data.chapters as number[]).length).toBe(5)
    expect(r0.body).toContain('cites no source')
  }, 150000)
})

describe('seed files of the non-fiction variant', () => {
  it('the formats, the gate and the prompt variants are in the seed', async () => {
    const root = path.resolve(__dirname, '..')
    const formats = (parseMd(await readFile(path.join(root, 'seed/config/formats.md'), 'utf8')).data.formats as Record<string, unknown>[]).map((f) => formatEntrySchema.parse(f))
    const nf = formats.filter((f) => f.nonfiction)
    expect(nf.map((f) => f.id).sort()).toEqual(['nonfiction-kids', 'nonfiction-short'])
    for (const f of nf) expect(f.long).toBe(false)
    expect(nf.find((f) => f.id === 'nonfiction-short')).toMatchObject({ kinds: ['nonfiction'], words: [5000, 15000] })
    expect(nf.find((f) => f.id === 'nonfiction-kids')).toMatchObject({ kinds: ['juvenile-nonfiction'], juvenile: true })
    const quality = parseMd(await readFile(path.join(root, 'seed/config/quality.md'), 'utf8')).data
    expect(quality.must_pass).toContain('fact-checker')
    for (const f of ['architect/pitch_nf', 'architect/outline_nf', 'architect/research_plan_nf', 'writer/draft_chapter_nf', 'writer/rewrite_chapter_nf', 'writer/research_prep_nf', 'archivist/factbase_update', 'fact-checker/fact_check', 'developmental-editor/review_nf', 'line-editor/review_nf', 'copy-editor/review_nf', 'beta-reader/review_nf', 'originality-checker/review_nf', 'publisher/publish_nf']) {
      expect(existsSync(path.join(root, 'seed/prompts', `${f}.md`)), f).toBe(true)
    }
    expect(existsSync(path.join(root, 'seed/agents/fact-checker-leo-brandt.md'))).toBe(true)
    const roles = parseMd(await readFile(path.join(root, 'seed/config/roles.md'), 'utf8')).data.roles as Record<string, unknown>
    expect(roles['fact-checker']).toBeTruthy()
  })

  it('the topic list covers all four kinds, with sections for each', async () => {
    const rows = parseTopics(await readFile(path.resolve(__dirname, '../seed/topics.md'), 'utf8'))
    for (const kind of ['fiction', 'juvenile-fiction', 'nonfiction', 'juvenile-nonfiction']) expect(rows.filter((r) => r.kind === kind).length, kind).toBeGreaterThanOrEqual(40)
    expect(rows.find((r) => r.id === 'his-books-and-printing')).toMatchObject({ kind: 'nonfiction', section: 'History' })
  })
})

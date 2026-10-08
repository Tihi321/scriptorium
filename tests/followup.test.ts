import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { advance, chaptersToRewrite, pickWorst, worstCount } from '../src/engine/pipeline/advance'
import type { BookState, ChapterScores, ReviewSummary } from '../src/engine/pipeline/advance'
import { Bible, entryKey, normThreadId } from '../src/engine/memory/bible'
import { BookStore } from '../src/engine/pipeline/books'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

// Fixes found by the Phase 6 real run: targeted rewrites, chapter length, bible duplicates, open threads, flat stretches.

describe('bible entries: names that differ in articles, case and punctuation are one entry', () => {
  it('entryKey normalises names', () => {
    expect(entryKey('The Lighthouse Cottage')).toBe('lighthouse-cottage')
    expect(entryKey('lighthouse-cottage')).toBe('lighthouse-cottage')
    expect(entryKey('the-lighthouse-cottage')).toBe('lighthouse-cottage')
    expect(entryKey('A  Lighthouse, Cottage!')).toBe('lighthouse-cottage')
    expect(entryKey("Mara's Cottage")).toBe('maras-cottage')
    expect(entryKey('The')).toBe('the') // nothing left after the article: keep it
    expect(entryKey('Anna')).not.toBe(entryKey('Anne'))
    expect(normThreadId(' T3 ')).toBe('t3')
    expect(normThreadId('#t4')).toBe('t4')
  })

  it('apply() reuses an existing entry instead of creating "the-lighthouse-cottage"; initial duplicates are merged', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-bible-'))
    try {
      const books = new BookStore(dir)
      const bible = new Bible(books)
      const slug = 'b1'
      await bible.writeInitial(slug, {
        characters: [
          { name: 'Mara', description: 'a lighthouse keeper', voice: 'dry' },
          { name: 'The Mara', description: 'the same woman, written again' }
        ],
        places: [{ name: 'lighthouse-cottage', description: 'a small stone cottage' }],
        threads: ['Who lit the lamp?', 'Where did the boat go?']
      })
      expect(await readdir(path.join(dir, 'books', slug, 'bible', 'characters'))).toEqual(['mara.md'])
      const first = parseMd(await readFile(path.join(dir, 'books', slug, 'bible', 'characters', 'mara.md'), 'utf8'))
      expect(first.body).toContain('a lighthouse keeper')
      expect(first.body).toContain('the same woman, written again')
      // the archivist writes the same place under another spelling, and a new place
      await bible.apply(slug, 2, {
        summary: 'Chapter two happened.',
        characters: [{ name: 'MARA', update: 'found the key', description: '' }],
        places: [
          { name: 'The Lighthouse Cottage', update: 'its door was open', description: 'duplicate description' },
          { name: 'The Harbour', update: '', description: 'a grey harbour' }
        ],
        threads_opened: [],
        threads_closed: ['T1', '#t2', 't9'],
        timeline: []
      })
      expect(await readdir(path.join(dir, 'books', slug, 'bible', 'places'))).toEqual(['harbour.md', 'lighthouse-cottage.md'])
      const cottage = parseMd(await readFile(path.join(dir, 'books', slug, 'bible', 'places', 'lighthouse-cottage.md'), 'utf8'))
      expect(cottage.body).toContain('a small stone cottage')
      expect(cottage.body).toContain('Ch 2: its door was open')
      const mara = parseMd(await readFile(path.join(dir, 'books', slug, 'bible', 'characters', 'mara.md'), 'utf8'))
      expect(mara.body).toContain('Ch 2: found the key')
      // thread ids are matched without regard to case and a leading #
      const threads = await bible.threads(slug)
      expect(threads.map((t) => [t.id, t.status])).toEqual([['t1', 'closed'], ['t2', 'closed']])
      // the end-of-book check can close threads by id too
      await bible.writeInitial('b2', { characters: [], threads: ['a', 'b', 'c'] })
      expect(await bible.closeThreads('b2', ['T2', 'x'], 4)).toEqual(['t2'])
      expect((await bible.threads('b2')).map((t) => t.status)).toEqual(['open', 'closed', 'open'])
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe('targeted rewrites: which chapters a revise touches', () => {
  const scores = (rows: Record<number, ChapterScores>) => new Map<number, ChapterScores>(Object.entries(rows).map(([n, s]) => [Number(n), s]))
  const ten = scores({
    1: { continuity: 9, tension: 6 },
    2: { continuity: 5, tension: 7 },
    3: { continuity: 8, tension: 8 },
    4: { continuity: 9, tension: 3 },
    5: { continuity: 7, tension: 7 },
    6: { continuity: 4, tension: 8 },
    7: { continuity: 9, tension: 9 },
    8: { continuity: 9, tension: 8 },
    9: { continuity: 9, tension: 7 },
    10: { continuity: 6, tension: 6 }
  })

  it('picks the worst 3 (under 10 chapters) or 4 chapters by continuity and tension', () => {
    expect(worstCount(6)).toBe(3)
    expect(worstCount(10)).toBe(4)
    expect(pickWorst([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ten, 4)).toEqual([2, 4, 6, 10]) // means 7, 6, 6, 6 -> ties by chapter number
    expect(pickWorst([1, 3, 7], ten, 2)).toEqual([1, 3])
    expect(pickWorst([1, 2], new Map(), 2)).toBeNull() // no scores at all
  })

  it('a revise that names chapters rewrites those; one that names none rewrites the worst few, not the book', () => {
    const state = { chapterScores: ten, flatChapters: [] }
    const named = chaptersToRewrite(state, [{ role: 'line-editor', rev: { verdict: 'revise', chapters: [3, 99] } }], 10)
    expect(named.chapters).toEqual([3])
    const unnamed = chaptersToRewrite(state, [{ role: 'line-editor', rev: { verdict: 'revise', chapters: [] } }], 10)
    expect(unnamed.chapters).toHaveLength(4)
    expect(unnamed.chapters).toEqual([2, 4, 6, 10])
    // an act review that names none: only the chapters of that act count
    const act = chaptersToRewrite(state, [{ role: 'copy-editor', rev: { verdict: 'revise', chapters: [], scope: [7, 8, 9, 10] } }], 10)
    expect(act.chapters).toEqual([7, 8, 9, 10])
    // two reviewers: the union
    const two = chaptersToRewrite(state, [
      { role: 'line-editor', rev: { verdict: 'revise', chapters: [1] } },
      { role: 'copy-editor', rev: { verdict: 'revise', chapters: [], scope: [4, 5, 6, 7, 8] } }
    ], 10)
    expect(two.chapters).toEqual([1, 4, 5, 6, 8])
    // no scores (short books): the whole book, as before
    expect(chaptersToRewrite({ chapterScores: new Map(), flatChapters: [] }, [{ role: 'x', rev: { verdict: 'revise', chapters: [] } }], 8).chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // the end-of-book thread check names none: the last two chapters
    expect(chaptersToRewrite(state, [{ role: 'thread-check', rev: { verdict: 'revise', chapters: [] } }], 10).chapters).toEqual([9, 10])
  })

  it('chapters of a flat tension stretch are added with a raise-tension flag (at most the three flattest)', () => {
    const flatScores = scores({ 1: { continuity: 9, tension: 7 }, 2: { continuity: 9, tension: 4 }, 3: { continuity: 9, tension: 3 }, 4: { continuity: 9, tension: 2 }, 5: { continuity: 9, tension: 2 }, 6: { continuity: 9, tension: 8 } })
    const r = chaptersToRewrite({ chapterScores: flatScores, flatChapters: [2, 3, 4, 5] }, [{ role: 'line-editor', rev: { verdict: 'revise', chapters: [1] } }], 6)
    expect(r.flat).toEqual([3, 4, 5])
    expect(r.chapters).toEqual([1, 3, 4, 5])
  })

  const format = formatEntrySchema.parse({ id: 'n', name: 'N', enabled: true, long: true, max_rounds: 1, words: [100, 200], chapters: [6, 6] })
  const base = (over: Partial<BookState> = {}): BookState => ({
    slug: 'b',
    stage: 'reviewing',
    round: 0,
    rewriteChapters: [],
    writerFamily: 'wfam',
    writerAgent: 'writer-x',
    format,
    quality: qualitySchema.parse({ kind: 'quality' }),
    hasPitch: true,
    outlineChapters: 6,
    outlineRound: 0,
    acts: [{ n: 1, chapters: [1, 2] }, { n: 2, chapters: [3, 4] }, { n: 3, chapters: [5, 6] }],
    chapters: new Map([1, 2, 3, 4, 5, 6].map((n) => [n, 0])),
    fixes: new Map(),
    totalWords: 0,
    lengthGate: null,
    reviews: new Map(),
    actReviewFiles: new Set(),
    outlineReview: { verdict: 'pass', chapters: [] },
    chapterChecks: new Map(),
    settled: new Set([1, 2, 3, 4, 5, 6]),
    actSummaries: new Set([1, 2, 3]),
    actReviews: new Set([1, 2, 3]),
    repetitionReport: true,
    failedJobs: [],
    ...quietResearchState(),
    ...over
  })

  it('advance puts the picked chapters and the flat ones in the patch', () => {
    const roles = ['continuity-checker', 'developmental-editor', 'line-editor', 'copy-editor', 'beta-reader', 'originality-checker', 'thread-check']
    const files = new Set(roles.slice(0, 6).flatMap((role) => [1, 2, 3].map((a) => `${role}:${a}:0`)))
    const reviews = new Map<string, ReviewSummary>(roles.map((r) => [`${r}:0`, { verdict: 'pass', chapters: [] }]))
    reviews.set('line-editor:0', { verdict: 'revise', chapters: [], scope: [1, 2, 3, 4, 5, 6] })
    const chapterScores = new Map<number, ChapterScores>([[1, { continuity: 9, tension: 8 }], [2, { continuity: 3, tension: 6 }], [3, { continuity: 9, tension: 8 }], [4, { continuity: 9, tension: 2 }], [5, { continuity: 6, tension: 7 }], [6, { continuity: 9, tension: 9 }]])
    const plan = advance(base({ reviews, actReviewFiles: files, chapterScores, flatChapters: [] }))
    expect(plan.patch).toMatchObject({ stage: 'rewriting', round: 1, rewrite_chapters: [2, 4, 5], tension_rewrite: [] })
    expect(plan.jobs.map((j) => j.id)).toEqual(['b--rewrite--ch02--r1', 'b--rewrite--ch04--r1', 'b--rewrite--ch05--r1'])
    const flat = advance(base({ reviews, actReviewFiles: files, chapterScores, flatChapters: [3, 4] }))
    expect(flat.patch).toMatchObject({ rewrite_chapters: [2, 3, 4, 5], tension_rewrite: [3, 4] })
  })
})

describe('the long-book fixes on the mock provider (a 6-chapter, 3-act novel)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env
  let slug = ''
  const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)
  const jobText = (id: string) => readFile(path.join(env.dir, 'jobs', 'done', `${id}.md`), 'utf8')

  beforeAll(async () => {
    env = await makePipelineEnv({
      activate: ['fic-fantasy-epic'],
      format: 'novel',
      smallNovel: true,
      // every first draft is half the asked length: the expand retry has to fix it
      draftRatio: 0.5,
      // line editor says revise in round 0 without naming a chapter; chapter 5 has the weakest continuity, 1 and 3 the flattest tension
      revise: { 'line-editor': [0] },
      continuity: { 5: 4 },
      tension: { 1: 2, 2: 6, 3: 2, 4: 7, 5: 5, 6: 8 },
      extraThread: true,
      // the thread check finds the first thread resolved in the text, written the way a model might write it
      threadResolved: ['T2']
    })
    slug = (await waitFor(async () => (await env.engine.snapshot()).books.find((x) => x.stage === 'published')?.slug ?? null, 90000, 'the novel to be published'))!
  }, 120000)
  afterAll(async () => {
    await env?.cleanup()
  })

  it('a chapter under 80% of its target gets one expand retry before the checks', async () => {
    expect(env.counters.calls.draft_chapter).toBe(12) // 6 chapters, two requests each
    const job = await jobText(`${slug}--draft--ch01--r0`)
    expect(job).toContain('### Call 1')
    expect(job).toContain('### Call 2')
    expect(job).toContain('Expand this chapter to about')
    expect(job).toMatch(/expanded from \d+\)/)
    const ch = parseMd(await readFile(dirOf('chapters', 'ch-01.md'), 'utf8'))
    const target = Math.round(parseMd(await readFile(dirOf('book.md'), 'utf8')).data.target_words as number / 6)
    expect(ch.data.words as number).toBeGreaterThanOrEqual(target * 0.8)
  })

  it('an unnamed revise rewrites the worst 3 chapters (not all 6), and only they are rewritten', async () => {
    const book = parseMd(await readFile(dirOf('book.md'), 'utf8')).data
    // chapter 5: continuity 4 and tension 5 (mean 4.5); chapters 1 and 3: continuity 9 and tension 2 (mean 5.5)
    expect(book.rewrite_chapters).toEqual([1, 3, 5])
    expect(book.round).toBe(1)
    const done = await readdir(path.join(env.dir, 'jobs', 'done'))
    const rewrites = done.filter((f) => f.startsWith(`${slug}--rewrite--ch`) && f.endsWith('--r1.md')).sort()
    expect(rewrites).toEqual([1, 3, 5].map((n) => `${slug}--rewrite--ch0${n}--r1.md`))
    // the second review round is the full set, once
    expect(done.filter((f) => f.includes('--review--') && f.endsWith('--r1.md'))).toHaveLength(6 * 3)
  })

  it('tension 2 at chapters 1 and 3 is not a flat stretch: nothing is flagged and there is no raise-tension note', async () => {
    const tension = parseMd(await readFile(dirOf('reports', 'tension.md'), 'utf8')).data
    expect(tension.flat_stretches).toEqual([])
    expect(await jobText(`${slug}--rewrite--ch03--r1`)).not.toContain('Raise tension')
  })

  it('the archivist is asked to close every thread the chapter resolves, with the open threads in its prompt', async () => {
    const job = await jobText(`${slug}--memory--ch02--r0`)
    expect(job).toContain('Open threads (id: text):')
    expect(job).toMatch(/t1: Who left the lantern in the barn\?/)
    expect(job).toMatch(/t2: What is the fox hiding\?/)
    expect(job).toContain('Close any thread this chapter resolves')
    // chapter 6 no longer lists t1: it was closed by the archivist in chapter 5
    const last = await jobText(`${slug}--memory--ch06--r0`)
    expect(last).not.toMatch(/t1: Who left/)
    expect(last).toMatch(/t2: What is the fox hiding\?/)
  })

  it('the end-of-book thread check works on the bible\'s open threads; what it finds resolved is closed, the rest goes to the publisher', async () => {
    const threads = parseMd(await readFile(dirOf('bible', 'threads.md'), 'utf8')).data.threads as { id: string; status: string; closed?: number }[]
    expect(threads.find((t) => t.id === 't1')).toMatchObject({ status: 'closed', closed: 5 })
    expect(threads.find((t) => t.id === 't2')).toMatchObject({ status: 'closed' }) // by the check ("T2" in any case)
    const report = parseMd(await readFile(dirOf('reports', 'open-threads.md'), 'utf8'))
    expect(report.data).toMatchObject({ open: 0, closed_by_check: ['t2'] })
    // the thread check was asked about t2 only (t1 was already closed in the bible)
    const check = await jobText(`${slug}--threadcheck--book--r0`)
    expect(check).toContain('t2: What is the fox hiding?')
    expect(check).not.toContain('t1: Who left the lantern')
    const publish = await jobText(`${slug}--publish--book--r1`)
    expect(publish).toContain('left these story threads open')
  })
})

describe('threads left open reach the publisher; flat stretches get a raise-tension note', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env
  let slug = ''
  const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)
  const jobText = (id: string) => readFile(path.join(env.dir, 'jobs', 'done', `${id}.md`), 'utf8')

  beforeAll(async () => {
    env = await makePipelineEnv({
      activate: ['fic-fantasy-epic'],
      format: 'novel',
      smallNovel: true,
      // the line editor names chapter 1; chapters 3, 4 and 5 form a flat stretch
      revise: { 'line-editor': [0] },
      reviewChapters: { 'line-editor': [1] },
      tension: { 1: 6, 2: 6, 3: 2, 4: 3, 5: 2, 6: 6 },
      extraThread: true,
      threadResolved: []
    })
    slug = (await waitFor(async () => (await env.engine.snapshot()).books.find((x) => x.stage === 'published')?.slug ?? null, 90000, 'the novel to be published'))!
  }, 120000)
  afterAll(async () => {
    await env?.cleanup()
  })

  it('a thread that nothing closed is in the report, the publisher prompt and book.md', async () => {
    const report = parseMd(await readFile(dirOf('reports', 'open-threads.md'), 'utf8'))
    expect(report.data).toMatchObject({ open: 1, threads: [{ id: 't2', text: 'What is the fox hiding?' }] })
    expect(report.body).toContain('t2: What is the fox hiding?')
    const publish = await jobText(`${slug}--publish--book--r1`)
    expect(publish).toMatch(/left these story threads open[\s\S]*- t2: What is the fox hiding\? \(opened in chapter 0\)/)
    const book = parseMd(await readFile(dirOf('book.md'), 'utf8')).data
    expect(book.open_threads).toEqual(['t2: What is the fox hiding?'])
    expect(book.stage).toBe('published')
  })

  it('the tension report flags chapters 3-5, and the rewrite round includes them with a raise-tension note', async () => {
    const tension = parseMd(await readFile(dirOf('reports', 'tension.md'), 'utf8')).data
    expect(tension.flat_stretches).toEqual([[3, 5]])
    const book = parseMd(await readFile(dirOf('book.md'), 'utf8')).data
    expect(book.rewrite_chapters).toEqual([1, 3, 4, 5])
    expect(book.tension_rewrite).toEqual([3, 4, 5])
    const flat = await jobText(`${slug}--rewrite--ch04--r1`)
    expect(flat).toContain('Raise tension')
    expect(await jobText(`${slug}--rewrite--ch01--r1`)).not.toContain('Raise tension')
    // the architect's research check ran (and found nothing to ask)
    expect(env.counters.calls.research_plan).toBe(1)
  })
})

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { perChapterTarget, TRIM_ABOVE } from '../src/engine/pipeline/handlers'
import { parseMd } from '../src/shared/md'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

describe('perChapterTarget', () => {
  it('is the book target over the planned chapters, not over the chapters written so far', () => {
    expect(perChapterTarget({ target_words: 6000 }, { chapters: new Array(6) }, 3)).toBe(1000)
    expect(perChapterTarget({ target_words: 45000 }, { chapters: new Array(11) }, 11)).toBe(4091)
    expect(perChapterTarget({ target_words: 900 }, null, 3)).toBe(300)
    expect(perChapterTarget({ target_words: 900 }, null, 0)).toBe(900)
    expect(TRIM_ABOVE).toBe(1.2)
  })
})

const short = formatEntrySchema.parse({ id: 'vn', name: 'VN', enabled: true, script: true, words: [8000, 25000], chapters: [4, 4] })
const long = formatEntrySchema.parse({ id: 'novella', name: 'Novella', enabled: true, long: true, max_rounds: 1, words: [20000, 50000], chapters: [10, 10] })

const base = (format: typeof short, over: Partial<BookState> = {}): BookState => ({
  slug: 'b',
  stage: 'drafting',
  round: 0,
  rewriteChapters: [],
  writerFamily: 'wfam',
  writerAgent: 'writer-x',
  format,
  quality: qualitySchema.parse({ kind: 'quality', max_rounds: 2 }),
  hasPitch: true,
  outlineChapters: format.chapters[0],
  outlineRound: 0,
  acts: [],
  chapters: new Map(Array.from({ length: format.chapters[0] }, (_, i) => [i + 1, 0])),
  fixes: new Map(),
  totalWords: 0,
  lengthGate: null,
  reviews: new Map(),
  actReviewFiles: new Set(),
  outlineReview: { verdict: 'pass', chapters: [] },
  chapterChecks: new Map(),
  settled: new Set(),
  actSummaries: new Set(),
  actReviews: new Set(),
  repetitionReport: false,
  failedJobs: [],
  ...quietResearchState(),
  ...over
})

describe('the length gate of a short book', () => {
  it('a draft inside the range but 23% over the target gets the gate, with chapters told their share of the target', () => {
    const plan = advance(base(short, { totalWords: 27000 / 1.0, targetWords: 22000 }))
    expect(plan.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 27000 } })
    // 27,000 is over the 25,000 ceiling by 8%: the old rule alone would let it pass; 27,000 against 22,000 does not
    expect(advance(base(short, { totalWords: 24000, targetWords: 22000 })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    const over = advance(base(short, { totalWords: 26800, targetWords: 22000 }))
    expect(over.jobs).toHaveLength(4)
    expect(over.jobs[0]!.body).toContain('this book should have about 22000')
    expect(over.jobs[0]!.body).toContain('Rewrite this chapter to about 5500 words')
    expect(over.jobs[0]!.body).toContain('It is too long')
  })

  it('without a target the old rule holds, and a draft 25% under the target gets the gate too', () => {
    expect(advance(base(short, { totalWords: 24000 })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    expect(advance(base(short, { totalWords: 6000 })).patch).toMatchObject({ length_gate: { status: 'rewriting' } })
    const under = advance(base(short, { totalWords: 15000, targetWords: 20000 }))
    expect(under.patch).toMatchObject({ length_gate: { status: 'rewriting' } })
    expect(under.jobs[0]!.body).toContain('Rewrite this chapter to about 5000 words')
    expect(under.jobs[0]!.body).toContain('It is too short')
  })

  it('a per-chapter share stays inside the format range (a target outside it is clamped)', () => {
    // a target of 40,000 over four chapters is 10,000 each, but the format allows 25,000 in all: 6,250 each at most
    const plan = advance(base(short, { totalWords: 8500, targetWords: 40000 }))
    expect(plan.jobs[0]!.body).toContain('Rewrite this chapter to about 6250 words')
  })
})

describe('the length gate of a long book', () => {
  const words = [4500, 4500, 7000, 4500, 3900, 4500, 8000, 4500, 4500, 4500]
  const state = (over: Partial<BookState> = {}) =>
    base(long, {
      targetWords: 45000,
      totalWords: words.reduce((a, b) => a + b, 0),
      chapterWords: new Map(words.map((w, i) => [i + 1, w])),
      acts: [{ n: 1, chapters: words.map((_, i) => i + 1) }],
      chapterChecks: new Map(words.map((_, i) => [i + 1, { verdict: 'pass' as const, chapters: [] }])),
      settled: new Set(words.map((_, i) => i + 1)),
      actSummaries: new Set([1]),
      actReviews: new Set([1]),
      ...over
    })

  it('a book over the format ceiling gets length rewrites for the chapters far from their share only', () => {
    const plan = advance(state())
    expect(plan.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 50400, min: 20000, max: 50000 } })
    expect(plan.jobs.map((j) => j.id)).toEqual(['b--rewrite--ch03--len', 'b--rewrite--ch05--len', 'b--rewrite--ch07--len'])
    expect(plan.jobs[0]!.body).toContain('Rewrite this chapter to about 4500 words')
    expect(plan.jobs[0]!.body).toContain('It is too long')
    expect(plan.jobs[1]!.body).toContain('It is too short')
  })

  it('goes on with the chapters not yet done, then reviews', () => {
    const rewriting = state({ stage: 'length-fix', lengthGate: { status: 'rewriting', words: 50400 }, fixes: new Map([[3, ['len']]]) })
    expect(advance(rewriting).jobs.map((j) => j.id)).toEqual(['b--rewrite--ch05--len', 'b--rewrite--ch07--len'])
    const done = advance(state({ stage: 'length-fix', lengthGate: { status: 'rewriting', words: 50400 }, fixes: new Map([[3, ['len']], [5, ['len']], [7, ['len']]]) }))
    expect(done.patch).toMatchObject({ stage: 'drafting', length_gate: { status: 'done', words_before: 50400 } })
    // once done the gate does not run again: the reviews start
    const after = advance(state({ stage: 'drafting', lengthGate: { status: 'done' }, repetitionReport: false }))
    expect(after.jobs.map((j) => j.task)).toEqual(['repetition_report'])
  })

  it('a book inside the range and near its target passes the gate, and a book already in review is left alone', () => {
    const fine = [4400, 4600, 4500, 4500, 4500, 4400, 4600, 4500, 4500, 4500]
    expect(advance(state({ totalWords: 45000, chapterWords: new Map(fine.map((w, i) => [i + 1, w])) })).patch).toMatchObject({ length_gate: { status: 'ok' } })
    expect(advance(state({ stage: 'reviewing' })).patch).not.toHaveProperty('length_gate')
    // over the target by 15% or more: the gate runs even inside the format's range (47,000 against 40,000, every chapter 700 over its share)
    const big = advance(state({ targetWords: 40000, totalWords: 47000, chapterWords: new Map(words.map((_, i) => [i + 1, 4700])) }))
    expect(big.patch).toMatchObject({ stage: 'length-fix', length_gate: { status: 'rewriting', words: 47000 } })
    expect(big.jobs).toHaveLength(10)
    expect(big.jobs[0]!.body).toContain('Rewrite this chapter to about 4000 words')
  })
})

describe('a chapter far over its target is cut once (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('a draft 50% over gets one tighten request and the chapter is kept near the target', async () => {
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', draftRatio: 1.5 })
    const e = env
    const slug = (await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'a book'))!
    await waitFor(async () => parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8').catch(() => '')).data.stage === 'published', 90000, 'published')
    const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
    const target = Number(book.target_words)
    const ch = parseMd(await readFile(path.join(e.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(e.counters.calls.draft_chapter).toBe(2) // the draft and the tighten request
    expect(Number(ch.data.words)).toBeGreaterThanOrEqual(target * 0.8)
    expect(Number(ch.data.words)).toBeLessThanOrEqual(target * 1.2)
    const job = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--draft--ch01--r0.md`), 'utf8'))
    expect(job.body).toMatch(/trimmed from \d+/)
    expect(job.body).toContain('Cut it to about')
    // the book summary shows the gate result
    expect((await e.engine.snapshot()).books.find((b) => b.slug === slug)?.lengthGate).toMatchObject({ status: 'ok' })
  }, 120000)
})

describe('the rewrite of a long book asks for the chapter\'s own share (pipeline)', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('the continuity fix of chapter 2, with 2 of 6 chapters written, is asked for the share of 6 chapters, not of 2', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true, checkRevise: [2] })
    const e = env
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the novel to be published'))!
    const target = Number(parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data.target_words)
    const fix = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--rewrite--ch02--chk.md`), 'utf8')).body
    const asked = Number(/Keep the chapter at about (\d+) words/.exec(fix)?.[1])
    const share = Math.round(target / 6)
    expect(asked).toBeGreaterThanOrEqual(Math.round(0.85 * share))
    expect(asked).toBeLessThanOrEqual(Math.round(1.15 * share))
    expect(asked).not.toBe(Math.round(target / 2))
  }, 180000)
})

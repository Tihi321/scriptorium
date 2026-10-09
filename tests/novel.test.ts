import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MemoryIndex } from '../src/engine/memory/index'
import { flatStretches } from '../src/engine/pipeline/longHandlers'
import { splitActs } from '../src/engine/pipeline/handlers'
import { advance } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env
let slug = ''
const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)

beforeAll(async () => {
  env = await makePipelineEnv({
    activate: ['fic-fantasy-epic'],
    format: 'novel',
    smallNovel: true,
    extraArchivist: true,
    checkRevise: [2]
  })
  slug = (await waitFor(async () => {
    const b = (await env.engine.snapshot()).books.find((x) => x.stage === 'published')
    return b?.slug ?? null
  }, 90000, 'the novel to be published'))!
}, 120000)
afterAll(async () => {
  await env?.cleanup()
})

describe('a 3-act novel on the mock provider', () => {
  it('reaches published with the long-book files in the planned structure', async () => {
    const { data } = parseMd(await readFile(dirOf('book.md'), 'utf8'))
    expect(data).toMatchObject({ format: 'novel', stage: 'published', round: 0 })
    const ls = async (...p: string[]) => (await readdir(dirOf(...p))).sort()
    expect(await ls('chapters')).toEqual(expect.arrayContaining(['ch-01.md', 'ch-06.md']))
    expect((await ls('chapters')).filter((f) => f.endsWith('.md'))).toHaveLength(6)
    // the structured bible
    expect(await ls('bible')).toEqual(['characters', 'places', 'style.md', 'threads.md', 'timeline.md'])
    expect(await ls('bible', 'characters')).toEqual(['fox.md'])
    const fox = parseMd(await readFile(dirOf('bible', 'characters', 'fox.md'), 'utf8'))
    expect(fox.data).toMatchObject({ name: 'Fox', voice: 'whispers, short sentences' })
    expect(fox.body).toContain('- Ch 6: Learned a lesson in chapter 6.')
    // the single thread was opened in the outline and closed by the archivist in chapter 5
    const threads = parseMd(await readFile(dirOf('bible', 'threads.md'), 'utf8')).data.threads as { id: string; status: string; closed?: number }[]
    expect(threads).toMatchObject([{ id: 't1', status: 'closed', closed: 5 }])
    expect((parseMd(await readFile(dirOf('bible', 'timeline.md'), 'utf8')).data.events as unknown[]).length).toBe(6)
    // chapter and act summaries; every chapter indexed
    expect((await ls('summaries')).sort()).toEqual(['act-1.md', 'act-2.md', 'act-3.md', 'ch-01.md', 'ch-02.md', 'ch-03.md', 'ch-04.md', 'ch-05.md', 'ch-06.md'])
    for (let n = 1; n <= 6; n++) expect(parseMd(await readFile(dirOf('summaries', `ch-0${n}.md`), 'utf8')).data.indexed).toBe(true)
    // reviews: outline, per chapter checks, per act developmental reviews with tension, the whole-book reviews per act, the thread check
    const reviews = await ls('reviews')
    expect(reviews).toEqual(expect.arrayContaining(['outline-review.md', 'actreview-1.md', 'actreview-2.md', 'actreview-3.md', 'thread-check-r0.md']))
    expect(reviews.filter((f) => /^ch-0\d-check\.md$/.test(f))).toHaveLength(6)
    expect(reviews.filter((f) => /^act-\d-.*-r0\.md$/.test(f))).toHaveLength(3 * 6)
    const tension = parseMd(await readFile(dirOf('reports', 'tension.md'), 'utf8')).data
    expect(Object.keys(tension.tension as Record<string, number>)).toHaveLength(6)
    expect(existsSync(dirOf('reports', 'repetition.md'))).toBe(true)
    expect(existsSync(dirOf('out', `${slug}.epub`))).toBe(true)
    expect(existsSync(dirOf('out', 'reader', 'chapter-06.xhtml'))).toBe(true)
  })

  it('moves the per-job record out of book.md into made.md, with a summary kept in book.md', async () => {
    const md = parseMd(await readFile(dirOf('book.md'), 'utf8'))
    expect(md.data.made).toBeUndefined()
    const made = await env.engine.books.readMade(slug)
    expect(md.data.jobs).toBe(made.length)
    expect(made.length).toBeGreaterThan(40)
    const tasks = new Set(made.map((m) => m.task))
    for (const t of ['pitch', 'outline', 'review_outline', 'draft_chapter', 'check_chapter', 'memory_update', 'act_summary', 'act_review', 'thread_check', 'review', 'publish']) expect(tasks.has(t), t).toBe(true)
    expect(Object.keys(md.data.models as object).sort()).toEqual(['r/review-model', 'w/writer-model'])
  })

  it('the continuity checker asked for a fix of chapter 2, which was rewritten once before the memory update', async () => {
    const ch = parseMd(await readFile(dirOf('chapters', 'ch-02.md'), 'utf8'))
    expect(ch.data.fixes).toEqual(['chk'])
    const fix = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--rewrite--ch02--chk.md`), 'utf8'))
    expect(fix.body).toContain('wrong coat in chapter 2')
    expect(env.counters.calls.check_chapter).toBe(6) // no second check after the fix
  })

  it('memory jobs for one book never run at the same time, and the second archivist is used for other work', async () => {
    const memoryTasks = new Set(['memory_update', 'index_chapter', 'act_summary'])
    const intervals = new Map<string, { start: number; end: number; task: string }>()
    env.events.forEach((e, i) => {
      if (e.type === 'job.started' && e.book === slug && memoryTasks.has(e.task.split(' ')[0]!)) intervals.set(e.jobId, { start: env.times[i]!, end: Infinity, task: e.task })
      if (e.type === 'job.done') {
        const it = intervals.get(e.jobId)
        if (it && it.end === Infinity) it.end = env.times[i]!
      }
    })
    const list = [...intervals.values()].sort((a, b) => a.start - b.start)
    expect(list.length).toBe(6 + 6 + 3)
    for (let i = 1; i < list.length; i++) expect(list[i]!.start, `${list[i - 1]!.task} then ${list[i]!.task}`).toBeGreaterThanOrEqual(list[i - 1]!.end)
  })

  it('the context for a chapter lists its items with token estimates in the job log, parts that do not change first', async () => {
    await env.engine.logs.flush()
    const log = await readFile(path.join(env.dir, 'books', slug, 'log.md'), 'utf8')
    const block = log.split('\n## ').find((b) => b.includes(`${slug}--draft--ch04--r0`))!
    expect(block).toContain('### Context')
    expect(block).toMatch(/- pitch and style \(\d+ tokens\)/)
    expect(block).toMatch(/- outline \(\d+ tokens\)/)
    expect(block).toMatch(/- bible: Fox \(\d+ tokens\)/)
    expect(block).toMatch(/- summary of chapter 3 \(\d+ tokens\)/)
    expect(block).toMatch(/- chapter 3 in full \(\d+ tokens\)/)
    // the request text is stored in the job file, in the order the packer laid it out
    const job = await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--draft--ch04--r0.md`), 'utf8')
    const at = (s: string) => job.indexOf(s)
    expect(at('## Pitch and style')).toBeGreaterThan(0)
    expect(at('## Outline of the whole book')).toBeGreaterThan(at('## Pitch and style'))
    expect(at('## Characters, places and open threads that matter here')).toBeGreaterThan(at('## Outline of the whole book'))
    expect(at('## Summaries of the chapters so far')).toBeGreaterThan(at('## Characters, places and open threads that matter here'))
    expect(at('## The previous chapter in full')).toBeGreaterThan(at('## Summaries of the chapters so far'))
    // the writer of chapter 4 did not get chapters 1 and 2 in full
    expect(job).not.toContain('### Chapter 2: Part 2\n\nThe little fox')
  })

  it('deleting index/ and reindexing gives the same search results', async () => {
    const queries = ['Fox learned a lesson', 'wrong coat', 'Hay Barn warm and dim']
    const search = async () => {
      await env.engine.memory.reindexAll()
      const index = MemoryIndex.open(env.dir, env.engine.memory.embedder) // a second handle on the same file
      try {
        return await Promise.all(queries.map(async (q) => (await index.search(q, { book: slug, k: 6 })).map((h) => [h.file, h.idx, h.score])))
      } finally {
        index.close()
      }
    }
    const before = await search()
    expect(before[0]!.length).toBeGreaterThan(0)
    env.engine.memory.close()
    await rm(path.join(env.dir, 'index'), { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) // Windows: a scanner may hold the file for a moment
    const after = await search()
    expect(after).toEqual(before)
    expect(env.engine.memory.getIndex().stats().chunks).toBeGreaterThan(10)
  })

  it('the whole-book reviews were read one act at a time, with the repetition report going to the line editor', async () => {
    const log = await readFile(path.join(env.dir, 'logs', 'agents', 'line-editor-otto-hale.md'), 'utf8').catch(() => '')
    expect(log).toContain('act 1 in full, summaries of the other acts')
    const jobs = await readdir(path.join(env.dir, 'jobs', 'done'))
    expect(jobs.filter((f) => f.includes('--review--line-editor--act')).length).toBe(3)
    const job = await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--review--line-editor--act2--r0.md`), 'utf8')
    expect(job).toContain('You are reading act 2 of 3')
    expect(job).toContain('Repetition report')
    const other = await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--review--copy-editor--act2--r0.md`), 'utf8')
    expect(other).not.toContain('Repetition report')
  })
})

describe('pure parts of the long pipeline', () => {
  it('splits chapters into acts', () => {
    expect(splitActs(6).map((a) => a.chapters)).toEqual([[1, 2], [3, 4], [5, 6]])
    expect(splitActs(4).map((a) => a.chapters)).toEqual([[1, 2], [3, 4]])
    expect(splitActs(9).map((a) => a.chapters)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    expect(splitActs(40).map((a) => a.chapters.length)).toEqual([14, 14, 12])
    expect(splitActs(2).map((a) => a.chapters)).toEqual([[1, 2]])
  })

  it('finds flat stretches of three or more chapters at tension 4 or below', () => {
    expect(flatStretches({ 1: 5, 2: 3, 3: 4, 4: 4, 5: 7, 6: 4, 7: 3 })).toEqual([[2, 4]])
    expect(flatStretches({ 1: 2, 2: 2, 3: 8 })).toEqual([])
    expect(flatStretches({ 1: 9, 2: 3, 3: 2, 4: 1, 5: 2 })).toEqual([[2, 5]])
  })

  const format = formatEntrySchema.parse({ id: 'n', name: 'N', enabled: true, long: true, max_rounds: 1, words: [100, 200], chapters: [4, 4] })
  const base = (over: Partial<BookState> = {}): BookState => ({
    slug: 'b',
    stage: 'drafting',
    round: 0,
    rewriteChapters: [],
    writerFamily: 'wfam',
    writerAgent: 'writer-x',
    format,
    quality: qualitySchema.parse({ kind: 'quality' }),
    hasPitch: true,
    outlineChapters: 4,
    outlineRound: 0,
    acts: [{ n: 1, chapters: [1, 2] }, { n: 2, chapters: [3, 4] }],
    chapters: new Map(),
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

  it('advance runs a long book one step at a time: outline review, draft, check, memory and index, act jobs', () => {
    expect(advance(base({ outlineReview: null })).jobs.map((j) => j.task)).toEqual(['review_outline'])
    expect(advance(base({ outlineReview: { verdict: 'revise', chapters: [] } })).jobs.map((j) => j.id)).toEqual(['b--outline--book--r1'])
    expect(advance(base({ outlineReview: { verdict: 'revise', chapters: [] }, outlineRound: 1 })).jobs.map((j) => j.id)).toEqual(['b--draft--ch01--r0'])
    expect(advance(base({ chapters: new Map([[1, 0]]) })).jobs.map((j) => j.id)).toEqual(['b--check--ch01--r0'])
    expect(advance(base({ chapters: new Map([[1, 0]]), chapterChecks: new Map([[1, { verdict: 'revise', chapters: [1] }]]) })).jobs.map((j) => j.id)).toEqual(['b--rewrite--ch01--chk'])
    const mem = advance(base({ chapters: new Map([[1, 0]]), chapterChecks: new Map([[1, { verdict: 'pass', chapters: [] }]]) }))
    expect(mem.jobs.map((j) => j.task)).toEqual(['memory_update', 'index_chapter'])
    expect(mem.jobs.every((j) => (j.locks as string[] | undefined)?.[0] === 'bible:b')).toBe(true)
    expect(mem.jobs[1]!.depends_on).toEqual([mem.jobs[0]!.id])
    // chapter 3 starts act 2: it waits for the summary and the review of act 1
    const done12 = {
      chapters: new Map([[1, 0], [2, 0]]),
      chapterChecks: new Map([[1, { verdict: 'pass' as const, chapters: [] }], [2, { verdict: 'pass' as const, chapters: [] }]]),
      settled: new Set([1, 2])
    }
    expect(advance(base(done12)).jobs.map((j) => j.task).sort()).toEqual(['act_review', 'act_summary'])
    expect(advance(base({ ...done12, actSummaries: new Set([1]), actReviews: new Set([1]) })).jobs.map((j) => j.id)).toEqual(['b--draft--ch03--r0'])
  })

  it('advance asks for the repetition report, then reviews per role and act, then the thread check, then publish', () => {
    const all = {
      chapters: new Map([[1, 0], [2, 0], [3, 0], [4, 0]]),
      chapterChecks: new Map([1, 2, 3, 4].map((n) => [n, { verdict: 'pass' as const, chapters: [] }])),
      settled: new Set([1, 2, 3, 4]),
      actSummaries: new Set([1, 2]),
      actReviews: new Set([1, 2])
    }
    expect(advance(base(all)).jobs.map((j) => j.task)).toEqual(['repetition_report'])
    const reviewing = advance(base({ ...all, repetitionReport: true }))
    expect(reviewing.jobs.filter((j) => j.task === 'review')).toHaveLength(6 * 2)
    expect(reviewing.jobs.filter((j) => j.task === 'thread_check')).toHaveLength(1)
    expect(reviewing.jobs.find((j) => j.id === 'b--review--line-editor--act2--r0')).toMatchObject({ unit: 'act2', avoid_family: 'wfam' })
    const roles = ['continuity-checker', 'developmental-editor', 'line-editor', 'copy-editor', 'beta-reader', 'originality-checker', 'thread-check']
    const files = (r: number) => new Set(roles.slice(0, 6).flatMap((role) => [1, 2].map((a) => `${role}:${a}:${r}`)))
    const reviews = new Map<string, { verdict: 'pass' | 'revise'; chapters: number[] }>(roles.map((r) => [`${r}:0`, { verdict: 'pass', chapters: [] }]))
    expect(advance(base({ ...all, repetitionReport: true, reviews, actReviewFiles: files(0) })).jobs.map((j) => j.id)).toEqual(['b--publish--book--r0'])
    // a revise naming chapter 3 leads to one rewrite round (max_rounds 1), then the second review round, then publish whatever the verdict
    reviews.set('line-editor:0', { verdict: 'revise', chapters: [3] })
    const rewrite = advance(base({ ...all, repetitionReport: true, reviews, actReviewFiles: files(0) }))
    expect(rewrite.patch).toMatchObject({ stage: 'rewriting', round: 1, rewrite_chapters: [3] })
    const r1 = new Map<string, { verdict: 'pass' | 'revise'; chapters: number[] }>(roles.map((r) => [`${r}:1`, { verdict: 'revise', chapters: [3] }]))
    expect(advance(base({ ...all, stage: 'reviewing', round: 1, repetitionReport: true, reviews: r1, actReviewFiles: files(1) })).jobs.map((j) => j.id)).toEqual(['b--publish--book--r1'])
  })
})

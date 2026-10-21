import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { advance } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { FactBase } from '../src/engine/memory/factbase'
import { BookStore } from '../src/engine/pipeline/books'
import { qualitySchema, formatEntrySchema } from '../src/shared/schemas'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

const format = formatEntrySchema.parse({ id: 'nf', name: 'NF', enabled: true, nonfiction: true, kinds: ['nonfiction'], words: [600, 1800], chapters: [1, 1], max_rounds: 1 })

function state(over: Partial<BookState> = {}): BookState {
  return {
    slug: 'b',
    stage: 'rewriting',
    round: 2,
    rewriteChapters: [1],
    writerFamily: null,
    writerAgent: null,
    format,
    quality: qualitySchema.parse({ kind: 'quality' }),
    hasPitch: true,
    outlineChapters: 1,
    outlineRound: 0,
    acts: [],
    chapters: new Map([[1, 1]]),
    fixes: new Map(),
    totalWords: 900,
    lengthGate: { status: 'ok' },
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
    factbase: new Set([1]),
    ...quietResearchState(),
    ...over
  }
}

describe('late research in the plan (pure)', () => {
  it('a rewrite round waits for the fact-base refresh when the book has unmerged notes, and runs the rewrite after it', () => {
    const wait = advance(state({ unmergedNotes: 2 })).jobs
    expect(wait).toHaveLength(1)
    expect(wait[0]).toMatchObject({ id: 'b--factbase--refresh--r2', task: 'factbase_update', role: 'archivist', unit: 'refresh', round: 2, locks: ['bible:b'] })
    // queued or running: still only the refresh (the id is the same, so it is never queued twice)
    expect(advance(state({ unmergedNotes: 2, refreshJobs: new Map([['b--factbase--refresh--r2', 'running']]) })).jobs.map((j) => j.id)).toEqual(['b--factbase--refresh--r2'])
    // merged (or the round's refresh is done): the rewrite goes on
    expect(advance(state({ unmergedNotes: 0 })).jobs.map((j) => j.task)).toEqual(['rewrite_chapter'])
    expect(advance(state({ unmergedNotes: 1, refreshJobs: new Map([['b--factbase--refresh--r2', 'done']]) })).jobs.map((j) => j.task)).toEqual(['rewrite_chapter'])
    // no late notes known (an older state): unchanged
    expect(advance(state()).jobs.map((j) => j.task)).toEqual(['rewrite_chapter'])
  })

  it('a fiction book never gets a refresh, and a book reopened for a review round refreshes before the reviewers', () => {
    expect(advance(state({ nonfiction: false, unmergedNotes: 3 })).jobs.map((j) => j.task)).toEqual(['rewrite_chapter'])
    const review = advance(state({ stage: 'reviewing', chapters: new Map([[1, 1]]), round: 2, unmergedNotes: 1 })).jobs
    expect(review.map((j) => j.id)).toEqual(['b--factbase--refresh--r2'])
    const after = advance(state({ stage: 'reviewing', round: 2, unmergedNotes: 1, refreshJobs: new Map([['b--factbase--refresh--r2', 'done']]) })).jobs
    expect(after.map((j) => j.task)).toContain('fact_check')
    // the first review round never waits for a refresh
    expect(advance(state({ stage: 'reviewing', round: 0, unmergedNotes: 4 })).jobs.map((j) => j.task)).toContain('fact_check')
  })
})

describe('the merged-notes list of the fact base', () => {
  it('remembers merged notes once, and a book without the list has none merged', async () => {
    const dir = path.join(process.cwd(), '.claude', 'temp', 'late-unit')
    const { rm, mkdir } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const books = new BookStore(dir)
    await books.create('b', { title: 'B', format: 'nf', target_words: 900, nonfiction: true })
    const fb = new FactBase(books)
    expect((await fb.merged('b')).size).toBe(0)
    await fb.markMerged('b', ['books/b/research/a.md'])
    await fb.markMerged('b', ['books/b/research/a.md', 'books/b/research/c.md'])
    expect([...(await fb.merged('b'))].sort()).toEqual(['books/b/research/a.md', 'books/b/research/c.md'])
    await rm(dir, { recursive: true, force: true })
  })
})

type Env = Awaited<ReturnType<typeof makePipelineEnv>>

describe('an article that gets research after it was rejected', () => {
  let env: Env
  afterAll(async () => {
    await env?.cleanup()
  })
  const LATE = { url: 'https://example.test/late-statement', title: 'Late statement', content: 'The operator said on Friday that the signal had been confirmed by a second station in the north of the country. '.repeat(3) }
  const LATE_Q = 'What did the operator confirm on Friday?'

  it('merges the new notes into the fact base on reopen, so the rewrite, the fact check and the references have them', async () => {
    const rewrites: string[] = []
    const checks: { round: number; text: string }[] = []
    env = await makePipelineEnv({
      format: 'article',
      citations: true,
      activate: [],
      researchPlan: ['What did the ministry announce this week?'],
      // rejected on its own: both fact checks of the first life send the chapter back
      factClaims: { 0: [{ chapter: 1, claim: 'The ministry acted on Monday' }], 1: [{ chapter: 1, claim: 'The ministry acted on Monday' }] },
      pagesFor: (q) => (q === LATE_Q ? [LATE] : [{ url: 'https://example.test/sea-routes', title: 'Sea routes', content: 'The passage took about six months in the early 1600s. '.repeat(4) }])
    })
    env.mock.on({ task: 'rewrite_chapter' }, (req) => {
      const text = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
      rewrites.push(text)
      // the writer cites the late source by the number the prompt gave it
      const late = /\[(\d+)\] Late statement\./.exec(text)?.[1]
      return 'The fox walked the long road home and the moon followed it all the way. '.repeat(70) + ` The operator confirmed it${late ? ` [${late}]` : ''}, as reported [1].`
    })
    env.mock.on({ task: 'fact_check' }, (req) => {
      const text = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
      const round = Number(/review round (\d+)/.exec(text)?.[1] ?? 0)
      checks.push({ round, text })
      const claims = round < 2 ? [{ chapter: 1, claim: 'The ministry acted on Monday', problem: 'unsourced', detail: 'no source number' }] : []
      return JSON.stringify({ verdict: claims.length ? 'revise' : 'pass', scores: { accuracy: claims.length ? 5 : 9 }, notes: claims.length ? 'Sourcing.' : 'Every claim is sourced.', claims, research_questions: [] })
    })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    const slug = await waitFor(async () => (await readdir(path.join(env.dir, 'books')))[0] ?? null, 20000, 'the article folder')
    await waitFor(() => existsSync(path.join(env.dir, 'books', slug, 'book.md')), 20000, 'book.md')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false })
    const dirOf = (...p: string[]) => path.join(env.dir, 'books', slug, ...p)
    const done = await waitFor(async () => (await env.engine.snapshot()).books.find((b) => b.slug === slug && ['published', 'rejected', 'failed'].includes(b.stage)), 90000, 'the article to finish')
    expect(done.stage).toBe('rejected')
    // an article without late notes never got a refresh
    const jobsDone = async () => (await readdir(path.join(env.dir, 'jobs', 'done'))).filter((f) => f.includes('--factbase--refresh--'))
    expect(await jobsDone()).toEqual([])
    const before = (parseMd(await readFile(dirOf('factbase', 'sources.md'), 'utf8')).data.sources as { n: number; url: string }[]).map((s) => s.url)
    expect(before).not.toContain(LATE.url)
    const rewritesBefore = rewrites.length

    // the owner asks the researcher for one more question; the answer is a note in the article's research folder
    await env.engine.handleCommand({ type: 'askResearcher', question: LATE_Q, book: slug })
    await waitFor(async () => (await readdir(dirOf('research'))).some((f) => f.includes('what-did-the-operator-confirm')), 30000, 'the late note')
    // not merged yet: the fact base does not know the source
    expect((parseMd(await readFile(dirOf('factbase', 'sources.md'), 'utf8')).data.sources as { url: string }[]).map((s) => s.url)).not.toContain(LATE.url)

    await env.engine.handleCommand({ type: 'reopenBook', book: slug, mode: 'rewrite' })
    const end = await waitFor(async () => (await env.engine.snapshot()).books.find((b) => b.slug === slug && ['published', 'rejected', 'failed'].includes(b.stage) && rewrites.length > rewritesBefore), 90000, 'the reopened article to finish')
    expect(end.stage).toBe('published')

    // the refresh job ran once, for round 2, before the rewrite
    expect(await jobsDone()).toEqual([`${slug}--factbase--refresh--r2.md`])
    const sources = parseMd(await readFile(dirOf('factbase', 'sources.md'), 'utf8')).data.sources as { n: number; url: string }[]
    const late = sources.find((s) => s.url === LATE.url)!
    expect(late).toBeDefined()
    const facts = parseMd(await readFile(dirOf('factbase', 'facts.md'), 'utf8')).data.chapters as Record<string, { fact: string; sources: number[] }[]>
    expect(facts['1']!.some((f) => f.sources.includes(late.n) && /sea passage took many months/.test(f.fact))).toBe(true)
    expect(existsSync(dirOf('factbase', 'merged.md'))).toBe(true)

    // the rewrite prompt has the late source, numbered, and its facts, first among the notes
    const rewrite = rewrites[rewrites.length - 1]!
    expect(rewrite).toContain(`[${late.n}] Late statement. ${LATE.url}`)
    expect(rewrite).toMatch(new RegExp(`sea passage took many months[^\\n]*\\[${late.n}\\]`))
    expect(rewrite.indexOf('What did the operator confirm on Friday?')).toBeGreaterThan(-1)

    // the fact-checker of the new round has the same numbered source and the same key fact
    const check = checks.find((c) => c.round === 2)!
    expect(check.text).toContain(`[${late.n}] Late statement. ${LATE.url}`)
    expect(check.text).toMatch(new RegExp(`sea passage took many months[^\\n]*\\[${late.n}\\]`))

    // the published article lists the source it now cites
    const html = await readFile(dirOf('out', 'article.html'), 'utf8')
    expect(html).toContain('id="ref-1"')
    expect(html).toContain(`id="ref-${late.n}"`)
    expect(html).toContain(LATE.url)
    expect(await readFile(dirOf('out', 'article.md'), 'utf8')).toContain(`[${late.n}] Late statement. ${LATE.url}`)
  }, 240000)
})

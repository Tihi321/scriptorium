import { afterEach, describe, expect, it } from 'vitest'
import { advance, needsResearch } from '../src/engine/pipeline/advance'
import type { BookState } from '../src/engine/pipeline/advance'
import { formatEntrySchema, qualitySchema } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, waitFor } from './helpers'

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const format = (over: Record<string, unknown>) => formatEntrySchema.parse({ id: 'f', name: 'F', enabled: true, words: [100, 200], chapters: [2, 2], ...over })
const state = (fmt: ReturnType<typeof format>, over: Partial<BookState> = {}): BookState => ({
  slug: 'b',
  stage: 'pitch',
  round: 0,
  rewriteChapters: [],
  writerFamily: 'wfam',
  writerAgent: 'writer-x',
  format: fmt,
  quality: qualitySchema.parse({ kind: 'quality' }),
  hasPitch: true,
  outlineChapters: null,
  outlineRound: 0,
  acts: [],
  chapters: new Map(),
  fixes: new Map(),
  totalWords: 0,
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
  ...quietResearchState(),
  researchPlan: null,
  ...over
})

describe('formats that need no research', () => {
  it('bedtime formats and `research: false` need none; the others do, and `research: true` wins over the bedtime name', () => {
    expect(needsResearch(format({ id: 'bedtime-toddler' }))).toBe(false)
    expect(needsResearch(format({ id: 'bedtime-new' }))).toBe(false)
    expect(needsResearch(format({ id: 'lullaby', research: false }))).toBe(false)
    expect(needsResearch(format({ id: 'novel' }))).toBe(true)
    expect(needsResearch(format({ id: 'bedtime-facts', research: true }))).toBe(true)
  })

  it('advance plans no research for such a format and goes to the outline, but still plans it for a novel', () => {
    const ids = (s: BookState) => advance(s).jobs.map((j) => j.id)
    expect(ids(state(format({ id: 'bedtime-story' })))).toEqual(['b--outline--book--r0'])
    expect(ids(state(format({ id: 'novel' })))).toEqual(['b--researchplan--book--r0'])
  })

  it('a bedtime book makes no research_plan and no research_prep job, even when its genre switches the prep on', async () => {
    env = await makePipelineEnv({ format: 'bedtime-toddler', activate: [], factory: { research_prep_genres: ['bedtime'] } })
    const e = env
    await e.engine.handleCommand({ type: 'setTopicActive', id: 'jfic-bedtime-and-dreams', active: true })
    await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published'), 90000, 'the book to be published')
    await e.engine.handleCommand({ type: 'setTopicActive', id: 'jfic-bedtime-and-dreams', active: false })
    expect(e.counters.calls.research_plan).toBeUndefined()
    expect(e.counters.calls.research_prep).toBeUndefined()
    expect(e.counters.calls.publish).toBeGreaterThanOrEqual(1)
  }, 120000)
})

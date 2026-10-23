import type { FormatEntry, QualityConfig } from '../../shared/schemas'
import type { NewJob } from '../queue/jobs'
import { researchJobId } from '../research/notes'
import { pad2 } from './books'

/** Reviewers for a format: the format's own list, or the default set. */
export function reviewersFor(format: FormatEntry): string[] {
  if (format.reviewers && format.reviewers.length) return format.reviewers
  // non-fiction: the fact-checker takes the continuity checker's place (it also checks the text against the fact base)
  const list = [format.nonfiction ? 'fact-checker' : 'continuity-checker', 'developmental-editor', 'line-editor', 'copy-editor', 'beta-reader', 'originality-checker']
  if (format.juvenile) list.push('child-safety-reviewer')
  if (format.read_aloud) list.push('read-aloud-reviewer')
  return list
}

/** False for a format that needs no real-world facts (`research: false`, and the `bedtime-*` formats unless they say otherwise): no research plan, no writer prep. */
export function needsResearch(format: Pick<FormatEntry, 'id' | 'research'>): boolean {
  return format.research ?? !format.id.startsWith('bedtime-')
}

/** The job task of a reviewer: the fact-checker has its own (it reads the notes and the fact base), every other reviewer uses `review`. */
export const reviewTask = (role: string) => (role === 'fact-checker' ? 'fact_check' : 'review')

/** The review key of the end-of-book thread check (long books). */
export const THREAD_CHECK = 'thread-check'

export interface ReviewSummary {
  verdict: 'pass' | 'revise'
  /** The chapters the reviewer named. */
  chapters: number[]
  /** Where an unnamed revise applies (the chapters of the reviewed act). Empty or missing: the whole book. */
  scope?: number[]
}

/** Per-chapter scores that tell which chapters are weakest. 1-10 each, missing when not measured. */
export interface ChapterScores {
  continuity?: number
  tension?: number
}

export interface ActInfo {
  n: number
  chapters: number[]
}

/** Everything `advance` looks at: the book's files and job files, already read. */
export interface BookState {
  slug: string
  stage: string
  round: number
  rewriteChapters: number[]
  /** book.md `extra_rounds`: rounds added by `reopen_book`. */
  extraRounds?: number
  writerFamily: string | null
  writerAgent: string | null
  format: FormatEntry
  quality: QualityConfig
  hasPitch: boolean
  outlineChapters: number | null
  /** 0 for the first outline, 1 after the outline was rewritten on the editor's notes. */
  outlineRound: number
  acts: ActInfo[]
  /** Chapter number -> round of the file on disk. */
  chapters: Map<number, number>
  /** Chapter number -> fixes already applied (`len` = length rewrite, `chk` = continuity fix). */
  fixes: Map<number, string[]>
  totalWords: number
  /** book.md `target_words`: the length the book is meant to have. The length gates use it next to the format's range. */
  targetWords?: number
  /** Chapter number -> words, for the length gate of a long book (which chapters are far from their share of the target). */
  chapterWords?: Map<number, number>
  /** book.md `length_gate`: null until the gate has run. */
  lengthGate: { status: string; words?: number } | null
  /** `${role}:${round}` -> review. For long books this is only set once every act has been reviewed. */
  reviews: Map<string, ReviewSummary>
  /** Long books: `${role}:${act}:${round}` of the act review files that exist. */
  actReviewFiles: Set<string>
  /** Long books: the developmental editor's review of the outline. */
  outlineReview: ReviewSummary | null
  /** Long books: chapter number -> continuity check right after drafting. */
  chapterChecks: Map<number, ReviewSummary>
  /** Long books: chapters whose summary is written and that are in the search index. */
  settled: Set<number>
  actSummaries: Set<number>
  actReviews: Set<number>
  repetitionReport: boolean
  /** Long books: continuity (per chapter check) and tension (act reviews) per chapter. */
  chapterScores: Map<number, ChapterScores>
  /** Chapters inside a flat stretch of the tension report (three or more chapters at tension 4 or below). */
  flatChapters: number[]
  /** The architect's "needs research?" step: null until research-plan.md exists, then the research job ids it asked for. */
  researchPlan: { jobs: string[] } | null
  /** Ids of research jobs that are queued or running. */
  researchPending: Set<string>
  /** The writer's prep step runs before each chapter (format.research_prep, or a genre in factory.research_prep_genres). */
  prepEnabled: boolean
  /** Chapters whose prep step is done, with the research job ids it asked for. */
  prep: Map<number, string[]>
  /** Chapter number -> the questions of the [RESEARCH: ...] markers still in its text (none once the fix-up ran). */
  markers: Map<number, string[]>
  /** Round -> research job ids that reviewers asked for in that round's reviews. */
  reviewResearch: Map<number, string[]>
  /** Chapter number -> research job ids the continuity check asked for. */
  checkResearch: Map<number, string[]>
  /** Ids of this book's jobs that are in failed/. */
  failedJobs: string[]
  /** Non-fiction variant (the format says so): research and a fact step before every chapter. */
  nonfiction?: boolean
  /** Non-fiction: chapters whose fact step (the archivist's key facts from the chapter's research) is done. */
  factbase?: Set<number>
  /** Non-fiction: how many verified notes of the book itself the fact base has not merged yet (late research). */
  unmergedNotes?: number
  /** Non-fiction: state (`queued`, `running`, `done`) of this book's fact-base refresh jobs, by job id. */
  refreshJobs?: Map<string, string>
  /**
   * The humanizer pass applies to this book: the format and the book allow it (`humanize`) and a humanizer agent is hired.
   * Missing or false: the pass is skipped, so `advance` never queues a job nobody can take.
   */
  humanize?: boolean
  /** Chapter number -> the round the humanizer rewrote it in. A chapter that was written again since has no entry. */
  humanized?: Map<number, number>
  /** The book adapts another book (`source_book`): it needs no research of its own, the source's facts are in the source text. */
  adaptation?: boolean
}

/** A job to enqueue, with the request text for its body. */
export type PlanJob = NewJob & { body?: string }

export interface Plan {
  /** Changes to book.md (applied before the jobs are enqueued). */
  patch: Record<string, unknown>
  jobs: PlanJob[]
}

export const TERMINAL_STAGES = new Set(['published', 'rejected', 'failed'])

/** How many chapters a rewrite round touches when no reviewer named any: 3 for books under 10 chapters, else 4. */
export const worstCount = (total: number) => (total >= 10 ? 4 : 3)

/**
 * The weakest chapters of `candidates`, by the mean of the chapter's continuity and tension scores (lower is worse).
 * Returns null when none of the candidates has a score (short books have none).
 */
export function pickWorst(candidates: number[], scores: Map<number, ChapterScores>, count: number): number[] | null {
  const ranked = candidates.map((n) => {
    const sc = scores.get(n)
    const parts = [sc?.continuity, sc?.tension].filter((x): x is number => typeof x === 'number')
    return { n, mean: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null }
  })
  if (!ranked.some((r) => r.mean !== null)) return null
  ranked.sort((a, b) => (a.mean ?? 7) - (b.mean ?? 7) || a.n - b.n)
  return ranked
    .slice(0, count)
    .map((r) => r.n)
    .sort((a, b) => a - b)
}

/**
 * The chapters a rewrite round touches. Chapters the reviewers named are always in.
 * A revise that names none picks the worst few chapters by the scores (of its act, for an act review),
 * and the whole book only when no scores exist. The end-of-book thread check, without names, points at the last two chapters.
 * Chapters of a flat tension stretch are added (at most the three flattest), with a "raise tension" note.
 */
export function chaptersToRewrite(
  s: Pick<BookState, 'chapterScores' | 'flatChapters'>,
  revise: { role: string; rev: ReviewSummary }[],
  total: number
): { chapters: number[]; flat: number[] } {
  const all = Array.from({ length: total }, (_, i) => i + 1)
  const inBook = (n: number) => n >= 1 && n <= total
  const affected = new Set<number>()
  const k = worstCount(total)
  const pick = (candidates: number[]) => {
    const list = candidates.filter(inBook)
    const worst = list.length <= k ? list : (pickWorst(list, s.chapterScores, k) ?? list)
    for (const n of worst) affected.add(n)
  }
  for (const { role, rev } of revise) {
    for (const n of rev.chapters.filter(inBook)) affected.add(n)
    if (rev.chapters.length === 0) {
      if (role === THREAD_CHECK) for (const n of all.slice(-2)) affected.add(n)
      else pick(rev.scope && rev.scope.length ? rev.scope : all)
    } else if (rev.scope && rev.scope.length) pick(rev.scope)
  }
  const flat = [...s.flatChapters]
    .filter(inBook)
    .sort((a, b) => (s.chapterScores.get(a)?.tension ?? 4) - (s.chapterScores.get(b)?.tension ?? 4) || a - b)
    .slice(0, 3)
    .sort((a, b) => a - b)
  for (const n of flat) affected.add(n)
  if (affected.size === 0) for (const n of all) affected.add(n)
  return { chapters: [...affected].sort((a, b) => a - b), flat }
}

const jobId = (slug: string, task: string, unit: string, round: number) => `${slug}--${task}--${unit}--r${round}`

const pendingAny = (s: Pick<BookState, 'researchPending'>, ids: string[]) => ids.some((id) => s.researchPending.has(id))

/** Before drafting chapter `n`: the writer's research prep, then waiting for its answers. Null when the chapter can be drafted. */
function prepStep(s: BookState, n: number): Plan | null {
  if (!s.prepEnabled) return null
  const stage = s.stage === 'drafting' ? {} : { stage: 'drafting' }
  const asked = s.prep.get(n)
  if (!asked) {
    const unit = `ch${pad2(n)}`
    return { patch: stage, jobs: [{ id: jobId(s.slug, 'prep', unit, 0), task: 'research_prep', role: 'writer', book: s.slug, unit, agent_hint: s.writerAgent, requested_by: 'engine' }] }
  }
  if (pendingAny(s, asked)) return { patch: stage, jobs: [] }
  return null
}

/**
 * A drafted chapter with [RESEARCH: ...] markers: wait until the researcher has answered every question,
 * then one fix-up job replaces the marked sentences. Null when the chapter has no marker left.
 */
function markerStep(s: BookState, n: number): Plan | null {
  const questions = s.markers.get(n)
  if (!questions || questions.length === 0) return null
  const stage = s.stage === 'drafting' ? {} : { stage: 'drafting' }
  if (pendingAny(s, questions.map((q) => researchJobId(s.slug, q)))) return { patch: stage, jobs: [] }
  const unit = `ch${pad2(n)}`
  return { patch: stage, jobs: [{ id: `${s.slug}--rewrite--${unit}--res`, task: 'research_fix', role: 'writer', book: s.slug, unit, round: 0, agent_hint: s.writerAgent, requested_by: 'engine' }] }
}

/** Non-fiction, before drafting chapter `n` and after its research: the archivist turns the notes into the chapter's key facts. */
function factStep(s: BookState, n: number): Plan | null {
  if (!s.nonfiction || s.factbase?.has(n)) return null
  const unit = `ch${pad2(n)}`
  const stage = s.stage === 'drafting' ? {} : { stage: 'drafting' }
  return { patch: stage, jobs: [{ id: jobId(s.slug, 'factbase', unit, 0), task: 'factbase_update', role: 'archivist', book: s.slug, unit, locks: [`bible:${s.slug}`], requested_by: 'engine' }] }
}

/**
 * Non-fiction, before a rewrite or a new review round: late research (notes the fact base has not merged) is merged first, so the
 * writer and the fact-checker work from the same numbered sources and facts. Null when there is nothing to merge or the round's refresh is done.
 */
function refreshStep(s: BookState, round: number): PlanJob[] | null {
  if (!s.nonfiction || (s.unmergedNotes ?? 0) === 0) return null
  const id = jobId(s.slug, 'factbase', 'refresh', round)
  if (s.refreshJobs?.get(id) === 'done') return null
  return [{ id, task: 'factbase_update', role: 'archivist', book: s.slug, unit: 'refresh', round, locks: [`bible:${s.slug}`], requested_by: 'engine' }]
}

/** The humanizer's pass over one chapter. `round` is the book's round, the chapter keeps its own. */
function humanizeJob(s: BookState, n: number, round: number): PlanJob {
  const unit = `ch${pad2(n)}`
  return { id: jobId(s.slug, 'humanize', unit, round), task: 'humanize_chapter', role: 'humanizer', book: s.slug, unit, round, requested_by: 'engine' }
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Rewrite rounds a book may have: the format's (or quality's) `max_rounds`, plus one for every time `reopen_book` gave a rejected book another round. */
export const maxRoundsOf = (s: Pick<BookState, 'format' | 'quality'> & { extraRounds?: number }) => (s.format.max_rounds ?? s.quality.max_rounds) + (s.extraRounds ?? 0)

/** A short book is outside its length when the draft is this far (as a share) from its target words, or outside the format's range by 15%. */
export const TARGET_BAND = 0.2
/** A long book's gate: over the format's ceiling, or this far over / under the target, as a share. */
export const LONG_OVER = 1.15
export const LONG_UNDER = 0.85
/** A chapter of a long book is rewritten by the gate when it is over / under its share of the target by this much. */
export const CHAPTER_OVER = 1.1
export const CHAPTER_UNDER = 0.9

/**
 * The note of a length rewrite. With the book's target the chapter is told its share of it (clamped so that every chapter at that length
 * stays inside the format's range); without one, the old rule: the middle of the range's near edge.
 */
function lengthNote(words: number, min: number, max: number, total: number, target?: number): string {
  const per = target
    ? Math.max(1, clamp(Math.round(target / total), Math.ceil(min / total), Math.max(Math.ceil(min / total), Math.floor(max / total))))
    : Math.max(1, Math.round(clamp(words < min ? min * 1.1 : max * 0.9, min, max) / total))
  const low = target ? words < target : words < min
  return (
    `The whole draft is ${words} words, but the format wants ${min} to ${max} words${target ? ` and this book should have about ${target}` : ''}. Rewrite this chapter to about ${per} words. ` +
    (low
      ? 'It is too short: develop the scenes, add concrete detail, repetition and sensory description, without changing the story.'
      : 'It is too long: tighten it and cut repetition, without changing the story.')
  )
}

function lengthJobs(s: BookState, total: number, note: string | ((n: number) => string), only?: number[]): PlanJob[] {
  const list = only ?? [...Array(total).keys()].map((i) => i + 1)
  return list.map((n, i) => ({
    id: `${s.slug}--rewrite--ch${pad2(n)}--len`,
    task: 'rewrite_chapter',
    role: 'writer',
    book: s.slug,
    unit: `ch${pad2(n)}`,
    round: 0,
    depends_on: i > 0 ? [`${s.slug}--rewrite--ch${pad2(list[i - 1]!)}--len`] : [],
    agent_hint: s.writerAgent,
    requested_by: 'editors',
    body: typeof note === 'string' ? note : note(n)
  }))
}

function rewriteJobs(s: BookState, list: number[], round: number): PlanJob[] {
  return list.map((n, i) => ({
    id: jobId(s.slug, 'rewrite', `ch${pad2(n)}`, round),
    task: 'rewrite_chapter',
    role: 'writer',
    book: s.slug,
    unit: `ch${pad2(n)}`,
    round,
    depends_on: i > 0 ? [jobId(s.slug, 'rewrite', `ch${pad2(list[i - 1]!)}`, round)] : [],
    agent_hint: s.writerAgent,
    requested_by: 'editors'
  }))
}

/**
 * What should happen next for a book. A pure function of the book's files and job files:
 * it returns the book.md changes and the jobs to enqueue. Job ids are deterministic, so
 * running it again (after every job, and at startup) never duplicates work.
 */
export function advance(s: BookState): Plan {
  const none: Plan = { patch: {}, jobs: [] }
  if (TERMINAL_STAGES.has(s.stage)) return none
  if (s.failedJobs.length > 0) {
    // the stage it failed in is kept, so a retry can continue from there
    return { patch: { stage: 'failed', failed_from: s.stage, reasons: [`job failed for good: ${s.failedJobs.join(', ')}`] }, jobs: [] }
  }
  const slug = s.slug
  const stageOf = (stage: string) => (s.stage === stage ? {} : { stage })

  if (!s.hasPitch) {
    return { patch: stageOf('pitch'), jobs: [{ id: jobId(slug, 'pitch', 'book', 0), task: 'pitch', role: 'architect', book: slug, unit: 'book' }] }
  }
  if (s.outlineChapters === null) {
    // the architect decides whether the book needs facts, and the research jobs run before the outline
    if (!s.researchPlan && !s.adaptation && needsResearch(s.format)) {
      return { patch: stageOf('outline'), jobs: [{ id: jobId(slug, 'researchplan', 'book', 0), task: 'research_plan', role: 'architect', book: slug, unit: 'book' }] }
    }
    if (s.researchPlan && pendingAny(s, s.researchPlan.jobs)) return { patch: stageOf('outline'), jobs: [] }
    return { patch: stageOf('outline'), jobs: [{ id: jobId(slug, 'outline', 'book', 0), task: 'outline', role: 'architect', book: slug, unit: 'book' }] }
  }
  const total = s.outlineChapters

  if (s.format.long) {
    const early = advanceLongDrafting(s, total)
    if (early) return early
  } else {
    // drafting: chapters in order, one at a time, so the same writer is hinted for the rest.
    // Before a chapter: the writer's research prep. After it: the answers to its [RESEARCH: ...] markers are put in.
    for (let n = 1; n <= total; n++) {
      if (!s.chapters.has(n)) {
        const prep = prepStep(s, n)
        if (prep) return prep
        const facts = factStep(s, n)
        if (facts) return facts
        return {
          patch: stageOf('drafting'),
          jobs: [{ id: jobId(slug, 'draft', `ch${pad2(n)}`, 0), task: 'draft_chapter', role: 'writer', book: slug, unit: `ch${pad2(n)}`, agent_hint: s.writerAgent, requested_by: n === 1 ? 'architect' : 'engine' }]
        }
      }
      const fix = markerStep(s, n)
      if (fix) return fix
    }
  }

  const r = s.round

  // length gate (short books, once, before the first reviews): a draft far outside the format's range is rewritten once
  if (!s.format.long && r === 0 && s.stage !== 'rewriting') {
    const [min, max] = s.format.words
    const gate = s.lengthGate
    if (!gate) {
      // outside the format's range (by 15%), or far from the length the book was meant to have (by 20% of its target)
      const out = s.totalWords < min * 0.85 || s.totalWords > max * 1.15 || (!!s.targetWords && (s.totalWords < s.targetWords * (1 - TARGET_BAND) || s.totalWords > s.targetWords * (1 + TARGET_BAND)))
      if (!out) return { patch: { length_gate: { status: 'ok', words: s.totalWords } }, jobs: [] }
      return {
        patch: { stage: 'length-fix', length_gate: { status: 'rewriting', words: s.totalWords, min, max } },
        jobs: lengthJobs(s, total, lengthNote(s.totalWords, min, max, total, s.targetWords))
      }
    }
    if (gate.status === 'rewriting') {
      const todo = [...Array(total).keys()].map((i) => i + 1).filter((n) => !(s.fixes.get(n) ?? []).includes('len'))
      if (todo.length === 0) return { patch: { stage: 'drafting', length_gate: { status: 'done', words_before: gate.words, words: s.totalWords } }, jobs: [] }
      return { patch: {}, jobs: lengthJobs(s, total, lengthNote(gate.words!, min, max, total, s.targetWords), todo) }
    }
  }

  // length gate (long books, once, after drafting and before the reviews): a book over the format's ceiling or far from its target is
  // brought back by rewriting only the chapters far from their share of the target. Settled chapters keep their summaries (the cuts change no event).
  if (s.format.long && r === 0 && s.chapterWords && !['reviewing', 'rewriting', 'publishing'].includes(s.stage)) {
    const [min, max] = s.format.words
    const share = Math.round((s.targetWords ?? (min + max) / 2) / total)
    const off = (n: number) => {
      const w = s.chapterWords!.get(n) ?? 0
      return w > share * CHAPTER_OVER || w < share * CHAPTER_UNDER
    }
    const every = [...Array(total).keys()].map((i) => i + 1)
    const gate = s.lengthGate
    const note = (words: number) => (n: number) => {
      const w = s.chapterWords!.get(n) ?? 0
      return (
        `The whole book is ${words} words, but ${s.targetWords ? `it should have about ${s.targetWords} words` : 'it is outside its length'} (the format allows ${min} to ${max}). Rewrite this chapter to about ${share} words. ` +
        (w > share
          ? 'It is too long: tighten it and cut repetition and description, without changing the events, names or facts.'
          : 'It is too short: develop the scenes, add concrete detail and sensory description, without changing the events, names or facts.')
      )
    }
    if (!gate) {
      const t = s.targetWords
      const out = s.totalWords > max || s.totalWords < min || (!!t && (s.totalWords > t * LONG_OVER || s.totalWords < t * LONG_UNDER))
      const todo = every.filter(off)
      if (!out || todo.length === 0) return { patch: { length_gate: { status: 'ok', words: s.totalWords } }, jobs: [] }
      return { patch: { stage: 'length-fix', length_gate: { status: 'rewriting', words: s.totalWords, min, max } }, jobs: lengthJobs(s, total, note(s.totalWords), todo) }
    }
    if (gate.status === 'rewriting') {
      const todo = every.filter((n) => off(n) && !(s.fixes.get(n) ?? []).includes('len'))
      if (todo.length === 0) return { patch: { stage: 'drafting', length_gate: { status: 'done', words_before: gate.words, words: s.totalWords } }, jobs: [] }
      return { patch: {}, jobs: lengthJobs(s, total, note(gate.words ?? s.totalWords), todo) }
    }
  }

  // humanizer (short books, once, before the first reviews): every chapter is rewritten so it reads less like a machine
  if (s.humanize && !s.format.long && r === 0 && !['reviewing', 'rewriting', 'publishing'].includes(s.stage)) {
    const todo = [...Array(total).keys()].map((i) => i + 1).filter((n) => !s.humanized?.has(n))
    if (todo.length > 0) return { patch: stageOf('humanizing'), jobs: todo.map((n) => humanizeJob(s, n, 0)) }
  }

  // rewriting: the affected chapters, one after the other, then the humanizer over the rewritten ones before they are reviewed again
  if (s.stage === 'rewriting') {
    const todo = s.rewriteChapters.filter((n) => (s.chapters.get(n) ?? 0) < r)
    if (todo.length > 0) return { patch: {}, jobs: refreshStep(s, r) ?? rewriteJobs(s, todo, r) }
    if (s.humanize) {
      const again = s.rewriteChapters.filter((n) => s.chapters.has(n) && !s.humanized?.has(n))
      if (again.length > 0) return { patch: {}, jobs: again.map((n) => humanizeJob(s, n, r)) }
    }
  }

  // a book reopened for a review round only: the late research is merged before the reviewers (the fact-checker) read it
  if (r > 0 && s.stage === 'reviewing') {
    const refresh = refreshStep(s, r)
    if (refresh) return { patch: {}, jobs: refresh }
  }

  // reviewing
  const roles = reviewersFor(s.format)
  const long = s.format.long
  const keys = long ? [...roles, THREAD_CHECK] : roles
  const missingJobs: PlanJob[] = []
  if (long) {
    if (!s.repetitionReport) {
      return {
        patch: stageOf('reviewing'),
        jobs: [{ id: jobId(slug, 'repetition', 'book', 0), task: 'repetition_report', role: 'line-editor', book: slug, unit: 'book', requested_by: 'engine' }]
      }
    }
    for (const role of roles) {
      for (const a of s.acts) {
        if (s.actReviewFiles.has(`${role}:${a.n}:${r}`)) continue
        missingJobs.push({
          id: `${slug}--review--${role}--act${a.n}--r${r}`,
          task: 'review',
          role,
          book: slug,
          unit: `act${a.n}`,
          round: r,
          avoid_family: s.writerFamily,
          requested_by: 'editor-in-chief'
        })
      }
    }
    if (!s.reviews.has(`${THREAD_CHECK}:${r}`)) {
      missingJobs.push({ id: jobId(slug, 'threadcheck', 'book', r), task: 'thread_check', role: 'continuity-checker', book: slug, unit: 'book', round: r, avoid_family: s.writerFamily, requested_by: 'editor-in-chief' })
    }
  } else {
    for (const role of roles) {
      if (s.reviews.has(`${role}:${r}`)) continue
      missingJobs.push({ id: jobId(slug, 'review', role, r), task: reviewTask(role), role, book: slug, unit: 'book', round: r, avoid_family: s.writerFamily, requested_by: 'editor-in-chief' })
    }
  }
  if (missingJobs.length > 0) return { patch: stageOf('reviewing'), jobs: missingJobs }

  // all reviews are in
  const revise = keys.map((role) => ({ role, rev: s.reviews.get(`${role}:${r}`)! })).filter((x) => x.rev.verdict === 'revise')
  if (revise.length > 0 && r < maxRoundsOf(s)) {
    // the rewrite uses what the researcher found for the reviewers' questions: wait for it
    if (pendingAny(s, s.reviewResearch.get(r) ?? [])) return { patch: stageOf('reviewing'), jobs: [] }
    const { chapters: list, flat } = chaptersToRewrite(s, revise, total)
    const next = r + 1
    return { patch: { stage: 'rewriting', round: next, rewrite_chapters: list, tension_rewrite: flat }, jobs: refreshStep(s, next) ?? rewriteJobs(s, list, next) }
  }

  // done reviewing: the publisher decides (publish or reject)
  return {
    patch: stageOf('publishing'),
    jobs: [{ id: jobId(slug, 'publish', 'book', r), task: 'publish', role: 'publisher', book: slug, unit: 'book', round: r, requested_by: 'editor-in-chief' }]
  }
}

/**
 * Long books, up to the whole-book reviews: the outline review, then for each chapter in order
 * draft, continuity check (and one fix), memory update and indexing, and after each act its summary and review.
 * Returns the plan for the first step that isn't finished, or null when every chapter and act is done.
 */
function advanceLongDrafting(s: BookState, total: number): Plan | null {
  const slug = s.slug
  const stageOf = (stage: string) => (s.stage === stage ? {} : { stage })
  const only = (job: PlanJob, stage: string): Plan => ({ patch: stageOf(stage), jobs: [job] })

  // after the first round the book is in its review and rewrite phases: drafting is over
  if (s.round > 0 || ['reviewing', 'rewriting', 'publishing'].includes(s.stage)) return null

  // 1 the outline gets one review, and one rewrite if the editor asks for it
  if (!s.outlineReview) {
    return only({ id: jobId(slug, 'outlinereview', 'book', 0), task: 'review_outline', role: 'developmental-editor', book: slug, unit: 'book', requested_by: 'architect' }, 'outline')
  }
  if (s.outlineReview.verdict === 'revise' && s.outlineRound === 0) {
    return only({ id: jobId(slug, 'outline', 'book', 1), task: 'outline', role: 'architect', book: slug, unit: 'book', round: 1, requested_by: 'developmental-editor' }, 'outline')
  }

  const actOf = (n: number) => s.acts.find((a) => a.chapters.includes(n))
  for (let n = 1; n <= total; n++) {
    const unit = `ch${pad2(n)}`
    const act = actOf(n)
    // the first chapter of a later act waits for the previous act's summary and review
    if (act && act.n > 1 && n === act.chapters[0]) {
      const prev = act.n - 1
      if (!s.actSummaries.has(prev) || !s.actReviews.has(prev)) return actStep(s, prev)
    }
    if (!s.chapters.has(n)) {
      const prep = prepStep(s, n)
      if (prep) return prep
      return only({ id: jobId(slug, 'draft', unit, 0), task: 'draft_chapter', role: 'writer', book: slug, unit, agent_hint: s.writerAgent, requested_by: n === 1 ? 'architect' : 'engine' }, 'drafting')
    }
    const fix = markerStep(s, n)
    if (fix) return fix
    const check = s.chapterChecks.get(n)
    if (!check) {
      return only({ id: jobId(slug, 'check', unit, 0), task: 'check_chapter', role: 'continuity-checker', book: slug, unit, avoid_family: s.writerFamily, requested_by: 'engine' }, 'drafting')
    }
    if (check.verdict === 'revise' && !(s.fixes.get(n) ?? []).includes('chk')) {
      // the continuity checker's research questions are answered before the fix
      if (pendingAny(s, s.checkResearch.get(n) ?? [])) return { patch: stageOf('drafting'), jobs: [] }
      return only({ id: `${slug}--rewrite--${unit}--chk`, task: 'rewrite_chapter', role: 'writer', book: slug, unit, round: 0, agent_hint: s.writerAgent, requested_by: 'continuity-checker' }, 'drafting')
    }
    // the humanizer rewrites the chapter before the memory is updated from it (not a chapter that is settled already: a book that was
    // started before the humanizer existed keeps its memory as it is)
    if (s.humanize && !s.settled.has(n) && !s.humanized?.has(n)) {
      return only(humanizeJob(s, n, 0), 'drafting')
    }
    if (!s.settled.has(n)) {
      const memory: PlanJob = { id: jobId(slug, 'memory', unit, 0), task: 'memory_update', role: 'archivist', book: slug, unit, locks: [`bible:${slug}`], requested_by: 'engine' }
      const index: PlanJob = { id: jobId(slug, 'index', unit, 0), task: 'index_chapter', role: 'archivist', book: slug, unit, locks: [`bible:${slug}`], depends_on: [memory.id], requested_by: 'engine' }
      return { patch: stageOf('drafting'), jobs: [memory, index] }
    }
  }
  // the last act
  for (const a of s.acts) if (!s.actSummaries.has(a.n) || !s.actReviews.has(a.n)) return actStep(s, a.n)
  return null
}

function actStep(s: BookState, actN: number): Plan {
  const slug = s.slug
  const jobs: PlanJob[] = []
  if (!s.actSummaries.has(actN)) jobs.push({ id: jobId(slug, 'actsummary', `act${actN}`, 0), task: 'act_summary', role: 'archivist', book: slug, unit: `act${actN}`, locks: [`bible:${slug}`], requested_by: 'engine' })
  if (!s.actReviews.has(actN)) jobs.push({ id: jobId(slug, 'actreview', `act${actN}`, 0), task: 'act_review', role: 'developmental-editor', book: slug, unit: `act${actN}`, requested_by: 'engine' })
  return { patch: s.stage === 'drafting' ? {} : { stage: 'drafting' }, jobs }
}

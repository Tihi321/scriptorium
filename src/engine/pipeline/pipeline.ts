import { promises as fs } from 'node:fs'
import { parseMd } from '../../shared/md'
import { COVER_HEIGHT, COVER_WIDTH } from '../publish/cover'
import type { Scheduler } from '../queue/scheduler'
import { advance, TERMINAL_STAGES } from './advance'
import { findMarkers } from '../research/markers'
import type { BookState, ChapterScores, ReviewSummary } from './advance'
import { countBooksInProgress } from './books'
import type { BookStore } from './books'
import { eligibleTopics, pickNext, registerHandlers } from './handlers'
import { registerLongHandlers } from './longHandlers'
import { registerNonfictionHandlers } from './nonfiction'
import { FactBase } from '../memory/factbase'
import { registerResearchHandlers } from './researchHandlers'
import type { PipelineDeps } from './handlers'
import type { JobStore } from '../queue/jobs'

export interface PipelineOptions extends Omit<PipelineDeps, 'requestCover' | 'kick' | 'factbase'> {
  scheduler: Scheduler
  /** Called when something about a book changed that the UI should hear about (a cover finished, ...). */
  bookChanged?: (slug: string) => void
  /** True when Electron main can render cover HTML to PNG (the engine runs as a utilityProcess). */
  coverRenderer: boolean
  /** Interval of the factory tick in ms. Default 5000. */
  tickMs?: number
}

/**
 * The factory around the books: advances every book after each job, starts new books up to the limit,
 * fills the idea bucket when it runs low, and asks for cover renders.
 */
export class Pipeline {
  private chain: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined
  private queuedTick = false
  private stopped = false
  private warned = new Set<string>()
  private readonly deps: PipelineDeps

  constructor(private readonly o: PipelineOptions) {
    this.deps = { ...o, factbase: new FactBase(o.books), requestCover: (slug) => this.requestCover(slug), kick: () => this.kick() }
    registerHandlers(o.scheduler, this.deps)
    registerLongHandlers(o.scheduler, this.deps)
    registerResearchHandlers(o.scheduler, this.deps)
    registerNonfictionHandlers(o.scheduler, this.deps)
  }

  private get books(): BookStore {
    return this.o.books
  }
  private get jobs(): JobStore {
    return this.o.jobs
  }

  async start(): Promise<void> {
    await this.scanCovers()
    this.kick()
    this.timer = setInterval(() => this.kick(), this.o.tickMs ?? 5000)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    await this.chain
  }

  /** Runs one factory tick soon. Ticks never overlap, and several requests collapse into one. */
  kick(): void {
    if (this.queuedTick || this.stopped) return
    this.queuedTick = true
    this.chain = this.chain.then(async () => {
      this.queuedTick = false
      try {
        await this.tick()
      } catch (err) {
        this.o.log(`pipeline tick failed: ${(err as Error).message}`)
      }
    })
  }

  /** Waits until the ticks asked for so far have run. For tests. */
  async idle(): Promise<void> {
    await this.chain
  }

  // ---- state ----

  async loadState(slug: string, failedByBook: Map<string, string[]>): Promise<BookState | null> {
    const book = await this.books.read(slug)
    if (!book) return null
    const d = book.data
    const format = this.o.getFormats().find((f) => f.id === d.format)
    if (!format) return null
    const outline = await this.books.outline(slug)
    const chapterFiles = await this.books.chapters(slug)
    const chapters = new Map(chapterFiles.map((c) => [c.n, c.round]))
    const total = outline ? outline.chapters.length : 0

    let acts: { n: number; chapters: number[] }[] = format.long ? (await this.books.acts(slug)).map((a) => ({ n: a.n, chapters: a.chapters })) : []
    if (format.long && acts.length === 0 && total > 0) acts = [{ n: 1, chapters: [...Array(total).keys()].map((i) => i + 1) }]
    const actChapters = (n: number) => acts.find((a) => a.n === n)?.chapters ?? []

    const chapterScores = new Map<number, ChapterScores>()
    const reviewResearch = new Map<number, string[]>()
    const checkResearch = new Map<number, string[]>()
    const strings = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : [])
    const reviews = new Map<string, ReviewSummary>()
    const actReviewFiles = new Set<string>()
    const perAct = new Map<string, { verdicts: ReviewSummary[]; acts: number[] }>()
    const chapterChecks = new Map<number, ReviewSummary>()
    let outlineReview: ReviewSummary | null = null
    const actReviews = new Set<number>()
    const list = async (dir: string) => {
      try {
        return (await fs.readdir(this.books.file(slug, dir))).filter((f) => f.endsWith('.md'))
      } catch {
        return []
      }
    }
    const nums = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(Number).filter(Number.isFinite) : [])
    for (const f of await list('reviews')) {
      const doc = parseMd(await fs.readFile(this.books.file(slug, 'reviews', f), 'utf8'))
      const verdict: 'pass' | 'revise' = doc.data.verdict === 'pass' ? 'pass' : 'revise'
      const kind = String(doc.data.kind ?? '')
      const asked = strings(doc.data.research_jobs)
      if (asked.length && kind === 'review') reviewResearch.set(Number(doc.data.round ?? 0), [...(reviewResearch.get(Number(doc.data.round ?? 0)) ?? []), ...asked])
      if (asked.length && kind === 'chapter-check') checkResearch.set(Number(doc.data.n), asked)
      if (kind === 'outline-review') outlineReview = { verdict, chapters: [] }
      else if (kind === 'chapter-check') {
        chapterChecks.set(Number(doc.data.n), { verdict, chapters: [Number(doc.data.n)] })
        const c = Number((doc.data.scores as Record<string, unknown> | undefined)?.continuity)
        if (Number.isFinite(c)) chapterScores.set(Number(doc.data.n), { ...chapterScores.get(Number(doc.data.n)), continuity: c })
      }
      else if (kind === 'act-review') actReviews.add(Number(doc.data.act))
      else if (typeof doc.data.unit === 'string' && /^act\d+$/.test(doc.data.unit)) {
        const act = Number(doc.data.unit.slice(3))
        actReviewFiles.add(`${doc.data.role}:${act}:${doc.data.round}`)
        const key = `${doc.data.role}:${doc.data.round}`
        const e = perAct.get(key) ?? { verdicts: [], acts: [] }
        // a revise that names no chapters is picked down to the weakest chapters of that act (see chaptersToRewrite)
        const named = nums(doc.data.chapters)
        e.verdicts.push({ verdict, chapters: named, scope: verdict === 'revise' && named.length === 0 ? actChapters(act) : [] })
        e.acts.push(act)
        perAct.set(key, e)
      } else {
        reviews.set(`${doc.data.role}:${doc.data.round}`, { verdict, chapters: nums(doc.data.chapters) })
      }
    }
    for (const [key, e] of perAct) {
      if (new Set(e.acts).size < acts.length) continue // not every act has been reviewed yet
      reviews.set(key, {
        verdict: e.verdicts.some((v) => v.verdict === 'revise') ? 'revise' : 'pass',
        chapters: [...new Set(e.verdicts.flatMap((v) => v.chapters))].sort((a, b) => a - b),
        scope: [...new Set(e.verdicts.flatMap((v) => v.scope ?? []))].sort((a, b) => a - b)
      })
    }

    const settled = new Set<number>()
    const actSummaries = new Set<number>()
    for (const f of await list('summaries')) {
      const m = /^(ch|act)-(\d+)\.md$/.exec(f)
      if (!m) continue
      const doc = parseMd(await fs.readFile(this.books.file(slug, 'summaries', f), 'utf8'))
      if (m[1] === 'act') actSummaries.add(Number(m[2]))
      else if (doc.data.indexed === true) settled.add(Number(m[2]))
    }
    // research: the architect's plan, the writer's prep per chapter, the markers still in the text, and which research jobs are running
    const planText = await this.books.readText(slug, 'research-plan.md')
    const researchPlan = planText
      ? { jobs: ((parseMd(planText).data.questions as { job?: string | null }[] | undefined) ?? []).map((q) => q.job).filter((j): j is string => typeof j === 'string') }
      : null
    const prep = new Map<number, string[]>()
    for (const f of await list('reports')) {
      const m = /^prep-ch-(\d+)\.md$/.exec(f)
      if (!m) continue
      const doc = parseMd(await fs.readFile(this.books.file(slug, 'reports', f), 'utf8'))
      prep.set(Number(m[1]), ((doc.data.questions as { job?: string | null }[] | undefined) ?? []).map((q) => q.job).filter((j): j is string => typeof j === 'string'))
    }
    const markers = new Map<number, string[]>()
    for (const c of chapterFiles) {
      if (c.fixes.includes('res')) continue
      const qs = findMarkers(c.body).map((m) => m.question)
      if (qs.length) markers.set(c.n, qs)
    }
    const researchPending = new Set<string>()
    for (const state of ['queued', 'running'] as const) for (const id of await this.jobs.ids(state)) if (id.startsWith('research--')) researchPending.add(id)
    const factory = this.o.getFactory()
    const genreText = `${d.genre ?? ''} ${d.topic_name ?? ''}`.toLowerCase()
    const prepEnabled = format.research_prep || format.nonfiction || factory.research_prep_genres.some((g) => g.trim() && genreText.includes(g.trim().toLowerCase()))
    const tensionDoc = await this.books.readText(slug, 'reports', 'tension.md')
    const tensionData = tensionDoc ? parseMd(tensionDoc).data : {}
    for (const [c, v] of Object.entries((tensionData.tension as Record<string, number> | undefined) ?? {})) {
      if (Number.isFinite(Number(v))) chapterScores.set(Number(c), { ...chapterScores.get(Number(c)), tension: Number(v) })
    }
    const flatChapters = ((tensionData.flat_stretches as [number, number][] | undefined) ?? []).flatMap(([a, b]) => Array.from({ length: Number(b) - Number(a) + 1 }, (_, i) => Number(a) + i))
    const outlineText = await this.books.readText(slug, 'outline.md')
    return {
      slug,
      stage: d.stage,
      round: d.round,
      rewriteChapters: d.rewrite_chapters,
      writerFamily: d.writer_family,
      writerAgent: d.writer_agent,
      format,
      quality: this.o.getQuality(),
      hasPitch: (await this.books.pitch(slug)) !== null,
      outlineChapters: outline ? outline.chapters.length : null,
      outlineRound: outlineText ? Number(parseMd(outlineText).data.round ?? 0) : 0,
      acts,
      chapters,
      fixes: new Map(chapterFiles.map((c) => [c.n, c.fixes])),
      totalWords: chapterFiles.reduce((n, c) => n + c.words, 0),
      lengthGate: (d.length_gate as { status: string; words?: number } | undefined) ?? null,
      reviews,
      actReviewFiles,
      outlineReview,
      chapterChecks,
      settled,
      actSummaries,
      actReviews,
      repetitionReport: (await this.books.readText(slug, 'reports', 'repetition.md')) !== null,
      chapterScores,
      flatChapters,
      researchPlan,
      researchPending,
      prepEnabled,
      prep,
      markers,
      reviewResearch,
      checkResearch,
      failedJobs: failedByBook.get(slug) ?? [],
      nonfiction: format.nonfiction,
      factbase: format.nonfiction ? await this.deps.factbase.doneChapters(slug) : new Set<number>()
    }
  }

  private async failedByBook(): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    for (const j of await this.jobs.list('failed')) {
      // a research question that could not be answered never fails the book: the writer goes on without the notes
      if (!j.data.book || j.data.task === 'research') continue
      map.set(j.data.book, [...(map.get(j.data.book) ?? []), j.id])
    }
    return map
  }

  /** Applies `advance` to one book. */
  async advanceBook(slug: string, failed?: Map<string, string[]>, depth = 0): Promise<void> {
    const state = await this.loadState(slug, failed ?? (await this.failedByBook()))
    if (!state) return
    const plan = advance(state)
    if (Object.keys(plan.patch).length > 0) {
      const before = state.stage
      await this.books.update(slug, () => plan.patch)
      const stage = plan.patch.stage as string | undefined
      if (stage && stage !== before) {
        this.o.emit({ type: 'book.stage', book: slug, stage })
        if (stage === 'failed') {
          const b = await this.books.read(slug)
          if (b?.data.topic) await this.o.topics.adjust(b.data.topic, { inProgress: -1 })
          this.o.log(`book ${slug} failed: ${(plan.patch.reasons as string[] | undefined)?.join('; ')}`)
        }
      }
    }
    for (const { body, ...job } of plan.jobs) await this.jobs.enqueue(job, body ?? '')
    // a plan that only records something (a gate result) is followed by the next step at once
    if (plan.jobs.length === 0 && Object.keys(plan.patch).length > 0 && depth < 4) await this.advanceBook(slug, failed, depth + 1)
  }

  // ---- the factory tick ----

  async tick(): Promise<void> {
    const failed = await this.failedByBook()
    for (const slug of await this.books.slugs()) {
      const b = await this.books.read(slug)
      if (!b || TERMINAL_STAGES.has(b.data.stage)) continue
      await this.advanceBook(slug, failed)
    }
    if (this.o.getFactory().paused) return
    await this.fillIdeas()
    await this.startBooks()
  }

  /** Books that are neither published, rejected nor failed. A folder whose book.md can't be read right now (being written) counts as in progress. */
  countInProgress(): Promise<number> {
    return countBooksInProgress(this.books)
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.o.log(`warning: ${message}`)
    this.o.emit({ type: 'engine.warning', message })
  }

  private async pendingJobs(task: string): Promise<number> {
    let n = 0
    for (const state of ['queued', 'running'] as const) for (const j of await this.jobs.list(state)) if (j.data.task === task) n++
    return n
  }

  private async jobCount(prefix: string): Promise<{ all: number; failed: number }> {
    let all = 0
    for (const s of ['queued', 'running', 'done', 'failed'] as const) all += (await this.jobs.ids(s)).filter((i) => i.startsWith(prefix)).length
    return { all, failed: (await this.jobs.ids('failed')).filter((i) => i.startsWith(prefix)).length }
  }

  private async fillIdeas(): Promise<void> {
    const formats = this.o.getFormats()
    const topics = await this.o.topics.read()
    const open = await this.o.ideas.open()
    const eligible = eligibleTopics(topics, formats)
    if (eligible.length === 0) {
      if (!open.some((i) => i.data.source === 'user')) {
        this.warnOnce('nothing-to-write', 'no topic is active and there is no idea of yours in ideas/. Set `active: yes` for a topic in topics.md, or add an idea file to ideas/.')
      }
      return
    }
    if (open.length >= this.o.getFactory().idea_low_water_mark) return
    if ((await this.pendingJobs('generate_ideas')) > 0) return
    const { all, failed } = await this.jobCount('ideas--generate--')
    if (failed >= 3) {
      this.warnOnce('ideas-failing', 'the idea generator failed 3 times. Not trying again until the failed jobs in jobs/failed/ are removed.')
      return
    }
    await this.jobs.enqueue({ id: `ideas--generate--b${all + 1}--r0`, task: 'generate_ideas', role: 'idea-generator', requested_by: 'engine' })
  }

  private async startBooks(): Promise<void> {
    const max = this.o.getFactory().max_books_in_progress
    // pending first, books second: a start job that finishes in between is then counted as a book (never missed)
    const pending = await this.pendingJobs('start_book')
    const inProgress = await this.countInProgress()
    if (inProgress + pending >= max || pending > 0) return
    const pick = pickNext(await this.o.ideas.list(), await this.o.topics.read(), this.o.getFormats())
    if (!pick) {
      const topics = await this.o.topics.read()
      if (eligibleTopics(topics, this.o.getFormats()).length > 0) {
        this.warnOnce('targets-reached', 'every active topic has reached its target. Raise a target in topics.md or switch on another topic.')
      }
      return
    }
    const { all, failed } = await this.jobCount('eic--start--')
    if (failed >= 3) {
      this.warnOnce('start-failing', 'starting a book failed 3 times. Not trying again until the failed jobs in jobs/failed/ are removed.')
      return
    }
    await this.jobs.enqueue({
      id: `eic--start--n${all + 1}--r0`,
      task: 'start_book',
      role: 'editor-in-chief',
      locks: ['factory:start'],
      requested_by: pick.idea?.data.source === 'user' ? 'you' : 'engine'
    })
  }

  // ---- covers ----

  async requestCover(slug: string): Promise<void> {
    const b = await this.books.read(slug)
    if (!b) return
    if (!this.o.coverRenderer) {
      await this.books.update(slug, () => ({ cover_png: 'pending' }))
      return
    }
    await this.books.update(slug, () => ({ cover_png: 'requested' }))
    this.o.emit({
      type: 'cover.render',
      book: slug,
      htmlPath: this.books.file(slug, 'out', 'cover.html'),
      outPath: this.books.file(slug, 'out', 'cover.png'),
      width: COVER_WIDTH,
      height: COVER_HEIGHT
    })
  }

  /** On start under Electron: render the covers that were left pending. */
  async scanCovers(): Promise<void> {
    if (!this.o.coverRenderer) return
    for (const slug of await this.books.slugs()) {
      const b = await this.books.read(slug)
      if (b && (b.data.cover_png === 'pending' || b.data.cover_png === 'requested') && b.data.stage === 'published') await this.requestCover(slug)
    }
  }

  /** The renderer answered. On success the EPUB is rebuilt with the cover image. */
  async coverRendered(slug: string, ok: boolean, error?: string): Promise<void> {
    const b = await this.books.read(slug)
    if (!b) return
    if (!ok) {
      this.o.log(`cover render for ${slug} failed: ${error ?? 'unknown error'}`)
      await this.books.update(slug, () => ({ cover_png: 'failed' }))
      return
    }
    try {
      await fs.access(this.books.file(slug, 'out', 'cover.png'))
    } catch {
      this.o.log(`cover render for ${slug} said ok but out/cover.png is missing`)
      await this.books.update(slug, () => ({ cover_png: 'failed' }))
      return
    }
    await this.books.buildEpubFile(slug)
    await this.books.update(slug, () => ({ cover_png: 'done' }))
    this.o.bookChanged?.(slug)
    this.o.log(`cover for ${slug} rendered, EPUB rebuilt`)
  }
}


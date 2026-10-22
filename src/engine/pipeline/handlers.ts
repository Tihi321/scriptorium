import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { EngineEvent } from '../../shared/protocol'
import type { FactoryConfig, FormatEntry, QualityConfig } from '../../shared/schemas'
import { briefOf, briefPromptText } from '../../shared/brief'
import { parseMd } from '../../shared/md'
import { genreClass, writeCoverHtml } from '../publish/cover'
import type { ModelInfo } from '../models/registry'
import type { JobStore } from '../queue/jobs'
import type { ChatOptions, ChatResult, JobContext, Scheduler } from '../queue/scheduler'
import type { ChatMessage } from '../models/types'
import { writeMd } from '../store/atomic'
import type { IdeaFile, IdeaStore } from '../store/ideas'
import { bookRefs, waitingStories } from '../store/series'
import type { BookRef, SeriesStore } from '../store/series'
import { ARTICLE_KIND } from '../store/topics'
import type { TopicRow, TopicsFile } from '../store/topics'
import { ideaSummaries, seriesSummaries } from '../summary'
import { countInProgress, countWords } from './books'
import type { BookStore } from './books'
import { reviewersFor, THREAD_CHECK } from './advance'
import type { Bible } from '../memory/bible'
import type { FactBase } from '../memory/factbase'
import { buildDraftContext } from '../memory/context'
import type { PackedContext } from '../memory/context'
import type { MemoryService } from '../memory/service'
import { researchBlock, researchNotesFor, researchNotesForQuestions } from '../research/context'
import { findMarkers, stripMarkers } from '../research/markers'
import type { ResearchService, SearchService } from '../research/service'
import { bibleFor, nonfictionContext } from './nfcontext'
import { chatJson, cleanProse } from './llm'
import { adaptationFamily, adaptSection, canonPathNote, normalizeSourceChapters, sourceExcerpt, sourceOf, uncovered, withSourceBible } from './adapt'
import { earlierSeriesBooks, lightBibleEntries, seriesSection, withSeriesBible } from './series'
import { instructionLines, stripTrailingLeak } from './leak'
import { chapterNotes, otherChapters } from './rewriteContext'
import { addPlacesToBible, canonicalScenes, placeDescriptions, placesBlock } from './scriptPlaces'
import { appendToPrompt, buildMessages, loadChoicesSection, loadPrompt } from './prompts'
import { calendarFor } from './calendar'
import { ensureProblemsRule, normalizeReviewJson, reviewBody, withUsableNotes } from './reviewNotes'
import { ARTICLE_IDEAS_RULE, newsHeadlines } from './newspaper'
import { ancestors, chapterPlace, CHOICES_RULE, checkBranches, endLine, renderOutlineBody, splitChoicesBlock } from './branches'
import type { BranchChapter } from './branches'
import { decide, dimensionsFor } from './scoring'
import type { ReviewResult } from './scoring'

export interface PipelineDeps {
  dataDir: string
  books: BookStore
  topics: TopicsFile
  ideas: IdeaStore
  /** The series (series/): the order gate, the series section of the prompts and the bible carry-over read them. */
  series: SeriesStore
  jobs: JobStore
  bible: Bible
  /** The fact base of non-fiction books (in place of the story bible). */
  factbase: FactBase
  memory: MemoryService
  /** The researcher's front door: creates research jobs (limit, ids) and knows where the notes are. */
  research: ResearchService
  /** Search providers and page fetching for the researcher. */
  search: SearchService
  getQuality(): QualityConfig
  /** The context window (tokens) of the model a role would use next, when known. */
  contextTokens(role: string): number | undefined
  getFormats(): FormatEntry[]
  getFactory(): FactoryConfig
  emit(e: EngineEvent): void
  log(message: string): void
  /** Renders the cover PNG (Electron) or marks it pending (headless). */
  requestCover(slug: string): Promise<void>
  kick(): void
}

/** Collects what one job spent, for the book's "how it was made" record. */
export class Run {
  cost = 0
  model: ModelInfo | undefined
  version = ''
  readonly started = Date.now()
  constructor(readonly ctx: JobContext) {}
  async chat(opts: ChatOptions) {
    const r = await this.ctx.chat(opts)
    this.cost += r.costUsd
    this.model = r.model
    return r
  }
  addJson(cost: number, model: ModelInfo) {
    this.cost += cost
    this.model = model
  }
}

const enabledFormats = (formats: FormatEntry[]) => formats.filter((f) => f.enabled)

/** A newspaper article format (`article: true`): one chapter, no cover and no EPUB, its own slot limit. */
export const isArticleFormat = (f: Pick<FormatEntry, 'article'> | undefined | null): boolean => f?.article === true

/** Formats for a topic kind. With no kind, every enabled format except the article formats (those are for the newspaper's own topics). */
export function formatsForKind(formats: FormatEntry[], kind: string | null): FormatEntry[] {
  const on = enabledFormats(formats)
  return kind ? on.filter((f) => f.kinds.includes(kind)) : on.filter((f) => !f.article)
}

/** Open slots: a book can start while fewer than `max_books_in_progress` books are open, an article while fewer than `max_articles_in_progress` articles are. */
export interface SlotRoom {
  books: boolean
  articles: boolean
}

/** Whether a story (and the topic it names) is an article: its topic is a newspaper section, or it fixes an article format. */
export function isArticleStory(idea: IdeaFile | undefined, topic: TopicRow | undefined, formats: FormatEntry[]): boolean {
  if (topic) return topic.kind === ARTICLE_KIND
  const fixed = idea?.data.format ? formats.find((f) => f.enabled && f.id === idea.data.format) : undefined
  return isArticleFormat(fixed)
}

export interface NextPick {
  idea?: IdeaFile
  topic?: TopicRow
}

/**
 * Who gets a book next: your ideas first, then generated ideas for active topics, then the emptiest active topic.
 * A story of a series waits while an earlier book of its series is not published yet (`books` says which are), or an earlier story of it is still open.
 * `prefer` is the slug of the story a start job was queued for (its models were chosen for that story): it is picked when it can still start.
 */
export function pickNext(ideas: IdeaFile[], topics: TopicRow[], formats: FormatEntry[], books: BookRef[] = [], room: SlotRoom = { books: true, articles: true }, prefer?: string): NextPick | null {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const waiting = waitingStories(ideas, books)
  const open = ideas.filter((i) => i.data.status === 'open' && !waiting.has(i.slug))
  // an article needs a free article slot and a book a free book slot: the two limits are separate
  const slot = (article: boolean) => (article ? room.articles : room.books)
  const ok = (topic?: TopicRow, idea?: IdeaFile) => {
    const article = isArticleStory(idea, topic, formats)
    return slot(article) && (formatsForKind(formats, topic?.kind ?? null).length > 0 || (!topic && article))
  }
  const wanted = prefer ? open.find((x) => x.slug === prefer) : undefined
  if (wanted) {
    const topic = wanted.data.topic ? byId.get(wanted.data.topic) : undefined
    if (wanted.data.source === 'user' ? ok(topic, wanted) : !!topic && topic.active && hasRoom(topic) && ok(topic, wanted)) return { idea: wanted, topic }
  }
  for (const i of open.filter((x) => x.data.source === 'user')) {
    const topic = i.data.topic ? byId.get(i.data.topic) : undefined
    if (ok(topic, i)) return { idea: i, topic }
  }
  for (const i of open.filter((x) => x.data.source === 'generated')) {
    const topic = i.data.topic ? byId.get(i.data.topic) : undefined
    if (topic && topic.active && hasRoom(topic) && ok(topic, i)) return { idea: i, topic }
  }
  const candidates = topics.filter((t) => t.active && hasRoom(t) && ok(t))
  candidates.sort((a, b) => a.done + a.inProgress - (b.done + b.inProgress) || a.line - b.line)
  return candidates[0] ? { topic: candidates[0] } : null
}

export const hasRoom = (t: TopicRow) => t.target === 0 || t.done + t.inProgress < t.target

/** Active topics that some enabled format can be written for. */
export function eligibleTopics(topics: TopicRow[], formats: FormatEntry[]): TopicRow[] {
  return topics.filter((t) => t.active && formatsForKind(formats, t.kind).length > 0)
}

export const unitNumber = (unit: string | null) => Number(/(\d+)/.exec(unit ?? '')?.[1] ?? 0)

export const formatVars = (f: FormatEntry, target: number) => ({
  format_id: f.id,
  format_name: f.name,
  age_band: f.age_band ?? 'general readers',
  words_min: f.words[0],
  words_max: f.words[1],
  chapters_min: f.chapters[0],
  chapters_max: f.chapters[1],
  guidance: f.guidance.trim(),
  target_words: target
})

/** A drafted chapter of a long book under this share of its target words gets an expand retry. */
export const EXPAND_BELOW = 0.8

/** A chapter over this share of its target words gets one tighten retry (every format, drafts and round rewrites). */
export const TRIM_ABOVE = 1.2

/**
 * The words one chapter should have: the book's target over the chapters its outline plans (the chapters written so far when there is no
 * outline entry count yet), never over the chapters written so far while the outline is longer.
 */
export const perChapterTarget = (book: { target_words: number }, outline: { chapters: unknown[] } | null | undefined, written: number): number =>
  Math.round(book.target_words / Math.max(1, outline?.chapters.length || written || 1))

/** The first two paragraphs of an appended section (its heading and its instruction): what a leak of it would repeat. */
const sectionHead = (section: string): string => section.split(/\n\n/).slice(0, 2).join('\n\n')

/** At most this many [RESEARCH: ...] markers of a chapter become research jobs. */
export const MAX_MARKERS_PER_CHAPTER = 3

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Three acts for a long book of 6 or more chapters, two for 4 or 5, else one. Chapters are split evenly. */
export function splitActs(chapters: number): { n: number; title: string; chapters: number[] }[] {
  const k = chapters >= 6 ? 3 : chapters >= 4 ? 2 : 1
  const size = Math.ceil(chapters / k)
  const romans = ['I', 'II', 'III']
  return Array.from({ length: k }, (_, i) => ({
    n: i + 1,
    title: `Act ${romans[i]}`,
    chapters: Array.from({ length: Math.max(0, Math.min(size, chapters - i * size)) }, (_, j) => i * size + j + 1)
  })).filter((a) => a.chapters.length > 0)
}

/** The context for writing or checking chapter `n` of a long book, from the book memory. */
export async function memoryContext(d: Pick<PipelineDeps, 'books' | 'bible' | 'series' | 'memory' | 'research' | 'log' | 'contextTokens'>, slug: string, n: number, budgetTokens: number, role: string): Promise<PackedContext> {
  // leave room for the answer: use at most 45% of the model's window
  const window = d.contextTokens(role)
  if (window) budgetTokens = Math.max(2500, Math.min(budgetTokens, Math.floor(window * 0.45)))
  let index = null
  if (!d.memory.ready() && d.memory.available()) {
    d.log('search skipped: the embeddings server is down; the chapter is written from the bible and the summaries')
  } else if (d.memory.available()) {
    try {
      index = d.memory.getIndex()
    } catch (err) {
      d.log(`search index not available: ${(err as Error).message}`)
    }
  }
  // research notes (of the book and shared) that fit what this chapter is about
  const entry = (await d.books.outline(slug))?.chapters.find((c) => c.n === n)
  const research = entry ? await researchNotesFor(d, slug, `${entry.title}. ${entry.summary}`, 4) : []
  const seriesBooks = await earlierSeriesBooks(d, slug)
  return buildDraftContext({ books: d.books, bible: d.bible, index, slug, n, budgetTokens, research, seriesBooks, log: d.log })
}

/** Writes the book's record of this job (books/<slug>/made.md and the summary in book.md). */
export async function recordMade(d: Pick<PipelineDeps, 'books'>, slug: string, run: Run): Promise<void> {
  const ctx = run.ctx
  await d.books.recordMade(
    slug,
    {
      job: ctx.job.id,
      task: ctx.job.task,
      role: ctx.job.role,
      unit: ctx.job.unit,
      round: ctx.job.round,
      agent: ctx.agent.id,
      model: run.model?.ref,
      prompt_version: run.version,
      cost_usd: Number(run.cost.toFixed(6)),
      ms: Date.now() - run.started
    },
    run.cost
  )
}

export function registerHandlers(sched: Scheduler, d: PipelineDeps): void {
  const formatOf = (id: string): FormatEntry => {
    const f = d.getFormats().find((x) => x.id === id)
    if (!f) throw new Error(`unknown format ${id} (see config/formats.md)`)
    return f
  }

  const made = (slug: string, run: Run) => recordMade(d, slug, run)

  // ---- idea generator ----
  /** The writer's answer as chapter text: no reasoning, no heading, and the task instructions a model repeated at the end cut off. A leak in the middle fails the job (it is asked again). */
  const chapterAnswer = (ctx: JobContext, forbid: string[], text: string): string => {
    const body = stripLeadingHeading(cleanProse(text))
    const leak = stripTrailingLeak(body, forbid)
    if (!leak) throw new Error('the answer repeats the task instructions')
    if (leak.cut) ctx.log('the answer ended with the task instructions: cut off')
    return leak.text
  }

  /**
   * A chapter over 120% of its target gets one more request: cut it to the target. The shorter text is kept when it is between 80% of the
   * target and the length it had. Returns the text, and the reply when the retry was kept.
   */
  const tighten = async (ctx: JobContext, run: Run, messages: ChatMessage[], body: string, target: number, script: boolean, forbid: string[], maxTokens: number): Promise<{ body: string; reply: ChatResult | null }> => {
    const words = countWords(body)
    if (words <= target * TRIM_ABOVE) return { body, reply: null }
    const how = script
      ? 'Cut narration lines and minor lines, and keep every SCENE, ON SCREEN and plot beat'
      : 'Tighten it: cut repetition and description, and keep every event, name and line of dialogue that matters'
    try {
      const retry = await run.chat({
        messages: [
          ...messages,
          { role: 'assistant', content: body },
          { role: 'user', content: `This chapter has ${words} words, but it should have about ${target}. Cut it to about ${target} words. ${how}. Write the whole chapter again, as plain ${script ? 'script' : 'prose'} only, with no title or notes.` }
        ],
        maxTokens,
        forbid
      })
      const shorter = chapterAnswer(ctx, forbid, retry.text)
      const now = countWords(shorter)
      if (now >= target * 0.8 && now < words) {
        ctx.log(`chapter was ${words} words (target ${target}); trimmed to ${now}`)
        return { body: shorter, reply: retry }
      }
      ctx.log(`the tighten retry gave ${now} words (target ${target}): keeping the first answer of ${words}`)
    } catch (err) {
      if (['AbortError', 'BudgetError'].includes((err as Error)?.name)) throw err
      ctx.log(`the tighten retry failed (${(err as Error).message}): keeping the first answer of ${words} words`)
    }
    return { body, reply: null }
  }

  /** A visual novel script: its SCENE places are the bible's names, and the places the bible lacks are added to it (see scriptPlaces.ts). */
  const settlePlaces = async (ctx: JobContext, slug: string, n: number, body: string): Promise<string> => {
    const bible = await d.books.bible(slug)
    if (!bible) return body // a structured bible keeps its places in files: the script is left as it is
    const places = lightBibleEntries(bible).filter((e) => e.group === 'places').map((e) => e.name)
    const out = canonicalScenes(body, places)
    for (const r of out.renamed) ctx.log(`SCENE place "${r.from}" written as the bible's "${r.to}"`)
    if (out.unknown.length) {
      const text = placeDescriptions(out.body, out.unknown)
      await writeMd(d.books.file(slug, 'bible', 'bible.md'), { kind: 'bible' }, '\n' + addPlacesToBible(bible, out.unknown.map((p) => ({ place: p, text: text.get(p) ?? '' })), n))
      ctx.log(`new place(s) added to the bible: ${out.unknown.join(', ')}`)
    }
    return out.body
  }

  sched.register('generate_ideas', async (ctx) => {
    const run = new Run(ctx)
    const formats = d.getFormats()
    const rows = await d.topics.read()
    const eligible = eligibleTopics(rows, formats)
    if (eligible.length === 0) return { result: 'no active topic with an enabled format' }
    const count = Math.max(3, d.getFactory().idea_low_water_mark)
    const existing = [...(await d.ideas.list()).map((i) => i.title)]
    for (const s of await d.books.slugs()) existing.push((await d.books.read(s))?.data.title ?? s)
    // the newspaper sections: a news search for each active one, so the ideas are about what is in the news now
    const news = await newsHeadlines(d, eligible.filter((t) => t.kind === ARTICLE_KIND), ctx)
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'idea-generator', 'generate_ideas', {
      count,
      topics: eligible.map((t) => `- ${t.id}: ${t.topic} (${t.kind}, ${t.done + t.inProgress} ${t.kind === ARTICLE_KIND ? 'articles' : 'books'} so far)`).join('\n'),
      existing_titles: existing.length ? existing.map((t) => `- ${t}`).join('\n') : '(none yet)',
      news
    })
    run.version = version
    // a data folder whose generate_ideas.md has no {{news}} (it predates the newspaper) still gets the headlines and the article rule
    if (news && !(await loadPrompt(d.dataDir, 'idea-generator', 'generate_ideas')).raw.includes('{{news}}')) appendToPrompt(messages, `${ARTICLE_IDEAS_RULE}\n\n${news}`)
    const schema = z.object({ ideas: z.array(z.object({ title: z.string().min(2), topic: z.string(), pitch: z.string().min(10) })).min(1) })
    const r = await chatJson(ctx, messages, schema, { maxTokens: 6000 })
    run.addJson(r.cost, r.chat.model)
    let created = 0
    const taken = new Set(existing.map((t) => t.toLowerCase()))
    const usage = new Map(eligible.map((t) => [t.id, t.done + t.inProgress]))
    for (const idea of r.value.ideas.slice(0, count)) {
      if (taken.has(idea.title.trim().toLowerCase())) continue
      let topic = eligible.find((t) => t.id === idea.topic)
      if (!topic) topic = [...eligible].sort((a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0))[0]!
      usage.set(topic.id, (usage.get(topic.id) ?? 0) + 1)
      taken.add(idea.title.trim().toLowerCase())
      await d.ideas.create({ title: idea.title.trim(), pitch: idea.pitch, topic: topic.id, source: 'generated' })
      created++
    }
    if (created === 0) throw new Error('the idea generator produced no new ideas')
    return { result: `${created} new idea(s)` }
  })

  // ---- editor-in-chief ----
  sched.register('start_book', async (ctx) => {
    const run = new Run(ctx)
    const formats = d.getFormats()
    // the start jobs hold the `factory:start` lock, so they run one at a time: count again here, in case the factory was busy since the job was queued
    const open = await countInProgress(d.books)
    const room: SlotRoom = { books: open.books < d.getFactory().max_books_in_progress, articles: open.articles < d.getFactory().max_articles_in_progress }
    if (!room.books && !room.articles) return { result: 'enough books in progress already' }
    const pick = pickNext(await d.ideas.list(), await d.topics.read(), formats, await bookRefs(d.books), room, ctx.job.idea)
    if (!pick) return { result: 'nothing to start' }
    const { idea, topic } = pick
    // an adaptation (a story with `source_book`) is a visual novel script: only the script formats are open to it
    const source = idea?.data.source_book ? await sourceOf(d, idea.data.source_book) : null
    let allowed = formatsForKind(formats, topic?.kind ?? null).filter((f) => !idea?.data.source_book || f.script)
    // a story with no topic that fixes an article format is an article of no section
    if (!topic && idea?.data.format && formats.some((f) => f.enabled && f.article && f.id === idea.data.format)) allowed = formats.filter((f) => f.id === idea.data.format)
    const articleStory = allowed.length > 0 && allowed.every((f) => f.article)
    // the owner's story: its title and format are theirs to fix, and the whole brief goes to the editor
    const fromOwner = idea?.data.source === 'user'
    const brief = idea && fromOwner ? briefOf(idea.data, idea.body) : null
    const fixedTitle = brief?.title.trim() || ''
    let fixedFormat: FormatEntry | undefined
    if (brief?.format) {
      fixedFormat = allowed.find((f) => f.id === brief.format)
      if (!fixedFormat) d.log(`the story "${idea!.title}" asks for the format "${brief.format}", which ${topic ? 'the topic does not allow' : 'is not enabled'}: the editor chooses`)
    }
    const ideaText = brief ? briefPromptText(brief) : idea?.body ?? ''
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'editor-in-chief', articleStory ? 'start_book_article' : 'start_book', {
      source: idea
        ? `An idea from the bucket (${fromOwner ? 'from the owner' : 'generated'}):${fixedTitle ? '' : ` "${idea.title}"`}\n${ideaText}` +
          (fixedTitle ? '\nThe owner fixed the title: use it as it is.' : '') +
          (fixedFormat ? `\nThe owner fixed the format: use "${fixedFormat.id}" (${fixedFormat.name}).` : '') +
          (source ? `\nThis story adapts the owner's published book "${source.title}" (genre: ${source.genre || 'none'}) into a visual novel script: keep the book's genre, and take the title from the book if the owner gave none.` : '')
        : 'No idea was picked: choose a fresh premise that fits the topic.',
      topic: topic ? `${topic.topic} (${topic.kind}), ${topic.done + topic.inProgress} books so far` : 'no topic given',
      formats: allowed.map((f) => `- ${f.id}: ${f.name}, ${f.words[0]}-${f.words[1]} words, ${f.chapters[0]}-${f.chapters[1]} chapter(s), age band ${f.age_band ?? 'general'}`).join('\n')
    })
    run.version = version
    const schema = z.object({
      format: z.string(),
      title: z.string().min(2),
      genre: z.string().default(''),
      target_words: z.number().optional(),
      notes: z.string().default('')
    })
    const r = await chatJson(ctx, messages, schema, { maxTokens: 6000 })
    run.addJson(r.cost, r.chat.model)
    const fmt = fixedFormat ?? allowed.find((f) => f.id === r.value.format) ?? allowed[0]
    if (!fmt) throw new Error(idea?.data.source_book ? 'no enabled visual novel format for this adaptation' : 'no enabled format for this topic')
    const target = clamp(Math.round(r.value.target_words ?? (fmt.words[0] + fmt.words[1]) / 2), fmt.words[0], fmt.words[1])
    const title = fixedTitle || r.value.title.replace(/^["'“”]+|["'“”]+$/g, '').trim()
    const slug = await d.books.freeSlug(title)
    await d.books.create(
      slug,
      {
        title,
        stage: 'new',
        round: 0,
        format: fmt.id,
        topic: topic?.id ?? null,
        topic_name: topic?.topic ?? null,
        genre: brief?.genre || source?.genre || r.value.genre || topic?.topic || fmt.name,
        age_band: fmt.age_band,
        ...(fmt.nonfiction ? { nonfiction: true } : {}),
        ...(fmt.article ? { article: true } : {}),
        ...(fmt.script ? { script: true } : {}),
        ...(idea?.data.humanize === false ? { humanize: false } : {}),
        ...(idea?.data.source_book ? { source_book: idea.data.source_book } : {}),
        target_words: target,
        ...(idea && idea.data.role_models && typeof idea.data.role_models === 'object' ? { role_models: idea.data.role_models } : {}),
        ...(idea?.data.series ? { series: idea.data.series, ...(idea.data.series_index ? { series_index: idea.data.series_index } : {}) } : {}),
        idea: idea?.slug ?? null,
        created: new Date().toISOString(),
        cost_usd: 0
      },
      `\n${r.value.notes ? `Editor-in-chief notes: ${r.value.notes}\n` : ''}${idea ? `\nStarted from the idea "${idea.title}".\n` : ''}`
    )
    if (idea) {
      // the book keeps its own copy of the story: the agents read it from there, and a hand edit applies from the next job
      const { status: _status, book: _book, ...kept } = idea.data
      await writeMd(d.books.file(slug, 'brief.md'), { ...kept, kind: 'brief', idea: idea.slug }, '\n' + idea.body + '\n')
      await d.ideas.markUsed(idea, slug)
      d.emit({ type: 'ideas.updated', ideas: ideaSummaries(await d.ideas.list()) })
      if (idea.data.series) {
        // the series lists its books in the order they were started
        await d.series.addBook(idea.data.series, slug)
        d.emit({ type: 'series.updated', series: await seriesSummaries(d) })
      }
    }
    if (topic) await d.topics.adjust(topic.id, { inProgress: 1 })
    await made(slug, run)
    d.emit({ type: 'book.stage', book: slug, stage: 'new' })
    d.kick()
    return { result: `started "${title}" (${fmt.id}, ${target} words)`, resultPath: `books/${slug}/book.md` }
  })

  // ---- architect: pitch ----
  sched.register('pitch', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const brief = await d.books.brief(slug)
    const ideaText = brief ? briefPromptText(brief) : typeof book.idea === 'string' ? ((await d.ideas.list()).find((i) => i.slug === book.idea)?.body ?? '') : ''
    // the library's pitch index is for books: an article is not checked against it and is not added to it
    const mem = d.memory.ready() && !fmt.article ? d.memory : null
    // the source of an adaptation (and other adaptations of it) is meant to be close: the similarity check leaves them out
    const family = await adaptationFamily(d, slug)
    let similarityNote = ''
    let text: string
    for (let attempt = 0; ; attempt++) {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', variant(fmt, 'pitch'), {
        title: book.title,
        topic: book.topic_name ?? book.genre,
        genre: book.genre,
        idea: ideaText || '(none: invent a premise that fits the topic)',
        similarity_note: similarityNote,
        ...formatVars(fmt, book.target_words)
      })
      run.version = version
      appendToPrompt(messages, await seriesSection(d, slug))
      appendToPrompt(messages, await adaptSection(d, slug, 'pitch', { formatName: fmt.name }))
      const r = await run.chat({ messages, maxTokens: 4000 })
      text = cleanProse(r.text)
      if (text.length < 40) throw new Error('the pitch came back empty')
      if (!mem || attempt >= 2) break
      // library-wide check: a pitch too close to an existing pitch or blurb is written again
      let near: { book: string; similarity: number } | null = null
      try {
        near = await mem.getIndex().nearest(text, { notBook: [slug, ...family], kinds: ['pitch', 'blurb'] })
      } catch (err) {
        d.log(`pitch similarity check skipped: ${(err as Error).message}`)
      }
      if (!near || near.similarity < d.getQuality().pitch_similarity_max) break
      const other = (await d.books.read(near.book))?.data.title ?? near.book
      similarityNote = `Your last pitch was too close to the existing book "${other}" (similarity ${near.similarity}). Write a different premise, with different characters, setting and plot.`
      ctx.log(`pitch too similar to "${other}" (${near.similarity}): writing it again (try ${attempt + 1})`)
    }
    await writeMd(d.books.file(slug, 'pitch.md'), { kind: 'pitch', title: book.title }, '\n' + text + '\n')
    if (mem) {
      try {
        await mem.getIndex().upsert({ file: `books/${slug}/pitch.md`, book: slug, kind: 'pitch', ref: 'pitch', text })
      } catch (err) {
        d.log(`could not index the pitch: ${(err as Error).message}`)
      }
    }
    await made(slug, run)
    return { result: 'pitch written', resultPath: `books/${slug}/pitch.md` }
  })

  // ---- architect: outline and bible ----
  sched.register('outline', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const round = ctx.job.round
    const reviewText = round > 0 ? await d.books.readText(slug, 'reviews', 'outline-review.md') : null
    const revision = reviewText
      ? `The developmental editor reviewed your first outline and asks for changes. Fix these problems and keep what already works:\n${parseMd(reviewText).body.trim()}`
      : ''
    // the architect's research questions (asked after the pitch) are answered by now: the outline is built on the notes
    const planText = await d.books.readText(slug, 'research-plan.md')
    const planned = planText && Array.isArray(parseMd(planText).data.questions) ? (parseMd(planText).data.questions as { question: string }[]).map((q) => q.question) : []
    const planNotes = planned.length ? await researchNotesForQuestions(d, slug, planned) : []
    if (planNotes.length) ctx.context(planNotes.map((i) => ({ name: i.name, tokens: Math.round(i.text.length / 4) })))
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', variant(fmt, 'outline'), {
      research: planNotes.length ? `${researchBlock(planNotes)}

Build the outline on these facts: the period, places, jobs, distances and durations must agree with them.` : '',
      title: book.title,
      genre: book.genre,
      pitch: (await d.books.pitch(slug)) ?? '',
      long: fmt.long ? 'yes' : 'no',
      revision_notes: revision,
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    // a story with choices: the architect plans a map of chapters with choices and endings
    if (fmt.choices) appendToPrompt(messages, await loadChoicesSection(d.dataDir, 'outline', { chapters_min: fmt.chapters[0], chapters_max: fmt.chapters[1] }))
    await ensureStoryYearRule(d.dataDir, messages, variant(fmt, 'outline'))
    appendToPrompt(messages, await storyBriefSection(d, slug))
    appendToPrompt(messages, await seriesSection(d, slug))
    // an adaptation: the source, the chapter range to compress it into and, with choices, the source's ending as the canon path
    const source = await sourceOf(d, slug)
    appendToPrompt(messages, await adaptSection(d, slug, 'outline', { formatName: fmt.name }))
    if (source && fmt.choices) appendToPrompt(messages, await canonPathNote(d.dataDir))
    appendToPrompt(messages, await ownerNotesSection(d, slug))
    const schema = z.object({
      chapters: z
        .array(
          z.object({
            title: z.string().min(1),
            summary: z.string().min(5),
            choices: z.array(z.object({ text: z.string(), to: z.coerce.number() })).default([]),
            ending: z.string().default(''),
            // an adaptation: the chapters of the source book this chapter is made from
            source_chapters: z.array(z.coerce.number()).default([])
          })
        )
        .min(1),
      characters: z.array(z.object({ name: z.string(), description: z.string(), voice: z.string().default('') })).default([]),
      places: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
      threads: z.array(z.string()).default([]),
      setting: z.string().default(''),
      style: z.string().default(''),
      // the year the story is set in (a number), or null for no fixed year: the reviewers get the calendar of that year
      story_year: z.union([z.number(), z.string(), z.null()]).default(null),
      // non-fiction: the argument, the audience and the terms of the fact base
      thesis: z.string().default(''),
      audience: z.string().default(''),
      terms: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
      // an article: its headline and standfirst
      headline: z.string().default(''),
      standfirst: z.string().default('')
    })
    let r = await chatJson(ctx, messages, schema, { maxTokens: fmt.long ? 12000 : 6000 })
    run.addJson(r.cost, r.chat.model)
    // too few chapters: ask once more with the count, instead of starting over (models often stop a chapter or two short)
    if (r.value.chapters.length < fmt.chapters[0]) {
      const short = r.value.chapters.length
      const more = await chatJson(
        ctx,
        [
          ...messages,
          { role: 'assistant', content: JSON.stringify(r.value).slice(0, 40000) },
          {
            role: 'user',
            content: `This outline has ${short} chapter(s), but this format needs ${fmt.chapters[0]} to ${fmt.chapters[1]}. Reply with the whole outline again as one JSON object in the same format, with at least ${fmt.chapters[0]} chapters: split the longest chapters, or add the steps the story skips. Keep the rest as it is.`
          }
        ],
        schema,
        { maxTokens: fmt.long ? 12000 : 6000 }
      )
      run.addJson(more.cost, more.chat.model)
      if (more.value.chapters.length > short) r = more
    }
    let chapters = r.value.chapters
    if (chapters.length > fmt.chapters[1]) chapters = chapters.slice(0, fmt.chapters[1])
    if (chapters.length < fmt.chapters[0]) throw new Error(`the outline has ${chapters.length} chapter(s), the format needs ${fmt.chapters[0]} to ${fmt.chapters[1]}`)
    // an adaptation: each chapter says which source chapters it is made from (numbers that are not in the source are dropped, a chapter with none gets an even share)
    let sourceMap: number[][] | null = null
    if (source) {
      const norm = normalizeSourceChapters(chapters.map((c) => c.source_chapters), source.chapterCount)
      sourceMap = norm.mapped
      if (norm.filled) ctx.log(`${norm.filled} chapter(s) of the outline named no source chapter: they get an even share of the source`)
      const lost = uncovered(sourceMap, source.chapterCount)
      if (lost.length) ctx.log(`no chapter of the outline is made from source chapter(s) ${lost.join(', ')}`)
    }
    const mapOf = (i: number) => (sourceMap?.[i]?.length ? { source_chapters: sourceMap[i] } : {})
    let numbered: BranchChapter[] = chapters.map((c, i) => ({ n: i + 1, title: c.title.trim(), summary: c.summary.trim(), ...mapOf(i) }))
    // a story with choices: bad choices are dropped, and a map a reader can't get through fails the job (it is planned again)
    if (fmt.choices) numbered = checkBranches(chapters.map((c, i) => ({ n: i + 1, title: c.title.trim(), summary: c.summary.trim(), choices: c.choices, ending: c.ending, ...mapOf(i) })))
    const acts = fmt.long ? splitActs(numbered.length) : undefined
    await writeMd(d.books.file(slug, 'outline.md'), { kind: 'outline', round, chapters: numbered, ...(acts ? { acts } : {}) }, renderOutlineBody(numbered, acts, !!fmt.choices))
    // a character the owner described is in the bible, even when the architect left it out
    const briefCharacters = fmt.nonfiction ? r.value.characters : await withBriefCharacters(d, slug, r.value.characters, ctx.log)
    // book N of a series starts from what the earlier books' bibles say about the recurring characters and places
    const carried = fmt.nonfiction ? { characters: briefCharacters, places: r.value.places } : await withSeriesBible(d, slug, briefCharacters, r.value.places, ctx.log)
    // an adaptation: the cast and places of the source book, looks kept (the art reference)
    const seeded = fmt.nonfiction ? carried : await withSourceBible(d, slug, carried.characters, carried.places, ctx.log)
    const characters = seeded.characters
    const places = seeded.places
    if (fmt.nonfiction) {
      // the fact base takes the place of the story bible: argument, audience, style, structure and terms (sources and facts follow per chapter)
      await d.factbase.writeThesis(
        slug,
        { thesis: r.value.thesis || r.value.setting, audience: r.value.audience, style: r.value.style, structure: numbered.map((c) => `${c.title}: ${c.summary}`) },
        r.value.terms
      )
    } else if (fmt.long) {
      // the structured bible: characters (with voice sheets), places, threads, timeline, style
      await fs.rm(d.books.file(slug, 'bible'), { recursive: true, force: true })
      await d.bible.writeInitial(slug, { characters, places, threads: r.value.threads, setting: r.value.setting, style: r.value.style })
    } else {
      const bible =
        `# Story bible (light)\n\n## Setting\n${r.value.setting || '(see the pitch)'}\n\n## Characters\n` +
        (characters.length ? characters.map((c) => `- **${c.name}**: ${c.description}${fmt.script && c.voice ? ` Voice: ${c.voice}` : ''}`).join('\n') : '(see the pitch)') +
        // a visual novel's places are the backgrounds an artist draws, so the light bible keeps them too
        (fmt.script && places.length ? `\n\n## Places\n${places.map((p) => `- **${p.name}**: ${p.description}`).join('\n')}` : '') +
        `\n\n## Style\n${r.value.style || '(see the format guidance)'}\n`
      await writeMd(d.books.file(slug, 'bible', 'bible.md'), { kind: 'bible' }, '\n' + bible)
    }
    const year = Math.round(Number(r.value.story_year))
    if (Number.isInteger(year) && year >= 1000 && year <= 2999 && book.story_year === undefined) await d.books.update(slug, () => ({ story_year: year }))
    if (fmt.article) {
      // the headline and the standfirst of the article, kept in book.md (the publisher makes them final)
      const headline = r.value.headline.replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim()
      const standfirst = r.value.standfirst.replace(/\s+/g, ' ').trim()
      if (headline || standfirst) await d.books.update(slug, () => ({ ...(headline ? { headline } : {}), ...(standfirst ? { standfirst } : {}) }))
    }
    await made(slug, run)
    const endings = fmt.choices ? numbered.filter((c) => !c.choices).length : 0
    return { result: `outline with ${numbered.length} chapter(s)${acts ? ` in ${acts.length} acts` : ''}${endings ? `, ${endings} endings` : ''}`, resultPath: `books/${slug}/outline.md` }
  })

  // ---- writer: draft a chapter ----
  sched.register('draft_chapter', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const outline = (await d.books.outline(slug))!
    const entry = outline.chapters.find((c) => c.n === n)
    if (!entry) throw new Error(`no outline entry for chapter ${n}`)
    const perChapter = perChapterTarget(book, outline, 0)
    let storySoFar: string
    if (fmt.nonfiction) {
      // non-fiction: the context comes from the fact base (key facts and numbered sources of this chapter, the notes, the chapters before)
      const packed = await nonfictionContext(d, slug, n, { budgetTokens: 20000, chapters: 'before', role: 'writer' })
      ctx.context(packed.items.map((i) => ({ name: i.included ? i.name : `${i.name} (left out: over the budget)`, tokens: i.tokens })))
      storySoFar = packed.text
    } else if (fmt.long) {
      // long books: the context is built from the book memory (bible, summaries, search), not the whole text
      const packed = await memoryContext(d, slug, n, 20000, 'writer')
      ctx.context(packed.items.map((i) => ({ name: i.included ? i.name : `${i.name} (left out: over the budget)`, tokens: i.tokens })))
      storySoFar = packed.text
    } else {
      // a story with choices: only the chapters a reader can pass through on the way here
      const before = fmt.choices ? ancestors(outline.chapters, n) : null
      const prior = (await d.books.chapters(slug)).filter((c) => (before ? before.has(c.n) : c.n < n))
      const research = await researchNotesFor(d, slug, `${entry.title}. ${entry.summary}`, 4)
      storySoFar = [
        `## Pitch\n${(await d.books.pitch(slug)) ?? ''}`,
        `## Outline\n${outline.chapters.map((c) => `${c.n}. ${c.title}: ${c.summary}${fmt.choices ? ` [${endLine(c)}]` : ''}`).join('\n')}`,
        `## Story bible\n${await d.books.bible(slug)}`,
        ...(research.length ? [`## ${researchBlock(research)}`] : []),
        `## ${before ? 'The chapters that can lead to this one' : 'The chapters written so far'}\n${prior.length ? prior.map((c) => `### Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n') : '(this is the first chapter)'}`
      ].join('\n\n')
      ctx.context([
        { name: 'pitch, outline and bible', tokens: Math.round((storySoFar.length - prior.reduce((s, c) => s + c.body.length, 0)) / 4) },
        { name: `${prior.length} earlier chapter(s) in full`, tokens: Math.round(prior.reduce((s, c) => s + c.body.length, 0) / 4) },
        ...research.map((r) => ({ name: r.name, tokens: Math.round(r.text.length / 4) }))
      ])
    }
    const { messages, version, template } = await buildMessages(d.dataDir, ctx, 'writer', variant(fmt, 'draft_chapter'), {
      title: book.title,
      story_so_far: storySoFar,
      chapter_n: n,
      chapter_count: outline.chapters.length,
      chapter_title: entry.title,
      chapter_summary: entry.summary,
      chapter_words: perChapter,
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    // what was added to the prompt, so the answer can be checked for repeating it (the client queue refuses such an answer up front)
    const appended: string[] = []
    const add = (text: string, whole = false) => {
      if (!text) return
      appendToPrompt(messages, text)
      appended.push(whole ? text : sectionHead(text))
    }
    if (fmt.choices) add(await loadChoicesSection(d.dataDir, 'draft', chapterPlace(outline.chapters, n)), true)
    add(await storyBriefSection(d, slug))
    add(await seriesSection(d, slug))
    add(await sourceChaptersSection(d, slug, n, 'draft', fmt.name, ctx))
    add(await ownerNotesSection(d, slug, n))
    if (fmt.script) add(placesBlock(lightBibleEntries(await d.books.bible(slug)).filter((e) => e.group === 'places').map((e) => e.name)), true)
    const forbid = instructionLines(template, appended)
    const maxTokens = Math.max(4000, perChapter * 6)
    let r = await run.chat({ messages, maxTokens, forbid })
    let body = chapterAnswer(ctx, forbid, r.text)
    if (countWords(body) < 20) throw new Error(`chapter ${n} came back too short (${countWords(body)} words, ${r.usage.outputTokens} tokens used: a thinking model may have run out of tokens)`)
    // long books: models write 10-50% less than asked. A chapter under 80% of its target gets one expand retry before the checks.
    let expandedFrom: number | null = null
    if (fmt.long && countWords(body) < perChapter * EXPAND_BELOW) {
      const before = countWords(body)
      const retry = await run.chat({
        messages: [
          ...messages,
          { role: 'assistant', content: body },
          {
            role: 'user',
            content: `This chapter has ${before} words, but it should have about ${perChapter}. Expand this chapter to about ${perChapter} words. Keep every event, name and fact as they are, and keep the same voice. Add what is missing: scene detail, the characters' thoughts and reactions, dialogue, the senses, the pauses between actions. Do not add new plot and do not repeat yourself. Write the whole chapter again, as plain prose only, with no title or notes.`
          }
        ],
        maxTokens,
        forbid
      })
      const longer = chapterAnswer(ctx, forbid, retry.text)
      if (countWords(longer) > before) {
        r = retry
        body = longer
        expandedFrom = before
      } else {
        ctx.log(`expand retry gave ${countWords(longer)} words, not more than ${before}: keeping the first draft`)
      }
      if (expandedFrom !== null) ctx.log(`chapter ${n} was ${before} words (target ${perChapter}); expanded to ${countWords(body)}`)
    }
    // a chapter far over its target (a model that does not stop): one request to cut it, for every format
    let trimmedFrom: number | null = null
    if (expandedFrom === null) {
      const before = countWords(body)
      const out = await tighten(ctx, run, messages, body, perChapter, !!fmt.script, forbid, maxTokens)
      if (out.reply) {
        r = out.reply
        body = out.body
        trimmedFrom = before
      }
    }
    // a script: the SCENE places are the bible's names, and a new place is added to the bible
    if (fmt.script) body = await settlePlaces(ctx, slug, n, body)
    // [RESEARCH: question] markers (any model can write them): each becomes a research job. A fix-up job replaces the sentences when the notes are in.
    const asked: string[] = []
    for (const m of findMarkers(body).slice(0, MAX_MARKERS_PER_CHAPTER)) {
      const a = await d.research.ask({ question: m.question, book: slug, askedBy: ctx.agent.id, purpose: `chapter ${n} of "${book.title}": the writer marked a sentence it was unsure about` })
      asked.push(`${m.question} (${a.status})`)
    }
    if (asked.length) ctx.log(`research markers in chapter ${n}: ${asked.join('; ')}`)
    // the pen name is set before the chapter appears, so the next chapter job already knows its writer
    if (!book.author) {
      await d.books.update(slug, () => ({ author: ctx.agent.name, writer_agent: ctx.agent.id, writer_family: r.model.family }))
    }
    await d.books.writeChapter(slug, { n, title: entry.title, round: 0, body, agent: ctx.agent.id, model: r.model.ref })
    await made(slug, run)
    return { result: `chapter ${n}: ${countWords(body)} words${expandedFrom !== null ? ` (expanded from ${expandedFrom})` : ''}${trimmedFrom !== null ? ` (trimmed from ${trimmedFrom})` : ''}`, resultPath: `books/${slug}/chapters/ch-${String(n).padStart(2, '0')}.md` }
  })

  // ---- reviewers ----
  sched.register(
    'review',
    async (ctx) => {
      const run = new Run(ctx)
      const slug = ctx.job.book!
      const role = ctx.job.role
      const round = ctx.job.round
      const book = (await d.books.read(slug))!.data
      const fmt = formatOf(book.format)
      const dims = dimensionsFor(role)
      const actN = /^act(\d+)$/.exec(ctx.job.unit ?? '')?.[1]
      let bookText: string
      let bible: string
      let extra = ''
      if (fmt.long && actN) {
        // long books are read one act at a time, with summaries of the other acts
        const acts = await d.books.acts(slug)
        const act = acts.find((a) => a.n === Number(actN))
        if (!act) throw new Error(`no act ${actN} in the outline`)
        const chapters = (await d.books.chapters(slug)).filter((c) => act.chapters.includes(c.n))
        const others: string[] = []
        for (const a of acts.filter((x) => x.n !== act.n)) {
          const t = await d.books.readText(slug, 'summaries', `act-${a.n}.md`)
          if (t) others.push(`### Act ${a.n}\n${parseMd(t).body.trim()}`)
        }
        bookText =
          `You are reading act ${act.n} of ${acts.length} (chapters ${act.chapters[0]}-${act.chapters[act.chapters.length - 1]}). The other acts are given as summaries.\n\n` +
          `## Summaries of the other acts\n${others.join('\n\n') || '(none)'}\n\n## Act ${act.n} in full\n\n` +
          chapters.map((c) => `### Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n')
        bible = await d.bible.digest(slug)
        if (role === 'line-editor') {
          const rep = await d.books.readText(slug, 'reports', 'repetition.md')
          if (rep) extra = `A script counted repeated phrases, openers and tics over the whole book. Use this report (it needs no model):\n${parseMd(rep).body.trim()}\n`
        }
      } else {
        bookText = await d.books.fullText(slug)
        bible = await bibleFor(d, slug, fmt.nonfiction)
      }
      const { messages, version } = await buildMessages(d.dataDir, ctx, role, variant(fmt, 'review'), {
        title: book.title,
        pitch: (await d.books.pitch(slug)) ?? '',
        bible,
        book_text: bookText,
        extra,
        dimensions: dims.join(', '),
        scores_example: JSON.stringify(Object.fromEntries(dims.map((x) => [x, 8]))),
        round,
        ...formatVars(fmt, book.target_words)
      })
      run.version = version
      if (fmt.choices) appendToPrompt(messages, await loadChoicesSection(d.dataDir, 'review'))
      appendToPrompt(messages, await seriesSection(d, slug))
      appendToPrompt(messages, await adaptSection(d, slug, 'review', { formatName: fmt.name }))
      await ensureProblemsRule(d.dataDir, messages, role, variant(fmt, 'review'))
      appendToPrompt(messages, await calendarFor(d, slug, bookText))
      ctx.context([{ name: actN ? `act ${actN} in full, summaries of the other acts` : 'whole book text', tokens: Math.round(messages[1]!.content.length / 4) }])
      // the schema names this reviewer's dimensions, so structured output and the repair retry both insist on them
      const schema = z.object({
        verdict: z.enum(['pass', 'revise']),
        scores: z.object(Object.fromEntries(dims.map((x) => [x, z.number()]))),
        notes: z.string(),
        chapters: z.array(z.number()).default([]),
        // every finding as a line: where, what is wrong, what to change (kept in the review file, so the rewrite gets all of them)
        problems: z.array(z.string()).default([]),
        research_questions: z.array(z.string()).default([])
      })
      const q = d.getQuality()
      // a revise that comes with only good scores (and from a reviewer that isn't a must-pass gate) is a pass
      const verdictOf = (v: z.infer<typeof schema>): 'pass' | 'revise' =>
        v.verdict === 'revise' && !q.must_pass.includes(role) && Math.min(...Object.values(v.scores).map((x) => clamp(Number(x), 1, 10))) >= q.revise_below ? 'pass' : v.verdict
      const first = await chatJson(ctx, messages, schema, { maxTokens: 6000, temperature: 0.2, normalize: normalizeReviewJson })
      // a revise that says nothing usable is asked again; a book never fails over it (the last attempt keeps what there is)
      const r = await withUsableNotes(ctx, messages, schema, first, {
        effective: verdictOf,
        notes: (v) => v.notes,
        problems: (v) => v.problems,
        retryLeft: ctx.job.attempts + 1 < (ctx.job.max_attempts ?? d.getFactory().max_attempts),
        maxTokens: 6000
      })
      run.addJson(r.cost, r.chat.model)
      // a claim that looks wrong and may not be in the notes: the researcher checks (and looks in the notes first)
      const researchJobs = await askFromReview(d, ctx.agent.id, slug, `the ${role.replace(/-/g, ' ')} doubts a claim in ${actN ? `act ${actN}` : 'the book'}`, r.value.research_questions)
      const scores: Record<string, number> = {}
      for (const [k, v] of Object.entries(r.value.scores)) scores[k.trim().toLowerCase().replace(/[\s-]+/g, '_')] = clamp(Number(v), 1, 10)
      const lowest = Math.min(...Object.values(scores))
      const verdict: 'pass' | 'revise' = r.value.verdict === 'revise' && !q.must_pass.includes(role) && lowest >= q.revise_below ? 'pass' : r.value.verdict
      const missing = dims.filter((x) => !(x in scores))
      if (missing.length) throw new Error(`the review is missing the score(s): ${missing.join(', ')}`)
      const name = actN ? `act-${actN}-${role}-r${round}.md` : `book-${role}-r${round}.md`
      await writeMd(
        d.books.file(slug, 'reviews', name),
        {
          kind: 'review',
          role,
          unit: actN ? `act${actN}` : 'book',
          round,
          verdict,
          verdict_raw: r.value.verdict,
          scores,
          chapters: r.value.chapters,
          ...(researchJobs.length ? { research_jobs: researchJobs } : {}),
          agent: ctx.agent.id,
          model: r.chat.model.ref
        },
        '\n' + reviewBody(r.value.notes, r.value.problems) + '\n'
      )
      await made(slug, run)
      return { result: `${verdict}${verdict !== r.value.verdict ? ' (was revise, scores all >= ' + q.revise_below + ')' : ''}: ${JSON.stringify(scores)}`, resultPath: `books/${slug}/reviews/${name}` }
    },
    { reviewing: true }
  )

  // ---- writer: rewrite one chapter from the merged notes ----
  sched.register('rewrite_chapter', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const round = ctx.job.round
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const chapters = await d.books.chapters(slug)
    const current = chapters.find((c) => c.n === n)
    if (!current) throw new Error(`chapter ${n} does not exist`)
    const isLength = ctx.job.id.endsWith('--len')
    const isCheck = ctx.job.id.endsWith('--chk')
    // your note from the draft reader, with "rewrite this chapter": the note is the job body
    const isNote = /--note\d+$/.test(ctx.job.id)
    const checkNotes = isCheck ? await d.books.readText(slug, 'reviews', `ch-${String(n).padStart(2, '0')}-check.md`) : null
    const reviews = isLength || isCheck || isNote ? [] : await loadReviews(d, slug, round - 1)
    const outline = await d.books.outline(slug)
    const acts = fmt.long ? await d.books.acts(slug) : []
    // the editors' notes that concern this chapter (the items that name other chapters are left out), not the notes on the whole book
    const mine = chapterNotes(reviews.filter((r) => !(r.role === 'fact-checker' && fmt.nonfiction)), n, acts)
    const notes = isLength
      ? ctx.jobBody.trim()
      : isNote
        ? `From the book's owner, who read the draft (this comes first): ${ctx.jobBody.trim()}`
      : isCheck
        ? `From the continuity checker: ${checkNotes ? parseMd(checkNotes).body.trim() : '(no notes)'}`
        : mine.text
    // a chapter in a flat tension stretch is rewritten to raise the tension (the developmental editor's tension report)
    const flat = !isLength && !isCheck && !isNote && Array.isArray(book.tension_rewrite) && (book.tension_rewrite as unknown[]).map(Number).includes(n)
    const tensionNote = flat ? `- Raise tension: this chapter is part of a flat stretch in the tension report (the developmental editor scored it ${(await readTensionOf(d, slug, n)) ?? 'low'} out of 10). Raise the stakes: add a sharper problem, a ticking clock, a loss or a hard choice, and end the chapter on a turn.` : ''
    const claimNote = fmt.nonfiction && !isLength && !isCheck && !isNote ? await factClaimNote(d, slug, round - 1, n) : ''
    const allNotes = [claimNote, notes, tensionNote].filter(Boolean).join('\n')
    // a note about a weekday, a date or an earlier book may be wrong: the writer checks it against the calendar and keeps correct text
    const calendarNote = `Notes about weekdays, dates, counts of years, or facts from earlier books of the series are open to judgement: check them against the calendar below and the series section; if the text is right, keep it.\n\n${await calendarFor(d, slug, current.body)}`
    let bibleText: string
    let researchText: string
    if (fmt.nonfiction) {
      // non-fiction: the fact base, the chapter's numbered notes and the other chapters come from the context builder (new notes the researcher found for the editors' questions are in)
      const packed = await nonfictionContext(d, slug, n, { budgetTokens: 20000, chapters: 'others', extraQuery: allNotes, role: 'writer' })
      ctx.context(packed.items.map((i) => ({ name: i.included ? i.name : `${i.name} (left out: over the budget)`, tokens: i.tokens })))
      bibleText = packed.text
      researchText = ''
    } else {
      const researchItems = await researchNotesFor(d, slug, `${current.title}. ${allNotes}`.slice(0, 1500), 4)
      bibleText = await d.books.bible(slug)
      researchText = researchBlock(researchItems)
    }
    // the chapters right before and after in full (a story with choices: the ones that lead here and the ones its choices lead to), the others as summaries
    const branches = fmt.choices ? outline?.chapters ?? null : null
    const summaries = new Map<number, string>()
    for (const c of chapters) {
      if (c.n === n) continue
      const file = fmt.long ? await d.books.readText(slug, 'summaries', `ch-${String(c.n).padStart(2, '0')}.md`) : null
      summaries.set(c.n, (file ? parseMd(file).body.trim() : '') || outline?.chapters.find((o) => o.n === c.n)?.summary || '')
    }
    const around = otherChapters({ chapters, n, branches, summaryOf: (k) => summaries.get(k) ?? '', windowTokens: d.contextTokens('writer') })
    ctx.context([
      { name: `${around.full.length} neighbouring chapter(s) in full`, tokens: Math.round(chapters.filter((c) => around.full.includes(c.n)).reduce((s, c) => s + c.body.length, 0) / 4) },
      { name: `${around.summaries} chapter summaries`, tokens: Math.round([...summaries.entries()].filter(([k]) => !around.full.includes(k)).reduce((s, [, t]) => s + t.length, 0) / 4) },
      { name: `notes for this chapter (${mine.kept} of ${mine.total} items)`, tokens: Math.round(notes.length / 4) }
    ])
    // the words this chapter should have: its share of the book's target over the planned chapters (a length rewrite says its own number)
    const target = perChapterTarget(book, outline, chapters.length)
    const lengthWords = isLength ? Number(/about (\d+) words/.exec(ctx.jobBody)?.[1]) : NaN
    const chapterWords = Number.isFinite(lengthWords) && lengthWords > 0 ? lengthWords : Math.round(clamp(current.words, 0.85 * target, 1.15 * target))
    const { messages, version, template } = await buildMessages(d.dataDir, ctx, 'writer', variant(fmt, 'rewrite_chapter'), {
      title: book.title,
      pitch: (await d.books.pitch(slug)) ?? '',
      bible: bibleText,
      notes: allNotes || '(no notes: improve the chapter where you can)',
      research: researchText,
      chapter_n: n,
      chapter_title: current.title,
      chapter_text: current.body,
      other_chapters: fmt.nonfiction ? '(the other chapters are in the fact base section above)' : around.text || '(this is the only chapter)',
      chapter_words: chapterWords,
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    const appended: string[] = []
    const add = (text: string, whole = false) => {
      if (!text) return
      appendToPrompt(messages, text)
      appended.push(whole ? text : sectionHead(text))
    }
    if (branches) {
      const section = await loadChoicesSection(d.dataDir, 'rewrite', chapterPlace(branches, n))
      add(section, true)
      // a data folder whose _choices.md predates the reworded choices still gets the rule
      if (!section.includes('CHOICES:')) add(CHOICES_RULE, true)
    }
    add(await storyBriefSection(d, slug))
    add(await seriesSection(d, slug))
    appendToPrompt(messages, calendarNote)
    add(await sourceChaptersSection(d, slug, n, 'rewrite', fmt.name, ctx))
    if (!isNote) add(await ownerNotesSection(d, slug, n)) // a note rewrite has the note as its notes already
    if (fmt.script) add(placesBlock(lightBibleEntries(await d.books.bible(slug)).filter((e) => e.group === 'places').map((e) => e.name)), true)
    const forbid = instructionLines(template, appended)
    const maxTokens = Math.max(4000, current.words * 6)
    let r = await run.chat({ messages, maxTokens, forbid })
    let body = stripMarkers(chapterAnswer(ctx, forbid, r.text))
    // a story with choices: the rewrite may end with reworded choices (`CHOICES:`). They are used when they keep the count and where each one leads.
    if (branches) {
      const split = splitChoicesBlock(body)
      body = split.body
      if (split.choices) {
        const old = branches.find((c) => c.n === n)?.choices ?? []
        const ok = split.choices.length === old.length && split.choices.every((c, i) => c.to === old[i]!.to && c.text.length >= 3 && c.text.length <= 120)
        if (ok && (await d.books.setChoiceTexts(slug, n, split.choices.map((c) => c.text)))) ctx.log(`the choices of chapter ${n} were reworded: ${split.choices.map((c) => `"${c.text}"`).join(', ')}`)
        else ctx.log(`the rewrite sent choices for chapter ${n} that change their number or where they lead (or are too short or long): ignored`)
      }
    }
    if (countWords(body) < 20) throw new Error(`the rewrite of chapter ${n} came back too short`)
    // a round rewrite far over the target gets one request to cut it (a length rewrite says its own number, a note of the owner is their choice)
    if (!isLength && !isNote) {
      const out = await tighten(ctx, run, messages, body, target, !!fmt.script, forbid, maxTokens)
      if (out.reply) {
        r = out.reply
        body = stripMarkers(out.body)
      }
    }
    if (fmt.script) body = await settlePlaces(ctx, slug, n, body)
    await d.books.writeChapter(slug, { n, title: current.title, round, body, agent: ctx.agent.id, model: r.model.ref, fixes: isLength ? [...current.fixes, 'len'] : isCheck ? [...current.fixes, 'chk'] : current.fixes })
    await made(slug, run)
    return { result: `chapter ${n} rewritten (round ${round}): ${countWords(body)} words`, resultPath: `books/${slug}/chapters/ch-${String(n).padStart(2, '0')}.md` }
  })

  // ---- publisher ----
  sched.register('publish', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const round = ctx.job.round
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const roles = [...reviewersFor(fmt), ...(fmt.long ? [THREAD_CHECK] : [])]
    const reviews = (await loadReviews(d, slug, round)).filter((r) => roles.includes(r.role))
    const decision = decide(reviews, d.getQuality())

    if (!decision.publish) {
      if (book.topic) await d.topics.adjust(book.topic, { inProgress: -1 })
      await made(slug, run)
      await d.books.update(slug, () => ({ stage: 'rejected', reasons: decision.reasons, score: decision.score, scores: decision.byDimension, rounds: round }))
      d.emit({ type: 'book.stage', book: slug, stage: 'rejected' })
      d.log(`rejected "${book.title}": ${decision.reasons.join(' | ')}`)
      return { result: `rejected: ${decision.reasons.join(' | ')}` }
    }

    // the end-of-book thread check (long books) leaves a report of the threads that are still open
    const openReport = await d.books.readText(slug, 'reports', 'open-threads.md')
    const openThreads = openReport && Array.isArray(parseMd(openReport).data.threads) ? (parseMd(openReport).data.threads as { id: string; text: string; opened: number }[]) : []
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'publisher', variant(fmt, 'publish'), {
      open_threads: openThreads.length ? openThreads.map((t) => `- ${t.id}: ${t.text} (opened in chapter ${t.opened})`).join('\n') : '(none)',
      title: book.title,
      author: book.author ?? '',
      pitch: (await d.books.pitch(slug)) ?? '',
      book_text: await d.books.fullText(slug),
      score: decision.score,
      juvenile: fmt.juvenile ? 'yes' : 'no',
      chapter_count: (await d.books.chapters(slug)).length,
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    const article = fmt.article === true
    const schema = z.object({
      title: z.string().min(1),
      // an article has a standfirst instead of a blurb, and no cover
      blurb: article ? z.string().default('') : z.string().min(10),
      standfirst: article ? z.string().min(5) : z.string().default(''),
      subjects: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      cover_brief: z.string().default(''),
      illustration_briefs: z.array(z.object({ chapter: z.number().default(1), description: z.string() })).default([])
    })
    const r = await chatJson(ctx, messages, schema, { maxTokens: 6000 })
    run.addJson(r.cost, r.chat.model)
    const title = r.value.title.replace(/^["'“”]+|["'“”]+$/g, '').trim() || book.title
    const year = new Date().getFullYear()
    const uuid = book.uuid ?? randomUUID()
    if (article) {
      // a newspaper article: no cover brief, cover, EPUB or Kindle. The page (out/article.html) and out/article.md are written before the stage flips.
      const standfirst = r.value.standfirst.replace(/\s+/g, ' ').trim()
      await d.books.update(slug, () => ({
        title,
        headline: title,
        standfirst,
        blurb: standfirst,
        subjects: r.value.subjects,
        keywords: r.value.keywords,
        year,
        uuid,
        score: decision.score,
        scores: decision.byDimension,
        rounds: round,
        reasons: [],
        published: new Date().toISOString()
      }))
      await made(slug, run)
      const page = await d.books.buildArticle(slug)
      if (book.topic) await d.topics.adjust(book.topic, { done: 1, inProgress: -1 })
      await d.books.update(slug, () => ({ stage: 'published' }))
      d.emit({ type: 'book.stage', book: slug, stage: 'published' })
      return { result: `published "${title}" (score ${decision.score})`, resultPath: path.relative(d.dataDir, page).split(path.sep).join('/') }
    }
    await writeMd(
      d.books.file(slug, 'cover-brief.md'),
      { kind: 'cover-brief', book: slug },
      `\n# Cover brief: ${title}\n\n${r.value.cover_brief.trim() || 'Template cover (title, author, genre, year). No image yet.'}\n\nThe template cover is drawn from \`templates/cover.html\`. This brief is for the image milestone (ComfyUI).\n`
    )
    if (fmt.juvenile) {
      const briefs = r.value.illustration_briefs
      await writeMd(
        d.books.file(slug, 'illustration-briefs.md'),
        { kind: 'illustration-briefs', book: slug, count: briefs.length },
        `\n# Illustration briefs: ${title}\n\nFor the image milestone. One picture per scene, kept simple and gentle.\n\n` +
          (briefs.length ? briefs.map((b, i) => `${i + 1}. Chapter ${b.chapter}: ${b.description.trim()}`).join('\n') : '(none given)') +
          '\n'
      )
    }
    const cls = genreClass({ topicName: book.topic_name, kind: topicKind(book.format, d.getFormats()), format: book.format })
    // everything is written before the stage flips to published, so readers of the stage see a finished book
    await d.books.update(slug, () => ({
      title,
      blurb: r.value.blurb.trim(),
      subjects: r.value.subjects,
      keywords: r.value.keywords,
      year,
      uuid,
      score: decision.score,
      scores: decision.byDimension,
      rounds: round,
      reasons: [],
      open_threads: openThreads.map((t) => `${t.id}: ${t.text}`),
      genre_class: cls
    }))
    await writeCoverHtml(d.dataDir, slug, { title, author: book.author ?? 'Unknown', genre: book.topic_name ?? book.genre, year, genreClass: cls })
    await made(slug, run)
    if (d.memory.ready()) {
      try {
        await d.memory.getIndex().upsert({ file: `books/${slug}/book.md#blurb`, book: slug, kind: 'blurb', ref: 'blurb', text: r.value.blurb.trim() })
      } catch (err) {
        d.log(`could not index the blurb: ${(err as Error).message}`)
      }
    }
    const epub = await d.books.buildEpubFile(slug)
    await d.requestCover(slug)
    if (book.topic) await d.topics.adjust(book.topic, { done: 1, inProgress: -1 })
    // a book that is still over the format's ceiling when the publisher publishes it is marked, so the owner sees it
    const wordTotal = (await d.books.chapters(slug)).reduce((s, c) => s + c.words, 0)
    const over = wordTotal > fmt.words[1]
    if (over) ctx.log(`warning: the book has ${wordTotal} words, over the format's ceiling of ${fmt.words[1]}; published anyway (length_over in book.md)`)
    await d.books.update(slug, () => ({ stage: 'published', published: new Date().toISOString(), ...(over ? { length_over: true } : {}) }))
    d.emit({ type: 'book.stage', book: slug, stage: 'published' })
    return { result: `published "${title}" (score ${decision.score})`, resultPath: path.relative(d.dataDir, epub).split(path.sep).join('/') }
  })
}

/** The prompt task for a format: `<task>_nf` for non-fiction, `<task>_vn` for a visual novel script, else `<task>`. */
export function variant(fmt: Pick<FormatEntry, 'nonfiction' | 'script'> & { article?: boolean }, task: string): string {
  return fmt.article ? `${task}_article` : fmt.nonfiction ? `${task}_nf` : fmt.script ? `${task}_vn` : task
}

/** Added to an outline prompt from an older data folder that does not ask for `story_year` (the seed prompts do). */
export const STORY_YEAR_RULE = `Also give "story_year" in the JSON object: the year the book is set in (or, for an article, the year it is about) as a number such as 2026, or null when it has no fixed year. Reviewers use it to check weekdays and dates.`

export async function ensureStoryYearRule(dataDir: string, messages: ChatMessage[], task: string): Promise<void> {
  if (!(await loadPrompt(dataDir, 'architect', task)).raw.includes('"story_year"')) appendToPrompt(messages, STORY_YEAR_RULE)
}

function topicKind(formatId: string, formats: FormatEntry[]): string | null {
  return formats.find((f) => f.id === formatId)?.kinds[0] ?? null
}

/** Removes a title or "Chapter N" line the model may put at the top of a chapter. */
export function stripLeadingHeading(text: string): string {
  const lines = text.split('\n')
  const first = lines[0]?.trim() ?? ''
  if (/^#{1,6}\s/.test(first) || /^\*{0,2}chapter\s+\d+/i.test(first)) return lines.slice(1).join('\n').trim()
  return text
}

/**
 * Reads the review files of one round and merges them per reviewer: for long books one reviewer has one file per act.
 * The verdict is revise if any file says revise, scores are averaged per dimension, notes are joined.
 */
export async function loadReviews(d: { books: BookStore }, slug: string, round: number): Promise<ReviewResult[]> {
  let names: string[]
  try {
    names = await fs.readdir(d.books.file(slug, 'reviews'))
  } catch {
    return []
  }
  const byRole = new Map<string, { verdicts: string[]; scores: Map<string, number[]>; notes: string[] }>()
  for (const n of names.filter((f) => f.endsWith(`-r${round}.md`)).sort()) {
    const doc = parseMd(await fs.readFile(d.books.file(slug, 'reviews', n), 'utf8'))
    if (doc.data.kind !== 'review' && doc.data.kind !== undefined && doc.data.kind !== 'thread-check') continue
    if (Number(doc.data.round) !== round || !doc.data.role) continue
    const role = String(doc.data.role)
    const e = byRole.get(role) ?? { verdicts: [], scores: new Map<string, number[]>(), notes: [] }
    e.verdicts.push(String(doc.data.verdict))
    for (const [dim, v] of Object.entries((doc.data.scores as Record<string, number>) ?? {})) e.scores.set(dim, [...(e.scores.get(dim) ?? []), Number(v)])
    const unit = String(doc.data.unit ?? '')
    e.notes.push(/^act\d+$/.test(unit) ? `(act ${unit.slice(3)}) ${doc.body.trim()}` : doc.body.trim())
    byRole.set(role, e)
  }
  return [...byRole.entries()].map(([role, e]) => ({
    role,
    verdict: e.verdicts.includes('revise') ? ('revise' as const) : ('pass' as const),
    scores: Object.fromEntries([...e.scores.entries()].map(([dim, v]) => [dim, Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2))])),
    notes: e.notes.join('\n\n')
  }))
}

/**
 * The fact-checker's flagged claims for one chapter, as an instruction to the writer: fix each one by citing a note that
 * supports it, correct it to agree with the notes, or remove or soften it, and add no new uncited claim.
 */
export async function factClaimNote(d: { books: BookStore }, slug: string, round: number, n: number): Promise<string> {
  const text = await d.books.readText(slug, 'reviews', `book-fact-checker-r${round}.md`)
  if (!text) return ''
  const doc = parseMd(text)
  if (doc.data.verdict !== 'revise') return ''
  const claims = (Array.isArray(doc.data.claims) ? (doc.data.claims as Array<Record<string, unknown>>) : []).filter((c) => Number(c.chapter) === n)
  if (!claims.length) return ''
  const lines = claims.map((c, i) => `  ${i + 1}. "${String(c.claim)}" (${String(c.problem ?? 'unsourced')}${c.detail ? `: ${String(c.detail)}` : ''})`)
  return [
    `- From the fact-checker, chapter ${n} has ${claims.length} flagged claim(s). Fix every one of them: cite the number of a source from the list whose note really says it, or correct it to agree with the notes, or remove it, or soften it to a general statement. Do not add any new claim that has no source number.`,
    ...lines
  ].join('\n')
}

/** The developmental editor's tension score for a chapter, from reports/tension.md. */
async function readTensionOf(d: { books: BookStore }, slug: string, n: number): Promise<number | null> {
  const t = await d.books.readText(slug, 'reports', 'tension.md')
  const raw = t ? (parseMd(t).data.tension as Record<string, number> | undefined) : undefined
  const v = raw?.[String(n)]
  return typeof v === 'number' ? v : null
}

/** At most this many research questions come from one review. */
export const MAX_REVIEW_QUESTIONS = 2

/** A reviewer's `research_questions` become research jobs for the book. Returns the ids of the jobs that exist (new or asked before). */
export async function askFromReview(d: Pick<PipelineDeps, 'research'>, agent: string, slug: string, purpose: string, questions: string[], max = MAX_REVIEW_QUESTIONS): Promise<string[]> {
  const ids: string[] = []
  for (const q of questions.slice(0, max)) {
    const a = await d.research.ask({ question: q, book: slug, askedBy: agent, purpose })
    if (a.id && (a.status === 'created' || a.status === 'exists')) ids.push(a.id)
  }
  return ids
}

/** An adaptation, for the writer of chapter `n`: the instruction and the full text of the source chapters the chapter is made from. Empty for a book that adapts none. */
async function sourceChaptersSection(d: Pick<PipelineDeps, 'books' | 'bible' | 'contextTokens'>, slug: string, n: number, task: 'draft' | 'rewrite', formatName: string, ctx: JobContext): Promise<string> {
  const head = await adaptSection(d, slug, task, { formatName })
  if (!head) return ''
  const excerpt = await sourceExcerpt(d, slug, n, 'writer', ctx.log)
  if (excerpt) ctx.context([{ name: 'source chapters in full', tokens: Math.round(excerpt.length / 4) }])
  return `${head}

${excerpt || '(this chapter has no source chapter mapped: work from the outline and the pitch)'}`
}

/** The owner's story brief (books/<slug>/brief.md) for the agents that plan, write and check. Empty when the book has none. */
export async function storyBriefSection(d: { books: BookStore }, slug: string): Promise<string> {
  const brief = await d.books.brief(slug)
  if (!brief) return ''
  return `## The owner's story brief\n\nThe owner described this story. Keep its title, its characters (names, roles, looks), its plot points and its setting, and build the story around them. Where the owner's notes (if any) conflict with the brief, the owner's notes win.\n\n${briefPromptText(brief)}`
}

type OutlineCharacter = { name: string; description: string; voice: string }

/** The outline's characters plus every character of the owner's brief that the architect left out (matched by name, ignoring case). */
export async function withBriefCharacters(d: { books: BookStore }, slug: string, characters: OutlineCharacter[], log: (m: string) => void): Promise<OutlineCharacter[]> {
  const brief = await d.books.brief(slug)
  if (!brief) return characters
  const have = new Set(characters.map((c) => c.name.trim().toLowerCase()))
  const missing = brief.characters.filter((c) => c.name.trim() && !have.has(c.name.trim().toLowerCase()))
  if (missing.length) log(`the outline left out ${missing.length} character(s) of the owner's brief: ${missing.map((c) => c.name).join(', ')}. They are added to the bible.`)
  return [...characters, ...missing.map((c) => ({ name: c.name.trim(), description: [c.role.trim(), c.description.trim()].filter(Boolean).join('. '), voice: '' }))]
}

/** Your notes from the draft reader (books/<slug>/notes.md), for the writers. Empty when there are none. */
export async function ownerNotesSection(d: { books: BookStore }, slug: string, chapter?: number): Promise<string> {
  const notes = await d.books.ownerNotes(slug)
  if (!notes) return ''
  const about = chapter ? ` A note marked "(chapter ${chapter})" is about the chapter you are writing now.` : ''
  return `## Notes from the book's owner\n\nThe owner read the draft and left these notes. Follow them: where they conflict with the outline or other notes, the owner's notes win.${about}\n\n${notes}`
}

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { EngineEvent } from '../../shared/protocol'
import type { FactoryConfig, FormatEntry, QualityConfig } from '../../shared/schemas'
import { parseMd } from '../../shared/md'
import { genreClass, writeCoverHtml } from '../publish/cover'
import type { ModelInfo } from '../models/registry'
import type { JobStore } from '../queue/jobs'
import type { ChatOptions, JobContext, Scheduler } from '../queue/scheduler'
import { writeMd } from '../store/atomic'
import type { IdeaFile, IdeaStore } from '../store/ideas'
import type { TopicRow, TopicsFile } from '../store/topics'
import { countBooksInProgress, countWords } from './books'
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
import { buildMessages } from './prompts'
import { decide, dimensionsFor } from './scoring'
import type { ReviewResult } from './scoring'

export interface PipelineDeps {
  dataDir: string
  books: BookStore
  topics: TopicsFile
  ideas: IdeaStore
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

export function formatsForKind(formats: FormatEntry[], kind: string | null): FormatEntry[] {
  const on = enabledFormats(formats)
  return kind ? on.filter((f) => f.kinds.includes(kind)) : on
}

export interface NextPick {
  idea?: IdeaFile
  topic?: TopicRow
}

/** Who gets a book next: your ideas first, then generated ideas for active topics, then the emptiest active topic. */
export function pickNext(ideas: IdeaFile[], topics: TopicRow[], formats: FormatEntry[]): NextPick | null {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const open = ideas.filter((i) => i.data.status === 'open')
  const ok = (topic?: TopicRow) => formatsForKind(formats, topic?.kind ?? null).length > 0
  for (const i of open.filter((x) => x.data.source === 'user')) {
    const topic = i.data.topic ? byId.get(i.data.topic) : undefined
    if (ok(topic)) return { idea: i, topic }
  }
  for (const i of open.filter((x) => x.data.source === 'generated')) {
    const topic = i.data.topic ? byId.get(i.data.topic) : undefined
    if (topic && topic.active && hasRoom(topic) && ok(topic)) return { idea: i, topic }
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
export async function memoryContext(d: Pick<PipelineDeps, 'books' | 'bible' | 'memory' | 'research' | 'log' | 'contextTokens'>, slug: string, n: number, budgetTokens: number, role: string): Promise<PackedContext> {
  // leave room for the answer: use at most 45% of the model's window
  const window = d.contextTokens(role)
  if (window) budgetTokens = Math.max(2500, Math.min(budgetTokens, Math.floor(window * 0.45)))
  let index = null
  if (d.memory.available()) {
    try {
      index = d.memory.getIndex()
    } catch (err) {
      d.log(`search index not available: ${(err as Error).message}`)
    }
  }
  // research notes (of the book and shared) that fit what this chapter is about
  const entry = (await d.books.outline(slug))?.chapters.find((c) => c.n === n)
  const research = entry ? await researchNotesFor(d, slug, `${entry.title}. ${entry.summary}`, 4) : []
  return buildDraftContext({ books: d.books, bible: d.bible, index, slug, n, budgetTokens, research })
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
  sched.register('generate_ideas', async (ctx) => {
    const run = new Run(ctx)
    const formats = d.getFormats()
    const rows = await d.topics.read()
    const eligible = eligibleTopics(rows, formats)
    if (eligible.length === 0) return { result: 'no active topic with an enabled format' }
    const count = Math.max(3, d.getFactory().idea_low_water_mark)
    const existing = [...(await d.ideas.list()).map((i) => i.title)]
    for (const s of await d.books.slugs()) existing.push((await d.books.read(s))?.data.title ?? s)
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'idea-generator', 'generate_ideas', {
      count,
      topics: eligible.map((t) => `- ${t.id}: ${t.topic} (${t.kind}, ${t.done + t.inProgress} books so far)`).join('\n'),
      existing_titles: existing.length ? existing.map((t) => `- ${t}`).join('\n') : '(none yet)'
    })
    run.version = version
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
    if ((await countBooksInProgress(d.books)) >= d.getFactory().max_books_in_progress) return { result: 'enough books in progress already' }
    const pick = pickNext(await d.ideas.list(), await d.topics.read(), formats)
    if (!pick) return { result: 'nothing to start' }
    const { idea, topic } = pick
    const allowed = formatsForKind(formats, topic?.kind ?? null)
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'editor-in-chief', 'start_book', {
      source: idea ? `An idea from the bucket (${idea.data.source === 'user' ? 'from the owner' : 'generated'}): "${idea.title}"\n${idea.body}` : 'No idea was picked: choose a fresh premise that fits the topic.',
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
    const fmt = allowed.find((f) => f.id === r.value.format) ?? allowed[0]
    if (!fmt) throw new Error('no enabled format for this topic')
    const target = clamp(Math.round(r.value.target_words ?? (fmt.words[0] + fmt.words[1]) / 2), fmt.words[0], fmt.words[1])
    const title = r.value.title.replace(/^["'“”]+|["'“”]+$/g, '').trim()
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
        genre: r.value.genre || topic?.topic || fmt.name,
        age_band: fmt.age_band,
        ...(fmt.nonfiction ? { nonfiction: true } : {}),
        target_words: target,
        idea: idea?.slug ?? null,
        created: new Date().toISOString(),
        cost_usd: 0
      },
      `\n${r.value.notes ? `Editor-in-chief notes: ${r.value.notes}\n` : ''}${idea ? `\nStarted from the idea "${idea.title}".\n` : ''}`
    )
    if (idea) await d.ideas.markUsed(idea, slug)
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
    const ideaText = typeof book.idea === 'string' ? ((await d.ideas.list()).find((i) => i.slug === book.idea)?.body ?? '') : ''
    const mem = d.memory.available() ? d.memory : null
    let similarityNote = ''
    let text: string
    for (let attempt = 0; ; attempt++) {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', fmt.nonfiction ? 'pitch_nf' : 'pitch', {
        title: book.title,
        topic: book.topic_name ?? book.genre,
        genre: book.genre,
        idea: ideaText || '(none: invent a premise that fits the topic)',
        similarity_note: similarityNote,
        ...formatVars(fmt, book.target_words)
      })
      run.version = version
      const r = await run.chat({ messages, maxTokens: 4000 })
      text = cleanProse(r.text)
      if (text.length < 40) throw new Error('the pitch came back empty')
      if (!mem || attempt >= 2) break
      // library-wide check: a pitch too close to an existing pitch or blurb is written again
      let near: { book: string; similarity: number } | null = null
      try {
        near = await mem.getIndex().nearest(text, { notBook: slug, kinds: ['pitch', 'blurb'] })
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
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', fmt.nonfiction ? 'outline_nf' : 'outline', {
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
    const schema = z.object({
      chapters: z.array(z.object({ title: z.string().min(1), summary: z.string().min(5) })).min(1),
      characters: z.array(z.object({ name: z.string(), description: z.string(), voice: z.string().default('') })).default([]),
      places: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
      threads: z.array(z.string()).default([]),
      setting: z.string().default(''),
      style: z.string().default(''),
      // non-fiction: the argument, the audience and the terms of the fact base
      thesis: z.string().default(''),
      audience: z.string().default(''),
      terms: z.array(z.object({ term: z.string(), definition: z.string() })).default([])
    })
    const r = await chatJson(ctx, messages, schema, { maxTokens: fmt.long ? 12000 : 6000 })
    run.addJson(r.cost, r.chat.model)
    let chapters = r.value.chapters
    if (chapters.length > fmt.chapters[1]) chapters = chapters.slice(0, fmt.chapters[1])
    if (chapters.length < fmt.chapters[0]) throw new Error(`the outline has ${chapters.length} chapter(s), the format needs ${fmt.chapters[0]} to ${fmt.chapters[1]}`)
    const numbered = chapters.map((c, i) => ({ n: i + 1, title: c.title.trim(), summary: c.summary.trim() }))
    const acts = fmt.long ? splitActs(numbered.length) : undefined
    await writeMd(
      d.books.file(slug, 'outline.md'),
      { kind: 'outline', round, chapters: numbered, ...(acts ? { acts } : {}) },
      '\n' +
        (acts
          ? acts.map((a) => `## ${a.title}\n\n${a.chapters.map((n) => `${n}. **${numbered[n - 1]!.title}**: ${numbered[n - 1]!.summary}`).join('\n')}`).join('\n\n')
          : numbered.map((c) => `${c.n}. **${c.title}**: ${c.summary}`).join('\n')) +
        '\n'
    )
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
      await d.bible.writeInitial(slug, { characters: r.value.characters, places: r.value.places, threads: r.value.threads, setting: r.value.setting, style: r.value.style })
    } else {
      const bible =
        `# Story bible (light)\n\n## Setting\n${r.value.setting || '(see the pitch)'}\n\n## Characters\n` +
        (r.value.characters.length ? r.value.characters.map((c) => `- **${c.name}**: ${c.description}`).join('\n') : '(see the pitch)') +
        `\n\n## Style\n${r.value.style || '(see the format guidance)'}\n`
      await writeMd(d.books.file(slug, 'bible', 'bible.md'), { kind: 'bible' }, '\n' + bible)
    }
    await made(slug, run)
    return { result: `outline with ${numbered.length} chapter(s)${acts ? ` in ${acts.length} acts` : ''}`, resultPath: `books/${slug}/outline.md` }
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
    const perChapter = Math.round(book.target_words / outline.chapters.length)
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
      const prior = (await d.books.chapters(slug)).filter((c) => c.n < n)
      const research = await researchNotesFor(d, slug, `${entry.title}. ${entry.summary}`, 4)
      storySoFar = [
        `## Pitch\n${(await d.books.pitch(slug)) ?? ''}`,
        `## Outline\n${outline.chapters.map((c) => `${c.n}. ${c.title}: ${c.summary}`).join('\n')}`,
        `## Story bible\n${await d.books.bible(slug)}`,
        ...(research.length ? [`## ${researchBlock(research)}`] : []),
        `## The chapters written so far\n${prior.length ? prior.map((c) => `### Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n') : '(this is the first chapter)'}`
      ].join('\n\n')
      ctx.context([
        { name: 'pitch, outline and bible', tokens: Math.round((storySoFar.length - prior.reduce((s, c) => s + c.body.length, 0)) / 4) },
        { name: `${prior.length} earlier chapter(s) in full`, tokens: Math.round(prior.reduce((s, c) => s + c.body.length, 0) / 4) },
        ...research.map((r) => ({ name: r.name, tokens: Math.round(r.text.length / 4) }))
      ])
    }
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'writer', fmt.nonfiction ? 'draft_chapter_nf' : 'draft_chapter', {
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
    let r = await run.chat({ messages, maxTokens: Math.max(4000, perChapter * 6) })
    let body = stripLeadingHeading(cleanProse(r.text))
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
        maxTokens: Math.max(4000, perChapter * 6)
      })
      const longer = stripLeadingHeading(cleanProse(retry.text))
      if (countWords(longer) > before) {
        r = retry
        body = longer
        expandedFrom = before
      } else {
        ctx.log(`expand retry gave ${countWords(longer)} words, not more than ${before}: keeping the first draft`)
      }
      if (expandedFrom !== null) ctx.log(`chapter ${n} was ${before} words (target ${perChapter}); expanded to ${countWords(body)}`)
    }
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
    return { result: `chapter ${n}: ${countWords(body)} words${expandedFrom !== null ? ` (expanded from ${expandedFrom})` : ''}`, resultPath: `books/${slug}/chapters/ch-${String(n).padStart(2, '0')}.md` }
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
      const { messages, version } = await buildMessages(d.dataDir, ctx, role, fmt.nonfiction ? 'review_nf' : 'review', {
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
      ctx.context([{ name: actN ? `act ${actN} in full, summaries of the other acts` : 'whole book text', tokens: Math.round(messages[1]!.content.length / 4) }])
      // the schema names this reviewer's dimensions, so structured output and the repair retry both insist on them
      const schema = z.object({
        verdict: z.enum(['pass', 'revise']),
        scores: z.object(Object.fromEntries(dims.map((x) => [x, z.number()]))),
        notes: z.string(),
        chapters: z.array(z.number()).default([]),
        research_questions: z.array(z.string()).default([])
      })
      const r = await chatJson(ctx, messages, schema, { maxTokens: 6000, temperature: 0.2 })
      run.addJson(r.cost, r.chat.model)
      // a claim that looks wrong and may not be in the notes: the researcher checks (and looks in the notes first)
      const researchJobs = await askFromReview(d, ctx.agent.id, slug, `the ${role.replace(/-/g, ' ')} doubts a claim in ${actN ? `act ${actN}` : 'the book'}`, r.value.research_questions)
      const scores: Record<string, number> = {}
      for (const [k, v] of Object.entries(r.value.scores)) scores[k.trim().toLowerCase().replace(/[\s-]+/g, '_')] = clamp(Number(v), 1, 10)
      // a revise that comes with only good scores (and from a reviewer that isn't a must-pass gate) is a pass
      const q = d.getQuality()
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
        '\n' + r.value.notes.trim() + '\n'
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
    const checkNotes = isCheck ? await d.books.readText(slug, 'reviews', `ch-${String(n).padStart(2, '0')}-check.md`) : null
    const reviews = isLength || isCheck ? [] : await loadReviews(d, slug, round - 1)
    const notes = isLength
      ? ctx.jobBody.trim()
      : isCheck
        ? `From the continuity checker: ${checkNotes ? parseMd(checkNotes).body.trim() : '(no notes)'}`
        : reviews
          .filter((r) => r.verdict === 'revise')
          .map((r) => (r.role === 'fact-checker' && fmt.nonfiction ? null : `- From the ${r.role.replace(/-/g, ' ')}: ${r.notes.trim()}`))
          .filter((x): x is string => x !== null)
          .join('\n')
    // a chapter in a flat tension stretch is rewritten to raise the tension (the developmental editor's tension report)
    const flat = !isLength && !isCheck && Array.isArray(book.tension_rewrite) && (book.tension_rewrite as unknown[]).map(Number).includes(n)
    const tensionNote = flat ? `- Raise tension: this chapter is part of a flat stretch in the tension report (the developmental editor scored it ${(await readTensionOf(d, slug, n)) ?? 'low'} out of 10). Raise the stakes: add a sharper problem, a ticking clock, a loss or a hard choice, and end the chapter on a turn.` : ''
    const claimNote = fmt.nonfiction && !isLength && !isCheck ? await factClaimNote(d, slug, round - 1, n) : ''
    const allNotes = [claimNote, notes, tensionNote].filter(Boolean).join('\n')
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
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'writer', fmt.nonfiction ? 'rewrite_chapter_nf' : 'rewrite_chapter', {
      title: book.title,
      pitch: (await d.books.pitch(slug)) ?? '',
      bible: bibleText,
      notes: allNotes || '(no notes: improve the chapter where you can)',
      research: researchText,
      chapter_n: n,
      chapter_title: current.title,
      chapter_text: current.body,
      other_chapters: fmt.nonfiction ? '(the other chapters are in the fact base section above)' : chapters.filter((c) => c.n !== n).map((c) => `### Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n') || '(this is the only chapter)',
      chapter_words: Math.round(book.target_words / Math.max(1, chapters.length)),
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    const r = await run.chat({ messages, maxTokens: Math.max(4000, current.words * 6) })
    const body = stripMarkers(stripLeadingHeading(cleanProse(r.text)))
    if (countWords(body) < 20) throw new Error(`the rewrite of chapter ${n} came back too short`)
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
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'publisher', fmt.nonfiction ? 'publish_nf' : 'publish', {
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
    const schema = z.object({
      title: z.string().min(1),
      blurb: z.string().min(10),
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
    if (d.memory.available()) {
      try {
        await d.memory.getIndex().upsert({ file: `books/${slug}/book.md#blurb`, book: slug, kind: 'blurb', ref: 'blurb', text: r.value.blurb.trim() })
      } catch (err) {
        d.log(`could not index the blurb: ${(err as Error).message}`)
      }
    }
    const epub = await d.books.buildEpubFile(slug)
    await d.requestCover(slug)
    if (book.topic) await d.topics.adjust(book.topic, { done: 1, inProgress: -1 })
    await d.books.update(slug, () => ({ stage: 'published', published: new Date().toISOString() }))
    d.emit({ type: 'book.stage', book: slug, stage: 'published' })
    return { result: `published "${title}" (score ${decision.score})`, resultPath: path.relative(d.dataDir, epub).split(path.sep).join('/') }
  })
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

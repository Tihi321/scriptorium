import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseMd } from '../../shared/md'
import { researchNotesFor } from '../research/context'
import type { ResearchItem } from '../research/context'
import { applyMarkerFixes, findMarkers, markerSentence } from '../research/markers'
import { formatNote, questionKey } from '../research/notes'
import type { NoteExcerpt, NoteFact } from '../research/notes'
import type { ChatMessage } from '../models/types'
import { capText, excerptFor, searchTerms } from '../research/web'
import type { SearchResult } from '../research/web'
import type { Scheduler } from '../queue/scheduler'
import { writeMd } from '../store/atomic'
import { pad2 } from './books'
import { chatJson } from './llm'
import { buildMessages } from './prompts'
import { recordMade, Run, unitNumber } from './handlers'
import type { PipelineDeps } from './handlers'

const isAbort = (err: unknown) => ['AbortError', 'BudgetError'].includes((err as Error)?.name)

/** Page text goes into the prompt only between these lines, and the text itself may not contain the delimiter characters. */
export function wrapUntrusted(pages: { n: number; url: string; title: string; text: string }[]): string {
  return pages
    .map((p) => {
      const clean = p.text.replace(/<{2,}|>{2,}/g, ' ').replace(/[ \t]+/g, ' ')
      const title = p.title.replace(/[<>\r\n]+/g, ' ').slice(0, 120)
      return `<<<WEB_PAGE ${p.n} | ${p.url} | ${title}>>>\n${clean}\n<<<END_WEB_PAGE ${p.n}>>>`
    })
    .join('\n\n')
}

/** True when a fact repeats a run of twelve or more words of the page word for word (the notes must be in the researcher's own words). */
export function copiesPage(fact: string, page: string, run = 12): boolean {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  const f = words(fact)
  if (f.length < run) return false
  const p = ` ${words(page).join(' ')} `
  for (let i = 0; i + run <= f.length; i++) if (p.includes(` ${f.slice(i, i + run).join(' ')} `)) return true
  return false
}

/** The most facts one note keeps. */
export const MAX_NOTE_FACTS = 16

/** A figure on a page that the notes do not have: the page, the figure and the sentence it stands in. */
export interface MissingFigure {
  page: number
  figure: string
  sentence: string
}

/**
 * Years (1800 to 2100) and numbers of two or more digits that stand in a sentence of a page about the question (the sentence or the one
 * next to it shares a word with the question) and in none of the facts. At most 10, each figure once.
 */
export function missingFigures(pages: { n: number; text: string }[], facts: string[], question: string): MissingFigure[] {
  const terms = searchTerms(question, 8).map((t) => t.toLowerCase())
  const plain = (s: string) => s.replace(/(?<=\d)[,\s](?=\d{3}\b)/g, '')
  const have = new Set(plain(facts.join(' ')).match(/\d+(?:\.\d+)?/g) ?? [])
  const out: MissingFigure[] = []
  const seen = new Set<string>()
  for (const p of pages) {
    const sentences = p.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
    sentences.forEach((s, i) => {
      const near = [sentences[i - 1], s, sentences[i + 1]].filter(Boolean).join(' ').toLowerCase()
      if (terms.length && !terms.some((t) => near.includes(t))) return
      for (const m of plain(s).matchAll(/\b\d+(?:\.\d+)?\b/g)) {
        const figure = m[0]
        if (figure.replace(/\D/g, '').length < 2 || have.has(figure) || seen.has(figure)) continue
        seen.add(figure)
        if (out.length < 10) out.push({ page: p.n, figure, sentence: s.slice(0, 240) })
      }
    })
  }
  return out
}

/** The words of a question that say it is about what happened in the last days or weeks (an article's search then asks for news). */
export function isNewsQuestion(question: string): boolean {
  const year = new Date().getFullYear()
  return new RegExp(`\\b(?:latest|this week|this month|today|yesterday|tonight|announc(?:e|ed|es|ement|ements)|new|recent|recently|now|currently|current year|last (?:week|few days)|breaking|${year})\\b`, 'i').test(question)
}

/** A question of the architect's or the writer's: a string, or an object with `news` (an article's questions are asked as objects). */
const questionSchema = z.union([z.string(), z.object({ question: z.string(), news: z.boolean().optional() })])
type AskedQuestion = { question: string; news?: boolean }
const asQuestion = (x: z.infer<typeof questionSchema>): AskedQuestion => (typeof x === 'string' ? { question: x.trim() } : { question: x.question.trim(), ...(x.news !== undefined ? { news: x.news } : {}) })

/** Handlers of the research steps: the researcher, the architect's plan, the writer's prep and the marker fix-up. */
export function registerResearchHandlers(sched: Scheduler, d: PipelineDeps): void {
  const made = async (slug: string | null, run: Run) => {
    if (slug && (await d.books.read(slug))) await recordMade(d, slug, run)
  }
  const known = (book: string | null) => d.research.store.available(book)
  const formatOfBook = (id: string) => d.getFormats().find((f) => f.id === id)
  /** A newspaper article: its search asks for recent news, and its notes stay with it. */
  const isArticle = async (book: string | null) => (book ? (await d.books.read(book))?.data.article === true : false)

  // ---- the researcher ----
  sched.register('research', async (ctx) => {
    const run = new Run(ctx)
    const question = String(ctx.job.question ?? '').replace(/\s+/g, ' ').trim()
    if (!question) throw new Error('a research job without a question')
    const book = ctx.job.book ?? null
    const askedBy = ctx.job.requested_by
    const purpose = String(ctx.job.purpose ?? '')
    const idea = typeof ctx.job.idea === 'string' ? ctx.job.idea : undefined
    // an article's search asks for the news of the last days only for a question about what just happened (the question says so, or its words do)
    const news = (await isArticle(book)) && (typeof ctx.job.news === 'boolean' ? ctx.job.news : isNewsQuestion(question))
    const context = [purpose ? `Why it is asked: ${purpose}` : '', book ? `It is for the book "${(await d.books.read(book))?.data.title ?? book}".` : ''].filter(Boolean).join('\n')

    // 1. what the library already knows (the shared notes and this book's notes)
    const exact = await d.research.store.findExact(question, book)
    if (exact) {
      ctx.log(`already answered by ${exact.file}`)
      return { result: `already in the notes (${exact.file})`, resultPath: exact.file }
    }
    const items = await researchNotesFor(d, book, question, 4)
    if (items.length > 0) {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'researcher', 'check_notes', { question, notes: items.map((i) => i.text).join('\n\n') })
      run.version = version
      ctx.context(items.map((i) => ({ name: i.name, tokens: Math.round(i.text.length / 4) })))
      const r = await chatJson(ctx, messages, z.object({ covered: z.boolean(), missing: z.string().default('') }), { maxTokens: 5000, temperature: 0.1 })
      run.addJson(r.cost, r.chat.model)
      if (r.value.covered) {
        await made(book, run)
        ctx.log(`covered by existing notes: ${items.map((i) => i.file).join(', ')}`)
        return { result: `covered by existing notes (${items[0]!.file})`, resultPath: items[0]!.file }
      }
      ctx.log(`the notes do not cover it${r.value.missing ? `: ${r.value.missing}` : ''}`)
    }

    // 2. search and read pages, 3. write facts from them (the only things the researcher can do besides writing a note).
    // When the pages answer nothing, the model suggests short search words and the search is tried again (once, with at most two new queries).
    let provider = ''
    let facts: NoteFact[] = []
    let excerpts: NoteExcerpt[] = []
    let unverified = false
    const seenUrls = new Set<string>()
    const triedQueries = new Set<string>()
    let queries = [question]
    for (let round = 0; round < 2 && facts.length === 0; round++) {
      for (const query of queries) {
        if (facts.length > 0 || triedQueries.has(query)) continue
        triedQueries.add(query)
        const pages = await gatherPages(query, question, seenUrls)
        if (!pages) {
          ctx.log(`no search provider gave results for "${query}"`)
          continue
        }
        provider = pages.provider
        ctx.log(`search (${pages.provider}) "${query}": ${pages.list.map((p) => p.url).join(', ')}`)
        const got = await factsFrom(question, context, pages.list)
        facts = got.facts
        excerpts = got.excerpts
        if (facts.length === 0) ctx.log(`the pages for "${query}" did not answer the question`)
      }
      if (facts.length > 0 || round === 1) break
      // the pages said nothing useful: ask the model for better search words
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'researcher', 'search_queries', { question, tried: [...triedQueries].map((q) => `- ${q}`).join('\n') })
      run.version = version
      const r = await chatJson(ctx, messages, z.object({ queries: z.array(z.string()).default([]) }), { maxTokens: 4000, temperature: 0.3 })
      run.addJson(r.cost, r.chat.model)
      queries = r.value.queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter((q) => q.length >= 3 && q.length <= 80).slice(0, 2)
      ctx.log(`new search words: ${queries.join(' | ') || '(none)'}`)
      if (queries.length === 0) break
    }

    // 3b. the helpers of the steps above
    async function gatherPages(query: string, forQuestion: string, seen: Set<string>) {
      const found = await d.search.search(query, { signal: ctx.signal, book, agent: ctx.agent.id, limit: 5, ...(news ? { news: true, days: 7 } : {}) })
      if (!found) return null
      // read the results (pages that need a download: only the first three), then keep the three that talk most about what was asked
      const terms = searchTerms(forQuestion, 8).map((t) => t.toLowerCase())
      const read: { url: string; title: string; text: string; score: number }[] = []
      let downloads = 0
      for (const res of found.results.slice(0, 5)) {
        if (seen.has(res.url)) continue
        if (!res.content && downloads >= 3) continue
        if (!res.content) downloads++
        const text = await pageText(forQuestion, res, ctx.signal)
        if (!text) continue
        const lower = text.toLowerCase()
        const title = res.title.toLowerCase()
        read.push({ url: res.url, title: res.title, text, score: terms.filter((t) => lower.includes(t)).length + 2 * terms.filter((t) => title.includes(t)).length })
      }
      read.sort((a, b) => b.score - a.score) // the sort is stable: the provider's own order breaks ties
      const list = read.slice(0, 3).map((p, i) => ({ n: i + 1, url: p.url, title: p.title, text: p.text }))
      for (const p of list) seen.add(p.url)
      return list.length ? { provider: found.provider, list } : null
    }

    async function factsFrom(forQuestion: string, ctxText: string, pages: { n: number; url: string; title: string; text: string }[]): Promise<{ facts: NoteFact[]; excerpts: NoteExcerpt[] }> {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'researcher', 'write_notes', { question: forQuestion, context: ctxText, pages: wrapUntrusted(pages) })
      run.version = version
      ctx.context(pages.map((p) => ({ name: `page ${p.n}: ${p.url}`, tokens: Math.round(p.text.length / 4) })))
      const schema = z.object({ facts: z.array(z.object({ fact: z.string(), source: z.number().optional() })).default([]) })
      const keep = (list: { fact: string; source?: number }[]): NoteFact[] => {
        const kept: NoteFact[] = []
        for (const f of list) {
          const page = pages.find((p) => p.n === Math.round(Number(f.source)))
          const text = f.fact.replace(/\s+/g, ' ').trim()
          if (!page || text.length < 10 || text.length > 600) continue
          if (copiesPage(text, page.text)) {
            ctx.log(`dropped a fact that copies page ${page.n}: "${text.slice(0, 60)}..."`)
            continue
          }
          kept.push({ fact: text, source: { url: page.url, title: page.title } })
        }
        return kept
      }
      const r = await chatJson(ctx, messages, schema, { maxTokens: 8000, temperature: 0.1 })
      run.addJson(r.cost, r.chat.model)
      let out = keep(r.value.facts)
      if (out.length === 0) return { facts: out, excerpts: [] }
      // the figures and dates of the pages that bear on the question must reach the note: ask once for the ones the facts lack
      let missing = missingFigures(pages, out.map((f) => f.fact), forQuestion)
      if (missing.length > 0) {
        ctx.log(`the pages have figures the notes lack (${missing.map((m) => m.figure).join(', ')}): asking for them`)
        const follow: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: JSON.stringify({ facts: r.value.facts }).slice(0, 6000) },
          {
            role: 'user',
            content: `The pages also give these figures and dates you did not note: ${missing.map((m) => `page ${m.page}, "${m.figure}": ${m.sentence}`).join(' | ')}. Add a fact for each one that bears on the question, in your own words, with its source. Reply with one JSON object like {"facts": [{"fact": "...", "source": 1}]} that holds only the new facts.`
          }
        ]
        try {
          const more = await chatJson(ctx, follow, schema, { maxTokens: 8000, temperature: 0.1 })
          run.addJson(more.cost, more.chat.model)
          const norm = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
          const have = new Set(out.map((f) => norm(f.fact)))
          for (const f of keep(more.value.facts)) if (!have.has(norm(f.fact))) out.push(f)
        } catch (err) {
          if (isAbort(err)) throw err
          ctx.log(`the follow-up for the missing figures failed (${(err as Error).message})`)
        }
        out = out.slice(0, MAX_NOTE_FACTS)
        missing = missingFigures(pages, out.map((f) => f.fact), forQuestion)
      }
      // what the model still left out is kept word for word (at most four sentences), so the figure is in front of the writer anyway
      const excerpts: NoteExcerpt[] = []
      for (const m of missing) {
        const page = pages.find((p) => p.n === m.page)
        if (page && excerpts.length < 4 && !excerpts.some((x) => x.text === m.sentence.slice(0, 300))) excerpts.push({ text: m.sentence.slice(0, 300), url: page.url })
      }
      return { facts: out.slice(0, MAX_NOTE_FACTS), excerpts }
    }

    // 4. last resort: the model's own knowledge, marked unverified
    if (facts.length === 0) {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'researcher', 'from_knowledge', { question, context })
      run.version = version
      const r = await chatJson(ctx, messages, z.object({ facts: z.array(z.object({ fact: z.string() })).default([]) }), { maxTokens: 6000, temperature: 0.2 })
      run.addJson(r.cost, r.chat.model)
      facts = r.value.facts
        .map((f) => ({ fact: f.fact.replace(/\s+/g, ' ').trim() }))
        .filter((f) => f.fact.length >= 10)
        .slice(0, 8)
      unverified = true
      provider = ''
    }
    if (facts.length === 0) {
      // nothing to write: finish the job without a note (retrying would search, and perhaps pay, again). The asker goes on without notes.
      ctx.log(`no facts found for "${question}": no source gave an answer and the model knew nothing reliable`)
      await made(book, run)
      return { result: 'no facts found: no note written' }
    }

    // 5. write the note and index it
    const note = await d.research.store.write({ question, book, facts, unverified, askedBy, purpose, provider: provider || undefined, idea, excerpts })
    await indexNote(note.file, note.book, note.slug)
    await made(book, run)
    return {
      result: `${facts.length} fact(s) ${unverified ? 'from the model\'s own knowledge (unverified)' : `from ${provider}, ${new Set(facts.map((f) => f.source?.url)).size} source(s)`}`,
      resultPath: note.file
    }
  })

  async function pageText(question: string, res: SearchResult, signal: AbortSignal): Promise<string> {
    let text = res.content?.trim() ?? ''
    if (text.length < 300) {
      try {
        text = (await d.search.fetchPage(res.url, signal)).trim() || text
      } catch (err) {
        if (isAbort(err)) throw err
        d.log(`could not read ${res.url}: ${(err as Error).message}`)
      }
    }
    return excerptFor(question, text, 5000)
  }

  async function indexNote(file: string, book: string | null, slug: string): Promise<void> {
    if (!d.memory.ready()) return
    try {
      const text = parseMd(await fs.readFile(path.join(d.dataDir, ...file.split('/')), 'utf8')).body.trim()
      await d.memory.getIndex().upsert({ file, book: book ?? '', kind: 'research', ref: slug, text })
    } catch (err) {
      d.log(`could not index ${file}: ${(err as Error).message}`)
    }
  }

  // ---- the architect: does this book need research before the outline? ----
  sched.register('research_plan', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const book = (await d.books.read(slug))!.data
    const nf = formatOfBook(book.format)?.nonfiction === true
    const art = book.article === true
    const max = Math.max(0, Math.min(4, nf ? d.getFactory().research_limit_nonfiction : d.getFactory().research_limit_per_book))
    let needs = false
    let questions: AskedQuestion[] = []
    if (max > 0) {
      try {
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', art ? 'research_plan_article' : nf ? 'research_plan_nf' : 'research_plan', {
          title: book.title,
          topic: book.topic_name ?? book.genre,
          genre: book.genre,
          pitch: (await d.books.pitch(slug)) ?? '',
          max_questions: max
        })
        run.version = version
        const r = await chatJson(ctx, messages, z.object({ needs_research: z.boolean().default(false), questions: z.array(questionSchema).default([]) }), { maxTokens: 5000, temperature: 0.2 })
        run.addJson(r.cost, r.chat.model)
        needs = r.value.needs_research || nf // a non-fiction book is always built on research
        questions = needs ? r.value.questions.map(asQuestion).filter((q) => questionKey(q.question).length >= 3).slice(0, max) : []
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the research check failed (${(err as Error).message}): going on without research`)
      }
    }
    // non-fiction: even when the model gave nothing, the book's own subject is researched before the outline
    if (nf && questions.length === 0 && max > 0) {
      const fallback: AskedQuestion[] = art
        ? [{ question: `${book.title}: the latest news`, news: true }, { question: `${book.topic_name ?? book.genre} news this week`, news: true }]
        : [{ question: `${book.title}: an overview` }, { question: `${book.topic_name ?? book.genre} history and background`, news: false }]
      questions = fallback.filter((q) => questionKey(q.question).length >= 3).slice(0, max)
    }
    const asked: { question: string; job: string | null; status: string }[] = []
    for (const q of questions) {
      // an article's question is a news search only when it is about what just happened (the architect says so, or its words do)
      const a = await d.research.ask({ question: q.question, book: slug, askedBy: ctx.agent.id, purpose: 'the outline of this book', ...(art ? { news: q.news ?? isNewsQuestion(q.question) } : {}) })
      asked.push({ question: q.question, job: a.id, status: a.status })
    }
    await writeMd(
      d.books.file(slug, 'research-plan.md'),
      { kind: 'research-plan', needs_research: needs && questions.length > 0, questions: asked },
      `\n# Research before the outline\n\n${asked.length ? asked.map((a) => `- ${a.question} (${a.status})`).join('\n') : 'The architect decided that this book needs no research before the outline.'}\n`
    )
    await made(slug, run)
    return { result: asked.length ? `${asked.length} research question(s)` : 'no research needed', resultPath: `books/${slug}/research-plan.md` }
  })

  // ---- the writer: questions before a chapter ----
  sched.register('research_prep', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const outline = (await d.books.outline(slug))!
    const entry = outline.chapters.find((c) => c.n === n)
    const nf = formatOfBook(book.format)?.nonfiction === true
    const art = book.article === true
    const max = Math.max(0, Math.min(3, nf ? d.getFactory().research_limit_nonfiction : d.getFactory().research_limit_per_book))
    const file = d.books.file(slug, 'reports', `prep-ch-${pad2(n)}.md`)
    let questions: AskedQuestion[] = []
    if (entry && max > 0) {
      try {
        const have = await known(slug)
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'writer', art ? 'research_prep_article' : nf ? 'research_prep_nf' : 'research_prep', {
          title: book.title,
          genre: book.genre,
          chapter_n: n,
          chapter_count: outline.chapters.length,
          chapter_title: entry.title,
          chapter_summary: entry.summary,
          bible: capText(nf ? await d.factbase.digest(slug) : (await d.bible.digest(slug)) || (await d.books.bible(slug)), 3000),
          known: have.length ? have.map((h) => `- ${h.question}`).join('\n') : '(none yet)',
          max_questions: max
        })
        run.version = version
        const r = await chatJson(ctx, messages, z.object({ questions: z.array(questionSchema).default([]) }), { maxTokens: 4000, temperature: 0.2 })
        run.addJson(r.cost, r.chat.model)
        questions = r.value.questions.map(asQuestion).filter((q) => questionKey(q.question).length >= 3).slice(0, max)
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the research prep failed (${(err as Error).message}): writing without it`)
      }
    }
    // non-fiction: research is required for every chapter, so a chapter with no question of its own is researched under its title
    if (nf && questions.length === 0 && entry && max > 0) questions = [{ question: `${entry.title}: ${book.title}` }]
    const asked: { question: string; job: string | null; status: string }[] = []
    for (const q of questions) {
      const a = await d.research.ask({ question: q.question, book: slug, askedBy: ctx.agent.id, purpose: `before writing chapter ${n}`, ...(art ? { news: q.news ?? isNewsQuestion(q.question) } : {}) })
      asked.push({ question: q.question, job: a.id, status: a.status })
    }
    await writeMd(file, { kind: 'research-prep', n, questions: asked }, `\n# Research before chapter ${n}\n\n${asked.length ? asked.map((a) => `- ${a.question} (${a.status})`).join('\n') : 'No research needed.'}\n`)
    await made(slug, run)
    return { result: asked.length ? `${asked.length} research question(s) for chapter ${n}` : `no research needed for chapter ${n}`, resultPath: `books/${slug}/reports/prep-ch-${pad2(n)}.md` }
  })

  // ---- the writer: replace each [RESEARCH: ...] marker with a corrected sentence ----
  sched.register('research_fix', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const chapter = (await d.books.chapters(slug)).find((c) => c.n === n)
    if (!chapter) throw new Error(`chapter ${n} does not exist`)
    const markers = findMarkers(chapter.body)
    let body = chapter.body
    let replaced = 0
    if (markers.length > 0) {
      const parts: string[] = []
      for (const [i, m] of markers.entries()) {
        const note = await d.research.store.findExact(m.question, slug)
        const found: ResearchItem[] = note ? [{ name: note.question, text: formatNote(note), file: note.file }] : await researchNotesFor(d, slug, m.question, 1)
        parts.push(`Marker ${i + 1}: ${m.question}\nSentence: ${markerSentence(chapter.body, m)}\n${found.length ? `Research notes:\n${found.map((f) => f.text).join('\n')}` : 'No notes were found for this question.'}`)
      }
      try {
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'writer', 'research_fix', { title: book.title, chapter_n: n, items: parts.join('\n\n') })
        run.version = version
        const r = await chatJson(ctx, messages, z.object({ fixes: z.array(z.object({ marker: z.number(), sentence: z.string() })).default([]) }), { maxTokens: 6000, temperature: 0.3 })
        run.addJson(r.cost, r.chat.model)
        const fixes = new Map(r.value.fixes.map((f) => [Math.round(f.marker) - 1, f.sentence]))
        const out = applyMarkerFixes(chapter.body, fixes)
        body = out.text
        replaced = out.replaced
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the fix-up failed (${(err as Error).message}): the markers are only removed`)
        body = applyMarkerFixes(chapter.body, new Map()).text
      }
    }
    await d.books.writeChapter(slug, { n, title: chapter.title, round: chapter.round, body, agent: ctx.agent.id, fixes: [...chapter.fixes, 'res'] })
    await made(slug, run)
    return { result: `chapter ${n}: ${replaced} of ${markers.length} marked sentence(s) corrected`, resultPath: `books/${slug}/chapters/ch-${pad2(n)}.md` }
  })
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseMd } from '../../shared/md'
import { researchNotesFor } from '../research/context'
import type { ResearchItem } from '../research/context'
import { applyMarkerFixes, findMarkers, markerSentence } from '../research/markers'
import { formatNote, questionKey } from '../research/notes'
import type { NoteFact } from '../research/notes'
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

/** Handlers of the research steps: the researcher, the architect's plan, the writer's prep and the marker fix-up. */
export function registerResearchHandlers(sched: Scheduler, d: PipelineDeps): void {
  const made = async (slug: string | null, run: Run) => {
    if (slug && (await d.books.read(slug))) await recordMade(d, slug, run)
  }
  const known = (book: string | null) => d.research.store.available(book)
  const formatOfBook = (id: string) => d.getFormats().find((f) => f.id === id)

  // ---- the researcher ----
  sched.register('research', async (ctx) => {
    const run = new Run(ctx)
    const question = String(ctx.job.question ?? '').replace(/\s+/g, ' ').trim()
    if (!question) throw new Error('a research job without a question')
    const book = ctx.job.book ?? null
    const askedBy = ctx.job.requested_by
    const purpose = String(ctx.job.purpose ?? '')
    const idea = typeof ctx.job.idea === 'string' ? ctx.job.idea : undefined
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
        facts = await factsFrom(question, context, pages.list)
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
      const found = await d.search.search(query, { signal: ctx.signal, book, agent: ctx.agent.id, limit: 5 })
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

    async function factsFrom(forQuestion: string, ctxText: string, pages: { n: number; url: string; title: string; text: string }[]): Promise<NoteFact[]> {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'researcher', 'write_notes', { question: forQuestion, context: ctxText, pages: wrapUntrusted(pages) })
      run.version = version
      ctx.context(pages.map((p) => ({ name: `page ${p.n}: ${p.url}`, tokens: Math.round(p.text.length / 4) })))
      const schema = z.object({ facts: z.array(z.object({ fact: z.string(), source: z.number().optional() })).default([]) })
      const r = await chatJson(ctx, messages, schema, { maxTokens: 8000, temperature: 0.1 })
      run.addJson(r.cost, r.chat.model)
      const out: NoteFact[] = []
      for (const f of r.value.facts) {
        const page = pages.find((p) => p.n === Math.round(Number(f.source)))
        const text = f.fact.replace(/\s+/g, ' ').trim()
        if (!page || text.length < 10 || text.length > 600) continue
        if (copiesPage(text, page.text)) {
          ctx.log(`dropped a fact that copies page ${page.n}: "${text.slice(0, 60)}..."`)
          continue
        }
        out.push({ fact: text, source: { url: page.url, title: page.title } })
      }
      return out.slice(0, 12)
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
    const note = await d.research.store.write({ question, book, facts, unverified, askedBy, purpose, provider: provider || undefined, idea })
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
    if (!d.memory.available()) return
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
    const max = Math.max(0, Math.min(4, nf ? d.getFactory().research_limit_nonfiction : d.getFactory().research_limit_per_book))
    let needs = false
    let questions: string[] = []
    if (max > 0) {
      try {
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'architect', nf ? 'research_plan_nf' : 'research_plan', {
          title: book.title,
          topic: book.topic_name ?? book.genre,
          genre: book.genre,
          pitch: (await d.books.pitch(slug)) ?? '',
          max_questions: max
        })
        run.version = version
        const r = await chatJson(ctx, messages, z.object({ needs_research: z.boolean().default(false), questions: z.array(z.string()).default([]) }), { maxTokens: 5000, temperature: 0.2 })
        run.addJson(r.cost, r.chat.model)
        needs = r.value.needs_research || nf // a non-fiction book is always built on research
        questions = needs ? r.value.questions.map((q) => q.trim()).filter((q) => questionKey(q).length >= 3).slice(0, max) : []
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the research check failed (${(err as Error).message}): going on without research`)
      }
    }
    // non-fiction: even when the model gave nothing, the book's own subject is researched before the outline
    if (nf && questions.length === 0 && max > 0) questions = [`${book.title}: an overview`, `${book.topic_name ?? book.genre} history and background`].filter((q) => questionKey(q).length >= 3).slice(0, max)
    const asked: { question: string; job: string | null; status: string }[] = []
    for (const q of questions) {
      const a = await d.research.ask({ question: q, book: slug, askedBy: ctx.agent.id, purpose: 'the outline of this book' })
      asked.push({ question: q, job: a.id, status: a.status })
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
    const max = Math.max(0, Math.min(3, nf ? d.getFactory().research_limit_nonfiction : d.getFactory().research_limit_per_book))
    const file = d.books.file(slug, 'reports', `prep-ch-${pad2(n)}.md`)
    let questions: string[] = []
    if (entry && max > 0) {
      try {
        const have = await known(slug)
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'writer', nf ? 'research_prep_nf' : 'research_prep', {
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
        const r = await chatJson(ctx, messages, z.object({ questions: z.array(z.string()).default([]) }), { maxTokens: 4000, temperature: 0.2 })
        run.addJson(r.cost, r.chat.model)
        questions = r.value.questions.map((q) => q.trim()).filter((q) => questionKey(q).length >= 3).slice(0, max)
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the research prep failed (${(err as Error).message}): writing without it`)
      }
    }
    // non-fiction: research is required for every chapter, so a chapter with no question of its own is researched under its title
    if (nf && questions.length === 0 && entry && max > 0) questions = [`${entry.title}: ${book.title}`]
    const asked: { question: string; job: string | null; status: string }[] = []
    for (const q of questions) {
      const a = await d.research.ask({ question: q, book: slug, askedBy: ctx.agent.id, purpose: `before writing chapter ${n}` })
      asked.push({ question: q, job: a.id, status: a.status })
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

import path from 'node:path'
import { z } from 'zod'
import { citedNumbers } from '../memory/factbase'
import type { KeyFact } from '../memory/factbase'
import type { NoteFile } from '../research/notes'
import type { Scheduler } from '../queue/scheduler'
import { writeMd } from '../store/atomic'
import { askFromReview, clamp, recordMade, Run, unitNumber } from './handlers'
import type { PipelineDeps } from './handlers'
import type { ChatMessage } from '../models/types'
import { chatJson } from './llm'
import { candidateFacts, chapterNotes, numberedNotes } from './nfcontext'
import { buildMessages } from './prompts'
import { dimensionsFor } from './scoring'

const isAbort = (err: unknown) => ['AbortError', 'BudgetError'].includes((err as Error)?.name)

/** At most this many key facts are kept for one chapter. */
export const MAX_KEY_FACTS = 14

/** At most this many research questions come from one fact check. */
export const MAX_FACT_CHECK_QUESTIONS = 4

/** At most this many claims are sent back in one fact check. */
export const MAX_CLAIMS = 12

export interface Claim {
  chapter: number
  claim: string
  problem: 'unsourced' | 'contradicted'
  detail: string
}

/** Handlers of the non-fiction variant: the archivist's fact step per chapter and the fact-checker. */
const FACT_CHECK_MAX_TOKENS = 14000
const FACT_CHECK_MIN_TOKENS = 4000

function isTokenLimit(err: unknown): boolean {
  return /token limit/i.test((err as Error)?.message ?? '')
}

export function registerNonfictionHandlers(sched: Scheduler, d: PipelineDeps): void {
  const made = (slug: string, run: Run) => recordMade(d, slug, run)

  // ---- the archivist: the chapter's research becomes its key facts, with numbered sources ----
  sched.register('factbase_update', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const entry = (await d.books.outline(slug))?.chapters.find((c) => c.n === n)
    if (!entry) throw new Error(`no outline entry for chapter ${n}`)
    const notes = await chapterNotes(d, slug, `${entry.title}. ${entry.summary}`, 6)
    const sources = await d.factbase.syncSources(slug, notes)
    const candidates = candidateFacts(notes, sources)
    if (candidates.length === 0) {
      // no source gave a fact (the researcher failed or found nothing): the chapter has no key facts, and the fact-checker will say so
      ctx.log(`no sourced facts for chapter ${n}: ${notes.length} note(s), none with a source`)
      await d.factbase.setChapterFacts(slug, n, [])
      return { result: `chapter ${n}: no sourced facts`, resultPath: `books/${slug}/factbase/facts.md` }
    }
    let facts: KeyFact[] = []
    try {
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'archivist', 'factbase_update', {
        title: book.title,
        chapter_n: n,
        chapter_title: entry.title,
        chapter_summary: entry.summary,
        thesis: (await d.factbase.thesis(slug)).replace(/^# .*\n+/, ''),
        notes: numberedNotes(notes, sources),
        known_terms: (await d.factbase.terms(slug)).map((t) => `- ${t.term}`).join('\n') || '(none yet)'
      })
      run.version = version
      ctx.context(notes.map((x) => ({ name: `research: ${x.question}`, tokens: Math.round(x.body.length / 4) })))
      const schema = z.object({
        facts: z.array(z.object({ fact: z.string(), sources: z.array(z.number()).default([]) })).default([]),
        terms: z.array(z.object({ term: z.string(), definition: z.string() })).default([])
      })
      const r = await chatJson(ctx, messages, schema, { maxTokens: 6000, temperature: 0.1 })
      run.addJson(r.cost, r.chat.model)
      const known = new Set(sources.map((s) => s.n))
      // a fact without a valid source number never enters the fact base
      facts = r.value.facts
        .map((f) => ({ fact: f.fact.replace(/\s+/g, ' ').replace(/\s*\[\d+(?:\s*[,;]\s*\d+)*\]/g, '').trim(), sources: [...new Set(f.sources.map(Math.round))].filter((x) => known.has(x)) }))
        .filter((f) => f.fact.length >= 10 && f.sources.length > 0)
        .slice(0, MAX_KEY_FACTS)
      await d.factbase.addTerms(slug, r.value.terms)
    } catch (err) {
      if (isAbort(err)) throw err
      ctx.log(`the fact step failed (${(err as Error).message}): using the notes' facts as they are`)
    }
    if (facts.length === 0) facts = candidates.slice(0, MAX_KEY_FACTS)
    await d.factbase.setChapterFacts(slug, n, facts)
    await made(slug, run)
    return { result: `chapter ${n}: ${facts.length} key fact(s) from ${new Set(facts.flatMap((f) => f.sources)).size} source(s)`, resultPath: `books/${slug}/factbase/facts.md` }
  })

  // ---- the fact-checker: every claim in the book must be sourced and must agree with the notes ----
  sched.register(
    'fact_check',
    async (ctx) => {
      const run = new Run(ctx)
      const slug = ctx.job.book!
      const round = ctx.job.round
      const role = ctx.job.role
      const book = (await d.books.read(slug))!.data
      const chapters = await d.books.chapters(slug)
      const outline = (await d.books.outline(slug))?.chapters ?? []
      const entryOf = (n: number) => outline.find((c) => c.n === n)

      // the notes the book rests on: its own, and the shared ones that fit its chapters. Verified notes first.
      const own = await d.research.store.list(slug)
      const found = new Map<string, NoteFile>(own.map((x) => [x.file, x]))
      for (const c of chapters) {
        for (const note of await chapterNotes(d, slug, `${entryOf(c.n)?.title ?? c.title}. ${entryOf(c.n)?.summary ?? ''}`, 4)) found.set(note.file, note)
      }
      const notes = [...found.values()]
      notes.sort((a, b) => Number(a.unverified) - Number(b.unverified))
      const sources = await d.factbase.syncSources(slug, notes)
      const known = new Set(sources.map((s) => s.n))

      // chapters that had no sourced facts when they were written: look again, the researcher may have found some since
      const facts = await d.factbase.facts(slug)
      for (const c of chapters) {
        if ((facts.get(c.n)?.length ?? 0) > 0) continue
        const near = await chapterNotes(d, slug, `${entryOf(c.n)?.title ?? c.title}. ${entryOf(c.n)?.summary ?? ''}`, 6)
        const cand = candidateFacts(near, await d.factbase.syncSources(slug, near)).slice(0, MAX_KEY_FACTS)
        if (cand.length) {
          await d.factbase.setChapterFacts(slug, c.n, cand)
          facts.set(c.n, cand)
        }
      }

      // the part that needs no model: a chapter without sourced facts, or without any source number, is not sourced
      const coverage: Claim[] = []
      const coverageQuestions: string[] = []
      for (const c of chapters) {
        const cites = citedNumbers(c.body)
        if ((facts.get(c.n)?.length ?? 0) === 0) {
          coverage.push({ chapter: c.n, claim: '(the whole chapter)', problem: 'unsourced', detail: 'no research note with a source supports this chapter. Remove specific claims it cannot support, or keep only what the other chapters\' notes back' })
          coverageQuestions.push(`What are the key facts about ${entryOf(c.n)?.title ?? c.title} (${book.topic_name ?? book.genre})?`)
        } else if (!cites.some((x) => known.has(x))) {
          coverage.push({ chapter: c.n, claim: '(the whole chapter)', problem: 'unsourced', detail: 'the chapter cites no source: put the number of the source in square brackets, like [2], after every fact taken from it' })
        }
        const bad = cites.filter((x) => !known.has(x))
        if (bad.length) coverage.push({ chapter: c.n, claim: `[${bad.join('], [')}]`, problem: 'unsourced', detail: 'cites a source number that is not in the list of sources' })
      }

      // what the model checks: each specific claim against the notes
      const digest = await d.factbase.digest(slug)
      const bookText = await d.books.fullText(slug)
      const window = d.contextTokens(role)
      const roomChars = window ? Math.max(6000, Math.floor(window * 0.6 * 4) - bookText.length - digest.length) : 24000
      const noteText = numberedNotes(notes, sources, 1500)
      const { messages, version } = await buildMessages(d.dataDir, ctx, role, 'fact_check', {
        title: book.title,
        factbase: digest,
        notes: noteText.slice(0, Math.min(30000, roomChars)) || '(no research notes at all)',
        book_text: bookText,
        coverage: coverage.length ? coverage.map((x) => `- Chapter ${x.chapter}: ${x.detail}`).join('\n') : '(every chapter has sourced facts and cites at least one source)',
        round,
        dimensions: dimensionsFor(role).join(', '),
        scores_example: JSON.stringify(Object.fromEntries(dimensionsFor(role).map((x) => [x, 8])))
      })
      run.version = version
      ctx.context([
        { name: 'whole book text', tokens: Math.round(bookText.length / 4) },
        { name: 'fact base', tokens: Math.round(digest.length / 4) },
        { name: `${notes.length} research note(s), numbered`, tokens: Math.round(Math.min(noteText.length, roomChars) / 4) }
      ])
      const schema = z.object({
        verdict: z.enum(['pass', 'revise']),
        scores: z.object({ accuracy: z.number() }),
        notes: z.string().default(''),
        claims: z.array(z.object({ chapter: z.number(), claim: z.string(), problem: z.string().default('unsourced'), detail: z.string().default('') })).default([]),
        research_questions: z.array(z.string()).default([])
      })
      // the answer budget is what the window leaves after the prompt (a thinking model spends part of it on reasoning), at most 14000
      const promptTokens = Math.round(messages.reduce((s, m) => s + m.content.length, 0) / 4)
      const room = window ? Math.min(FACT_CHECK_MAX_TOKENS, window - promptTokens - 1000) : FACT_CHECK_MAX_TOKENS
      const answerTokens = Math.max(FACT_CHECK_MIN_TOKENS, room)
      let r: Awaited<ReturnType<typeof chatJson<z.infer<typeof schema>>>>
      try {
        r = await chatJson(ctx, messages, schema, { maxTokens: answerTokens, temperature: 0.2 })
      } catch (err) {
        if (!isTokenLimit(err)) throw err
        // cut off at the limit with no answer: ask once more for the shortest possible reply
        ctx.log(`the fact-check reply hit the token limit (${answerTokens}); asking again for a short answer`)
        const short: ChatMessage[] = [...messages, { role: 'user', content: 'Reply now with the JSON object only: no reasoning, at most 5 claims, each detail under 12 words.' }]
        try {
          r = await chatJson(ctx, short, schema, { maxTokens: answerTokens, temperature: 0.2 })
        } catch (err2) {
          if (!isTokenLimit(err2)) throw err2
          throw new Error(`the fact-check could not finish: the model hit the token limit twice (budget ${answerTokens} tokens, prompt about ${promptTokens}). Load the fact-checker model with a larger context or a non-thinking mode.`, { cause: err2 })
        }
      }
      run.addJson(r.cost, r.chat.model)

      const inBook = new Set(chapters.map((c) => c.n))
      const fromModel: Claim[] = r.value.claims
        .filter((x) => x.claim.trim() && inBook.has(Math.round(x.chapter)))
        .map((x) => ({ chapter: Math.round(x.chapter), claim: x.claim.replace(/\s+/g, ' ').trim().slice(0, 300), problem: /contradict|wrong|conflict|false/i.test(x.problem) ? ('contradicted' as const) : ('unsourced' as const), detail: x.detail.replace(/\s+/g, ' ').trim().slice(0, 300) }))
      const claims = [...fromModel, ...coverage].slice(0, MAX_CLAIMS)
      // a claim sends the book back, whatever the verdict says; a revise without claims is kept as it is
      const verdict: 'pass' | 'revise' = claims.length > 0 ? 'revise' : r.value.verdict
      let accuracy = clamp(Number(r.value.scores.accuracy), 1, 10)
      if (claims.length > 0) accuracy = Math.min(accuracy, 6)
      const researchJobs = await askFromReview(d, ctx.agent.id, slug, 'the fact-checker found a claim without a source', [...r.value.research_questions, ...coverageQuestions], MAX_FACT_CHECK_QUESTIONS)
      const named = [...new Set(claims.map((x) => x.chapter))].sort((a, b) => a - b)
      const list = claims.map((x) => `- Chapter ${x.chapter}, ${x.problem}: ${x.claim}${x.detail ? ` (${x.detail})` : ''}`).join('\n')
      const text = `${r.value.notes.trim()}${list ? `\n\nClaims sent back (each must be sourced with a source number from the list, supported by the notes, or removed):\n${list}` : ''}`.trim()
      const name = `book-${role}-r${round}.md`
      await writeMd(
        d.books.file(slug, 'reviews', name),
        {
          kind: 'review',
          role,
          unit: 'book',
          round,
          verdict,
          verdict_raw: r.value.verdict,
          scores: { accuracy },
          chapters: named,
          claims,
          ...(researchJobs.length ? { research_jobs: researchJobs } : {}),
          agent: ctx.agent.id,
          model: r.chat.model.ref
        },
        '\n' + (text || 'Every claim is sourced and agrees with the notes.') + '\n'
      )
      await made(slug, run)
      return { result: `${verdict}: ${claims.length} claim(s) sent back, accuracy ${accuracy}`, resultPath: path.posix.join('books', slug, 'reviews', name) }
    },
    { reviewing: true }
  )
}

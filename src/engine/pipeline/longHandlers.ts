import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { parseMd } from '../../shared/md'
import { memoryUpdateSchema } from '../memory/bible'
import { reindex } from '../memory/index'
import { analyzeRepetition } from '../memory/repetition'
import type { Scheduler } from '../queue/scheduler'
import { writeMd } from '../store/atomic'
import { pad2 } from './books'
import { chatJson, cleanProse } from './llm'
import { buildMessages } from './prompts'
import { askFromReview, clamp, formatVars, memoryContext, recordMade, Run, unitNumber } from './handlers'
import type { PipelineDeps } from './handlers'

const reviewSchema = (dims: string[]) =>
  z.object({
    verdict: z.enum(['pass', 'revise']),
    scores: z.object(Object.fromEntries(dims.map((x) => [x, z.number()]))),
    notes: z.string(),
    chapters: z.array(z.number()).default([]),
    research_questions: z.array(z.string()).default([])
  })

/** Handlers for the long-book machinery: outline review, chapter checks, memory updates, act jobs, thread check, repetition report. */
export function registerLongHandlers(sched: Scheduler, d: PipelineDeps): void {
  const formatOf = (id: string) => {
    const f = d.getFormats().find((x) => x.id === id)
    if (!f) throw new Error(`unknown format ${id}`)
    return f
  }
  const made = (slug: string, run: Run) => recordMade(d, slug, run)
  const body = (t: string | null) => (t ? parseMd(t).body.trim() : '')

  // ---- the developmental editor reads the outline before anything is written ----
  sched.register('review_outline', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const book = (await d.books.read(slug))!.data
    const fmt = formatOf(book.format)
    const outline = (await d.books.outline(slug))!
    const acts = await d.books.acts(slug)
    const outlineText =
      outline.chapters.map((c) => `${c.n}. ${c.title}: ${c.summary}`).join('\n') +
      (acts.length ? '\n\nActs: ' + acts.map((a) => `${a.title} = chapters ${a.chapters[0]}-${a.chapters[a.chapters.length - 1]}`).join('; ') : '')
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'developmental-editor', 'review_outline', {
      title: book.title,
      pitch: (await d.books.pitch(slug)) ?? '',
      outline: outlineText,
      bible: await d.bible.digest(slug),
      ...formatVars(fmt, book.target_words)
    })
    run.version = version
    const r = await chatJson(ctx, messages, reviewSchema(['structure']), { maxTokens: 6000, temperature: 0.2 })
    run.addJson(r.cost, r.chat.model)
    const score = clamp(Number(r.value.scores.structure), 1, 10)
    const q = d.getQuality()
    const verdict = r.value.verdict === 'revise' && score >= q.revise_below ? 'pass' : r.value.verdict
    await writeMd(
      d.books.file(slug, 'reviews', 'outline-review.md'),
      { kind: 'outline-review', role: 'developmental-editor', verdict, scores: { structure: score }, agent: ctx.agent.id, model: r.chat.model.ref },
      '\n' + r.value.notes.trim() + '\n'
    )
    await made(slug, run)
    return { result: `outline ${verdict} (structure ${score})`, resultPath: `books/${slug}/reviews/outline-review.md` }
  })

  // ---- the continuity checker reads each new chapter against the memory ----
  sched.register('check_chapter', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const chapter = (await d.books.chapters(slug)).find((c) => c.n === n)
    if (!chapter) throw new Error(`chapter ${n} does not exist`)
    const packed = await memoryContext(d, slug, n, 16000, 'continuity-checker')
    ctx.context(packed.items.map((i) => ({ name: i.included ? i.name : `${i.name} (left out: over the budget)`, tokens: i.tokens })))
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'continuity-checker', 'check_chapter', {
      title: book.title,
      chapter_n: n,
      chapter_title: chapter.title,
      chapter_text: chapter.body,
      memory: packed.text
    })
    run.version = version
    const r = await chatJson(ctx, messages, reviewSchema(['continuity']), { maxTokens: 6000, temperature: 0.2 })
    run.addJson(r.cost, r.chat.model)
    const researchJobs = await askFromReview(d, ctx.agent.id, slug, `the continuity checker doubts a claim in chapter ${n}`, r.value.research_questions)
    const score = clamp(Number(r.value.scores.continuity), 1, 10)
    const q = d.getQuality()
    const verdict = r.value.verdict === 'revise' && score >= q.revise_below ? 'pass' : r.value.verdict
    await writeMd(
      d.books.file(slug, 'reviews', `ch-${pad2(n)}-check.md`),
      { kind: 'chapter-check', n, role: 'continuity-checker', verdict, scores: { continuity: score }, ...(researchJobs.length ? { research_jobs: researchJobs } : {}), agent: ctx.agent.id, model: r.chat.model.ref },
      '\n' + r.value.notes.trim() + '\n'
    )
    await made(slug, run)
    return { result: `chapter ${n} continuity: ${verdict} (${score})`, resultPath: `books/${slug}/reviews/ch-${pad2(n)}-check.md` }
  })

  // ---- the archivist records what the chapter established ----
  sched.register('memory_update', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const chapter = (await d.books.chapters(slug)).find((c) => c.n === n)
    if (!chapter) throw new Error(`chapter ${n} does not exist`)
    const entries = await d.bible.entries(slug)
    const threads = (await d.bible.threads(slug)).filter((t) => t.status === 'open')
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'archivist', 'memory_update', {
      title: book.title,
      chapter_n: n,
      chapter_title: chapter.title,
      chapter_text: chapter.body,
      known: entries.map((e) => `- ${e.name} (${e.group === 'characters' ? 'character' : 'place'})`).join('\n') || '(none yet)',
      threads: threads.map((t) => `${t.id}: ${t.text}`).join('\n') || '(none)'
    })
    run.version = version
    ctx.context([
      { name: `chapter ${n} text`, tokens: Math.round(chapter.body.length / 4) },
      { name: `${entries.length} bible entries (names only)`, tokens: Math.round(entries.length * 6) },
      { name: `${threads.length} open threads`, tokens: Math.round(threads.reduce((s, t) => s + t.text.length, 0) / 4) }
    ])
    const r = await chatJson(ctx, messages, memoryUpdateSchema, { maxTokens: 8000, temperature: 0.2 })
    run.addJson(r.cost, r.chat.model)
    const applied = await d.bible.apply(slug, n, r.value)
    for (const w of applied.warnings) ctx.log(`warning: ${w}`)
    await writeMd(d.books.file(slug, 'summaries', `ch-${pad2(n)}.md`), { kind: 'summary', n, title: chapter.title, indexed: false }, '\n' + r.value.summary.trim() + '\n')
    await made(slug, run)
    return { result: `chapter ${n}: ${r.value.characters.length} character update(s), ${r.value.threads_opened.length} thread(s) opened, ${r.value.threads_closed.length} closed`, resultPath: `books/${slug}/summaries/ch-${pad2(n)}.md` }
  })

  // ---- indexing for search (no model call, only embeddings) ----
  sched.register('index_chapter', async (ctx) => {
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const file = d.books.file(slug, 'summaries', `ch-${pad2(n)}.md`)
    const doc = parseMd(await fs.readFile(file, 'utf8'))
    let note: string
    if (d.memory.available()) {
      const r = await reindex(d.dataDir, d.memory.getIndex())
      note = `indexed (${r.indexed} file(s) new or changed)`
    } else {
      note = 'no embedding model available: the search index was skipped'
      ctx.log(note)
    }
    await writeMd(file, { ...doc.data, indexed: true }, doc.body)
    return { result: `chapter ${n} ${note}` }
  })

  // ---- act summary ----
  sched.register('act_summary', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const actN = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const act = (await d.books.acts(slug)).find((a) => a.n === actN)
    if (!act) throw new Error(`no act ${actN}`)
    const parts: string[] = []
    for (const c of act.chapters) {
      const t = await d.books.readText(slug, 'summaries', `ch-${pad2(c)}.md`)
      if (t) parts.push(`### Chapter ${c}\n${body(t)}`)
    }
    const { messages, version } = await buildMessages(d.dataDir, ctx, 'archivist', 'act_summary', {
      title: book.title,
      act_n: actN,
      act_chapters: `${act.chapters[0]}-${act.chapters[act.chapters.length - 1]}`,
      summaries: parts.join('\n\n')
    })
    run.version = version
    const r = await run.chat({ messages, maxTokens: 4000 })
    const text = cleanProse(r.text)
    if (text.length < 40) throw new Error('the act summary came back empty')
    await writeMd(d.books.file(slug, 'summaries', `act-${actN}.md`), { kind: 'summary', act: actN }, '\n' + text + '\n')
    await made(slug, run)
    return { result: `act ${actN} summarised`, resultPath: `books/${slug}/summaries/act-${actN}.md` }
  })

  // ---- developmental edit of an act, with tension scores ----
  sched.register(
    'act_review',
    async (ctx) => {
      const run = new Run(ctx)
      const slug = ctx.job.book!
      const actN = unitNumber(ctx.job.unit)
      const book = (await d.books.read(slug))!.data
      const fmt = formatOf(book.format)
      const acts = await d.books.acts(slug)
      const act = acts.find((a) => a.n === actN)
      if (!act) throw new Error(`no act ${actN}`)
      const outline = (await d.books.outline(slug))!
      const chapters = (await d.books.chapters(slug)).filter((c) => act.chapters.includes(c.n))
      const earlier: string[] = []
      for (const a of acts.filter((x) => x.n < actN)) {
        const t = await d.books.readText(slug, 'summaries', `act-${a.n}.md`)
        if (t) earlier.push(`### Act ${a.n}\n${body(t)}`)
      }
      const tension = await readTension(d, slug)
      const { messages, version } = await buildMessages(d.dataDir, ctx, 'developmental-editor', 'act_review', {
        title: book.title,
        act_n: actN,
        act_count: acts.length,
        act_chapters: `${act.chapters[0]}-${act.chapters[act.chapters.length - 1]}`,
        outline: outline.chapters.map((c) => `${c.n}. ${c.title}: ${c.summary}`).join('\n'),
        earlier: earlier.join('\n\n') || '(this is the first act)',
        tension_so_far: Object.entries(tension).map(([c, v]) => `ch${c}=${v}`).join(', ') || '(none yet)',
        act_text: chapters.map((c) => `### Chapter ${c.n}: ${c.title}\n\n${c.body}`).join('\n\n'),
        ...formatVars(fmt, book.target_words)
      })
      run.version = version
      ctx.context([{ name: `act ${actN} in full`, tokens: Math.round(chapters.reduce((s, c) => s + c.body.length, 0) / 4) }])
      const schema = z.object({
        verdict: z.enum(['pass', 'revise']),
        scores: z.object({ structure: z.number() }),
        notes: z.string(),
        chapters: z.array(z.number()).default([]),
        tension: z.array(z.object({ chapter: z.number(), score: z.number() })).default([])
      })
      const r = await chatJson(ctx, messages, schema, { maxTokens: 6000, temperature: 0.2 })
      run.addJson(r.cost, r.chat.model)
      for (const t of r.value.tension) if (act.chapters.includes(t.chapter)) tension[String(t.chapter)] = clamp(Number(t.score), 1, 10)
      const flat = flatStretches(tension)
      await writeMd(
        d.books.file(slug, 'reports', 'tension.md'),
        { kind: 'report', tension, flat_stretches: flat },
        `\n# Tension per chapter\n\n${Object.entries(tension).map(([c, v]) => `- Chapter ${c}: ${v}`).join('\n')}\n\n${flat.length ? `Flat stretches (three or more chapters at 4 or below): ${flat.map((f) => `${f[0]}-${f[1]}`).join(', ')}\n` : 'No flat stretch found.\n'}`
      )
      const notes = r.value.notes.trim() + (flat.length ? `\n\nFlat stretch flagged: chapters ${flat.map((f) => `${f[0]}-${f[1]}`).join(', ')}. Raise the stakes there.` : '')
      await writeMd(
        d.books.file(slug, 'reviews', `actreview-${actN}.md`),
        { kind: 'act-review', act: actN, role: 'developmental-editor', verdict: r.value.verdict, scores: { structure: clamp(Number(r.value.scores.structure), 1, 10) }, agent: ctx.agent.id, model: r.chat.model.ref },
        '\n' + notes + '\n'
      )
      await made(slug, run)
      return { result: `act ${actN} reviewed (${r.value.verdict}), tension ${r.value.tension.map((t) => t.score).join(',')}`, resultPath: `books/${slug}/reviews/actreview-${actN}.md` }
    },
    { reviewing: true }
  )

  // ---- the script that counts repeated phrases (no model) ----
  sched.register('repetition_report', async (ctx) => {
    const slug = ctx.job.book!
    const chapters = await d.books.chapters(slug)
    const report = analyzeRepetition(chapters.map((c) => ({ n: c.n, text: c.body })))
    await writeMd(d.books.file(slug, 'reports', 'repetition.md'), { kind: 'report', words: report.words, flagged: report.flagged }, '\n' + report.markdown)
    ctx.log(`repetition report: ${report.flagged} thing(s) flagged over ${report.words} words`)
    return { result: `${report.flagged} thing(s) flagged`, resultPath: `books/${slug}/reports/repetition.md` }
  })

  // ---- end of book: every thread closed? ----
  sched.register(
    'thread_check',
    async (ctx) => {
      const run = new Run(ctx)
      const slug = ctx.job.book!
      const round = ctx.job.round
      const book = (await d.books.read(slug))!.data
      // the bible's own list of open threads is what gets checked (not the summaries alone)
      const open = (await d.bible.threads(slug)).filter((t) => t.status === 'open')
      let verdict: 'pass' | 'revise' = 'pass'
      let score = 10
      let notes = 'No thread is left open.'
      let affected: number[] = []
      let stillOpen = open
      let closedNow: string[] = []
      const chapters = await d.books.chapters(slug)
      if (open.length > 0) {
        const summaries: string[] = []
        for (const a of await d.books.acts(slug)) {
          const t = await d.books.readText(slug, 'summaries', `act-${a.n}.md`)
          if (t) summaries.push(`### Act ${a.n}\n${body(t)}`)
        }
        const last = chapters[chapters.length - 1]
        const { messages, version } = await buildMessages(d.dataDir, ctx, 'continuity-checker', 'thread_check', {
          title: book.title,
          threads: open.map((t) => `${t.id}: ${t.text} (opened in chapter ${t.opened})`).join('\n'),
          summaries: summaries.join('\n\n') || '(none)',
          last_chapter: last ? `### Chapter ${last.n}: ${last.title}\n\n${last.body}` : ''
        })
        run.version = version
        const schema = reviewSchema(['threads']).extend({ resolved: z.array(z.string()).default([]) })
        const r = await chatJson(ctx, messages, schema, { maxTokens: 6000, temperature: 0.2 })
        run.addJson(r.cost, r.chat.model)
        score = clamp(Number(r.value.scores.threads), 1, 10)
        verdict = r.value.verdict === 'revise' && score >= d.getQuality().revise_below ? 'pass' : r.value.verdict
        notes = r.value.notes.trim()
        affected = r.value.chapters
        // threads the checker found really closed are closed in the bible; the rest stays open and goes to the publisher
        closedNow = await d.bible.closeThreads(slug, r.value.resolved, last?.n ?? 0)
        stillOpen = open.filter((t) => !closedNow.includes(t.id))
      }
      // a later check round keeps what an earlier one closed
      const before = await d.books.readText(slug, 'reports', 'open-threads.md')
      const earlier = before && Array.isArray(parseMd(before).data.closed_by_check) ? (parseMd(before).data.closed_by_check as unknown[]).map(String) : []
      const everClosed = [...new Set([...earlier, ...closedNow])]
      await writeMd(
        d.books.file(slug, 'reports', 'open-threads.md'),
        { kind: 'report', open: stillOpen.length, closed_by_check: everClosed, threads: stillOpen.map((t) => ({ id: t.id, text: t.text, opened: t.opened })) },
        `\n# Threads left open at the end\n\n${stillOpen.length ? stillOpen.map((t) => `- ${t.id}: ${t.text} (opened in chapter ${t.opened})`).join('\n') : 'None: every thread is closed.'}\n${everClosed.length ? `\nClosed by the end-of-book check (the text resolves them): ${everClosed.join(', ')}.\n` : ''}`
      )
      await writeMd(
        d.books.file(slug, 'reviews', `thread-check-r${round}.md`),
        { kind: 'review', role: 'thread-check', unit: 'book', round, verdict, scores: { threads: score }, chapters: affected, open_threads: stillOpen.map((t) => t.id), closed_by_check: closedNow, agent: ctx.agent.id },
        '\n' + notes + '\n'
      )
      await made(slug, run)
      return { result: `thread check ${verdict} (${open.length} open thread(s) before the check, ${stillOpen.length} still open)`, resultPath: `books/${slug}/reviews/thread-check-r${round}.md` }
    },
    { reviewing: true }
  )
}

async function readTension(d: PipelineDeps, slug: string): Promise<Record<string, number>> {
  const t = await d.books.readText(slug, 'reports', 'tension.md')
  const raw = t ? parseMd(t).data.tension : null
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, number>) } : {}
}

/** Runs of three or more consecutive chapters with tension 4 or below. */
export function flatStretches(tension: Record<string, number>): [number, number][] {
  const ns = Object.keys(tension).map(Number).sort((a, b) => a - b)
  const out: [number, number][] = []
  let start: number | null = null
  let prev = 0
  const close = () => {
    if (start !== null && prev - start >= 2) out.push([start, prev])
    start = null
  }
  for (const n of ns) {
    if (tension[String(n)]! <= 4 && (start === null || n === prev + 1)) {
      start ??= n
      prev = n
    } else {
      close()
      if (tension[String(n)]! <= 4) {
        start = n
        prev = n
      }
    }
  }
  close()
  return out
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { briefOf, briefPromptText, emptyBrief, renderBrief } from '../../shared/brief'
import type { BriefCharacter, StoryBrief } from '../../shared/brief'
import type { BookSummary } from '../../shared/protocol'
import { ROLES } from '../../shared/schemas'
import { DEFAULT_LEASE_MS } from '../models/client'
import type { Engine } from '../engine'
import { TERMINAL_BOOK_STAGES } from '../pipeline/books'
import { parseLightBible, parseScript } from '../publish/script'
import { musicCues, parseScreenplay, runtimeOf } from '../publish/screenplay'
import { puzzleEntrySchema } from '../../shared/puzzles'
import type { PuzzleEntry } from '../../shared/puzzles'
import { puzzlesOf } from '../pipeline/puzzles'
import { agentSummary, bookSummary, ideaSummary, modelSummaries, roleDefaults, seriesSummary, serverStatuses, topicSummary } from '../summary'
import { bookRefs, seriesMembers } from '../store/series'
import { TOPIC_KINDS } from '../store/topics'

/** A mistake in what the agent sent: shown to it as a tool error. */
class ToolError extends Error {}

const fail = (message: string): never => {
  throw new ToolError(message)
}

const text = (x: unknown) => ({ content: [{ type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2) }] })

/** Runs a tool: the result is JSON text, any error comes back as an MCP tool error (never a crash). */
const run =
  <A>(fn: (args: A, extra: { signal?: AbortSignal }) => Promise<unknown>) =>
  async (args: A, extra: { signal?: AbortSignal } = {}) => {
    try {
      return text(await fn(args, extra))
    } catch (err) {
      return { ...text(err instanceof Error ? err.message : String(err)), isError: true }
    }
  }

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

/** A slug is a folder or file name, never a path. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const validSlug = (s: string) => SLUG.test(s) && !s.includes('..')

const characterSchema = z.object({
  name: z.string().describe('Character name'),
  role: z.string().optional().describe('Who they are in the story, e.g. "the hero", "the lighthouse keeper\'s daughter"'),
  description: z.string().optional().describe('Looks, voice, history: free text')
})
const sectionSchema = z.object({ heading: z.string(), text: z.string() })
const modelsSchema = z.record(z.string(), z.string())

const toCharacter = (c: z.infer<typeof characterSchema>): BriefCharacter => ({ name: c.name.trim(), role: c.role?.trim() ?? '', description: c.description?.trim() ?? '' })

/** A book summary without the reader page list (noise for an agent). */
const slim = ({ readerPages: _r, ...rest }: BookSummary) => rest

/** Registers the factory tools on an MCP server. Secrets, settings, Kindle, model lists and stopNow are left out on purpose. */
export function registerTools(server: McpServer, engine: Engine): void {
  // ---- helpers over the engine ----
  const topics = () => engine.topics.read()
  const needBook = async (slug: string) => {
    if (!validSlug(slug) || !(await engine.books.read(slug))) fail(`no book "${slug}" (list_books shows the slugs)`)
    return slug
  }
  const needAgent = (id: string) => engine.agents.get(id) ?? fail(`no agent "${id}" (list_agents shows the ids)`)
  const needStory = async (slug: string) => {
    const idea = validSlug(slug) ? (await engine.ideas.list()).find((i) => i.slug === slug) : undefined
    return idea ?? fail(`no story "${slug}" (list_stories shows the slugs)`)
  }
  const needSeries = async (slug: string) => (validSlug(slug) ? await engine.series.get(slug) : null) ?? fail(`no series "${slug}" (list_series shows the slugs)`)
  const seriesRow = async (slug: string) => {
    const s = await needSeries(slug)
    return seriesSummary(s, seriesMembers(s.slug, await bookRefs(engine.books), await engine.ideas.list()))
  }
  const checkSeries = async (series?: string) => {
    if (series && !(await engine.series.get(series))) fail(`unknown series "${series}" (list_series shows the slugs)`)
  }
  const checkFormat = (format?: string) => {
    if (format && !engine.formats.some((f) => f.enabled && f.id === format)) {
      fail(`unknown format "${format}". Enabled formats: ${engine.formats.filter((f) => f.enabled).map((f) => f.id).join(', ')}`)
    }
  }
  const checkTopic = async (topic?: string) => {
    if (topic && !(await topics()).some((t) => t.id === topic)) fail(`unknown topic "${topic}" (list_topics shows the ids)`)
  }
  const needRole = (role: string) => {
    if (!(ROLES as readonly string[]).includes(role) && !(role in engine.registry.roles.roles)) fail(`unknown role "${role}"`)
  }
  const needModel = (ref: string) => {
    const m = engine.registry.getModel(ref) ?? fail(`unknown model "${ref}" (list_models shows the refs)`)
    if (!m.provider.available) fail(`the provider of "${ref}" is not available (${m.provider.unavailableReason ?? 'switched off'}): jobs would skip it`)
  }
  const checkRoleModels = (models?: Record<string, string>) => {
    for (const [role, ref] of Object.entries(models ?? {})) {
      needRole(role)
      needModel(ref)
    }
  }
  const book = async (slug: string) => {
    const s = await bookSummary(engine.books, slug, await topics())
    return s ? { ...slim(s), roleModels: (await engine.books.read(slug))?.data.role_models ?? {} } : null
  }
  /** A path below the data folder as an absolute one (native separators), or null when there is nothing there. */
  const abs = (rel: string | null | undefined) => (rel ? path.join(engine.dataDir, ...rel.split('/')) : null)
  const bookPaths = async (slug: string, s: BookSummary) => {
    const dir = engine.books.dir(slug)
    const there = (...p: string[]) => fs.stat(path.join(dir, ...p)).then(() => path.join(dir, ...p), () => null)
    return {
      dataDir: engine.dataDir,
      folder: dir,
      epub: abs(s.epub),
      coverPng: abs(s.coverPng),
      readerDir: abs(s.readerDir),
      articlePage: abs(s.articlePage),
      articleMarkdown: await there('out', 'article.md'),
      chapters: await there('chapters')
    }
  }
  const agent = (id: string) => {
    const def = engine.agents.get(id)
    return def ? agentSummary(def, engine.scheduler, engine.router) : null
  }
  const allAgents = () => engine.agents.list().map((a) => agentSummary(a, engine.scheduler, engine.router))

  // ---- read ----
  server.registerTool(
    'factory_status',
    {
      description: 'Overview of the factory: dataDir (the absolute path of the data folder), paused or not, spend against the caps, local model servers, running jobs, `blocked` (queued jobs no model can take now, each with the reason: a server down, a day used up, a rate limit, every slot busy), `lastResort` (the model of `last_resort_model` that takes a job when every model of its role is down or used up for the day, or null), `providers` (`dayFull`, `resetsAt`, `down` per provider), `embeddings` (the embedding model and whether its server is down, null when none), books per stage, agents busy and idle, and clientTasks (model requests waiting for you, or leased to you, on a `client` model).',
      annotations: READ
    },
    run(async () => {
      const byStage: Record<string, number> = {}
      for (const slug of await engine.books.slugs()) {
        const b = await engine.books.read(slug)
        if (b) byStage[b.data.stage] = (byStage[b.data.stage] ?? 0) + 1
      }
      const agents = allAgents()
      const busy = agents.filter((a) => a.state === 'working' || a.state === 'reviewing' || a.state === 'waiting-provider' || a.state === 'waiting-research')
      return {
        dataDir: engine.dataDir,
        paused: engine.factory.paused,
        uptimeMs: engine.uptimeMs,
        spend: engine.budget.snapshot(),
        servers: serverStatuses(engine.registry),
        running: engine.scheduler.runningJobs(),
        booksByStage: byStage,
        maxBooksInProgress: engine.factory.max_books_in_progress,
        maxArticlesInProgress: engine.factory.max_articles_in_progress,
        openStories: (await engine.ideas.open()).filter((i) => i.data.source === 'user').length,
        clientTasks: engine.clientQueue.counts(),
        // queued jobs that no model can take now (a server down, a day used up, a rate limit, every slot busy), and the providers behind it
        blocked: engine.scheduler.blockedJobs(),
        lastResort: engine.registry.lastResort()?.ref ?? null,
        providers: [...engine.registry.providers.values()]
          .filter((p) => p.kind !== 'search' && p.kind !== 'client' && p.available)
          .map((p) => {
            const dayFull = engine.router.limiter.dayFull(p)
            return { id: p.id, dayFull, resetsAt: dayFull ? new Date(engine.router.limiter.dayResetsAt()).toISOString() : null, down: p.down }
          }),
        embeddings: (() => {
          const m = engine.registry.embeddingModel()
          return m ? { model: m.ref, provider: m.provider.id, down: m.provider.down } : null
        })(),
        agents: { total: agents.length, busy: busy.length, idle: agents.filter((a) => a.state === 'idle').length, paused: agents.filter((a) => a.paused).length },
        busyAgents: busy.map((a) => ({ id: a.id, state: a.state, task: a.task, book: a.book }))
      }
    })
  )

  server.registerTool(
    'list_books',
    {
      description: 'List the books, one compact row each. Optionally only one stage (e.g. published, failed, drafting) or one medium (book or article: the newspaper articles are in the list too, with medium "article"; list_articles is the newspaper view).',
      inputSchema: { stage: z.string().optional().describe('Only books in this stage'), medium: z.enum(['book', 'article']).optional().describe('Only books (everything but articles) or only newspaper articles') },
      annotations: READ
    },
    run(async ({ stage, medium }: { stage?: string; medium?: 'book' | 'article' }) => {
      const all = await topics()
      const rows = []
      for (const slug of await engine.books.slugs()) {
        const b = await bookSummary(engine.books, slug, all)
        if (!b || (stage && b.stage !== stage) || (medium && b.medium !== medium)) continue
        rows.push({ slug, folder: engine.books.dir(slug), title: b.title, medium: b.medium, stage: b.stage, format: b.format, chaptersWritten: b.chaptersWritten, chaptersPlanned: b.chaptersPlanned, words: b.words, targetWords: b.targetWords, score: b.score, paused: b.paused, ...(b.sourceBook ? { sourceBook: b.sourceBook.slug } : {}) })
      }
      return rows
    })
  )

  server.registerTool(
    'list_articles',
    {
      description:
        'The newspaper: the published articles, newest first, one compact row each (slug, headline, standfirst, section, byline, date, words, score, and the page: `page` is books/<slug>/out/article.html relative to the data folder, `pagePath` the absolute path, with out/article.md beside it). Optionally only one section (a topic id like news-technology, or its name) and only articles published on or after a date. stage "all" lists the articles in progress too.',
      inputSchema: {
        section: z.string().optional().describe('A newspaper section: the topic id (news-technology) or its name (Technology)'),
        since: z.string().optional().describe('Only articles published on or after this date (YYYY-MM-DD, or a full ISO time)'),
        stage: z.string().optional().describe('Default published. A stage such as drafting, or "all"')
      },
      annotations: READ
    },
    run(async ({ section, since, stage }: { section?: string; since?: string; stage?: string }) => {
      let from = 0
      if (since) {
        from = Date.parse(since)
        if (Number.isNaN(from)) fail(`"${since}" is not a date: use YYYY-MM-DD`)
      }
      const want = section?.trim().toLowerCase()
      const all = await topics()
      const rows: { publishedAt: string | null; row: Record<string, unknown> }[] = []
      for (const slug of await engine.books.slugs()) {
        const b = await bookSummary(engine.books, slug, all)
        if (!b || b.medium !== 'article') continue
        if ((stage ?? 'published') !== 'all' && b.stage !== (stage ?? 'published')) continue
        if (want && b.topic?.id.toLowerCase() !== want && b.topic?.name.toLowerCase() !== want) continue
        if (from && (!b.publishedAt || Date.parse(b.publishedAt) < from)) continue
        rows.push({
          publishedAt: b.publishedAt,
          row: { slug, headline: b.headline ?? b.title, standfirst: b.standfirst, section: b.topic?.name ?? null, sectionId: b.topic?.id ?? null, byline: b.author, publishedAt: b.publishedAt, stage: b.stage, words: b.words, score: b.score, page: b.articlePage, pagePath: abs(b.articlePage) }
        })
      }
      return rows.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).map((r) => r.row)
    })
  )

  server.registerTool(
    'get_book',
    { description: 'One book in full: stage, chapters, words, score, team, last steps, cover and EPUB state, `paths` (absolute paths of the folder, EPUB, cover, reader, article page and chapters, null when not there; the relative fields stay), and the owner story brief it was made from (if any).', inputSchema: { book: z.string().describe('Book slug') }, annotations: READ },
    run(async ({ book: slug }: { book: string }) => {
      await needBook(slug)
      const summary = (await bookSummary(engine.books, slug, await topics()))!
      return { ...(await book(slug)), paths: await bookPaths(slug, summary), brief: await engine.books.brief(slug) }
    })
  )

  server.registerTool(
    'wait_for_book',
    {
      description:
        'Long tool: waits until a book is published, rejected or failed, or until a model request of the book waits for you (stop_on_client_task, default true), or timeout_seconds (default 60, at most 900) passes, and then reports where the book is. `slug` is a story slug or a book slug (a story with no book yet is waited on until its book starts). Call it again after `timeout`; answer the client tasks (get_client_task, submit_client_task) when it returns `client-task`. Returns {done, reason: published, rejected, failed, client-task or timeout, story, book, title, stage, chaptersWritten, chaptersPlanned, words, targetWords, score, clientTasks, folder, epub, articlePage (absolute paths), waitedMs} and `reasons` for a rejected or failed book.',
      inputSchema: {
        slug: z.string().describe('A story slug or a book slug'),
        timeout_seconds: z.number().int().min(1).max(900).optional().describe('Default 60'),
        stop_on_client_task: z.boolean().optional().describe('Return as soon as a model request of this book waits for you (default true)')
      },
      annotations: READ
    },
    run(async ({ slug, timeout_seconds, stop_on_client_task }: { slug: string; timeout_seconds?: number; stop_on_client_task?: boolean }, extra) => {
      if (!validSlug(slug)) fail(`no book or story "${slug}"`)
      const started = Date.now()
      const deadline = started + (timeout_seconds ?? 60) * 1000
      const stopOnTask = stop_on_client_task !== false
      let story: string | null = null
      if (!(await engine.books.read(slug))) {
        story = (await engine.ideas.list()).find((i) => i.slug === slug)?.slug ?? fail(`no book or story "${slug}" (list_books and list_stories show the slugs)`)
      }
      for (;;) {
        // a story's book appears when the factory starts it
        let bookSlug: string | null = story ? ((await engine.ideas.list()).find((i) => i.slug === story)?.data.book ?? null) : slug
        if (bookSlug && !(await engine.books.read(bookSlug))) bookSlug = null
        const summary = bookSlug ? await bookSummary(engine.books, bookSlug, await topics()) : null
        const tasks = engine.clientQueue.list()
        const mine = (t: { book: string }) => !!bookSlug && t.book === bookSlug
        const startTask = (t: { role: string; task: string }) => !bookSlug && t.role === 'editor-in-chief' && t.task === 'start_book'
        const waiting = tasks.filter((t) => t.state === 'waiting' && (mine(t) || startTask(t))).length
        let reason: string | null = null
        if (summary && TERMINAL_BOOK_STAGES.has(summary.stage)) reason = summary.stage
        else if (stopOnTask && waiting > 0) reason = 'client-task'
        else if (Date.now() >= deadline || extra.signal?.aborted) reason = 'timeout'
        if (reason) {
          return {
            done: summary ? TERMINAL_BOOK_STAGES.has(summary.stage) : false,
            reason,
            story,
            book: bookSlug,
            title: summary?.title ?? null,
            stage: summary?.stage ?? null,
            chaptersWritten: summary?.chaptersWritten ?? 0,
            chaptersPlanned: summary?.chaptersPlanned ?? null,
            words: summary?.words ?? 0,
            targetWords: summary?.targetWords ?? null,
            score: summary?.score ?? null,
            ...(summary && (summary.stage === 'rejected' || summary.stage === 'failed') ? { reasons: summary.reasons } : {}),
            clientTasks: { waiting, leased: tasks.filter((t) => t.state === 'leased' && mine(t)).length },
            folder: bookSlug ? engine.books.dir(bookSlug) : null,
            epub: summary ? abs(summary.epub) : null,
            articlePage: summary ? abs(summary.articlePage) : null,
            waitedMs: Date.now() - started
          }
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
    })
  )

  server.registerTool(
    'get_script',
    {
      description:
        'The parsed script of a visual novel book (a script format, any stage, drafts too) as JSON: {slug, title, author, genre, format, style, characters: [{name, looks, voice, aliases}], places: [{name, looks}], chapters: [{n, title, choices, ending, sourceChapters, scenes: [{place, time, background, beats}]}]}. A beat is a cast list, a line (speaker, expression, text), narration, a break, a puzzle beat of a mystery with puzzles ({type: "clue", puzzle, clue, text} for a CLUE line, {type: "evidence", key, text}, {type: "puzzle", puzzle, kind} and {type: "testimony", witness, statements: [{n, speaker, expression, text}]}; `puzzles` at the top level lists the puzzles of the book from bible/puzzles.md) or a cue ({type: "cue", cue: "cg" | "insert" | "sfx" | "ambience", text}: a picture or sound line, text null for `CG: none`, `END CG` and `AMBIENCE: none`). A speaker or cast name that is one of the aliases of a character comes out as the bible name, with `alias` set on the line or the cast entry; see docs/visual-novel.md. Give `chapter` for one chapter. Refused for a book that is not a script.',
      inputSchema: { book: z.string().describe('Book slug'), chapter: z.number().int().positive().optional().describe('Only this chapter') },
      annotations: READ
    },
    run(async ({ book: slug, chapter }: { book: string; chapter?: number }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.screenplay === true) fail(`"${slug}" is a screenplay (its format is ${b.data.format}), not a visual novel script: use get_screenplay`)
      if (b?.data.script !== true) fail(`"${slug}" is not a visual novel script (its format is ${b?.data.format}): get_script needs a book with script: true`)
      const bible = parseLightBible(await engine.books.bible(slug))
      const outline = await engine.books.outline(slug)
      const names = bible.characters.map((c) => c.name)
      const written = await engine.books.chapters(slug)
      if (chapter && !written.some((c) => c.n === chapter)) fail(`chapter ${chapter} of "${slug}" is not written`)
      return {
        slug,
        title: b!.data.title,
        author: b!.data.author,
        genre: b!.data.genre,
        format: b!.data.format,
        style: bible.style,
        characters: bible.characters,
        places: bible.places,
        chapters: written
          .filter((c) => !chapter || c.n === chapter)
          .map((c) => {
            const entry = outline?.chapters.find((o) => o.n === c.n)
            return {
              n: c.n,
              title: c.title,
              choices: entry?.choices ?? [],
              ending: entry?.ending ?? null,
              ...(entry?.source_chapters ? { sourceChapters: entry.source_chapters } : {}),
              scenes: parseScript(c.body, names, bible.characters).scenes
            }
          }),
        puzzles: await puzzlesOf(engine, slug)
      }
    })
  )

  server.registerTool(
    'get_screenplay',
    {
      description:
        'The parsed screenplay of a short film or cartoon book (a screenplay format such as short-film, cartoon or kids-cartoon; any stage, drafts too) as JSON: {slug, title, author, genre, format, aspect ("16:9", or "9:16" when the brief or style says vertical), style, runtimeSeconds, runtimeRange, characters: [{name, looks, voice, aliases}], places: [{name, looks}], music: [{id, description, from, to}] (shot ids), chapters: [{n, title, sourceChapters, scenes: [{id, place, time, background, shots: [{id, framing, move, seconds, continuous, action, cast: [{name, look}], sfx, title, lines: [{speaker, delivery, text, kind}]}]}]}]}. `kind` of a line is dialogue, voice-over or off-screen; ids are ch01.s01.sh02. A shot with no length gets 4 seconds (longer when its lines need it), a spoken line before any shot opens a medium shot. See docs/screenplay.md. Give `chapter` for one chapter (the music cues then only cover it). Refused for a book that is not a screenplay (use get_script for a visual novel).',
      inputSchema: { book: z.string().describe('Book slug'), chapter: z.number().int().positive().optional().describe('Only this chapter') },
      annotations: READ
    },
    run(async ({ book: slug, chapter }: { book: string; chapter?: number }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.screenplay !== true) {
        fail(`"${slug}" is not a screenplay (its format is ${b?.data.format}): get_screenplay needs a book of a screenplay format${b?.data.script === true ? '; this one is a visual novel script, use get_script' : ''}`)
      }
      const bible = parseLightBible(await engine.books.bible(slug))
      const outline = await engine.books.outline(slug)
      const names = bible.characters.map((c) => c.name)
      const written = await engine.books.chapters(slug)
      if (chapter && !written.some((c) => c.n === chapter)) fail(`chapter ${chapter} of "${slug}" is not written`)
      const brief = await engine.books.brief(slug)
      const vertical = /\b(vertical|portrait|9:16|tiktok|reels|shorts)\b/i.test(`${brief ? briefPromptText(brief) : ''} ${bible.style}`)
      const chapters = written
        .filter((c) => !chapter || c.n === chapter)
        .map((c) => {
          const entry = outline?.chapters.find((o) => o.n === c.n)
          return {
            n: c.n,
            title: c.title,
            ...(entry?.source_chapters ? { sourceChapters: entry.source_chapters } : {}),
            scenes: parseScreenplay(c.body, names, c.n).scenes
          }
        })
      const range = engine.formats.find((f) => f.id === b!.data.format)?.runtime
      return {
        slug,
        title: b!.data.title,
        author: b!.data.author,
        genre: b!.data.genre,
        format: b!.data.format,
        aspect: vertical ? '9:16' : '16:9',
        style: bible.style,
        runtimeSeconds: runtimeOf(chapters),
        ...(range ? { runtimeRange: range } : {}),
        characters: bible.characters,
        places: bible.places,
        music: musicCues(chapters),
        chapters: chapters.map((c) => ({
          ...c,
          scenes: c.scenes.map((s) => ({ ...s, shots: s.shots.map(({ music: _m, musicStop: _s, ...shot }) => shot) }))
        }))
      }
    })
  )

  server.registerTool(
    'refresh_factbase',
    {
      description:
        'Merge the research notes a non-fiction book or article has gathered since its fact base was made (its unmerged notes) into the fact base now, at any stage, a published book too. Returns {queued: the job id or null, unmerged: how many notes}. The published text and references do not change: reopen_book to have the writers use the new facts. A fiction book is refused.',
      inputSchema: { book: z.string().describe('Book slug') },
      annotations: WRITE
    },
    run(async ({ book: slug }: { book: string }) => engine.refreshFactbase(await needBook(slug)).catch((err: Error) => fail(err.message)))
  )

  server.registerTool(
    'read_book_file',
    {
      description:
        'Read one text file of a book: brief, pitch, outline, bible (the whole story bible), notes (the owner notes), or chapter (give the chapter number). Only files inside the book folder can be read.',
      inputSchema: {
        book: z.string().describe('Book slug'),
        file: z.enum(['brief', 'pitch', 'outline', 'bible', 'notes', 'chapter']),
        chapter: z.number().int().positive().optional().describe('Chapter number, for file "chapter"')
      },
      annotations: READ
    },
    run(async ({ book: slug, file, chapter }: { book: string; file: 'brief' | 'pitch' | 'outline' | 'bible' | 'notes' | 'chapter'; chapter?: number }) => {
      await needBook(slug)
      const b = engine.books
      const rel =
        file === 'chapter' ? (chapter ? path.relative(b.dir(slug), b.chapterFile(slug, chapter)) : fail('give the chapter number')) : file === 'bible' ? 'bible' : `${file}.md`
      const full = path.join(b.dir(slug), rel)
      // belt and braces: the name is fixed above and the slug is checked, but nothing outside the book folder is read
      if (path.relative(b.dir(slug), full).startsWith('..')) fail('path outside the book')
      if (file === 'bible') return (await readBible(full)) ?? fail(`book "${slug}" has no bible yet`)
      const content = await fs.readFile(full, 'utf8').catch(() => null)
      if (content === null) {
        if (file === 'brief') {
          const brief = await b.brief(slug)
          if (brief) return renderBrief(brief)
        }
        fail(`book "${slug}" has no ${file === 'chapter' ? `chapter ${chapter}` : file} yet`)
      }
      return content
    })
  )

  server.registerTool(
    'list_stories',
    {
      description: 'List the stories (idea files): the owner stories you add, and the ideas the factory generated. Default: open stories from every source.',
      inputSchema: {
        status: z.enum(['open', 'used', 'all']).optional().describe('open = waiting for a book (default), used = a book was started'),
        source: z.enum(['user', 'generated', 'all']).optional().describe('Default all')
      },
      annotations: READ
    },
    run(async ({ status, source }: { status?: 'open' | 'used' | 'all'; source?: 'user' | 'generated' | 'all' }) =>
      (await engine.ideas.list())
        .filter((i) => (status ?? 'open') === 'all' || i.data.status === (status ?? 'open'))
        .filter((i) => !source || source === 'all' || i.data.source === source)
        .map(ideaSummary)
        .map(({ brief: _b, ...row }) => row)
    )
  )

  server.registerTool(
    'get_story',
    { description: 'One story with its whole brief (premise, plot, characters, setting, style, extra sections).', inputSchema: { story: z.string().describe('Story slug') }, annotations: READ },
    run(async ({ story }: { story: string }) => ideaSummary(await needStory(story)))
  )

  server.registerTool(
    'list_topics',
    { description: 'The topics the factory writes about, with how many books each wants and has.', inputSchema: { active: z.boolean().optional().describe('Only switched-on (true) or switched-off (false) topics') }, annotations: READ },
    run(async ({ active }: { active?: boolean }) => (await topics()).filter((t) => active === undefined || t.active === active).map(topicSummary))
  )

  server.registerTool('list_agents', { description: 'The agents (staff): role, model, state, current task and book, assigned book.', annotations: READ }, run(async () => allAgents()))

  server.registerTool(
    'list_models',
    { description: 'The models the pickers offer (provider/model refs, prices, context) and the default model of each role.', annotations: READ },
    run(async () => ({ models: modelSummaries(engine.registry).filter((m) => m.shown), roleDefaults: roleDefaults(engine.registry) }))
  )

  // ---- stories ----
  server.registerTool(
    'add_story',
    {
      description:
        'Give the factory a story to turn into a book. Needs at least a title or some text. The editor-in-chief keeps your title, characters, plot and setting, and the writers follow them. Returns the story slug.',
      inputSchema: {
        title: z.string().optional().describe('The book title. When set, the book keeps it'),
        premise: z.string().optional().describe('What the story is about'),
        plot: z.string().optional().describe('Plot points, in any detail you like'),
        characters: z.array(characterSchema).optional(),
        setting: z.string().optional(),
        style: z.string().optional().describe('Voice, tone, point of view'),
        sections: z.array(sectionSchema).optional().describe('Any extra headed text (themes, rules of the world, ...)'),
        format: z.string().optional().describe('A format id from config/formats.md. Empty: the editor-in-chief picks. "article" or "feature-article" writes a researched newspaper article (use a topic of kind article, e.g. news-technology; the title is the headline, the premise the subject and angle): it has no cover and no EPUB and appears in list_articles'),
        topic: z.string().optional().describe('A topic id from list_topics. A newspaper section (kind article) only takes article formats, and article formats only take a newspaper section'),
        genre: z.string().optional(),
        series: z.string().optional().describe('A series slug from list_series: the book continues that series (its premise, cast and earlier books go to the writers) and starts only when the books before it are published. series_index is set to the next free number'),
        humanize: z.boolean().optional().describe('false: the humanizer does not rewrite the chapters of this book (default: it does, when the format allows it and a humanizer is hired)'),
        puzzles: z
          .array(puzzleEntrySchema)
          .optional()
          .describe('A mystery with puzzles (format "mystery-puzzle-visual-novel"): the puzzles, each as VN Studio makes them (vno_puzzle_generate): {key, kind: "murdle", title?, core (the whole core), names (item id -> name in the story), text (clue id and "murder" -> the canonical sentence)}; for a testimony also {testimony: {witness, breaks: [{statement, evidence}], evidence: [{key, description}]}}. Scriptorium keeps them as bible/puzzles.md, the outline places each in a chapter and the writers plant the clues (docs/visual-novel.md "Puzzles")'),
        models: modelsSchema.optional().describe('Models for this book only, role -> provider/model, e.g. {"writer": "client/claude-code"}. Its jobs of that role use it first; any agent of the role takes them')
      }
    },
    run(
      async (a: { title?: string; premise?: string; plot?: string; characters?: z.infer<typeof characterSchema>[]; setting?: string; style?: string; sections?: z.infer<typeof sectionSchema>[]; format?: string; topic?: string; genre?: string; series?: string; humanize?: boolean; puzzles?: PuzzleEntry[]; models?: Record<string, string> }) => {
        checkFormat(a.format)
        await checkTopic(a.topic)
        await checkSeries(a.series)
        checkRoleModels(a.models)
        const brief: StoryBrief = {
          ...emptyBrief(),
          title: a.title?.trim() ?? '',
          premise: a.premise ?? '',
          plot: a.plot ?? '',
          characters: (a.characters ?? []).filter((c) => c.name.trim()).map(toCharacter),
          setting: a.setting ?? '',
          style: a.style ?? '',
          sections: a.sections ?? [],
          ...(a.format ? { format: a.format } : {}),
          ...(a.topic ? { topic: a.topic } : {}),
          ...(a.genre ? { genre: a.genre } : {}),
          ...(a.series ? { series: a.series } : {}),
          ...(a.humanize === false ? { humanize: false } : {}),
          ...(a.puzzles?.length ? { puzzles: a.puzzles } : {}),
          ...(a.models && Object.keys(a.models).length ? { models: a.models } : {})
        }
        const idea = await engine.addStory(brief).catch((err: Error) => fail(err.message))
        return { slug: idea.slug, file: `ideas/${idea.slug}.md`, story: ideaSummary(idea) }
      }
    )
  )

  server.registerTool(
    'adapt_book',
    {
      description:
        'The script writer: adapt a published book into a visual novel script that VN Studio can import, or into a screenplay for a short film or cartoon (get_screenplay). Creates a story with source_book set; the factory starts the book at once (it is already published), the architect compresses the book into the format chapters and maps each to the source chapters, and the writers turn those chapters into script scenes. The source must exist and be published. Returns the story slug.',
      inputSchema: {
        book: z.string().describe('Slug of the published book to adapt (list_books)'),
        format: z.string().describe('A script format id: "visual-novel" (linear) or "choice-visual-novel" (choices; the source ending stays one canon path) for VN Studio, or a screenplay format: "short-film", "cartoon" or "kids-cartoon" (the source is compressed into its runtime)'),
        title: z.string().optional().describe('Title of the script. Default: the title of the source book'),
        notes: z.string().optional().describe('Notes for the adapter: what to keep, cut or change'),
        models: modelsSchema.optional().describe('Models for this book only, role -> provider/model, e.g. {"writer": "client/claude-code"}')
      }
    },
    run(async (a: { book: string; format: string; title?: string; notes?: string; models?: Record<string, string> }) => {
      await needBook(a.book)
      checkRoleModels(a.models)
      const idea = await engine.adaptBook(a).catch((err: Error) => fail(err.message))
      return { slug: idea.slug, file: `ideas/${idea.slug}.md`, story: ideaSummary(idea) }
    })
  )

  server.registerTool(
    'update_story',
    {
      description:
        'Change a story that no book has started yet. Only the fields you give change. `characters` replaces the whole list; `add_characters` adds characters (one with a name that is already there is replaced). An empty string clears a text field.',
      inputSchema: {
        story: z.string().describe('Story slug'),
        title: z.string().optional(),
        premise: z.string().optional(),
        plot: z.string().optional(),
        characters: z.array(characterSchema).optional().describe('Replaces the character list'),
        add_characters: z.array(characterSchema).optional().describe('Adds to the list'),
        setting: z.string().optional(),
        style: z.string().optional(),
        sections: z.array(sectionSchema).optional().describe('Replaces the extra sections'),
        format: z.string().optional(),
        topic: z.string().optional(),
        genre: z.string().optional(),
        series: z.string().optional().describe('Moves the story to this series (it gets the next free series_index there); an empty string takes it out of its series'),
        humanize: z.boolean().optional().describe('false: the humanizer skips this book; true: back to the default'),
        models: modelsSchema.optional().describe('Replaces the models of this story (role -> provider/model); {} clears them')
      }
    },
    run(
      async (a: {
        story: string
        title?: string
        premise?: string
        plot?: string
        characters?: z.infer<typeof characterSchema>[]
        add_characters?: z.infer<typeof characterSchema>[]
        setting?: string
        style?: string
        sections?: z.infer<typeof sectionSchema>[]
        format?: string
        topic?: string
        genre?: string
        series?: string
        humanize?: boolean
        models?: Record<string, string>
      }) => {
        const idea = await needStory(a.story)
        if (idea.data.status !== 'open') fail(`the story "${a.story}" was already used by a book (${idea.data.book ?? 'unknown'}): add a note to that book instead (add_book_note)`)
        checkFormat(a.format)
        await checkTopic(a.topic)
        await checkSeries(a.series)
        checkRoleModels(a.models)
        const brief = briefOf(idea.data, idea.body)
        if (a.models !== undefined) {
          if (Object.keys(a.models).length) brief.models = a.models
          else delete brief.models
        }
        if (a.humanize === false) brief.humanize = false
        else if (a.humanize === true) delete brief.humanize
        if (a.title !== undefined) brief.title = a.title.trim()
        if (a.premise !== undefined) brief.premise = a.premise
        if (a.plot !== undefined) brief.plot = a.plot
        if (a.setting !== undefined) brief.setting = a.setting
        if (a.style !== undefined) brief.style = a.style
        if (a.sections !== undefined) brief.sections = a.sections
        if (a.characters !== undefined) brief.characters = a.characters.filter((c) => c.name.trim()).map(toCharacter)
        for (const c of a.add_characters ?? []) {
          if (!c.name.trim()) continue
          const next = toCharacter(c)
          const i = brief.characters.findIndex((x) => x.name.toLowerCase() === next.name.toLowerCase())
          if (i >= 0) brief.characters[i] = next
          else brief.characters.push(next)
        }
        for (const k of ['format', 'topic', 'genre', 'series'] as const) {
          if (a[k] === undefined) continue
          if (a[k]!.trim()) brief[k] = a[k]!.trim()
          else delete brief[k]
        }
        const updated = await engine.updateStory(a.story, brief).catch((err: Error) => fail(err.message))
        return { slug: updated.slug, file: `ideas/${updated.slug}.md`, story: ideaSummary(updated) }
      }
    )
  )

  // ---- series ----
  server.registerTool(
    'list_series',
    { description: 'List the series (books that continue each other, with shared characters and canon), one compact row each with its books in order.', annotations: READ },
    run(async () => {
      const [all, refs, ideas] = [await engine.series.list(), await bookRefs(engine.books), await engine.ideas.list()]
      return all.map((s) => ({ slug: s.slug, title: s.title, genre: s.data.genre ?? null, format: s.data.format ?? null, books: seriesMembers(s.slug, refs, ideas).map(({ slug, title, index, kind, stage, score }) => ({ slug, title, index, kind, stage, score })) }))
    })
  )

  server.registerTool(
    'get_series',
    {
      description: 'One series in full: its file (premise = the series arc, recurring characters, setting, style, extra sections) and its books in order with stage and score. A story that no book has started yet is listed with kind "story".',
      inputSchema: { series: z.string().describe('Series slug') },
      annotations: READ
    },
    run(async ({ series }: { series: string }) => {
      const s = await needSeries(series)
      const row = await seriesRow(series)
      return { slug: s.slug, file: `series/${s.slug}.md`, title: s.title, genre: row.genre, format: row.format, brief: row.brief, books: row.books }
    })
  )

  const seriesBrief = (a: { title?: string; premise?: string; plot?: string; characters?: z.infer<typeof characterSchema>[]; setting?: string; style?: string; sections?: z.infer<typeof sectionSchema>[]; format?: string; genre?: string }): StoryBrief => ({
    ...emptyBrief(),
    title: a.title?.trim() ?? '',
    premise: a.premise ?? '',
    plot: a.plot ?? '',
    characters: (a.characters ?? []).filter((c) => c.name.trim()).map(toCharacter),
    setting: a.setting ?? '',
    style: a.style ?? '',
    sections: a.sections ?? [],
    ...(a.format ? { format: a.format } : {}),
    ...(a.genre ? { genre: a.genre } : {})
  })
  const seriesInput = {
    premise: z.string().optional().describe('The arc of the whole series'),
    plot: z.string().optional().describe('Where the series is going, in any detail you like'),
    characters: z.array(characterSchema).optional().describe('The recurring cast: every book gets them, and their end state is carried from book to book'),
    setting: z.string().optional(),
    style: z.string().optional().describe('Voice, tone, point of view for every book'),
    sections: z.array(sectionSchema).optional().describe('Any extra headed text (rules of the world, ...)'),
    genre: z.string().optional(),
    format: z.string().optional().describe('A format id from config/formats.md (informational for the series)')
  }

  server.registerTool(
    'add_series',
    {
      description:
        'Create a series: a title, the series arc (premise), the recurring characters, setting and style. Then add its books with add_story {series}: each gets the series and the earlier books (summaries, cast end states, open threads), and book N starts only when book N-1 is published. Returns the series slug.',
      inputSchema: { title: z.string().describe('The series title'), ...seriesInput },
      annotations: WRITE
    },
    run(async (a: { title: string; premise?: string; plot?: string; characters?: z.infer<typeof characterSchema>[]; setting?: string; style?: string; sections?: z.infer<typeof sectionSchema>[]; format?: string; genre?: string }) => {
      checkFormat(a.format)
      if (!a.title.trim()) fail('a series needs a title')
      const s = await engine.addSeries(seriesBrief(a)).catch((err: Error) => fail(err.message))
      return { slug: s.slug, file: `series/${s.slug}.md`, series: await seriesRow(s.slug) }
    })
  )

  server.registerTool(
    'update_series',
    {
      description: 'Change a series. Only the fields you give change. `characters` replaces the whole cast; `add_characters` adds characters (one with a name that is already there is replaced). An empty string clears a text field. Its books stay.',
      inputSchema: {
        series: z.string().describe('Series slug'),
        title: z.string().optional(),
        ...seriesInput,
        add_characters: z.array(characterSchema).optional().describe('Adds to the cast')
      },
      annotations: WRITE
    },
    run(
      async (a: {
        series: string
        title?: string
        premise?: string
        plot?: string
        characters?: z.infer<typeof characterSchema>[]
        add_characters?: z.infer<typeof characterSchema>[]
        setting?: string
        style?: string
        sections?: z.infer<typeof sectionSchema>[]
        format?: string
        genre?: string
      }) => {
        const s = await needSeries(a.series)
        checkFormat(a.format)
        const brief = { ...s.brief }
        if (a.title !== undefined) brief.title = a.title.trim()
        if (a.premise !== undefined) brief.premise = a.premise
        if (a.plot !== undefined) brief.plot = a.plot
        if (a.setting !== undefined) brief.setting = a.setting
        if (a.style !== undefined) brief.style = a.style
        if (a.sections !== undefined) brief.sections = a.sections
        if (a.characters !== undefined) brief.characters = a.characters.filter((c) => c.name.trim()).map(toCharacter)
        for (const c of a.add_characters ?? []) {
          if (!c.name.trim()) continue
          const next = toCharacter(c)
          const i = brief.characters.findIndex((x) => x.name.toLowerCase() === next.name.toLowerCase())
          if (i >= 0) brief.characters[i] = next
          else brief.characters.push(next)
        }
        for (const k of ['format', 'genre'] as const) {
          if (a[k] === undefined) continue
          if (a[k]!.trim()) brief[k] = a[k]!.trim()
          else delete brief[k]
        }
        const updated = await engine.updateSeries(a.series, brief).catch((err: Error) => fail(err.message))
        return { slug: updated.slug, file: `series/${updated.slug}.md`, series: await seriesRow(updated.slug) }
      }
    )
  )

  // ---- books ----
  server.registerTool(
    'add_book_note',
    {
      description: 'Add an owner note to a book: the writers follow it from the next job on. With `chapter` the note is about that written chapter; with `rewrite` as well, that chapter is rewritten with the note.',
      inputSchema: { book: z.string(), text: z.string(), chapter: z.number().int().positive().optional(), rewrite: z.boolean().optional().describe('Rewrite the chapter now (needs chapter)') },
      annotations: WRITE
    },
    run(async ({ book: slug, text: note, chapter, rewrite }: { book: string; text: string; chapter?: number; rewrite?: boolean }) => {
      await needBook(slug)
      if (!note.trim()) fail('the note is empty')
      if (rewrite && !chapter) fail('rewrite needs a chapter number')
      if (chapter && !(await engine.books.chapters(slug)).some((c) => c.n === chapter)) fail(`chapter ${chapter} of "${slug}" is not written yet`)
      await engine.handleCommand({ type: 'addBookNote', book: slug, text: note, chapter, rewrite })
      return { book: await book(slug), notes: await engine.books.ownerNotes(slug) }
    })
  )

  server.registerTool(
    'set_book_paused',
    { description: 'Pause or resume one book: its jobs wait while the agents work on the other books.', inputSchema: { book: z.string(), paused: z.boolean() }, annotations: WRITE },
    run(async ({ book: slug, paused }: { book: string; paused: boolean }) => {
      await needBook(slug)
      await engine.handleCommand({ type: 'pauseBook', book: slug, paused })
      return book(slug)
    })
  )

  server.registerTool(
    'retry_book',
    { description: 'Continue a failed book: its failed jobs go back in the queue.', inputSchema: { book: z.string() }, annotations: WRITE },
    run(async ({ book: slug }: { book: string }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.stage !== 'failed') fail(`"${slug}" is not a failed book (stage: ${b?.data.stage})`)
      await engine.handleCommand({ type: 'retryBook', book: slug })
      return book(slug)
    })
  )

  server.registerTool(
    'set_book_model',
    {
      description:
        'Set the model ONE book uses for a role (model null removes it). Its jobs of that role try this model first, before any model set on the agent, and any agent of the role may take them; the role list stays the fallback. Use it to put one book on client/claude-code without touching the others. Running jobs of the book switch at once. Works at any stage, so a model can be set on a failed or published book before retry_book or reopen_book; null always works.',
      inputSchema: { book: z.string(), role: z.string(), model: z.string().nullable().describe('A provider/model ref from list_models, or null to remove') },
      annotations: WRITE
    },
    run(async ({ book: slug, role, model }: { book: string; role: string; model: string | null }) => {
      await needBook(slug)
      needRole(role)
      if (model !== null) needModel(model)
      await engine.handleCommand({ type: 'setBookModel', book: slug, role, model })
      return book(slug)
    })
  )

  server.registerTool(
    'reopen_book',
    {
      description:
        'Give a REJECTED or PUBLISHED book one more round (retry_book is for failed books). mode "rewrite": the chapters (the ones you give, or the ones the reviews of the last round name) are rewritten, then reviewed again. A published book needs the chapters when its last reviews named none. mode "review": the book is reviewed again with no rewrite. Either way the publisher then decides again (publish or reject); the old EPUB or article page stays until it publishes again, and a reopened book that is rejected stays rejected like any other. It counts toward max_books_in_progress again. Agents assigned to the book were freed when it was rejected or published: assign them again.',
      inputSchema: {
        book: z.string(),
        mode: z.enum(['rewrite', 'review']),
        chapters: z.array(z.number().int().positive()).optional().describe('Chapter numbers to rewrite (mode rewrite). Default: the ones the reviews name')
      },
      annotations: WRITE
    },
    run(async ({ book: slug, mode, chapters }: { book: string; mode: 'rewrite' | 'review'; chapters?: number[] }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.stage !== 'rejected' && b?.data.stage !== 'published') fail(`"${slug}" is not a rejected or published book (stage: ${b?.data.stage}): only those can be reopened (retry_book is for failed ones)`)
      if (chapters?.length && mode !== 'rewrite') fail('chapters only apply to mode rewrite')
      if (chapters?.length) {
        const written = new Set((await engine.books.chapters(slug)).map((c) => c.n))
        const missing = chapters.filter((n) => !written.has(n))
        if (missing.length) fail(`chapter ${missing.join(', ')} of "${slug}" is not written`)
      }
      const error = await engine.reopenBook(slug, mode, chapters)
      if (error) fail(error)
      return book(slug)
    })
  )

  server.registerTool(
    'rate_book',
    { description: 'Give a book your rating (1 to 5) and an optional note.', inputSchema: { book: z.string(), rating: z.number().int().min(1).max(5), note: z.string().optional() }, annotations: WRITE },
    run(async ({ book: slug, rating, note }: { book: string; rating: number; note?: string }) => {
      await needBook(slug)
      await engine.handleCommand({ type: 'rate', book: slug, rating, note })
      return book(slug)
    })
  )

  server.registerTool(
    'rename_book',
    { description: 'Give a published book a new title (its slug stays). The cover, EPUB and reader are made again.', inputSchema: { book: z.string(), title: z.string() }, annotations: WRITE },
    run(async ({ book: slug, title }: { book: string; title: string }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.stage !== 'published') fail(`"${slug}" is not published (stage: ${b?.data.stage}): only published books can be renamed`)
      const clean = title.replace(/\s+/g, ' ').trim()
      if (!clean || clean.length > 200) fail('the title is empty or longer than 200 characters')
      await engine.handleCommand({ type: 'renameBook', book: slug, title: clean })
      return book(slug)
    })
  )

  server.registerTool(
    'remake_cover',
    { description: 'Draw the cover of a published book again and rebuild its EPUB.', inputSchema: { book: z.string() }, annotations: WRITE },
    run(async ({ book: slug }: { book: string }) => {
      const b = await engine.books.read(await needBook(slug))
      if (b?.data.stage !== 'published') fail(`"${slug}" is not published (stage: ${b?.data.stage})`)
      await engine.handleCommand({ type: 'regenerateCover', book: slug })
      return book(slug)
    })
  )

  // ---- client tasks: do the model work yourself ----
  server.registerTool(
    'list_client_tasks',
    {
      description: 'The model requests that wait for you: jobs whose model is a `client` one (for example client/claude-code). Oldest first, with their age. Take one with get_client_task.',
      annotations: READ
    },
    run(async () => ({ ...engine.clientQueue.counts(), tasks: engine.clientQueue.list() }))
  )

  server.registerTool(
    'get_client_task',
    {
      description:
        'Take the oldest waiting model request (optionally of one role, book or task; `role: "searcher"` takes the web searches the researcher waits for, see docs/mcp.md "Do the web research yourself") and hold it for 30 minutes. `system` holds the instructions and `user` is the turn to answer; `messages` (the conversation without the system turns) is there only when there is more than one turn, for example a repair round. Answer it with submit_client_task. Several sessions can each take one at a time. Returns {none: true, waiting} when nothing matches.',
      inputSchema: { role: z.string().optional(), book: z.string().optional().describe('Book slug'), task: z.string().optional().describe('Job task, e.g. draft_chapter, review, outline') },
      annotations: WRITE
    },
    run(async (f: { role?: string; book?: string; task?: string }) => {
      const t = engine.clientQueue.lease(f, DEFAULT_LEASE_MS)
      if (!t) return { none: true, waiting: engine.clientQueue.counts().waiting }
      // `user` is the turn to answer. A plain task (one user turn, nothing said before) has no `messages`: sending the prompt in
      // both fields put every task in the client's context twice. A repair or follow-up round has the whole conversation there.
      const turns = t.messages.filter((m) => m.role !== 'system')
      const plain = turns.length === 1 && turns[0]!.role === 'user'
      const lastUser = [...turns].reverse().find((m) => m.role === 'user') ?? turns.at(-1)
      return {
        taskId: t.id,
        meta: { job: t.job, call: t.call, role: t.role, task: t.task, book: t.book, agent: t.agent, unit: t.unit },
        system: t.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
        user: lastUser?.content ?? '',
        ...(plain ? {} : { messages: turns.map((m) => ({ role: m.role, content: m.content })) }),
        ...(t.schema ? { schema: t.schema } : {}),
        ...(t.maxTokens ? { maxTokens: t.maxTokens } : {}),
        output:
          t.task === 'web_search'
            ? 'This is a web search: do it yourself with your own web search and fetch tools, read the pages, and prefer primary, official and recent sources. Reply with one JSON object that matches `schema`: {results: [{title, url, content, published?}]}, where content is a verbatim excerpt of the page (at most 1500 characters) and url is a page you really read. Never invent a URL. An empty results list is fine when you find nothing. No prose, no code fence.'
            : t.schema
              ? 'Reply with one JSON object that matches `schema`. No prose, no code fence.'
              : 'Reply with the text only: no preamble, no notes, no code fence.',
        leaseMinutes: DEFAULT_LEASE_MS / 60_000
      }
    })
  )

  server.registerTool(
    'submit_client_task',
    {
      description:
        'Answer a task you took with get_client_task. When the task has a schema, the text is checked first: a bad answer comes back as {accepted: false, problems} and the task stays yours, so fix it and submit again. A task that is gone (aborted, answered, or the engine restarted) is refused.',
      inputSchema: { taskId: z.string(), text: z.string() },
      annotations: WRITE
    },
    run(async ({ taskId, text: answer }: { taskId: string; text: string }) => engine.clientQueue.submit(taskId, answer))
  )

  server.registerTool(
    'release_client_task',
    { description: 'Give a task you took back, so it waits for the next get_client_task.', inputSchema: { taskId: z.string() }, annotations: WRITE },
    run(async ({ taskId }: { taskId: string }) => ({ released: engine.clientQueue.release(taskId) }))
  )

  // ---- factory ----
  server.registerTool(
    'set_factory_paused',
    { description: 'Pause or resume the whole factory. While paused no new jobs start (running ones finish).', inputSchema: { paused: z.boolean() }, annotations: WRITE },
    run(async ({ paused }: { paused: boolean }) => {
      await engine.handleCommand({ type: paused ? 'pauseAll' : 'resumeAll' })
      return { paused: engine.factory.paused }
    })
  )

  server.registerTool(
    'ask_researcher',
    {
      description: 'Ask the researcher a question. The answer is written to the research notes: the book notes when `book` is given, else the shared notes.',
      inputSchema: { question: z.string(), book: z.string().optional().describe('Book slug the question is for') },
      annotations: WRITE
    },
    run(async ({ question, book: slug }: { question: string; book?: string }) => {
      if (!question.trim()) fail('the question is empty')
      if (slug) await needBook(slug)
      await engine.handleCommand({ type: 'askResearcher', question, book: slug })
      return { asked: true, for: slug ?? 'the shared notes' }
    })
  )

  server.registerTool(
    'add_topic',
    {
      description: `Add a topic to "My topics": the factory then writes books about it. kind is one of ${TOPIC_KINDS.join(', ')}. target is how many books are wanted (empty: no limit).`,
      inputSchema: { name: z.string(), kind: z.enum(TOPIC_KINDS as [string, ...string[]]), target: z.number().int().nonnegative().optional() },
      annotations: WRITE
    },
    run(async ({ name, kind, target }: { name: string; kind: string; target?: number }) => {
      if (!name.trim()) fail('the topic name is empty')
      const before = new Set((await topics()).map((t) => t.id))
      await engine.handleCommand({ type: 'addTopic', name, kind, target })
      const added = (await topics()).filter((t) => !before.has(t.id))
      if (!added.length) fail('the topic was not added')
      return added.map(topicSummary)
    })
  )

  server.registerTool(
    'set_topic_active',
    { description: 'Switch a topic on or off.', inputSchema: { id: z.string(), active: z.boolean() }, annotations: WRITE },
    run(async ({ id, active }: { id: string; active: boolean }) => {
      if (!(await topics()).some((t) => t.id === id)) fail(`unknown topic "${id}" (list_topics shows the ids)`)
      await engine.handleCommand({ type: 'setTopicActive', id, active })
      return (await topics()).filter((t) => t.id === id).map(topicSummary)
    })
  )

  server.registerTool(
    'check_servers',
    { description: 'Ask the local model servers (Strata, LM Studio) how many requests they take at once, now. Use it after starting one.', annotations: WRITE },
    run(async () => {
      await engine.handleCommand({ type: 'checkServers' })
      return serverStatuses(engine.registry)
    })
  )

  // ---- agents ----
  server.registerTool(
    'hire_agent',
    {
      description: `Hire an agent. role is one of ${ROLES.join(', ')} (or a role defined in config/roles.md). name and model (a provider/model ref from list_models) are optional.`,
      inputSchema: { role: z.string(), name: z.string().optional(), model: z.string().optional() },
      annotations: WRITE
    },
    run(async ({ role, name, model }: { role: string; name?: string; model?: string }) => {
      if (!(ROLES as readonly string[]).includes(role) && !(role in engine.registry.roles.roles)) fail(`unknown role "${role}"`)
      if (model && !engine.registry.getModel(model)) fail(`unknown model "${model}" (list_models shows the refs)`)
      const before = new Set(engine.agents.list().map((a) => a.id))
      await engine.handleCommand({ type: 'hire', role, name, model })
      const hired = engine.agents.list().filter((a) => !before.has(a.id))
      if (!hired.length) fail('nobody was hired')
      return hired.map((a) => agentSummary(a, engine.scheduler, engine.router))
    })
  )

  server.registerTool(
    'fire_agent',
    { description: 'Fire an agent. It finishes its current job first, unless `now` is true.', inputSchema: { agent: z.string(), now: z.boolean().optional() }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
    run(async ({ agent: id, now }: { agent: string; now?: boolean }) => {
      needAgent(id)
      await engine.handleCommand({ type: 'fire', agent: id, now })
      return agent(id) ?? { fired: id }
    })
  )

  server.registerTool(
    'set_agent_paused',
    { description: 'Pause or resume one agent.', inputSchema: { agent: z.string(), paused: z.boolean() }, annotations: WRITE },
    run(async ({ agent: id, paused }: { agent: string; paused: boolean }) => {
      needAgent(id)
      await engine.handleCommand({ type: paused ? 'pause' : 'resume', agent: id })
      return agent(id)
    })
  )

  server.registerTool(
    'assign_agent',
    {
      description:
        'Assign an agent to one book in progress (it then only takes that book\'s jobs; a writer becomes the book\'s writer), or free it with book null. exclusive: only the agents assigned to this book (exclusively) take its jobs, and a job waits for them even while they are busy or paused; without it the assigned agent prefers the book and the other agents of the role still help.',
      inputSchema: { agent: z.string(), book: z.string().nullable(), exclusive: z.boolean().optional().describe('Only the agents assigned this way work on the book') },
      annotations: WRITE
    },
    run(async ({ agent: id, book: slug, exclusive }: { agent: string; book: string | null; exclusive?: boolean }) => {
      needAgent(id)
      if (slug !== null) {
        const b = await engine.books.read(await needBook(slug))
        if (!b || TERMINAL_BOOK_STAGES.has(b.data.stage)) fail(`"${slug}" is not a book in progress (stage: ${b?.data.stage})`)
      }
      await engine.handleCommand({ type: 'assignBook', agent: id, book: slug, exclusive })
      return agent(id)
    })
  )

  server.registerTool(
    'set_model',
    {
      description: 'Set the model of one agent (`agent`; model null clears its override), or the default model of a role (`role`, a model is needed). Give exactly one of agent and role. Models are provider/model refs from list_models.',
      inputSchema: { model: z.string().nullable(), agent: z.string().optional(), role: z.string().optional() },
      annotations: WRITE
    },
    run(async ({ model, agent: id, role }: { model: string | null; agent?: string; role?: string }) => {
      if (!!id === !!role) fail('give exactly one of agent and role')
      if (model !== null && !engine.registry.getModel(model)) fail(`unknown model "${model}" (list_models shows the refs)`)
      if (id) {
        needAgent(id)
        await engine.handleCommand({ type: 'setModel', model, agent: id })
        return agent(id)
      }
      if (model === null) fail('a role default needs a model')
      if (!(role! in engine.registry.roles.roles) && !(ROLES as readonly string[]).includes(role!)) fail(`unknown role "${role}"`)
      await engine.handleCommand({ type: 'setModel', model, role })
      return { role, default: roleDefaults(engine.registry)[role!] ?? null }
    })
  )
}

/** The bible of a book: bible/bible.md of a light book, else every file under bible/ (a long book) one after the other. */
async function readBible(dir: string): Promise<string | null> {
  const single = await fs.readFile(path.join(dir, 'bible.md'), 'utf8').catch(() => null)
  if (single !== null) return single
  const parts: string[] = []
  const walk = async (d: string) => {
    const entries = (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.md')) parts.push(`<!-- ${path.relative(dir, p).split(path.sep).join('/')} -->\n${(await fs.readFile(p, 'utf8')).trim()}`)
    }
  }
  await walk(dir)
  return parts.length ? parts.join('\n\n') : null
}

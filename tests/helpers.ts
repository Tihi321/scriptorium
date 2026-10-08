import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Engine } from '../src/engine/engine'
import type { EngineOptions } from '../src/engine/engine'
import { MockProvider } from '../src/engine/models/mock'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { writeMd } from '../src/engine/store/atomic'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { ROLES } from '../src/shared/schemas'
import { dimensionsFor } from '../src/engine/pipeline/scoring'

export const seedDir = path.resolve(__dirname, '../seed')

export interface TestProvider {
  id: string
  local?: boolean
  concurrency?: number
  /** USD per 1M tokens. Default 0. */
  price?: number
  family?: string
  models?: string[]
}

export interface EnvOptions {
  providers?: TestProvider[]
  /** role -> `provider/model` refs */
  roles?: Record<string, string[]>
  caps?: { monthly?: number; daily?: number; perBook?: number | null }
  agents?: { role: string; name: string; model?: string | null; maxParallel?: number; paused?: boolean; focus?: string[]; pin?: string | null }[]
  paused?: boolean
}

/** Writes providers, roles, budget, factory and agent files for a mock-only data folder. */
export async function writeTestConfig(dir: string, o: EnvOptions): Promise<void> {
  const providers = o.providers ?? [{ id: 'loc', local: true, concurrency: 4, models: ['m1'] }]
  await writeMd(
    path.join(dir, 'config', 'providers.md'),
    {
      kind: 'providers',
      providers: providers.map((p) => ({
        id: p.id,
        kind: 'mock',
        local: p.local ?? false,
        concurrency: p.concurrency ?? 4,
        models: (p.models ?? ['m1']).map((m) => ({
          id: m,
          family: p.family ?? p.id,
          price_in: p.price ?? 0,
          price_out: p.price ?? 0
        }))
      }))
    },
    'test providers\n'
  )
  const roles = o.roles ?? {}
  await writeMd(
    path.join(dir, 'config', 'roles.md'),
    { kind: 'roles', roles: Object.fromEntries(Object.entries(roles).map(([r, models]) => [r, { models }])) },
    'test roles\n'
  )
  await writeMd(
    path.join(dir, 'config', 'budget.md'),
    {
      kind: 'budget',
      monthly_cap_usd: o.caps?.monthly ?? 40,
      daily_cap_usd: o.caps?.daily ?? 5,
      per_book_cap_usd: o.caps?.perBook ?? null,
      warn_at: 0.8
    },
    '# Budget\n\nhand written text\n'
  )
  await writeMd(path.join(dir, 'config', 'factory.md'), { kind: 'factory', paused: o.paused ?? false, max_attempts: 3 }, 'factory\n')
  for (const a of o.agents ?? []) {
    const id = `${a.role}-${a.name.toLowerCase().replace(/\W+/g, '-')}`
    await writeMd(
      path.join(dir, 'agents', `${id}.md`),
      { kind: 'agent', role: a.role, name: a.name, model: a.model ?? null, focus: a.focus ?? [], pin: a.pin ?? null, max_parallel: a.maxParallel ?? 1, paused: a.paused ?? false },
      `Persona of ${a.name}.\n`
    )
  }
}

export interface TestEnv {
  dir: string
  engine: Engine
  mock: MockProvider
  events: EngineEvent[]
  logs: string[]
  cleanup(): Promise<void>
}

/** A temp data folder with mock providers and a started engine. */
export async function makeEnv(o: EnvOptions = {}, engineOpts: Partial<EngineOptions> = {}): Promise<TestEnv> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-engine-'))
  await initDataFolder(dir, seedDir)
  await rm(path.join(dir, 'agents'), { recursive: true, force: true }) // tests bring their own staff
  await mkdir(path.join(dir, 'agents'), { recursive: true })
  await writeTestConfig(dir, o)
  const events: EngineEvent[] = []
  const logs: string[] = []
  const mock = new MockProvider('mock', { chunkDelayMs: 5 })
  const engine = new Engine({
    dataDir: dir,
    emit: (e) => events.push(e),
    log: (m) => logs.push(m),
    registry: { mock },
    router: { backoffMs: 1, retries: 1 },
    pollMs: 40,
    discover: false,
    ...engineOpts
  })
  await engine.start()
  return {
    dir,
    engine,
    mock,
    events,
    logs,
    async cleanup() {
      await engine.stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }
}

export async function waitFor<T>(fn: () => T | Promise<T>, ms = 8000, label = 'condition'): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The research and per-chapter score fields of a BookState for the pure `advance` tests: nothing asked, nothing pending. */
export const quietResearchState = () => ({
  chapterScores: new Map<number, { continuity?: number; tension?: number }>(),
  flatChapters: [] as number[],
  researchPlan: { jobs: [] as string[] } as { jobs: string[] } | null,
  researchPending: new Set<string>(),
  prepEnabled: false,
  prep: new Map<number, string[]>(),
  markers: new Map<number, string[]>(),
  reviewResearch: new Map<number, string[]>(),
  checkResearch: new Map<number, string[]>()
})

// ---- pipeline tests ----

export interface PipelineEnvOptions {
  /** Topic ids to switch on. */
  activate?: string[]
  coverRenderer?: boolean
  maxBooks?: number
  lowWater?: number
  /** Reviewers say `revise` in these rounds: role -> rounds. */
  revise?: Record<string, number[]>
  /** Replace the seed novel with a small long format for tests (6 chapters, 3 acts). */
  smallNovel?: boolean
  /** The continuity checker asks for a fix of these chapters (once). */
  checkRevise?: number[]
  /** A second archivist, so memory jobs of different books can run side by side. */
  extraArchivist?: boolean
  /** The mock writer's first drafts are far too short (60 words); rewrites have the right length. */
  shortDrafts?: boolean
  /** Format the mock editor-in-chief picks. */
  format?: string
  /** Which topics.md edits to make before the engine starts. */
  beforeStart?: (dir: string) => Promise<void>
  /** The architect's "needs research?" answer: these questions (default none). */
  researchPlan?: string[]
  /** Questions the writer's prep step asks before chapter n. */
  prep?: Record<number, string[]>
  /** [RESEARCH: ...] markers the mock writer puts into the first draft of chapter n. */
  markers?: Record<number, string[]>
  /** `research_questions` a reviewer adds in round 0: role -> questions. */
  reviewQuestions?: Record<string, string[]>
  /** `research_questions` of the continuity check of chapter n (long books). */
  checkQuestions?: Record<number, string[]>
  /** Chapters a reviewer names when it says revise: role -> chapters. */
  reviewChapters?: Record<string, number[]>
  /** A second story thread that nothing closes. */
  extraThread?: boolean
  /** Share of the asked length the mock writer delivers in a first draft (an expand request gets the full length). Default 1. */
  draftRatio?: number
  /** Tension per chapter from the mock developmental editor. Default 3 + position in the act. */
  tension?: Record<number, number>
  /** Per-chapter continuity score of the mock checker. Default 9. */
  continuity?: Record<number, number>
  /** Threads (ids) the mock thread check reports as resolved. Default none. */
  threadResolved?: string[]
  /** The pages the fake search returns. Default: two pages about a sea passage. `[]` = the search finds nothing. */
  pages?: { url: string; title: string; content: string; /** The search result carries the page text (like Tavily and Wikipedia); otherwise the page is fetched. */ inline?: boolean }[]
  /** The pages the fake search returns for a query (instead of `pages`). */
  pagesFor?: (query: string) => { url: string; title: string; content: string; inline?: boolean }[]
  /** The search words the mock researcher suggests when the first pages answer nothing. */
  searchQueries?: string[]
  /** What the fake search charges per request (USD). Default 0.005. */
  searchPrice?: number
  /** Settings for config/factory.md. */
  factory?: Record<string, unknown>
  /** Non-fiction: the mock writer cites source number [1] in its chapters. */
  citations?: boolean
  /** Non-fiction: claims the mock fact-checker sends back in a round (the verdict is revise): round -> claims. */
  factClaims?: Record<number, { chapter: number; claim: string; problem?: string }[]>
}

/** A data folder with the real seed (staff, prompts, formats, topics) but mock models. */
export interface PipelineCounters {
  calls: Record<string, number>
  /** Queries the fake search provider got, and the URLs the fake page fetch got. */
  searches: string[]
  fetches: string[]
}

export async function makePipelineEnv(o: PipelineEnvOptions = {}, engineOpts: Partial<EngineOptions> = {}): Promise<TestEnv & { times: number[]; counters: PipelineCounters }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-pipeline-'))
  await initDataFolder(dir, seedDir)
  const writerRoles = ['writer', 'architect', 'editor-in-chief', 'idea-generator', 'publisher']
  await writeMd(
    path.join(dir, 'config', 'providers.md'),
    {
      kind: 'providers',
      providers: [
        { id: 'w', kind: 'mock', local: true, concurrency: 8, models: [{ id: 'writer-model', family: 'wfam' }, { id: 'embed', family: 'embed', embedding: true }] },
        { id: 'r', kind: 'mock', local: true, concurrency: 8, models: [{ id: 'review-model', family: 'rfam' }] }
      ]
    },
    'test providers\n'
  )
  await writeMd(
    path.join(dir, 'config', 'roles.md'),
    {
      kind: 'roles',
      embeddings: 'w/embed',
      roles: Object.fromEntries(ROLES.map((r) => [r, { models: [writerRoles.includes(r) ? 'w/writer-model' : 'r/review-model'] }]))
    },
    'test roles\n'
  )
  await writeMd(path.join(dir, 'config', 'factory.md'), { kind: 'factory', paused: false, max_books_in_progress: o.maxBooks ?? 1, idea_low_water_mark: o.lowWater ?? 2, max_attempts: 2, ...o.factory }, 'factory\n')
  const { TopicsFile } = await import('../src/engine/store/topics')
  const topics = new TopicsFile(dir)
  for (const id of o.activate ?? []) if (!(await topics.setActive(id, true))) throw new Error(`unknown topic ${id}`)
  if (o.smallNovel) {
    const file = path.join(dir, 'config', 'formats.md')
    const doc = parseMd(await readFile(file, 'utf8'))
    const formats = (doc.data.formats as { id: string }[]).map((f) =>
      f.id === 'novel' ? { ...f, words: [1200, 4000], chapters: [6, 6], long: true, max_rounds: 1, enabled: true } : f
    )
    await writeMd(file, { ...doc.data, formats }, doc.body)
  }
  if (o.extraArchivist) {
    const text = await readFile(path.join(dir, 'agents', 'archivist-milo-grant.md'), 'utf8')
    await writeFile(path.join(dir, 'agents', 'archivist-second-hand.md'), text.replace('name: Milo Grant', 'name: Second Hand'))
  }
  await o.beforeStart?.(dir)

  const events: EngineEvent[] = []
  const times: number[] = []
  const logs: string[] = []
  const mock = new MockProvider('mock', { chunkDelayMs: 1, chunks: 3 })
  const counters: PipelineCounters = { calls: {}, searches: [], fetches: [] }
  scriptMock(mock, o, counters)
  const pages = o.pages ?? [
    { url: 'https://example.test/sea-routes', title: 'Sea routes', content: 'The passage from Lisbon to Goa took about six months in the early 1600s, sailing with the monsoon winds around the Cape of Good Hope. '.repeat(3) },
    { url: 'https://example.test/crews', title: 'Ship crews', content: 'A Portuguese carrack carried several hundred people, sailors, soldiers and passengers, and many fell ill with scurvy on the way. '.repeat(3) }
  ]
  const known = new Map<string, { url: string; content: string }>()
  const fakeSearch = {
    id: 'fakesearch',
    pricePerRequest: o.searchPrice ?? 0.005,
    search: async (query: string) => {
      counters.searches.push(query)
      const list = o.pagesFor ? o.pagesFor(query) : pages
      for (const p of list) known.set(p.url, p)
      return list.map((p) => ({ title: p.title, url: p.url, snippet: p.content.slice(0, 80), content: p.inline ? p.content : (undefined as string | undefined) }))
    }
  }
  const engine = new Engine({
    dataDir: dir,
    emit: (e) => {
      events.push(e)
      times.push(Date.now())
    },
    log: (m) => logs.push(m),
    registry: { mock },
    router: { backoffMs: 1, retries: 0 },
    pollMs: 30,
    tickMs: 100,
    discover: false,
    coverRenderer: o.coverRenderer,
    search: {
      providers: [fakeSearch],
      fetchPage: async (url: string) => {
        counters.fetches.push(url)
        const page = known.get(url) ?? pages.find((p) => p.url === url)
        if (!page) throw new Error(`no such page ${url}`)
        return page.content
      }
    },
    ...engineOpts
  })
  await engine.start()
  return {
    dir,
    engine,
    mock,
    events,
    times,
    logs,
    counters,
    async cleanup() {
      await engine.stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }
}

const lastUser = (req: { messages: { role: string; content: string }[] }) => req.messages.filter((m) => m.role === 'user').pop()!.content

function scriptMock(mock: MockProvider, o: PipelineEnvOptions, counters: { calls: Record<string, number> }): void {
  let ideaN = 0
  let bookN = 0
  const bump = (k: string) => (counters.calls[k] = (counters.calls[k] ?? 0) + 1)
  const prose = (n: number) => Array.from({ length: n }, (_, i) => ['The', 'little', 'fox', 'yawned', 'and', 'curled', 'up', 'in', 'the', 'warm', 'hay.'][i % 11]).join(' ')
  const wantWords = (req: { messages: { role: string; content: string }[] }, fallback: number) => {
    const t = lastUser(req)
    const m = /Rewrite this chapter to about (\d+) words/.exec(t) ?? /Expand this chapter to about (\d+) words/.exec(t) ?? /chapter should be about (\d+) words/.exec(t) ?? /Keep the chapter at about (\d+) words/.exec(t)
    return m ? Number(m[1]) : fallback
  }
  mock.on({ task: 'generate_ideas' }, (req) => {
    bump('generate_ideas')
    const ids = [...lastUser(req).matchAll(/^- ([\w-]+): /gm)].map((m) => m[1]!)
    return JSON.stringify({ ideas: [0, 1, 2].map((i) => ({ title: `Generated Idea ${++ideaN}`, topic: ids[i % ids.length], pitch: 'A small animal finds a quiet way to fall asleep.' })) })
  })
  mock.on({ task: 'start_book' }, (req) => {
    bump('start_book')
    const formats = [...lastUser(req).matchAll(/^- ([\w-]+): /gm)].map((m) => m[1]!)
    const format = o.format && formats.includes(o.format) ? o.format : formats[0]
    return JSON.stringify({ format, title: `The Sleepy Fox ${++bookN}`, genre: 'Bedtime story', target_words: 600, notes: 'Keep it gentle.' })
  })
  mock.on({ task: 'pitch' }, () => (bump('pitch'), 'A fox cannot sleep until the moon sings. Logline: a fox, a moon, a hay bed. The ending is a yawn and a hug. '.repeat(2)))
  mock.on({ task: 'outline' }, (req) => {
    bump('outline')
    const text = lastUser(req)
    const id = /Format id: ([\w-]+)/.exec(text)?.[1] ?? ''
    const [min] = (/Number of chapters: (\d+) to (\d+)/.exec(text) ?? []).slice(1).map(Number)
    const n = id.startsWith('bedtime') ? 1 : (min ?? 3)
    return JSON.stringify({
      chapters: Array.from({ length: n }, (_, i) => ({ title: `Part ${i + 1}`, summary: `Fox does thing number ${i + 1} and learns something kind.` })),
      characters: [{ name: 'Fox', description: 'soft-spoken and sleepy', voice: 'whispers, short sentences' }],
      places: [{ name: 'Hay Barn', description: 'warm and dim' }],
      threads: o.extraThread ? ['Who left the lantern in the barn?', 'What is the fox hiding?'] : ['Who left the lantern in the barn?'],
      setting: 'a hay barn at night',
      style: 'gentle and rhythmic'
    })
  })
  const cite = o.citations ? ' The facts above come from the notes [1].' : ''
  mock.on({ task: 'draft_chapter' }, (req) => {
    bump('draft_chapter')
    // the expand retry is a second request in the same job: its last message asks for the full length
    const expand = /Expand this chapter to about/.test(lastUser(req))
    const n = Number(/Now write chapter (\d+):/.exec(req.messages[1]?.content ?? '')?.[1] ?? 0)
    const words = o.shortDrafts ? 60 : Math.round(wantWords(req, 100) * (expand ? 1 : (o.draftRatio ?? 1)))
    const marks = expand ? '' : (o.markers?.[n] ?? []).map((q) => ` [RESEARCH: ${q}]`).join('')
    return prose(words) + cite + marks
  })
  mock.on({ task: 'rewrite_chapter' }, (req) => (bump('rewrite_chapter'), prose(wantWords(req, 100)) + cite))
  mock.on({ task: 'review' }, (req) => {
    const role = req.meta!.role!
    bump(`review:${role}`)
    const round = Number(/review round (\d+)/.exec(lastUser(req))?.[1] ?? 0)
    const revise = o.revise?.[role]?.includes(round) ?? false
    return JSON.stringify({
      verdict: revise ? 'revise' : 'pass',
      scores: Object.fromEntries(dimensionsFor(role).map((d) => [d, revise ? 5 : 8])),
      notes: revise ? `Please soften the ending (${role}).` : `Looks good (${role}).`,
      chapters: revise ? (o.reviewChapters?.[role] ?? []) : [],
      research_questions: round === 0 ? (o.reviewQuestions?.[role] ?? []) : []
    })
  })
  // ---- non-fiction: the archivist's key facts and the fact-checker ----
  mock.on({ task: 'factbase_update' }, (req) => {
    bump('factbase_update')
    const lines = [...lastUser(req).matchAll(/^- (.+?)\s*\[(\d+)\]\s*$/gm)]
    return JSON.stringify({ facts: lines.slice(0, 6).map((m) => ({ fact: m[1], sources: [Number(m[2])] })), terms: [{ term: 'Movable type', definition: 'Separate metal letters that can be set in rows and reused.' }] })
  })
  mock.on({ task: 'fact_check' }, (req) => {
    bump('fact_check')
    const round = Number(/review round (\d+)/.exec(lastUser(req))?.[1] ?? 0)
    const claims = o.factClaims?.[round] ?? []
    return JSON.stringify({
      verdict: claims.length ? 'revise' : 'pass',
      scores: { accuracy: claims.length ? 5 : 9 },
      notes: claims.length ? 'Some claims have no source.' : 'Every claim is sourced.',
      claims: claims.map((c) => ({ ...c, problem: c.problem ?? 'unsourced', detail: 'no source number' })),
      research_questions: []
    })
  })
  const checked = new Set<number>()
  mock.on({ task: 'review_outline' }, () => (bump('review_outline'), JSON.stringify({ verdict: 'pass', scores: { structure: 8 }, notes: 'The outline works.', chapters: [] })))
  mock.on({ task: 'check_chapter' }, (req) => {
    bump('check_chapter')
    const n = Number(/Chapter (\d+):/.exec(lastUser(req))?.[1] ?? 0)
    const first = !checked.has(n)
    checked.add(n)
    const revise = first && (o.checkRevise ?? []).includes(n)
    return JSON.stringify({
      verdict: revise ? 'revise' : 'pass',
      scores: { continuity: revise ? 5 : (o.continuity?.[n] ?? 9) },
      notes: revise ? `The fox has the wrong coat in chapter ${n}.` : 'Consistent.',
      chapters: [],
      research_questions: first ? (o.checkQuestions?.[n] ?? []) : []
    })
  })
  mock.on({ task: 'memory_update' }, (req) => {
    bump('memory_update')
    const t = lastUser(req)
    const n = Number(/Chapter (\d+):/.exec(t)?.[1] ?? 0)
    const hasT1 = /^t1: /m.test(t)
    return {
      text: JSON.stringify({
        summary: `In chapter ${n} the fox does thing number ${n} and learns something kind.`,
        characters: [{ name: 'Fox', update: `Learned a lesson in chapter ${n}.`, description: '' }],
        places: [],
        threads_opened: [],
        threads_closed: n >= 5 && hasT1 ? ['t1'] : [],
        timeline: [`Event of chapter ${n}`]
      }),
      chunkDelayMs: 15
    }
  })
  mock.on({ task: 'act_summary' }, () => (bump('act_summary'), { text: 'In this act the fox sets out, meets friends and learns something kind about the barn.', chunkDelayMs: 15 }))
  mock.on({ task: 'act_review' }, (req) => {
    bump('act_review')
    const m = /chapters (\d+)-(\d+)/.exec(lastUser(req))
    const [a, b] = [Number(m?.[1] ?? 1), Number(m?.[2] ?? 1)]
    return JSON.stringify({
      verdict: 'pass',
      scores: { structure: 8 },
      notes: 'Good pace. Raise the stakes a little in the next act.',
      chapters: [],
      tension: Array.from({ length: b - a + 1 }, (_, i) => ({ chapter: a + i, score: o.tension?.[a + i] ?? 3 + i }))
    })
  })
  mock.on({ task: 'thread_check' }, () => (bump('thread_check'), JSON.stringify({ verdict: 'pass', scores: { threads: 9 }, notes: 'Mostly closed.', chapters: [], resolved: o.threadResolved ?? [] })))
  // ---- research ----
  mock.on({ task: 'research_plan' }, () => (bump('research_plan'), JSON.stringify({ needs_research: (o.researchPlan ?? []).length > 0, questions: o.researchPlan ?? [] })))
  mock.on({ task: 'research_prep' }, (req) => {
    bump('research_prep')
    const n = Number(/chapter (\d+) of \d+/.exec(lastUser(req))?.[1] ?? 0)
    return JSON.stringify({ questions: o.prep?.[n] ?? [] })
  })
  mock.on({ task: 'research_fix' }, (req) => {
    bump('research_fix')
    const items = [...lastUser(req).matchAll(/^Marker (\d+): (.*)\n[\s\S]*?(?=\n\nMarker \d+:|\n\nRules:|(?![\s\S]))/gm)]
    return JSON.stringify({
      fixes: items.map((m) => ({ marker: Number(m[1]), sentence: /Research notes:/.test(m[0]) ? `Corrected with the notes: ${m[2]!.replace(/[?]/g, '')}.` : `Corrected without notes: ${m[2]!.replace(/[?]/g, '')}.` }))
    })
  })
  mock.on({ task: 'research' }, (req) => {
    const t = lastUser(req)
    if (/Decide whether the notes already answer/.test(t)) {
      bump('research:check')
      return JSON.stringify({ covered: false, missing: 'the exact figure' })
    }
    if (/Suggest up to two new searches/.test(t)) {
      bump('research:queries')
      return JSON.stringify({ queries: o.searchQueries ?? ['Carrack voyages'] })
    }
    if (/<<<WEB_PAGE/.test(t)) {
      bump('research:notes')
      // a page about something else (gardening) answers nothing
      const blocks = [...t.matchAll(/<<<WEB_PAGE (\d+) \|[^\n]*>>>([\s\S]*?)<<<END_WEB_PAGE \d+>>>/g)].filter((m) => !/gardening/.test(m[2]!))
      return JSON.stringify({ facts: blocks.map((m) => ({ fact: `Page ${m[1]} says the sea passage took many months, a fact in my own words.`, source: Number(m[1]) })) })
    }
    bump('research:knowledge')
    return JSON.stringify({ facts: [{ fact: 'From memory: the passage by sail took many months.' }] })
  })
  mock.on({ task: 'publish' }, () => {
    bump('publish')
    return JSON.stringify({
      title: 'The Sleepy Fox',
      blurb: 'A fox who cannot sleep finds out what the moon sings at night.',
      subjects: ['Bedtime stories'],
      keywords: ['fox', 'moon', 'sleep'],
      cover_brief: 'A round orange fox asleep in hay under a big friendly moon.',
      illustration_briefs: [{ chapter: 1, description: 'The fox curled up in the hay.' }]
    })
  })
}

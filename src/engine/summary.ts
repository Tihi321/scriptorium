import { promises as fs } from 'node:fs'
import { readReaderPages } from './publish/reader'
import { briefOf } from '../shared/brief'
import type { AgentSummary, BookSummary, FormatSummary, IdeaSummary, ModelSummary, ProviderSummary, ServerStatus, TopicSummary } from '../shared/protocol'
import type { FormatEntry } from '../shared/schemas'
import type { AgentDef } from './agents/agents'
import type { BookStore } from './pipeline/books'
import type { ProviderLimiter } from './models/limiter'
import type { ModelRegistry } from './models/registry'
import type { ModelRouter } from './models/router'
import type { Scheduler } from './queue/scheduler'
import type { IdeaFile } from './store/ideas'
import type { TopicRow } from './store/topics'

const exists = (file: string) => fs.access(file).then(() => true, () => false)

export const topicSummary = (t: TopicRow): TopicSummary => ({
  id: t.id,
  section: t.section,
  name: t.topic,
  kind: t.kind,
  active: t.active,
  target: t.target,
  done: t.done,
  inProgress: t.inProgress
})

export const ideaSummary = (i: IdeaFile): IdeaSummary => {
  const brief = briefOf(i.data, i.body)
  return {
    slug: i.slug,
    title: i.title,
    status: i.data.status,
    source: i.data.source,
    format: i.data.format,
    topic: i.data.topic,
    book: i.data.book,
    titleFixed: i.data.title_fixed === true,
    characters: brief.characters.length,
    brief
  }
}

/** The owner's open stories (oldest first, the order they are picked) and the last `used` ones that books were made from (newest first). */
export function ideaSummaries(ideas: IdeaFile[], used = 10): IdeaSummary[] {
  const open = ideas.filter((i) => i.data.status === 'open' && i.data.source === 'user')
  const done = ideas.filter((i) => i.data.status === 'used').sort((a, b) => b.createdMs - a.createdMs).slice(0, used)
  return [...open, ...done].map(ideaSummary)
}

export const formatSummaries = (formats: FormatEntry[]): FormatSummary[] => formats.filter((f) => f.enabled).map((f) => ({ id: f.id, name: f.name, kinds: f.kinds }))

export async function bookSummary(books: BookStore, slug: string, topics: TopicRow[]): Promise<BookSummary | null> {
  const b = await books.read(slug)
  if (!b) return null
  const d = b.data as Record<string, unknown> & typeof b.data
  const chapters = await books.chapters(slug)
  const rel = (...p: string[]) => ['books', slug, ...p].join('/')
  const epub = `out/${slug}.epub`
  const topic = d.topic ? topics.find((t) => t.id === d.topic) : undefined
  const coverMtime = await fs.stat(books.file(slug, 'out', 'cover.png')).then((st) => Math.round(st.mtimeMs), () => null)
  return {
    slug,
    title: d.title,
    author: d.author,
    topic: d.topic ? { id: d.topic, name: d.topic_name ?? topic?.topic ?? d.topic } : null,
    kind: topic?.kind ?? null,
    format: d.format,
    stage: d.stage,
    paused: d.paused === true,
    chaptersWritten: chapters.length,
    chaptersPlanned: (await books.outline(slug))?.chapters.length ?? null,
    targetWords: d.target_words,
    round: d.round,
    reasons: d.reasons,
    ...teamOf(await books.readMade(slug)),
    words: chapters.reduce((s, c) => s + c.words, 0),
    year: typeof d.year === 'number' ? d.year : null,
    score: typeof d.score === 'number' ? d.score : null,
    scores: (d.scores as Record<string, number> | undefined) ?? {},
    costUsd: d.cost_usd,
    rating: typeof d.rating === 'number' ? d.rating : null,
    ratingNote: typeof d.rating_note === 'string' ? d.rating_note : null,
    coverPng: coverMtime !== null ? rel('out', 'cover.png') : null,
    coverVersion: coverMtime,
    coverState: typeof d.cover_png === 'string' ? d.cover_png : null,
    epub: (await exists(books.file(slug, epub))) ? rel(epub) : null,
    readerDir: (await exists(books.file(slug, 'out', 'reader', 'index.html'))) ? rel('out', 'reader') : null,
    readerPages: await readReaderPages(books.file(slug, 'out', 'reader')),
    publishedAt: typeof d.published === 'string' ? d.published : null
  }
}

export function agentSummary(def: AgentDef, sched: Scheduler, router: ModelRouter): AgentSummary {
  const info = sched.agentInfo(def.id)
  // a working agent shows the model its job calls now, not the role default it would start the next job with
  const resolved = info.model ?? router.candidates(def.data.role, { agentModel: def.data.model })[0]?.ref ?? def.data.model ?? router.registry.roleModelRefs(def.data.role)[0] ?? null
  return {
    id: def.id,
    name: def.data.name,
    role: def.data.role,
    model: def.data.model,
    resolvedModel: resolved,
    pin: def.data.pin,
    paused: def.data.paused,
    state: def.data.paused && info.state === 'idle' ? 'paused' : info.state,
    task: info.task,
    book: info.book,
    jobId: info.jobId,
    problem: info.problem
  }
}

export function modelSummaries(registry: ModelRegistry): ModelSummary[] {
  return [...registry.models.values()]
    .filter((m) => !m.embedding)
    .map((m) => ({
      ref: m.ref,
      provider: m.provider.id,
      model: m.id,
      family: m.family,
      local: m.provider.local,
      enabled: m.provider.available,
      shown: registry.isShown(m.ref),
      source: m.picked ? ('picked' as const) : m.discovered ? ('discovered' as const) : ('config' as const),
      context: m.context,
      priceIn: m.priceIn,
      priceOut: m.priceOut
    }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.ref.localeCompare(b.ref))
}

/** The model providers, for the Models dialog. */
export function providerSummaries(registry: ModelRegistry, limiter: ProviderLimiter): ProviderSummary[] {
  return [...registry.providers.values()]
    .filter((p) => p.kind !== 'search' && p.kind !== 'mock')
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      // a client provider (Claude Code over MCP) is local and free, never paid or down
      local: p.local || p.kind === 'client',
      available: p.available,
      reason: p.available ? undefined : p.unavailableReason,
      canList: p.kind === 'openai-compat',
      concurrency: p.concurrency,
      concurrencyAuto: p.concurrencyAuto,
      rpm: p.rpm,
      rpd: p.rpd,
      requestsToday: limiter.requestsToday(p.id),
      dayFull: limiter.dayFull(p),
      dayResetsAt: limiter.dayResetsAt()
    }))
}

/** The local servers the engine checks (`concurrency: auto`): Strata and LM Studio. */
export function serverStatuses(registry: ModelRegistry): ServerStatus[] {
  return [...registry.providers.values()].filter((p) => p.concurrencyAuto && p.available).map((p) => ({ id: p.id, down: p.down, slots: p.concurrency }))
}

export function roleDefaults(registry: ModelRegistry): Record<string, string> {
  const out: Record<string, string> = {}
  for (const role of Object.keys(registry.roles.roles)) {
    const first = registry.roleEntries(role)[0]
    if (first) out[role] = first
  }
  return out
}

/** Who worked on a book and its last steps, from the rows of made.md. */
export function teamOf(rows: Record<string, string>[]): Pick<BookSummary, 'team' | 'steps'> {
  const team = new Map<string, BookSummary['team'][number]>()
  for (const r of rows) {
    if (!r.agent) continue
    const t = team.get(r.agent) ?? { agent: r.agent, role: r.role ?? '', jobs: 0, models: [], costUsd: 0 }
    t.jobs++
    if (r.model && !t.models.includes(r.model)) t.models.push(r.model)
    t.costUsd += Number(r.cost_usd) || 0
    team.set(r.agent, t)
  }
  const steps = rows
    .slice(-6)
    .reverse()
    .map((r) => ({ task: r.task ?? '', unit: r.unit ?? '', agent: r.agent ?? '', model: r.model ?? '' }))
  return { team: [...team.values()].sort((a, b) => b.jobs - a.jobs), steps }
}

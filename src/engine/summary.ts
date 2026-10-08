import { promises as fs } from 'node:fs'
import type { AgentSummary, BookSummary, ModelSummary, TopicSummary } from '../shared/protocol'
import type { AgentDef } from './agents/agents'
import type { BookStore } from './pipeline/books'
import type { ModelRegistry } from './models/registry'
import type { ModelRouter } from './models/router'
import type { Scheduler } from './queue/scheduler'
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

export async function bookSummary(books: BookStore, slug: string, topics: TopicRow[]): Promise<BookSummary | null> {
  const b = await books.read(slug)
  if (!b) return null
  const d = b.data as Record<string, unknown> & typeof b.data
  const chapters = await books.chapters(slug)
  const rel = (...p: string[]) => ['books', slug, ...p].join('/')
  const epub = `out/${slug}.epub`
  const topic = d.topic ? topics.find((t) => t.id === d.topic) : undefined
  return {
    slug,
    title: d.title,
    author: d.author,
    topic: d.topic ? { id: d.topic, name: d.topic_name ?? topic?.topic ?? d.topic } : null,
    kind: topic?.kind ?? null,
    format: d.format,
    stage: d.stage,
    words: chapters.reduce((s, c) => s + c.words, 0),
    year: typeof d.year === 'number' ? d.year : null,
    score: typeof d.score === 'number' ? d.score : null,
    scores: (d.scores as Record<string, number> | undefined) ?? {},
    costUsd: d.cost_usd,
    rating: typeof d.rating === 'number' ? d.rating : null,
    ratingNote: typeof d.rating_note === 'string' ? d.rating_note : null,
    coverPng: (await exists(books.file(slug, 'out', 'cover.png'))) ? rel('out', 'cover.png') : null,
    epub: (await exists(books.file(slug, epub))) ? rel(epub) : null,
    readerDir: (await exists(books.file(slug, 'out', 'reader', 'index.html'))) ? rel('out', 'reader') : null,
    publishedAt: typeof d.published === 'string' ? d.published : null
  }
}

export function agentSummary(def: AgentDef, sched: Scheduler, router: ModelRouter): AgentSummary {
  const info = sched.agentInfo(def.id)
  const resolved = router.candidates(def.data.role, { agentModel: def.data.model })[0]?.ref ?? def.data.model ?? router.registry.roleModelRefs(def.data.role)[0] ?? null
  return {
    id: def.id,
    name: def.data.name,
    role: def.data.role,
    model: def.data.model,
    resolvedModel: resolved,
    paused: def.data.paused,
    state: def.data.paused && info.state === 'idle' ? 'paused' : info.state,
    task: info.task,
    book: info.book,
    jobId: info.jobId
  }
}

export function modelSummaries(registry: ModelRegistry): ModelSummary[] {
  return [...registry.models.values()]
    .filter((m) => !m.embedding)
    .map((m) => ({ ref: m.ref, provider: m.provider.id, model: m.id, family: m.family, local: m.provider.local, enabled: m.provider.available }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.ref.localeCompare(b.ref))
}

export function roleDefaults(registry: ModelRegistry): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [role, v] of Object.entries(registry.roles.roles)) if (v.models[0]) out[role] = v.models[0]
  return out
}

import { createStore } from 'zustand/vanilla'
import type { AgentSummary, BookSummary, EngineEvent, ModelSummary, SettingsSummary, TopicSummary } from '../../shared/protocol'
import {
  asAgentState,
  bookColor,
  groupOf,
  handoverAlpha,
  providerOf,
  titleFromSlug,
  type AgentView,
  type BookView,
  type HandoverView,
  type SpendView,
  type StateGroup
} from './model'
import { MAX_JOBS_PER_KEY, appendOutput, emptyJob, type JobLog } from './logModel'

export interface OfficeState {
  connected: boolean
  dataDir: string
  allPaused: boolean
  warnings: string[]
  agents: Record<string, AgentView>
  agentOrder: string[]
  books: Record<string, BookView>
  handovers: HandoverView[]
  spend: SpendView
  /** Models the pickers offer, from the snapshot. */
  models: ModelSummary[]
  roleDefaults: Record<string, string>
  topics: TopicSummary[]
  settings: SettingsSummary | null
  secretsSet: string[]
  /** Result of the last Send to Kindle per book. */
  kindle: Record<string, { state: 'sending' | 'ok' | 'error'; error?: string }>
  /** The office or the library. */
  view: 'office' | 'library'
  /** The book whose card is open, and whether its reader is showing. */
  openBook: string | null
  reading: boolean
  settingsOpen: boolean
  /** The agent whose panel is open. */
  selectedAgent: string | null
  /** The book highlighted on the whiteboard. Everyone not on it is dimmed. */
  highlightBook: string | null
  terminalOpen: boolean
  terminalMode: 'agent' | 'book'
  jobs: Record<string, JobLog>
  jobsByAgent: Record<string, string[]>
  jobsByBook: Record<string, string[]>
  /** Bumped on every applied event, so non-React code (Phaser) can cheaply notice changes. */
  version: number
}

export interface OfficeActions {
  applyEvent(event: EngineEvent, now?: number): void
  /** Applies several events with a single store update (used to batch per animation frame). */
  applyEvents(events: EngineEvent[], now?: number): void
  selectAgent(id: string | null): void
  toggleHighlightBook(slug: string | null): void
  setTerminal(open: boolean, mode?: 'agent' | 'book'): void
  setView(view: 'office' | 'library'): void
  openBookCard(slug: string | null, reading?: boolean): void
  setReading(reading: boolean): void
  setSettingsOpen(open: boolean): void
  markKindleSending(slug: string): void
  reset(): void
}

export type OfficeStore = OfficeState & OfficeActions

const EMPTY_SPEND: SpendView = { today: 0, month: 0, dailyCap: 0, monthlyCap: 0 }

function initial(): OfficeState {
  return {
    connected: false,
    dataDir: '',
    allPaused: false,
    warnings: [],
    agents: {},
    agentOrder: [],
    books: {},
    handovers: [],
    spend: { ...EMPTY_SPEND },
    models: [],
    roleDefaults: {},
    topics: [],
    settings: null,
    secretsSet: [],
    kindle: {},
    view: 'office',
    openBook: null,
    reading: false,
    settingsOpen: false,
    selectedAgent: null,
    highlightBook: null,
    terminalOpen: false,
    terminalMode: 'agent',
    jobs: {},
    jobsByAgent: {},
    jobsByBook: {},
    version: 0
  }
}

function pushId(map: Record<string, string[]>, key: string, id: string): Record<string, string[]> {
  const list = map[key] ?? []
  if (list.includes(id)) return map
  const next = [...list, id]
  return { ...map, [key]: next.length > MAX_JOBS_PER_KEY ? next.slice(next.length - MAX_JOBS_PER_KEY) : next }
}

function upsertBook(books: Record<string, BookView>, slug: string, patch: Partial<BookView>, now: number): Record<string, BookView> {
  const cur = books[slug]
  const next: BookView = {
    slug,
    title: cur?.title ?? titleFromSlug(slug),
    stage: cur?.stage ?? 'new',
    color: bookColor(slug),
    updatedAt: now,
    ...cur,
    ...patch
  }
  return { ...books, [slug]: next }
}

function viewOfBook(b: BookSummary, now: number): BookView {
  return { slug: b.slug, title: b.title || titleFromSlug(b.slug), stage: b.stage, color: bookColor(b.slug), updatedAt: now, summary: b }
}

function booksFromSnapshot(list: BookSummary[], now: number): Record<string, BookView> {
  const out: Record<string, BookView> = {}
  for (const b of list) out[b.slug] = viewOfBook(b, now)
  return out
}

function agentFromSummary(a: AgentSummary, prev: AgentView | undefined, now: number): AgentView {
  const state = a.paused ? 'paused' : asAgentState(a.state)
  const same = prev?.state === state && prev.task === a.task
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    model: a.resolvedModel ?? a.model ?? prev?.model ?? null,
    override: a.model,
    state,
    paused: a.paused,
    task: a.task,
    book: a.book,
    jobId: a.jobId,
    since: same && prev ? prev.since : now
  }
}

export function reduceEvent(s: OfficeState, e: EngineEvent, now: number): Partial<OfficeState> {
  switch (e.type) {
    case 'engine.ready':
      return { connected: true, dataDir: e.dataDir }
    case 'engine.heartbeat':
      return { connected: true }
    case 'engine.warning':
      return { warnings: [...s.warnings.slice(-19), e.message] }
    case 'snapshot': {
      const agents: Record<string, AgentView> = {}
      for (const a of e.agents) agents[a.id] = agentFromSummary(a, s.agents[a.id], now)
      for (const r of e.running) {
        const a = agents[r.agent]
        if (a && !a.jobId) a.jobId = r.jobId
      }
      return {
        connected: true,
        dataDir: e.dataDir,
        allPaused: e.paused,
        agents,
        agentOrder: e.agents.map((a) => a.id),
        books: booksFromSnapshot(e.books, now),
        topics: e.topics,
        spend: e.spend,
        models: e.models,
        roleDefaults: e.roleDefaults,
        settings: e.settings,
        secretsSet: e.secretsSet,
        selectedAgent: s.selectedAgent && agents[s.selectedAgent] ? s.selectedAgent : null
      }
    }
    case 'agent.hired': {
      const prev = s.agents[e.agent.id]
      return {
        agents: { ...s.agents, [e.agent.id]: agentFromSummary(e.agent, prev, now) },
        agentOrder: prev ? s.agentOrder : [...s.agentOrder, e.agent.id]
      }
    }
    case 'agent.removed': {
      const { [e.agent]: _gone, ...rest } = s.agents
      return {
        agents: rest,
        agentOrder: s.agentOrder.filter((id) => id !== e.agent),
        selectedAgent: s.selectedAgent === e.agent ? null : s.selectedAgent
      }
    }
    case 'factory.paused':
      return { allPaused: e.paused }
    case 'book.updated':
      return { books: { ...s.books, [e.book.slug]: viewOfBook(e.book, now) } }
    case 'topics.updated':
      return { topics: e.topics }
    case 'kindle.sent':
      return { kindle: { ...s.kindle, [e.book]: e.ok ? { state: 'ok' } : { state: 'error', error: e.error } } }
    case 'secrets.updated':
      return { secretsSet: e.secretsSet }
    case 'agent.state': {
      const prev = s.agents[e.agent]
      const state = e.state
      const task = state === 'idle' || state === 'paused' ? undefined : (e.task ?? (prev?.state === state ? prev.task : undefined))
      const base: AgentView = prev ?? { id: e.agent, name: e.agent, role: e.role, model: null, override: null, state, paused: false, since: now }
      const changed = prev?.state !== state || prev?.task !== task
      const agent: AgentView = {
        ...base,
        role: e.role || base.role,
        state,
        paused: state === 'paused',
        task,
        book: state === 'idle' || state === 'paused' ? undefined : (e.book ?? base.book),
        jobId: e.jobId ?? (state === 'idle' ? undefined : base.jobId),
        since: changed ? now : base.since
      }
      return {
        agents: { ...s.agents, [e.agent]: agent },
        agentOrder: prev ? s.agentOrder : [...s.agentOrder, e.agent],
        books: e.book && !s.books[e.book] ? upsertBook(s.books, e.book, {}, now) : s.books
      }
    }
    case 'job.started': {
      const job: JobLog = { ...emptyJob(e.jobId, e.agent, now), ...s.jobs[e.jobId], task: e.task, book: e.book, model: e.model }
      const prev = s.agents[e.agent]
      const agents = prev ? { ...s.agents, [e.agent]: { ...prev, model: e.model ?? prev.model, jobId: e.jobId, book: e.book ?? prev.book } } : s.agents
      return {
        agents,
        jobs: { ...s.jobs, [e.jobId]: job },
        jobsByAgent: pushId(s.jobsByAgent, e.agent, e.jobId),
        jobsByBook: e.book ? pushId(s.jobsByBook, e.book, e.jobId) : s.jobsByBook,
        books: e.book && !s.books[e.book] ? upsertBook(s.books, e.book, {}, now) : s.books
      }
    }
    case 'job.token': {
      const cur = s.jobs[e.jobId] ?? emptyJob(e.jobId, e.agent, now)
      const jobs = { ...s.jobs, [e.jobId]: { ...cur, output: appendOutput(cur.output, e.text) } }
      return s.jobs[e.jobId] ? { jobs } : { jobs, jobsByAgent: pushId(s.jobsByAgent, e.agent, e.jobId) }
    }
    case 'job.done': {
      const cur = s.jobs[e.jobId] ?? emptyJob(e.jobId, e.agent, now)
      const job: JobLog = { ...cur, finishedAt: now, ok: e.ok, result: e.result ?? cur.result, error: e.error }
      if (job.result && /^\S+\/\S+\.md$/.test(job.result)) job.destination = job.result
      return { jobs: { ...s.jobs, [e.jobId]: job } }
    }
    case 'handover': {
      const key = e.jobId ?? `${e.from}>${e.to}>${e.label}`
      const rest = s.handovers.filter((h) => h.key !== key)
      const prev = s.handovers.find((h) => h.key === key)
      const h: HandoverView = { key, from: e.from, to: e.to, label: e.label, jobId: e.jobId, startedAt: prev?.startedAt ?? now, doneAt: e.done ? now : undefined }
      const jobs = e.jobId && s.jobs[e.jobId] && !s.jobs[e.jobId]!.requestedBy ? { jobs: { ...s.jobs, [e.jobId]: { ...s.jobs[e.jobId]!, requestedBy: e.from } } } : {}
      return { handovers: [...rest, h].filter((x) => handoverAlpha(x, now) > 0).slice(-40), ...jobs }
    }
    case 'spend': {
      const spend: SpendView = { ...s.spend, today: s.spend.today + e.costUsd, month: s.spend.month + e.costUsd }
      const patch: Partial<OfficeState> = { spend }
      const a = e.agent ? s.agents[e.agent] : undefined
      if (a) patch.agents = { ...s.agents, [a.id]: { ...a, model: `${e.provider}/${e.model}` } }
      const jobId = a?.jobId
      const job = jobId ? s.jobs[jobId] : undefined
      if (jobId && job) {
        patch.jobs = {
          ...s.jobs,
          [jobId]: {
            ...job,
            calls: (job.calls ?? 0) + 1,
            tokensIn: (job.tokensIn ?? 0) + e.tokensIn,
            tokensOut: (job.tokensOut ?? 0) + e.tokensOut,
            costUsd: (job.costUsd ?? 0) + e.costUsd,
            model: `${e.provider}/${e.model}`
          }
        }
      }
      return patch
    }
    case 'book.stage':
      return { books: upsertBook(s.books, e.book, { stage: e.stage }, now) }
    default:
      return {}
  }
}

export function createOfficeStore() {
  return createStore<OfficeStore>()((set, get) => ({
    ...initial(),
    applyEvent(event, now = Date.now()) {
      get().applyEvents([event], now)
    },
    applyEvents(events, now = Date.now()) {
      if (events.length === 0) return
      let state: OfficeState = get()
      for (const e of events) state = { ...state, ...reduceEvent(state, e, now) }
      set({ ...state, version: get().version + 1 })
    },
    selectAgent(id) {
      set({ selectedAgent: id, terminalMode: 'agent', terminalOpen: id ? true : get().terminalOpen })
    },
    toggleHighlightBook(slug) {
      set({ highlightBook: get().highlightBook === slug ? null : slug })
    },
    setTerminal(open, mode) {
      set({ terminalOpen: open, terminalMode: mode ?? get().terminalMode })
    },
    setView(view) {
      set({ view })
    },
    openBookCard(slug, reading = false) {
      set({ openBook: slug, reading: slug ? reading : false })
    },
    setReading(reading) {
      set({ reading })
    },
    setSettingsOpen(open) {
      set({ settingsOpen: open })
    },
    markKindleSending(slug) {
      set({ kindle: { ...get().kindle, [slug]: { state: 'sending' } } })
    },
    reset() {
      set(initial())
    }
  }))
}

/** The app-wide store. Tests make their own with createOfficeStore(). */
export const officeStore = createOfficeStore()

// ---- selectors (pure, tested) ----

export interface StateCounts {
  working: number
  waiting: number
  idle: number
  total: number
}

function emptyCounts(): StateCounts {
  return { working: 0, waiting: 0, idle: 0, total: 0 }
}

export function countStates(agents: AgentView[]): StateCounts {
  const c = emptyCounts()
  for (const a of agents) {
    c[groupOf(a.state) as StateGroup]++
    c.total++
  }
  return c
}

export function countBy(agents: AgentView[], key: (a: AgentView) => string): Record<string, StateCounts> {
  const out: Record<string, StateCounts> = {}
  for (const a of agents) {
    const k = key(a)
    const c = (out[k] ??= emptyCounts())
    c[groupOf(a.state)]++
    c.total++
  }
  return out
}

export const countByRole = (agents: AgentView[]) => countBy(agents, (a) => a.role)
export const countByProvider = (agents: AgentView[]) => countBy(agents, (a) => providerOf(a.model))

/** Agents currently on each book. */
export function agentsPerBook(agents: AgentView[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of agents) if (a.book && groupOf(a.state) !== 'idle') out[a.book] = (out[a.book] ?? 0) + 1
  return out
}

/** True when a book is highlighted and this agent is not working on it. */
export function isDimmed(agent: AgentView, highlightBook: string | null): boolean {
  return highlightBook !== null && agent.book !== highlightBook
}

export function activeHandovers(handovers: HandoverView[], now: number): { h: HandoverView; alpha: number }[] {
  return handovers.map((h) => ({ h, alpha: handoverAlpha(h, now) })).filter((x) => x.alpha > 0)
}

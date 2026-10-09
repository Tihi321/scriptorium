import { describe, expect, it } from 'vitest'
import type { AgentSummary, BookSummary, EngineEvent, SnapshotEvent } from '../../src/shared/protocol'
import {
  HANDOVER_FADE_MS,
  bookColor,
  budgetLevel,
  budgetPct,
  handoverAlpha,
  providerOf,
  stageColumn
} from '../../src/renderer/store/model'
import { agentsPerBook, countByProvider, countByRole, countStates, createOfficeStore, isDimmed } from '../../src/renderer/store/store'
import { jobToText, mergeJobs, parseLog } from '../../src/renderer/store/logModel'
import { buildShelves, emptiestFirst, groupTopics } from '../../src/renderer/store/shelves'
import { breakSpot, placeDesks, roomForRole } from '../../src/renderer/office/layout'

const T0 = 1_000_000

function agentSummary(id: string, name: string, role: string, o: Partial<AgentSummary> = {}): AgentSummary {
  return { id, name, role, model: null, resolvedModel: null, paused: false, state: 'idle', ...o }
}

export function bookSummary(slug: string, o: Partial<BookSummary> = {}): BookSummary {
  return {
    slug,
    title: slug,
    author: 'Mara',
    topic: { id: 'jfic', name: 'Bedtime' },
    kind: 'juvenile-fiction',
    format: 'bedtime-toddler',
    stage: 'drafting',
    words: 450,
    year: 2026,
    score: null,
    scores: {},
    costUsd: 0,
    rating: null,
    ratingNote: null,
    coverPng: null,
    epub: null,
    readerDir: null,
    publishedAt: null,
    ...o
  }
}

function snapshot(extra: Partial<SnapshotEvent> = {}): EngineEvent {
  return {
    type: 'snapshot',
    dataDir: 'd',
    uptimeMs: 1,
    paused: false,
    agents: [
      agentSummary('w1', 'Mara', 'writer', { resolvedModel: 'deepseek/deepseek-v4-flash' }),
      agentSummary('w2', 'Tobias', 'writer', { resolvedModel: 'deepseek/deepseek-v4-flash' }),
      agentSummary('e1', 'Otto', 'line-editor', { model: 'lmstudio/qwen', resolvedModel: 'lmstudio/qwen' }),
      agentSummary('a1', 'Milo', 'archivist', { paused: true })
    ],
    books: [bookSummary('fox-book', { title: 'Fox Book' })],
    topics: [],
    models: [],
    roleDefaults: {},
    spend: { today: 1.6, month: 6, dailyCap: 2, monthlyCap: 30 },
    running: [],
    settings: { kindleAddress: '', fromAddress: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpSecure: false },
    secretsSet: [],
    at: 'now',
    ...extra
  }
}

function agentState(agent: string, role: string, state: Extract<EngineEvent, { type: 'agent.state' }>['state'], book?: string, task?: string): EngineEvent {
  return { type: 'agent.state', agent, role, state, book, task }
}

describe('counts', () => {
  it('groups states into working, waiting and idle, and breaks them down by role and provider', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent(agentState('w1', 'writer', 'working', 'fox-book', 'draft ch-1'), T0)
    store.getState().applyEvent(agentState('w2', 'writer', 'waiting-provider', 'fox-book'), T0)
    store.getState().applyEvent(agentState('e1', 'line-editor', 'reviewing', 'fox-book'), T0)
    const agents = Object.values(store.getState().agents)
    expect(countStates(agents)).toEqual({ working: 2, waiting: 1, idle: 1, total: 4 })
    expect(countByRole(agents).writer).toEqual({ working: 1, waiting: 1, idle: 0, total: 2 })
    const byProvider = countByProvider(agents)
    expect(byProvider.deepseek?.total).toBe(2)
    expect(byProvider.lmstudio?.working).toBe(1)
    expect(byProvider.default?.idle).toBe(1)
  })

  it('shows a paused agent as paused, which counts as idle', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    expect(store.getState().agents.a1?.state).toBe('paused')
    expect(countStates(Object.values(store.getState().agents)).idle).toBe(4)
  })

  it('learns the model from job.started and spend', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'job.started', jobId: 'j', agent: 'a1', task: 'update bible', model: 'lmstudio/nail' }, T0)
    expect(providerOf(store.getState().agents.a1?.model)).toBe('lmstudio')
  })
})

describe('handover fade', () => {
  it('stays opaque while active, then fades out over the fade time after done', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'handover', from: 'w1', to: 'e1', label: 'review ch-1', jobId: 'j1' }, T0)
    const active = store.getState().handovers[0]!
    expect(handoverAlpha(active, T0 + 60_000)).toBe(1)
    store.getState().applyEvent({ type: 'handover', from: 'w1', to: 'e1', label: 'review ch-1', jobId: 'j1', done: true }, T0 + 1000)
    const done = store.getState().handovers[0]!
    expect(store.getState().handovers).toHaveLength(1)
    expect(done.startedAt).toBe(T0)
    expect(handoverAlpha(done, T0 + 1000)).toBe(1)
    expect(handoverAlpha(done, T0 + 1000 + HANDOVER_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(handoverAlpha(done, T0 + 1000 + HANDOVER_FADE_MS)).toBe(0)
  })

  it('drops faded handovers when the next one arrives', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'handover', from: 'you', to: 'w1', label: 'a', jobId: 'j1' }, T0)
    store.getState().applyEvent({ type: 'handover', from: 'you', to: 'w1', label: 'a', jobId: 'j1', done: true }, T0)
    store.getState().applyEvent({ type: 'handover', from: 'you', to: 'w2', label: 'b', jobId: 'j2' }, T0 + HANDOVER_FADE_MS + 1)
    expect(store.getState().handovers.map((h) => h.key)).toEqual(['j2'])
  })

  it('gives up on a handover that never gets its done event', () => {
    const h = { key: 'k', from: 'a', to: 'b', label: 'x', startedAt: T0 }
    expect(handoverAlpha(h, T0 + 1_000)).toBe(1)
    expect(handoverAlpha(h, T0 + 10 * 60_000)).toBe(0)
  })
})

describe('book highlight', () => {
  it('dims every agent that is not on the highlighted book', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent(agentState('w1', 'writer', 'working', 'fox-book'), T0)
    store.getState().applyEvent(agentState('w2', 'writer', 'working', 'other-book'), T0)
    const { agents } = store.getState()
    expect(isDimmed(agents.w1!, null)).toBe(false)
    store.getState().toggleHighlightBook('fox-book')
    expect(store.getState().highlightBook).toBe('fox-book')
    expect(isDimmed(agents.w1!, 'fox-book')).toBe(false)
    expect(isDimmed(agents.w2!, 'fox-book')).toBe(true)
    expect(isDimmed(agents.e1!, 'fox-book')).toBe(true)
    store.getState().toggleHighlightBook('fox-book')
    expect(store.getState().highlightBook).toBeNull()
  })

  it('counts the agents on each book and gives each book a stable colour', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent(agentState('w1', 'writer', 'working', 'fox-book'), T0)
    store.getState().applyEvent(agentState('e1', 'line-editor', 'reviewing', 'fox-book'), T0)
    expect(agentsPerBook(Object.values(store.getState().agents))).toEqual({ 'fox-book': 2 })
    expect(bookColor('fox-book')).toBe(bookColor('fox-book'))
    expect(bookColor('fox-book')).toMatch(/^#[0-9a-f]{6}$/)
    expect(bookColor('fox-book')).not.toBe(bookColor('moon-book'))
    expect(store.getState().books['fox-book']?.color).toBe(bookColor('fox-book'))
  })

  it('moves a book across the whiteboard on book.stage, and maps stage names to columns', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'book.stage', book: 'fox-book', stage: 'editing' }, T0)
    expect(store.getState().books['fox-book']?.stage).toBe('editing')
    expect(['new', 'outline', 'drafting', 'review-2', 'published', 'rejected', 'weird'].map(stageColumn)).toEqual(['idea', 'outline', 'drafting', 'editing', 'published', 'rejected', 'other'])
  })
})

describe('budget', () => {
  it('computes percentages and the 80% warning level', () => {
    expect(budgetPct(1, 2)).toBe(50)
    expect(budgetPct(1, 0)).toBe(0)
    expect(budgetLevel(79.9)).toBe('ok')
    expect(budgetLevel(80)).toBe('warn')
    expect(budgetLevel(100)).toBe('over')
  })

  it('adds spend events to today and the month, and replaces them from a snapshot', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'spend', provider: 'deepseek', model: 'deepseek-v4-flash', tokensIn: 10, tokensOut: 5, costUsd: 0.1, agent: 'w1' }, T0)
    const { spend } = store.getState()
    expect(spend.today).toBeCloseTo(1.7)
    expect(spend.month).toBeCloseTo(6.1)
    expect(budgetLevel(budgetPct(spend.today, spend.dailyCap))).toBe('warn')
    store.getState().applyEvent(snapshot({ spend: { today: 0, month: 1, dailyCap: 2, monthlyCap: 30 } }), T0)
    expect(store.getState().spend.today).toBe(0)
  })
})

describe('live job log', () => {
  it('collects streamed tokens and the result per job', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvents(
      [
        { type: 'job.started', jobId: 'j1', agent: 'w1', task: 'draft ch-1', book: 'fox-book', model: 'deepseek/deepseek-v4-flash' },
        { type: 'handover', from: 'you', to: 'w1', label: 'draft ch-1', jobId: 'j1' },
        { type: 'job.token', jobId: 'j1', agent: 'w1', text: 'Once ' },
        { type: 'job.token', jobId: 'j1', agent: 'w1', text: 'upon a time' },
        { type: 'job.done', jobId: 'j1', agent: 'w1', ok: true, result: 'books/fox-book/chapters/ch-1.md' }
      ],
      T0
    )
    const job = store.getState().jobs.j1!
    expect(job.output).toBe('Once upon a time')
    expect(job.ok).toBe(true)
    expect(job.requestedBy).toBe('you')
    expect(job.destination).toBe('books/fox-book/chapters/ch-1.md')
    expect(store.getState().jobsByAgent.w1).toEqual(['j1'])
    expect(store.getState().jobsByBook['fox-book']).toEqual(['j1'])
  })

  it('caps very long streamed output', () => {
    const store = createOfficeStore()
    store.getState().applyEvent({ type: 'job.started', jobId: 'j', agent: 'w1', task: 't' }, T0)
    for (let i = 0; i < 30; i++) store.getState().applyEvent({ type: 'job.token', jobId: 'j', agent: 'w1', text: 'x'.repeat(10_000) }, T0)
    expect(store.getState().jobs.j!.output.length).toBeLessThanOrEqual(121_000)
  })
})

const LOG = `
## 2026-10-05T10:00:00+02:00 job \`fox--draft--ch-01--r0\`

- requested by: editor-in-chief-edith-marlowe
- task: draft (role writer), book fox, unit ch-01, round 0
- agent: writer-mara-quill, first model: deepseek/deepseek-v4-flash, prompt version a1b2, attempt 1
### Context
- bible/characters (412 tokens)
- outline (233 tokens)
### Output

_model deepseek/deepseek-v4-flash_

Once upon a time.

### Result
Written to books/fox/chapters/ch-01.md. 1 call(s), 2100 in (0 cached) / 640 out tokens, 0.000812 USD, 12.4 s

## 2026-10-05T10:05:00+02:00 job \`fox--review--ch-01--r0\`

- requested by: engine
- task: review (role line-editor), book fox, round 0
- agent: writer-mara-quill, first model: deepseek/deepseek-v4-flash, prompt version a1b2, attempt 1
### Output
### Result
Failed (attempt 1 of 3): 429. Retrying in 2 s.
`

describe('log parsing', () => {
  it('parses the blocks the scheduler writes', () => {
    const jobs = parseLog(LOG)
    expect(jobs).toHaveLength(2)
    const j = jobs[0]!
    expect(j.jobId).toBe('fox--draft--ch-01--r0')
    expect(j.requestedBy).toBe('editor-in-chief-edith-marlowe')
    expect(j.task).toBe('draft ch-01')
    expect(j.book).toBe('fox')
    expect(j.agent).toBe('writer-mara-quill')
    expect(j.model).toBe('deepseek/deepseek-v4-flash')
    expect(j.context).toEqual([
      { name: 'bible/characters', tokens: 412 },
      { name: 'outline', tokens: 233 }
    ])
    expect(j.output).toContain('Once upon a time.')
    expect(j.destination).toBe('books/fox/chapters/ch-01.md')
    expect(j.tokensIn).toBe(2100)
    expect(j.tokensOut).toBe(640)
    expect(j.costUsd).toBeCloseTo(0.000812)
    expect(j.seconds).toBe(12.4)
    expect(j.ok).toBe(true)
    expect(jobs[1]!.ok).toBe(false)
    expect(jobToText(j)).toContain('draft ch-01')
  })

  it('lets live data win over history for the same job', () => {
    const [h] = parseLog(LOG)
    const merged = mergeJobs([h!], [{ jobId: h!.jobId, agent: 'writer-mara-quill', task: 'draft ch-01', startedAt: 5, context: [], output: 'live text that is longer than the history text, which is short. '.repeat(3) }])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.output).toContain('live text')
    expect(merged[0]!.context).toHaveLength(2)
  })
})

describe('office layout', () => {
  it('puts roles in their rooms and gives every agent its own desk', () => {
    expect(roomForRole('archivist')).toBe('archive')
    expect(roomForRole('child-safety-reviewer')).toBe('children')
    expect(roomForRole('read-aloud-reviewer')).toBe('children')
    expect(roomForRole('publisher')).toBe('print')
    const agents = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, role: 'writer' }))
    const placed = placeDesks(agents)
    expect(placed.size).toBe(12)
    const spots = new Set([...placed.values()].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`))
    expect(spots.size).toBe(12)
    expect(breakSpot(0)).not.toEqual(breakSpot(1))
  })
})

describe('library and protocol events', () => {
  it('replaces and removes agents from agent.hired and agent.removed, and follows factory.paused', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'agent.hired', agent: agentSummary('w3', 'Nina', 'writer', { resolvedModel: 'deepseek/deepseek-v4-flash' }) }, T0)
    expect(store.getState().agentOrder).toContain('w3')
    expect(store.getState().agents.w3?.model).toBe('deepseek/deepseek-v4-flash')
    expect(store.getState().agents.w3?.override).toBeNull()
    store.getState().selectAgent('w3')
    store.getState().applyEvent({ type: 'agent.removed', agent: 'w3' }, T0)
    expect(store.getState().agents.w3).toBeUndefined()
    expect(store.getState().selectedAgent).toBeNull()
    store.getState().applyEvent({ type: 'factory.paused', paused: true }, T0)
    expect(store.getState().allPaused).toBe(true)
  })

  it('keeps the override apart from the resolved model, so "back to role default" can be offered', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    expect(store.getState().agents.e1).toMatchObject({ override: 'lmstudio/qwen', model: 'lmstudio/qwen' })
    expect(store.getState().agents.w1).toMatchObject({ override: null, model: 'deepseek/deepseek-v4-flash' })
  })

  it('tracks book.updated, ratings and the Kindle result', () => {
    const store = createOfficeStore()
    store.getState().applyEvent(snapshot(), T0)
    store.getState().applyEvent({ type: 'book.updated', book: bookSummary('fox-book', { stage: 'published', rating: 4, ratingNote: 'nice' }) }, T0)
    expect(store.getState().books['fox-book']?.summary?.rating).toBe(4)
    expect(store.getState().books['fox-book']?.stage).toBe('published')
    store.getState().markKindleSending('fox-book')
    expect(store.getState().kindle['fox-book']?.state).toBe('sending')
    store.getState().applyEvent({ type: 'kindle.sent', book: 'fox-book', ok: false, error: 'bad password' }, T0)
    expect(store.getState().kindle['fox-book']).toEqual({ state: 'error', error: 'bad password' })
    store.getState().applyEvent({ type: 'kindle.sent', book: 'fox-book', ok: true }, T0)
    expect(store.getState().kindle['fox-book']?.state).toBe('ok')
  })

  it('builds shelves for active topics and topics with books, and orders topics emptiest first', () => {
    const topic = (id: string, active: boolean, done: number, target: number) => ({ id, section: 's', name: id, kind: 'fiction', active, target, done, inProgress: 0 })
    const topics = [topic('a', true, 3, 4), topic('b', true, 0, 4), topic('c', false, 0, 4), topic('d', false, 1, 4)]
    const books = [
      bookSummary('x', { stage: 'published', topic: { id: 'a', name: 'a' } }),
      bookSummary('y', { stage: 'published', topic: { id: 'd', name: 'd' } }),
      bookSummary('z', { stage: 'rejected', topic: { id: 'c', name: 'c' } }),
      bookSummary('w', { stage: 'published', topic: { id: 'gone', name: 'Gone' } })
    ]
    const shelves = buildShelves(topics, books)
    expect(shelves.map((s) => s.id)).toEqual(['a', 'b', 'd', 'gone'])
    expect(shelves.find((s) => s.id === 'b')?.books).toHaveLength(0)
    expect(emptiestFirst(topics).map((t) => t.id)).toEqual(['b', 'c', 'd', 'a'])
  })
  it('groups topics by section, emptiest first, and filters them', () => {
    const topic = (id: string, section: string, name: string, kind: string, active: boolean, done: number, target: number, inProgress = 0) => ({ id, section, name, kind, active, target, done, inProgress })
    const topics = [
      topic('f1', 'Fiction', 'Fantasy / Cozy', 'fiction', false, 0, 5),
      topic('f2', 'Fiction', 'Mystery / Cozy', 'fiction', true, 2, 5, 1),
      topic('h1', 'History', 'Ancient / Rome', 'nonfiction', false, 0, 5),
      topic('h2', 'History', 'History of Books & Printing', 'nonfiction', false, 0, 5),
      topic('c1', 'Children', 'Bedtime', 'juvenile-fiction', true, 5, 5)
    ]
    const groups = groupTopics(topics)
    // the emptiest section first (History: nothing done), the full one last
    expect(groups.map((g) => g.section)).toEqual(['History', 'Fiction', 'Children'])
    expect(groups[1]!.topics.map((t) => t.id)).toEqual(['f1', 'f2']) // inside a section too
    expect(groups[1]).toMatchObject({ active: 1, done: 2, target: 10, inProgress: 1, open: true })
    expect(groups[0]).toMatchObject({ active: 0, done: 0, open: false })
    // a filter keeps topics with every word, in name, section, kind or id, and opens the sections it finds
    expect(groupTopics(topics, { query: 'cozy' }).flatMap((g) => g.topics.map((t) => t.id)).sort()).toEqual(['f1', 'f2'])
    const found = groupTopics(topics, { query: 'printing history' })
    expect(found.map((g) => g.topics.map((t) => t.id))).toEqual([['h2']])
    expect(found[0]!.open).toBe(true)
    expect(groupTopics(topics, { query: 'juvenile' }).map((g) => g.section)).toEqual(['Children'])
    expect(groupTopics(topics, { activeOnly: true }).flatMap((g) => g.topics.map((t) => t.id)).sort()).toEqual(['c1', 'f2'])
    expect(groupTopics(topics, { query: 'zzz' })).toEqual([])
  })
})

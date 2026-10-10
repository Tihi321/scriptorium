/**
 * Dev harness: a fake engine that stands in for `window.scriptorium`, so the UI can be built and tested in a plain browser.
 * Start it with `npm run dev:ui` (or add `?demo` to the page URL). It is only imported in development builds.
 *
 * Query flags: `seed=N` (random seed), `tick=MS` (simulation step, default 400; 0 stops the clock, use `__scriptoriumFake.step()`).
 * Recorded commands are in `window.__scriptoriumFake.commands`.
 */
import type { AgentState, AgentSummary, Command, EngineEvent, ModelSummary } from '../../shared/protocol'
import { bookSummary as summaryOfBook, makeBookUrl, makeBooks, makeTopics, topicSummaries } from './library'
import type { RendererApi } from '../api'

interface FakeAgent {
  id: string
  name: string
  role: string
  paused: boolean
  state: AgentState
  model: string
  /** The agent's own override, or null. */
  override: string | null
  /** Remaining ticks of the current job, or 0. */
  ticks: number
  jobId?: string
  book?: string
  task?: string
  tokens: number
  requester?: string
  phase: 'main' | 'wait-provider' | 'wait-research'
}

const DS = 'deepseek/deepseek-v4-flash'
const QWEN27 = 'lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp'
const QWEN35 = 'lmstudio/nail-qwen3.6-35b-a3b-mtp'

const STAFF: [string, string, string, string][] = [
  ['editor-in-chief', 'Edith Marlowe', 'editor-in-chief-edith-marlowe', DS],
  ['idea-generator', 'Felix Ashby', 'idea-generator-felix-ashby', DS],
  ['architect', 'Ada Thorne', 'architect-ada-thorne', DS],
  ['writer', 'Mara Quill', 'writer-mara-quill', DS],
  ['writer', 'Tobias Wren', 'writer-tobias-wren', DS],
  ['publisher', 'Clara Ostrow', 'publisher-clara-ostrow', DS],
  ['developmental-editor', 'Rosa Delmar', 'developmental-editor-rosa-delmar', QWEN27],
  ['line-editor', 'Otto Hale', 'line-editor-otto-hale', QWEN27],
  ['copy-editor', 'June Pryor', 'copy-editor-june-pryor', QWEN27],
  ['beta-reader', 'Sam Okafor', 'beta-reader-sam-okafor', QWEN27],
  ['child-safety-reviewer', 'Hazel Moore', 'child-safety-reviewer-hazel-moore', QWEN27],
  ['read-aloud-reviewer', 'Percy Lane', 'read-aloud-reviewer-percy-lane', QWEN27],
  ['continuity-checker', 'Ingrid Vale', 'continuity-checker-ingrid-vale', QWEN35],
  ['originality-checker', 'Vera Lindqvist', 'originality-checker-vera-lindqvist', QWEN35],
  ['fact-checker', 'Leo Brandt', 'fact-checker-leo-brandt', QWEN35],
  ['researcher', 'Noor Castell', 'researcher-noor-castell', QWEN35],
  ['archivist', 'Milo Grant', 'archivist-milo-grant', QWEN35]
]

const TASKS: Record<string, string[]> = {
  'editor-in-chief': ['pick idea', 'plan shelf'],
  'idea-generator': ['ideas batch'],
  architect: ['outline', 'chapter plan'],
  writer: ['draft ch-', 'draft ch-', 'rewrite ch-'],
  publisher: ['score and publish', 'build epub'],
  'developmental-editor': ['review structure ch-'],
  'line-editor': ['line edit ch-'],
  'copy-editor': ['copy pass ch-'],
  'beta-reader': ['read ch-'],
  'child-safety-reviewer': ['safety check ch-'],
  'read-aloud-reviewer': ['read-aloud ch-'],
  'continuity-checker': ['continuity ch-'],
  'originality-checker': ['originality'],
  'fact-checker': ['fact check ch-'],
  researcher: ['research: ship travel', 'research: moon phases'],
  archivist: ['update bible', 'summarise ch-']
}
const REVIEWING = new Set(['developmental-editor', 'line-editor', 'copy-editor', 'beta-reader', 'child-safety-reviewer', 'read-aloud-reviewer', 'continuity-checker', 'originality-checker', 'fact-checker'])

const WORDS = 'the small fox carried a lantern through quiet fields while the moon rose over the bakery and everyone slept except the old clock which counted softly toward morning and the wind told a story about distant harbours'.split(' ')

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FakeHandle {
  commands: Command[]
  emit(e: EngineEvent): void
  step(): void
}

declare global {
  interface Window {
    __scriptoriumFake?: FakeHandle
  }
}

export function installFakeEngine(params: URLSearchParams): void {
  const rnd = mulberry32(Number(params.get('seed') ?? 7))
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!
  const tickMs = Number(params.get('tick') ?? 400)
  const handlers = new Set<(e: EngineEvent) => void>()
  const commands: Command[] = []
  const t0 = Date.now()
  let allPaused = false
  let jobCounter = 100
  const spend = { today: 0.42, month: 6.1, dailyCap: 2, monthlyCap: 30 }
  const topics = makeTopics()
  const books = makeBooks()
  const agents: FakeAgent[] = STAFF.map(([role, name, id, model]) => ({ id, name, role, paused: false, state: 'idle', model, override: null, ticks: 0, tokens: 0, phase: 'main' }))
  const activeBooks = books.filter((b) => !['published', 'rejected', 'idea'].includes(b.stage))

  const emit = (e: EngineEvent) => {
    for (const h of [...handlers]) h(e)
  }
  const MODELS: ModelSummary[] = [DS, QWEN27, QWEN35, 'anthropic/claude-sonnet-5'].map((ref) => ({
    ref,
    provider: ref.split('/')[0]!,
    model: ref.split('/')[1]!,
    family: ref.split('/')[0]!,
    local: ref.startsWith('lmstudio') || ref.startsWith('strata'),
    enabled: !ref.startsWith('anthropic')
  }))
  const roleDefaults: Record<string, string> = Object.fromEntries(STAFF.map(([role, , , model]) => [role, model]))
  let settings = { kindleAddress: 'me@kindle.com', fromAddress: 'me@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'me', smtpSecure: false }
  const secretsSet = new Set<string>(['DEEPSEEK_API_KEY'])

  const summaryOf = (a: FakeAgent): AgentSummary => ({
    id: a.id,
    name: a.name,
    role: a.role,
    model: a.override,
    resolvedModel: a.model,
    paused: a.paused,
    state: a.paused ? 'paused' : a.state,
    task: a.task,
    book: a.book,
    jobId: a.jobId
  })
  const snapshot = (): EngineEvent => ({
    type: 'snapshot',
    dataDir: 'C:/demo/scriptorium-data',
    uptimeMs: Date.now() - t0,
    paused: allPaused,
    agents: agents.map(summaryOf),
    books: books.map((b) => summaryOfBook(b, topics)),
    topics: topicSummaries(topics, books),
    models: MODELS,
    roleDefaults,
    spend: { ...spend },
    running: agents.filter((a) => a.jobId).map((a) => ({ jobId: a.jobId!, agent: a.id })),
    settings,
    secretsSet: [...secretsSet],
    at: new Date().toISOString()
  })

  const setState = (a: FakeAgent, state: AgentState, task?: string) => {
    a.state = state
    emit({ type: 'agent.state', agent: a.id, role: a.role, state, jobId: a.jobId, task, book: a.book })
  }

  const startJob = (a: FakeAgent) => {
    const taskBase = pick(TASKS[a.role] ?? ['work'])
    const chapter = String(1 + Math.floor(rnd() * 18)).padStart(2, '0')
    const task = taskBase.endsWith('-') ? taskBase + chapter : taskBase
    const book = a.role === 'idea-generator' || a.role === 'editor-in-chief' ? undefined : pick(activeBooks).slug
    const other = pick(agents.filter((x) => x.id !== a.id))
    const requester = rnd() < 0.08 ? 'you' : rnd() < 0.1 ? 'engine' : other.id
    a.jobId = `job-${++jobCounter}`
    a.book = book
    a.task = task
    a.requester = requester
    a.ticks = 6 + Math.floor(rnd() * 14)
    a.tokens = 0
    a.phase = 'main'
    setState(a, REVIEWING.has(a.role) ? 'reviewing' : 'working', task)
    emit({ type: 'job.started', jobId: a.jobId, agent: a.id, task, book, model: a.model })
    if (requester !== 'engine') emit({ type: 'handover', from: requester, to: a.id, label: task, jobId: a.jobId })
  }

  const finishJob = (a: FakeAgent, ok: boolean) => {
    const jobId = a.jobId!
    const tokensIn = 800 + Math.floor(rnd() * 5000)
    const tokensOut = a.tokens || 400
    const costUsd = a.model.startsWith('deepseek') ? (tokensIn * 0.00000014 + tokensOut * 0.00000028) * 4 : 0
    emit({ type: 'spend', provider: a.model.split('/')[0]!, model: a.model.split('/')[1]!, tokensIn, tokensOut, costUsd, agent: a.id, book: a.book })
    spend.today += costUsd
    spend.month += costUsd
    emit({ type: 'job.done', jobId, agent: a.id, ok, result: ok ? `books/${a.book ?? 'x'}/chapters/${a.task?.split(' ').pop() ?? '01'}.md` : undefined, error: ok ? undefined : '429 rate limited by provider' })
    if (a.requester && a.requester !== 'engine') emit({ type: 'handover', from: a.requester, to: a.id, label: a.task ?? '', jobId, done: true })
    a.jobId = undefined
    a.ticks = 0
    if (!ok) {
      setState(a, 'error', '429 rate limited')
      a.ticks = -3
      return
    }
    setState(a, a.paused ? 'paused' : 'idle')
    // sometimes a book moves on
    if (rnd() < 0.18 && a.book) {
      const b = books.find((x) => x.slug === a.book)
      const order = ['idea', 'outline', 'drafting', 'editing', 'published']
      if (b && order.indexOf(b.stage) >= 0 && order.indexOf(b.stage) < order.length - 1) {
        b.stage = order[order.indexOf(b.stage) + 1]!
        emit({ type: 'book.stage', book: b.slug, stage: b.stage })
        if (b.stage === 'published') activeBooks.splice(activeBooks.indexOf(b as (typeof activeBooks)[number]), 1)
      }
    }
  }

  const step = () => {
    for (const a of agents) {
      if (a.paused || allPaused) continue
      if (a.ticks < 0) {
        a.ticks++
        if (a.ticks === 0) setState(a, 'idle')
        continue
      }
      if (!a.jobId) {
        if (activeBooks.length && rnd() < 0.12) startJob(a)
        continue
      }
      a.ticks--
      // stream some words
      if (a.phase === 'main' && (a.state === 'working' || a.state === 'reviewing')) {
        const n = 3 + Math.floor(rnd() * 7)
        let text = ''
        for (let i = 0; i < n; i++) text += pick(WORDS) + ' '
        a.tokens += n
        emit({ type: 'job.token', jobId: a.jobId, agent: a.id, text })
      }
      if (a.phase === 'main' && a.ticks > 3 && rnd() < 0.07) {
        a.phase = rnd() < 0.5 ? 'wait-provider' : 'wait-research'
        setState(a, a.phase === 'wait-provider' ? 'waiting-provider' : 'waiting-research', a.task)
        if (a.phase === 'wait-research') {
          const researcher = agents.find((x) => x.role === 'researcher')
          if (researcher) emit({ type: 'handover', from: a.id, to: researcher.id, label: 'question: ship travel times', jobId: `q-${a.jobId}` })
        }
      } else if (a.phase !== 'main' && rnd() < 0.4) {
        if (a.phase === 'wait-research') {
          const researcher = agents.find((x) => x.role === 'researcher')
          if (researcher) emit({ type: 'handover', from: a.id, to: researcher.id, label: 'question: ship travel times', jobId: `q-${a.jobId}`, done: true })
        }
        a.phase = 'main'
        setState(a, REVIEWING.has(a.role) ? 'reviewing' : 'working', a.task)
      }
      if (a.ticks <= 0 && a.phase === 'main') finishJob(a, rnd() > 0.06)
    }
  }

  const historyFor = (rel: string): string | null => {
    const m = /^logs\/agents\/(.+)\.md$/.exec(rel)
    const book = /^books\/([^/]+)\/log\.md$/.exec(rel)
    if (!m && !book) return null
    const agent = m ? agents.find((a) => a.id === m[1]) : pick(agents)
    if (!agent) return null
    const slug = book ? book[1]! : books[0]!.slug
    let md = ''
    for (let i = 0; i < 3; i++) {
      const id = `${slug}--draft--ch-0${i + 1}--r0`
      md +=
        `\n## 2026-10-0${i + 5}T10:0${i}:00+02:00 job \`${id}\`\n\n- requested by: ${i === 0 ? 'you' : 'editor-in-chief-edith-marlowe'}\n- task: draft (role ${agent.role}), book ${slug}, unit ch-0${i + 1}, round 0\n` +
        `- agent: ${agent.id}, first model: ${agent.model}, prompt version a1b2c3, attempt 1\n### Context\n- bible/characters (412 tokens)\n- chapters/ch-0${i}.summary (233 tokens)\n### Output\n\n` +
        'Once upon a time a small fox carried a lantern through the quiet fields. '.repeat(3) +
        `\n\n### Result\nWritten to books/${slug}/chapters/ch-0${i + 1}.md. 1 call(s), 2100 in (0 cached) / 640 out tokens, 0.000812 USD, 12.4 s\n`
    }
    return md
  }

  const api: RendererApi = {
    bookUrl: makeBookUrl(books),
    openFolder: async () => true,
    getStartWithWindows: async () => false,
    setStartWithWindows: async (on) => on,
    on(handler) {
      handlers.add(handler)
      setTimeout(() => {
        handler({ type: 'engine.ready', pid: 4242, dataDir: 'C:/demo/scriptorium-data', at: new Date().toISOString() })
        handler(snapshot())
        for (let i = 0; i < 5; i++) step() // start with a busy office
      }, 0)
      return () => handlers.delete(handler)
    },
    send(command) {
      commands.push(command)
      switch (command.type) {
        case 'snapshot':
          emit(snapshot())
          break
        case 'ping':
          emit({ type: 'pong', id: command.id, at: new Date().toISOString() })
          break
        case 'pauseAll':
          allPaused = true
          for (const a of agents) a.paused = true
          emit({ type: 'factory.paused', paused: true })
          for (const a of agents) emit({ type: 'agent.state', agent: a.id, role: a.role, state: 'paused' })
          break
        case 'resumeAll':
          allPaused = false
          for (const a of agents) a.paused = false
          emit({ type: 'factory.paused', paused: false })
          for (const a of agents) emit({ type: 'agent.state', agent: a.id, role: a.role, state: 'idle' })
          break
        case 'pause':
        case 'resume': {
          const a = agents.find((x) => x.id === command.agent)
          if (a) {
            a.paused = command.type === 'pause'
            setState(a, a.paused ? 'paused' : a.jobId ? 'working' : 'idle', a.task)
          }
          break
        }
        case 'stop': {
          const a = agents.find((x) => x.id === command.agent)
          if (a?.jobId) finishJob(a, false)
          break
        }
        case 'stopNow':
          for (const a of agents) if (a.jobId) finishJob(a, false)
          break
        case 'fire': {
          const i = agents.findIndex((x) => x.id === command.agent)
          if (i >= 0) {
            agents.splice(i, 1)
            emit({ type: 'agent.removed', agent: command.agent })
          }
          break
        }
        case 'hire': {
          const n = agents.length + 1
          const hired: FakeAgent = {
            id: `${command.role}-new-${n}`,
            name: command.name ?? `New Hire ${n}`,
            role: command.role,
            paused: false,
            state: 'idle',
            model: command.model ?? roleDefaults[command.role] ?? DS,
            override: command.model ?? null,
            ticks: 0,
            tokens: 0,
            phase: 'main'
          }
          agents.push(hired)
          emit({ type: 'agent.hired', agent: summaryOf(hired) })
          break
        }
        case 'setModel': {
          if (command.agent) {
            const a = agents.find((x) => x.id === command.agent)
            if (a) {
              a.override = command.model
              a.model = command.model ?? roleDefaults[a.role] ?? a.model
              emit({ type: 'agent.hired', agent: summaryOf(a) })
            }
          } else if (command.role && command.model) {
            roleDefaults[command.role] = command.model
            for (const a of agents) {
              if (a.role === command.role && !a.override) a.model = command.model
            }
            emit(snapshot())
          }
          break
        }
        case 'rate': {
          const b = books.find((x) => x.slug === command.book)
          if (b) {
            b.rating = command.rating
            b.note = command.note ?? null
            emit({ type: 'book.updated', book: summaryOfBook(b, topics) })
          }
          break
        }
        case 'sendToKindle':
          setTimeout(() => emit({ type: 'kindle.sent', book: command.book, ok: true }), 200)
          break
        case 'setTopicActive': {
          const t = topics.find((x) => x.id === command.id)
          if (t) t.active = command.active
          emit({ type: 'topics.updated', topics: topicSummaries(topics, books) })
          break
        }
        case 'saveSettings': {
          const { type: _type, ...rest } = command
          settings = rest
          break
        }
        case 'setSecret':
          secretsSet.add(command.name)
          emit({ type: 'secrets.updated', secretsSet: [...secretsSet] })
          break
        default:
          break
      }
    },
    async readFile(rel) {
      if (rel.startsWith('jobs/')) return `---\nkind: job\nid: ${rel.split('/').pop()}\n---\n## Request\n\n[system]\nYou are a writer.\n\n[user]\nDraft chapter 3 using the bible and the outline.\n`
      return historyFor(rel)
    },
    async tailFile(rel) {
      const text = historyFor(rel)
      return text === null ? null : { text, size: text.length }
    }
  }
  ;(window as { scriptorium: RendererApi }).scriptorium = api
  window.__scriptoriumFake = { commands, emit, step }
  if (tickMs > 0) setInterval(step, tickMs)
}

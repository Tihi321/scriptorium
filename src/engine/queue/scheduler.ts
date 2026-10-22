import { createHash } from 'node:crypto'
import type { EngineEvent, AgentProblem, AgentState } from '../../shared/protocol'
import type { FactoryConfig, JobFrontmatter } from '../../shared/schemas'
import type { AgentDef, AgentStore } from '../agents/agents'
import type { Budget } from '../budget/spend'
import { localIso } from '../budget/spend'
import type { LogWriter } from '../logs/logs'
import { isPaidModel } from '../models/registry'
import type { ModelInfo } from '../models/registry'
import type { ModelRouter } from '../models/router'
import { BudgetError, emptyUsage, isAbortError, ServerDownError } from '../models/types'
import type { ChatMessage, Usage } from '../models/types'
import type { JobFile, JobStore, NewJob } from './jobs'

export interface ChatOptions {
  messages: ChatMessage[]
  schema?: Record<string, unknown>
  maxTokens?: number
  temperature?: number
  /** Instruction lines of the prompt that the answer must not repeat (`instructionLines`): a client answer that does is refused up front. */
  forbid?: string[]
}

export interface ChatResult {
  text: string
  usage: Usage
  model: ModelInfo
  costUsd: number
}

export interface JobContext {
  job: JobFrontmatter
  jobBody: string
  agent: { id: string; role: string; name: string; persona: string }
  signal: AbortSignal
  /** Calls the model through the router: fallback, limits, budget and spend rows are handled. */
  chat(opts: ChatOptions): Promise<ChatResult>
  /** Lists what went into the request, for the terminal and the log. */
  context(items: { name: string; tokens: number }[]): void
  /** Tells the scheduler which prompt template text was used, so `prompt_version` covers the edited file. */
  usedTemplate(templateText: string): string
  /** Adds a line to the job's log block. */
  log(text: string): void
  /** Enqueues a follow-up job (idempotent by id). */
  enqueue(job: NewJob, body?: string): Promise<boolean>
}

export type HandlerResult = { result: string; resultPath?: string } | { suspendOn: string }

export type JobHandler = (ctx: JobContext) => Promise<HandlerResult>

export interface HandlerOptions {
  /** Prompt template text. Hashed with the agent body into `prompt_version`. */
  template?: string
  /** Shows the agent as "reviewing" instead of "working". */
  reviewing?: boolean
}

type AbortReason = 'stop' | 'fire' | 'stopNow' | 'shutdown'

interface RunningJob {
  job: JobFile
  agentId: string
  controller: AbortController
  reason?: AbortReason
  done: Promise<void>
  /** Providers whose slot the job holds from its start: the first model's, until the job falls back to another provider. */
  held: Set<string>
  /** The model the job calls now: the first one, then each fallback. */
  model: string
  /** Aborts only the request in flight, for a model change. The job goes on. */
  request?: AbortController
  /** The first model of the list the request in flight was sent with. */
  first?: string
  /** The agent's or role's model changed: the job's next request builds its model list again. */
  modelChanged?: boolean
  /** The book's own model for the job's role (`role_models` in book.md), first in its model list. */
  bookModel?: string
}

interface AgentRuntime {
  id: string
  running: Map<string, RunningJob>
  retiring: boolean
  state?: string
  task?: string
  jobId?: string
  book?: string
  errorUntil: number
  /** A server its job needs is down: until then the agent shows as waiting for the provider (see `ServerDownError`). */
  waitUntil?: number
  waitNote?: string
  /** Its last failed request, until a request of it is answered again. */
  problem?: AgentProblem
}

export interface SchedulerDeps {
  jobs: JobStore
  agents: AgentStore
  router: ModelRouter
  budget: Budget
  logs: LogWriter
  /** A line for the engine log (the last resort model taking a job). */
  log?: (text: string) => void
  getFactory: () => FactoryConfig
  emit: (e: EngineEvent) => void
  pollMs?: number
  now?: () => number
  /** Called when an agent file was removed (a graceful fire finished). */
  onAgentsChanged?: () => void
  /** True for a book paused on its own (`paused: true` in book.md): its jobs wait, running ones finish. */
  isBookPaused?: (book: string) => boolean
  /** The model a book sets for a role (`role_models` in book.md), if any. */
  getBookModel?: (book: string, role: string) => Promise<string | undefined>
  /** The model a story sets for a role (`role_models` in ideas/<story>.md): for a job of no book yet, such as `start_book`. */
  getIdeaModel?: (idea: string, role: string) => Promise<string | undefined>
}

/** A queued job that no model can take now, and why (`factory_status` shows them). */
export interface BlockedJob {
  job: string
  role: string
  agent: string
  reason: string
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8)

export class Scheduler {
  private handlers = new Map<string, { fn: JobHandler; opts: HandlerOptions }>()
  private runtimes = new Map<string, AgentRuntime>()
  private running = new Map<string, RunningJob>()
  private locks = new Set<string>()
  private ticking = false
  private again = false
  private timer: NodeJS.Timeout | undefined
  private stopped = false
  private blocked: BlockedJob[] = []
  private readonly now: () => number

  constructor(private readonly d: SchedulerDeps) {
    this.now = d.now ?? Date.now
  }

  register(task: string, fn: JobHandler, opts: HandlerOptions = {}): void {
    this.handlers.set(task, { fn, opts })
  }

  start(): void {
    this.stopped = false
    this.timer = setInterval(() => void this.tick(), this.d.pollMs ?? 1000)
    this.timer.unref?.()
    void this.tick()
  }

  kick(): void {
    void this.tick()
  }

  async tick(): Promise<void> {
    if (this.stopped) return
    if (this.ticking) {
      this.again = true
      return
    }
    this.ticking = true
    try {
      do {
        this.again = false
        await this.tickOnce()
      } while (this.again && !this.stopped)
    } catch (err) {
      // a file operation that failed for a moment (Windows locks): the next tick starts over, nothing is lost
      console.error('[engine] scheduler tick failed:', (err as Error).message)
    } finally {
      this.ticking = false
    }
  }

  // ---- controls ----

  stopAgent(agentId: string, reason: AbortReason = 'stop'): number {
    let n = 0
    for (const rj of this.running.values()) {
      if (rj.agentId === agentId) {
        this.abort(rj, reason)
        n++
      }
    }
    return n
  }

  stopAll(reason: AbortReason = 'stopNow'): number {
    let n = 0
    for (const rj of this.running.values()) {
      this.abort(rj, reason)
      n++
    }
    return n
  }

  /**
   * The model of running jobs changed (an agent's own model, a role default, the default models or their order). Each matching job
   * takes the new model list from its next request; a request in flight on a model that is no longer first starts again on the new one.
   * Earlier requests of the job are kept. Returns how many requests were restarted.
   */
  changeModel(match: { agent?: string; role?: string; book?: string } = {}): number {
    let n = 0
    for (const rj of this.running.values()) {
      if (match.agent && rj.agentId !== match.agent) continue
      if (match.role && rj.job.data.role !== match.role) continue
      if (match.book && rj.job.data.book !== match.book) continue
      rj.modelChanged = true
      const first = this.modelsFor(rj)[0]
      if (rj.request && first && first.ref !== rj.first) {
        rj.request.abort()
        n++
      }
    }
    return n
  }

  /** The models a running job may use now: the agent's own model (as its file says now), then its role's list. */
  private modelsFor(rj: RunningJob): ModelInfo[] {
    const def = this.d.agents.get(rj.agentId)
    return this.d.router.candidates(rj.job.data.role, { agentModel: def?.data.model, avoidFamily: rj.job.data.avoid_family, bookModel: rj.bookModel })
  }

  /** A book's model for a role was set or cleared: its running jobs of that role switch (see `changeModel`). */
  bookModelChanged(book: string, role: string, model: string | undefined): number {
    for (const rj of this.running.values()) {
      if (rj.job.data.book === book && rj.job.data.role === role) rj.bookModel = model
    }
    return this.changeModel({ book, role })
  }

  /** Fire: graceful lets the current job finish, then removes the file. Now aborts it and removes the file at once. */
  async fire(agentId: string, now: boolean): Promise<void> {
    const rt = this.runtimes.get(agentId)
    if (rt) rt.retiring = true
    if (now) this.stopAgent(agentId, 'fire')
    if (!rt || rt.running.size === 0 || now) await this.d.agents.remove(agentId)
    this.d.onAgentsChanged?.()
    this.kick()
  }

  /** Waits for every running job to settle. */
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()].map((r) => r.done))
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.stopAll('shutdown')
    await this.drain()
  }

  /** The queued jobs that no model could take at the last tick, with the reason (a server down, a day used up, a rate limit, all slots busy). */
  blockedJobs(): BlockedJob[] {
    return [...this.blocked]
  }

  runningJobs(): { jobId: string; agent: string }[] {
    return [...this.running.values()].map((r) => ({ jobId: r.job.id, agent: r.agentId }))
  }

  agentStates(): { id: string; state: string }[] {
    return [...this.runtimes.values()].map((r) => ({ id: r.id, state: r.state ?? 'idle' }))
  }

  /** The agent's current state, task, book and the model its job calls now, for snapshots. */
  agentInfo(id: string): { state: AgentState; task?: string; book?: string; jobId?: string; model?: string; problem?: AgentProblem } {
    const r = this.runtimes.get(id)
    const state = (r?.state?.split('|')[0] ?? 'idle') as AgentState
    const model = r?.jobId ? r.running.get(r.jobId)?.model : undefined
    return { state, task: r?.task || undefined, book: r?.book, jobId: r?.jobId, model, problem: r?.problem }
  }

  /** Records an agent's failed request, or clears it (`undefined`) when one is answered again, and tells the office. */
  private setProblem(rt: AgentRuntime, problem: AgentProblem | undefined): void {
    if (!problem && !rt.problem) return
    rt.problem = problem
    this.d.emit({ type: 'agent.problem', agent: rt.id, problem: problem ?? null })
  }

  private abort(rj: RunningJob, reason: AbortReason): void {
    rj.reason = rj.reason ?? reason
    rj.controller.abort()
  }

  // ---- the loop ----

  private runtimeFor(id: string): AgentRuntime {
    let rt = this.runtimes.get(id)
    if (!rt) this.runtimes.set(id, (rt = { id, running: new Map(), retiring: false, errorUntil: 0 }))
    return rt
  }

  private async tickOnce(): Promise<void> {
    const { jobs, agents, router, budget } = this.d
    const defs = new Map(agents.list().map((a) => [a.id, a]))
    for (const id of defs.keys()) this.runtimeFor(id)
    for (const rt of [...this.runtimes.values()]) {
      if (!defs.has(rt.id)) {
        rt.retiring = true
        if (rt.running.size === 0) this.runtimes.delete(rt.id)
      }
    }

    const blocked = new Map<string, string>()
    const blockedJobs: BlockedJob[] = []
    const factory = this.d.getFactory()
    if (!factory.paused) {
      const queued = await jobs.list('queued')
      const doneIds = new Set(await jobs.ids('done'))
      queued.sort((a, b) => (a.data.created ?? '').localeCompare(b.data.created ?? '') || a.id.localeCompare(b.id))
      const t = this.now()
      for (const job of queued) {
        if (this.stopped) break
        const j = job.data
        if (!this.handlers.has(j.task)) continue
        if (j.not_before && Date.parse(j.not_before) > t) continue
        if (j.book && this.d.isBookPaused?.(j.book)) continue
        if (j.depends_on.some((id) => !doneIds.has(id))) continue
        if (j.waiting_on && !doneIds.has(j.waiting_on)) continue
        if (j.locks.some((l) => this.locks.has(l))) continue

        const agent = this.pickAgent(j, defs)
        if (!agent) continue
        const rt = this.runtimeFor(agent.id)
        const bookModel = j.book ? await this.d.getBookModel?.(j.book, j.role) : j.idea ? await this.d.getIdeaModel?.(j.idea, j.role) : undefined
        const models = router.candidates(j.role, { agentModel: agent.data.model, avoidFamily: j.avoid_family, bookModel })
        if (models.length === 0) {
          rt.errorUntil = t + 3000
          this.setState(rt, agent, 'error', 'no model available for this role')
          continue
        }
        let chosen: ModelInfo | undefined
        let launchWith = models
        const reasons: string[] = []
        let unusable = 0 // models skipped because they are down or used up for the day
        let otherSkips = false // a model skipped for its budget or because it is busy or rate-limited: the job just waits for it
        for (const m of models) {
          if (isPaidModel(m) && !budget.isExhausted(j.book).ok) {
            otherSkips = true
            continue // paid and over a cap: try the next (local) model
          }
          if (!router.usable(m.provider)) {
            unusable++
            // down or used up for the day: never wait on it, try the next model. When every model is like that the job waits (below)
            // instead of starting on a server that does not answer, which would fail it three times and fail the book.
            reasons.push(`${m.ref}: ${router.blockReason(m.provider)}`)
            continue
          }
          if (!router.limiter.hasCapacity(m.provider)) {
            otherSkips = true
            reasons.push(`${m.ref}: ${router.blockReason(m.provider)}`)
            break // wait for the preferred provider instead of silently using a paid fallback
          }
          router.limiter.tryAcquire(m.provider)
          chosen = m
          break
        }
        // every model of the role is down or used up for the day (none only busy, rate-limited or over budget): the last resort of settings.md
        const lastResort = !chosen && !otherSkips && unusable === models.length ? router.registry.lastResort() : undefined
        if (lastResort && !models.some((m) => m.ref === lastResort.ref)) {
          const p = lastResort.provider
          if (!router.usable(p)) reasons.push(`${lastResort.ref} (last resort): ${router.blockReason(p)}`)
          else if (isPaidModel(lastResort) && !budget.isExhausted(j.book).ok) reasons.push(`${lastResort.ref} (last resort): over budget`)
          else if (!router.limiter.hasCapacity(p)) reasons.push(`${lastResort.ref} (last resort): ${router.blockReason(p)}`)
          else {
            router.limiter.tryAcquire(p)
            chosen = lastResort
            launchWith = [lastResort]
            this.d.log?.(`every model of ${j.role} is unusable (${reasons.join('; ')}): using the last resort ${lastResort.ref}`)
          }
        }
        if (!chosen) {
          if (reasons.length) {
            const reason = reasons.join('; ')
            if (!blocked.has(agent.id)) blocked.set(agent.id, reason)
            blockedJobs.push({ job: job.id, role: j.role, agent: agent.id, reason })
          }
          continue
        }
        const claimed = await jobs.claim(job.id)
        // the scheduler stopped while the job was being claimed: nothing aborts it later, and a job that waits for a client would hold the stop forever
        if (claimed && this.stopped) {
          router.limiter.release(chosen.provider)
          await jobs.requeue(claimed.id).catch(() => undefined)
          break
        }
        if (!claimed) {
          router.limiter.release(chosen.provider)
          continue
        }
        for (const l of j.locks) this.locks.add(l)
        this.launch(claimed, agent, launchWith.slice(launchWith.indexOf(chosen)), chosen, bookModel)
      }
    }
    this.blocked = blockedJobs
    for (const rt of this.runtimes.values()) {
      const def = defs.get(rt.id)
      if (!def) continue
      if (rt.running.size === 0) {
        if (def.data.paused) this.setState(rt, def, 'paused')
        else if (rt.errorUntil > this.now()) this.setState(rt, def, 'error', rt.state?.split('|')[1])
        else if (rt.waitUntil && rt.waitUntil > this.now()) this.setState(rt, def, 'waiting-provider', rt.waitNote)
        else if (blocked.has(rt.id)) this.setState(rt, def, 'waiting-provider', blocked.get(rt.id))
        else this.setState(rt, def, 'idle')
      }
    }
  }

  private pickAgent(j: JobFrontmatter, defs: Map<string, AgentDef>): AgentDef | undefined {
    // agents assigned exclusively to the book (`pin_exclusive`) are the only ones that may take its jobs: the job waits for them
    const owners = new Set<string>()
    if (j.book) {
      for (const def of defs.values()) {
        if (def.data.role === j.role && def.data.pin === j.book && def.data.pin_exclusive && this.runtimes.get(def.id)?.retiring === false) owners.add(def.id)
      }
    }
    const options: { def: AgentDef; focus: boolean; hint: boolean; pinned: boolean; load: number }[] = []
    for (const def of defs.values()) {
      const rt = this.runtimes.get(def.id)
      if (!rt || rt.retiring || def.data.paused) continue
      if (def.data.role !== j.role) continue
      if (rt.running.size >= def.data.max_parallel) continue
      if (def.data.pin && def.data.pin !== j.book) continue
      if (owners.size && !owners.has(def.id)) continue
      options.push({ def, focus: !!j.book && def.data.focus.includes(j.book), hint: j.agent_hint === def.id, pinned: !!j.book && def.data.pin === j.book, load: rt.running.size })
    }
    if (owners.size) return options.sort((a, b) => Number(b.hint) - Number(a.hint) || a.load - b.load || a.def.id.localeCompare(b.def.id))[0]?.def
    // the hinted agent (same writer for a book) is busy finishing the job before this one: wait a little for it
    if (j.agent_hint && !options.some((o) => o.hint)) {
      const hinted = defs.get(j.agent_hint)
      const age = this.now() - (j.created ? Date.parse(j.created) : 0)
      if (hinted && !hinted.data.paused && this.runtimes.get(hinted.id)?.retiring === false && age < 20_000) return undefined
    }
    options.sort((a, b) => Number(b.hint) - Number(a.hint) || Number(b.pinned) - Number(a.pinned) || Number(b.focus) - Number(a.focus) || a.load - b.load || a.def.id.localeCompare(b.def.id))
    return options[0]?.def
  }

  private setState(rt: AgentRuntime, def: AgentDef, state: AgentState, task?: string, job?: JobFrontmatter): void {
    const key = `${state}|${task ?? ''}|${job?.id ?? ''}`
    if (rt.state === key) return
    rt.state = key
    rt.task = task
    rt.jobId = job?.id
    rt.book = job?.book ?? undefined
    this.d.emit({
      type: 'agent.state',
      agent: def.id,
      role: def.data.role,
      state,
      jobId: job?.id,
      task,
      book: job?.book ?? undefined
    })
  }

  // ---- running a job ----

  private launch(job: JobFile, agent: AgentDef, models: ModelInfo[], leased: ModelInfo, bookModel?: string): void {
    const rt = this.runtimeFor(agent.id)
    const controller = new AbortController()
    const rj: RunningJob = { job, agentId: agent.id, controller, done: Promise.resolve(), held: new Set([leased.provider.id]), model: leased.ref, bookModel }
    this.running.set(job.id, rj)
    rt.running.set(job.id, rj)
    rj.done = this.run(rj, agent, models, leased).catch((err) => { console.error('[engine] job runner failed:', err) }).finally(() => {
      this.running.delete(job.id)
      rt.running.delete(job.id)
      if (rj.held.delete(leased.provider.id)) this.d.router.limiter.release(leased.provider)
      for (const l of job.data.locks) this.locks.delete(l)
      void this.afterJob(rt, agent).finally(() => this.kick())
    })
  }

  private async afterJob(rt: AgentRuntime, agent: AgentDef): Promise<void> {
    if (rt.running.size === 0) {
      if (rt.retiring) {
        await this.d.agents.remove(agent.id)
        this.runtimes.delete(agent.id)
        this.d.onAgentsChanged?.()
        return
      }
      const def = this.d.agents.get(agent.id) ?? agent
      if (def.data.paused) this.setState(rt, def, 'paused')
      else if (this.now() < rt.errorUntil) this.setState(rt, def, 'error')
      else if (rt.waitUntil && rt.waitUntil > this.now()) this.setState(rt, def, 'waiting-provider', rt.waitNote)
      else this.setState(rt, def, 'idle')
    }
  }

  private async run(rj: RunningJob, agent: AgentDef, startModels: ModelInfo[], leased: ModelInfo): Promise<void> {
    let models = startModels
    const { jobs, logs, emit } = this.d
    const { job } = rj
    const j = job.data
    const handler = this.handlers.get(j.task)!
    const rt = this.runtimeFor(agent.id)
    const started = Date.now()
    let promptVersion = sha((handler.opts.template ?? '') + agent.body)
    const taskLabel = j.label?.trim() || `${j.task}${j.unit ? ' ' + j.unit : ''}`
    const requests: string[] = []
    const usedModels: string[] = []
    const totals = { calls: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, costUsd: 0 }
    const logAll = (text: string) => logs.both(agent.id, j.book, text)

    this.setState(rt, agent, handler.opts.reviewing ? 'reviewing' : 'working', taskLabel, j)
    emit({ type: 'job.started', jobId: j.id, agent: agent.id, task: taskLabel, book: j.book ?? undefined, model: leased.ref })
    if (j.requested_by !== 'engine') {
      emit({ type: 'handover', from: j.requested_by, to: agent.id, label: taskLabel, jobId: j.id })
    }
    logAll(
      `\n## ${localIso(new Date())} job \`${j.id}\`\n\n` +
        `- requested by: ${j.requested_by}\n- task: ${j.task} (role ${j.role})${j.book ? `, book ${j.book}` : ''}${j.unit ? `, unit ${j.unit}` : ''}, round ${j.round}\n` +
        `- agent: ${agent.id}, first model: ${leased.ref}, prompt version ${promptVersion}, attempt ${j.attempts + 1}\n`
    )
    await jobs.update('running', j.id, { paid: isPaidModel(leased), prompt_version: promptVersion, agent: agent.id, model: leased.ref } as Partial<JobFrontmatter>)

    const ctx: JobContext = {
      job: j,
      jobBody: job.body,
      agent: { id: agent.id, role: agent.data.role, name: agent.data.name, persona: agent.body },
      signal: rj.controller.signal,
      usedTemplate: (text) => (promptVersion = sha(text + agent.body)),
      context: (items) => {
        logAll('### Context\n' + items.map((i) => `- ${i.name} (${i.tokens} tokens)`).join('\n') + '\n')
      },
      log: (text) => logAll(text.endsWith('\n') ? text : text + '\n'),
      enqueue: (nj, body) => jobs.enqueue({ requested_by: agent.id, ...nj }, body),
      chat: async (o) => {
        requests.push(o.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'))
        let text = ''
        let result: ChatResult | undefined
        logAll(`### Output\n`)
        for (;;) {
          if (rj.modelChanged) {
            rj.modelChanged = false
            const next = this.modelsFor(rj)
            if (next.length > 0) models = next
          }
          // a model change aborts only this request; stopping the job aborts it too
          const request = new AbortController()
          const onStop = () => request.abort()
          rj.controller.signal.addEventListener('abort', onStop, { once: true })
          if (rj.controller.signal.aborted) request.abort()
          rj.request = request
          rj.first = models[0]?.ref
          try {
            for await (const ev of this.d.router.chat(
              models,
              {
                messages: o.messages,
                schema: o.schema,
                maxTokens: o.maxTokens,
                temperature: o.temperature,
                signal: request.signal,
                meta: { job: j.id, role: j.role, task: j.task, book: j.book ?? undefined, agent: agent.id, unit: j.unit ?? undefined, ...(o.forbid?.length ? { forbid: o.forbid } : {}) }
              },
              rj.held
            )) {
              if (ev.type === 'attempt') {
                text = ''
                if (ev.model.ref !== (usedModels[usedModels.length - 1] ?? leased.ref)) {
                  emit({ type: 'job.model', jobId: j.id, agent: agent.id, model: ev.model.ref })
                }
                // fell back to another provider: give the first one's slot back, so other agents don't wait for a server this job no longer uses
                if (ev.model.provider.id !== leased.provider.id && rj.held.delete(leased.provider.id)) {
                  this.d.router.limiter.release(leased.provider)
                  this.kick()
                }
                usedModels.push(ev.model.ref)
                rj.model = ev.model.ref
                logAll(`\n_model ${ev.model.ref}${ev.attempt > 1 ? ' (fallback or retry)' : ''}_\n\n`)
              } else if (ev.type === 'problem') {
                this.setProblem(rt, { kind: ev.kind, model: ev.model.ref, message: ev.message.slice(0, 300), at: this.now() })
              } else if (ev.type === 'delta') {
                text += ev.text
                emit({ type: 'job.token', jobId: j.id, agent: agent.id, text: ev.text })
                logAll(ev.text)
              } else {
                this.setProblem(rt, undefined)
                totals.calls++
                totals.tokensIn += ev.usage.inputTokens
                totals.tokensCached += ev.usage.cachedInputTokens
                totals.tokensOut += ev.usage.outputTokens
                totals.costUsd += ev.costUsd
                result = { text, usage: ev.usage, model: ev.model, costUsd: ev.costUsd }
                emit({
                  type: 'spend',
                  provider: ev.model.provider.id,
                  model: ev.model.id,
                  tokensIn: ev.usage.inputTokens,
                  tokensOut: ev.usage.outputTokens,
                  costUsd: ev.costUsd,
                  agent: agent.id,
                  book: j.book ?? undefined
                })
              }
            }
            break
          } catch (err) {
            // only a model change aborts the request without stopping the job: ask again, on the new model list
            if (rj.controller.signal.aborted || !request.signal.aborted) throw err
            rj.modelChanged = true
            logAll(`\n_model changed, this request starts again_\n\n`)
          } finally {
            rj.controller.signal.removeEventListener('abort', onStop)
            rj.request = undefined
          }
        }
        logAll('\n')
        return result ?? { text, usage: emptyUsage(), model: leased, costUsd: 0 }
      }
    }

    const numbers = () =>
      `${totals.calls} call(s), ${totals.tokensIn} in (${totals.tokensCached} cached) / ${totals.tokensOut} out tokens, ${totals.costUsd.toFixed(6)} USD, ${((Date.now() - started) / 1000).toFixed(1)} s`
    const requestBody = () => (job.body.trim() ? job.body.trimEnd() + '\n\n' : '') + (requests.length ? '## Request\n\n' + requests.map((r, i) => `### Call ${i + 1}\n\n${r}`).join('\n\n') + '\n\n' : '')
    const stats = (): Partial<JobFrontmatter> =>
      ({
        model: usedModels[usedModels.length - 1] ?? leased.ref,
        prompt_version: promptVersion,
        tokens_in: totals.tokensIn,
        tokens_out: totals.tokensOut,
        cost_usd: Number(totals.costUsd.toFixed(6)),
        ms: Date.now() - started
      }) as Partial<JobFrontmatter>

    try {
      const out = await handler.fn(ctx)
      if (rj.controller.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if ('suspendOn' in out) {
        await jobs.requeue(j.id, { waiting_on: out.suspendOn })
        logAll(`### Result\nSuspended, waiting on ${out.suspendOn}. ${numbers()}\n`)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: true, result: `waiting on ${out.suspendOn}` })
      } else {
        await jobs.complete(j.id, { ...stats(), finished: new Date().toISOString() } as Partial<JobFrontmatter>, `${requestBody()}## Result\n\n${out.resultPath ? `Written to ${out.resultPath}\n\n` : ''}${out.result}\n\n${numbers()}\n`)
        logAll(`### Result\n${out.resultPath ? `Written to ${out.resultPath}. ` : ''}${numbers()}\n`)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: true, result: out.resultPath ?? out.result.slice(0, 200) })
      }
    } catch (err) {
      const aborted = rj.controller.signal.aborted || isAbortError(err)
      if (aborted) {
        await jobs.requeue(j.id)
        logAll(`### Result\nStopped (${rj.reason ?? 'stop'}), job goes back to the queue. ${numbers()}\n`)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: false, error: `stopped (${rj.reason ?? 'stop'})` })
      } else if (err instanceof ServerDownError) {
        // a server the job needs is not running: not the job's fault. It waits a little and goes on without an attempt counted.
        await jobs.requeue(j.id, { not_before: new Date(this.now() + 30_000).toISOString() })
        logAll(`### Result\nWaiting: ${err.message}. Job goes back to the queue for 30 seconds, no attempt counted.\n`)
        rt.waitUntil = this.now() + 30_000
        rt.waitNote = err.message.slice(0, 120)
        this.setState(rt, agent, 'waiting-provider', rt.waitNote, j)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: false, error: err.message })
      } else if (err instanceof BudgetError) {
        await jobs.requeue(j.id, { not_before: new Date(this.now() + 15_000).toISOString() })
        logAll(`### Result\nBlocked by the budget: ${err.message}. Job goes back to the queue.\n`)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: false, error: err.message })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        const attempts = j.attempts + 1
        const max = j.max_attempts ?? this.d.getFactory().max_attempts
        rt.errorUntil = this.now() + 3000
        if (rt.problem) this.setProblem(rt, { ...rt.problem, failed: true })
        if (attempts >= max) {
          await jobs.fail(j.id, { ...stats(), attempts, failure: message } as Partial<JobFrontmatter>, `${requestBody()}## Failed\n\n${message}\n`)
          logAll(`### Result\nFailed for good after ${attempts} attempt(s): ${message}\n`)
        } else {
          const wait = Math.min(60_000, 1000 * 2 ** attempts)
          await jobs.requeue(j.id, { attempts, not_before: new Date(this.now() + wait).toISOString() })
          logAll(`### Result\nFailed (attempt ${attempts} of ${max}): ${message}. Retrying in ${wait / 1000} s.\n`)
        }
        this.setState(rt, agent, 'error', message.slice(0, 80), j)
        emit({ type: 'job.done', jobId: j.id, agent: agent.id, ok: false, error: message })
      }
    }
    if (j.requested_by !== 'engine') {
      emit({ type: 'handover', from: j.requested_by, to: agent.id, label: taskLabel, jobId: j.id, done: true })
    }
  }
}

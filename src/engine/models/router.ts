import { estimateCost } from '../budget/spend'
import type { Budget } from '../budget/spend'
import { ProviderLimiter } from './limiter'
import { computeCost, isPaidModel } from './registry'
import type { ModelInfo, ModelRegistry, ProviderInfo } from './registry'
import { BudgetError, emptyUsage, isAbortError, ProviderError } from './types'
import type { ChatMessage, RequestMeta, Usage } from './types'
import type { ProblemKind } from '../../shared/protocol'

export interface CandidateOptions {
  /** The agent's own `provider/model` override. Goes first. */
  agentModel?: string | null
  /** The book's own model for this role (`role_models` in book.md). Goes before the agent's own model. */
  bookModel?: string | null
  /** Reviewers prefer another family than the book's writer. Models of this family go last. */
  avoidFamily?: string | null
}

export interface RoutedRequest {
  messages: ChatMessage[]
  schema?: Record<string, unknown>
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  meta: RequestMeta & { role: string }
}

export type RoutedEvent =
  | { type: 'attempt'; model: ModelInfo; attempt: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: ModelInfo; usage: Usage; costUsd: number; ms: number }
  /** A request failed: the router retries, falls back to the next model, or gives up after this. */
  | { type: 'problem'; model: ModelInfo; kind: ProblemKind; message: string }

export interface RouterOptions {
  /** Retries on the same model for retryable errors before falling back. Default 2. */
  retries?: number
  /** First backoff in ms. Doubled each retry. Default 1000. */
  backoffMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      },
      { once: true }
    )
  })

/**
 * Picks models for a role and calls them with fallback: retries with backoff on 429, 5xx and timeouts,
 * then the next model in the list. Records spend, reserves cost before paid requests, and respects provider limits.
 */
export class ModelRouter {
  readonly limiter: ProviderLimiter
  /** Called when a request finds a server not running and marks it down for every job. */
  onProviderDown?: (p: ProviderInfo) => void
  /** Called when a provider's daily limit is used up (its `rpd`, or the provider said so): its jobs use their next model until midnight UTC. */
  onProviderDayFull?: (p: ProviderInfo) => void
  /** Called once when a model turns out to be retired or unknown at its provider: it is left out of every job's list until the engine restarts. */
  onModelRetired?: (m: ModelInfo, message: string) => void
  /** Models the provider no longer serves (`provider/model` ref to the provider's text), for this engine run. */
  private readonly retired = new Map<string, string>()
  private readonly opts: Required<Omit<RouterOptions, 'now'>>

  constructor(
    readonly registry: ModelRegistry,
    readonly budget: Budget | undefined,
    opts: RouterOptions = {},
    limiter?: ProviderLimiter
  ) {
    this.limiter = limiter ?? new ProviderLimiter(opts.now)
    this.opts = { retries: opts.retries ?? 2, backoffMs: opts.backoffMs ?? 1000, sleep: opts.sleep ?? defaultSleep }
  }

  /** The provider can take requests now: its server is up and its daily limit isn't used up. */
  usable(p: ProviderInfo): boolean {
    return !p.down && !this.limiter.dayFull(p)
  }

  /** The provider's text when this model was found retired or unknown in this engine run, else undefined. */
  retiredReason(m: ModelInfo): string | undefined {
    return this.retired.get(m.ref)
  }

  /** Why a provider takes no request now, in words for the office and `factory_status`, or null when it takes one. */
  blockReason(p: ProviderInfo): string | null {
    if (p.down) return `down (${p.baseUrl ?? p.id} does not answer)`
    if (this.limiter.dayFull(p)) {
      const at = new Date(this.limiter.dayResetsAt()).toISOString().slice(11, 16)
      return `used up its requests for today (resets ${at} UTC)`
    }
    if (this.limiter.rpmWaitMs(p) > 0) return `rate limit (${p.rpm}/min)`
    if (this.limiter.inFlight(p.id) >= p.concurrency) return `busy (${this.limiter.inFlight(p.id)} of ${p.concurrency} requests at once)`
    return null
  }

  /**
   * Ordered models for a job: the agent's override, then the role's list. Unavailable providers are dropped,
   * and so are servers that are down (Strata not started) and providers whose daily limit is used up, unless nothing else is left.
   */
  candidates(role: string, o: CandidateOptions = {}): ModelInfo[] {
    const own = o.agentModel ? this.registry.resolve(o.agentModel) : undefined
    const book = o.bookModel ? this.registry.resolve(o.bookModel) : undefined
    const chosen = [book, own].filter((r): r is string => !!r)
    const refs = [...chosen, ...this.registry.roleModelRefs(role)]
    const seen = new Set<string>()
    let list: ModelInfo[] = []
    for (const ref of refs) {
      if (seen.has(ref)) continue
      seen.add(ref)
      const m = this.registry.getModel(ref)
      if (m && m.provider.available && m.provider.client && !m.embedding) list.push(m)
    }
    const up = list.filter((m) => this.usable(m.provider))
    if (up.length > 0) list = up
    // a model the provider retired answers 404 every time: leave it out while another model is left (the chain's last entry stays so the error shows)
    const live = list.filter((m) => !this.retired.has(m.ref))
    if (live.length > 0) list = live
    if (o.avoidFamily) {
      // the book's and the agent's own model were picked on purpose: they stay first even in the writer's family
      let lead = 0
      while (lead < list.length && chosen.includes(list[lead]!.ref)) lead++
      const first = list.slice(0, lead)
      const rest = list.slice(first.length)
      const keep = rest.filter((m) => m.family !== o.avoidFamily)
      const avoid = rest.filter((m) => m.family === o.avoidFamily)
      return [...first, ...keep, ...avoid]
    }
    return list
  }

  /**
   * Streams a reply, falling back through `models`. `held` are providers whose slot the caller already holds.
   * After a failed attempt the consumer sees a new `attempt` event and should drop the text so far.
   */
  async *chat(models: ModelInfo[], req: RoutedRequest, held: ReadonlySet<string> = new Set()): AsyncGenerator<RoutedEvent, void, void> {
    if (models.length === 0) throw new ProviderError(`no available model for role ${req.meta.role}`)
    let lastError: unknown
    let budgetRefusal: string | undefined
    let attempts = 0
    const failures: string[] = []
    for (const [i, model] of models.entries()) {
      // a server that went down, or a daily limit used up, after the job started: skip it while a later model can answer
      if (!this.usable(model.provider) && models.slice(i + 1).some((m) => this.usable(m.provider))) continue
      // a job that picked its models before the model was found retired skips it too
      if (this.retired.has(model.ref) && models.slice(i + 1).some((m) => !this.retired.has(m.ref))) continue
      for (let retry = 0; retry <= this.opts.retries; retry++) {
        if (req.signal?.aborted) throw abort()
        const paid = isPaidModel(model)
        let reservation
        if (paid && this.budget) {
          const est = estimateCost(model, req.messages, req.maxTokens)
          const r = this.budget.reserve(est, req.meta.book ?? '')
          if (!r.ok) {
            yield { type: 'problem', model, kind: 'budget', message: r.reason }
            budgetRefusal = r.reason
            break // next model
          }
          reservation = r.reservation
        }
        const provider = model.provider
        const holdsSlot = held.has(provider.id)
        let acquired = false
        const started = Date.now()
        try {
          if (!holdsSlot) {
            await this.limiter.acquire(provider, req.signal)
            acquired = true
          }
          const wait = this.limiter.rpmWaitMs(provider)
          if (wait > 0) await this.opts.sleep(wait, req.signal)
          this.limiter.noteRequest(provider)
          attempts++
          yield { type: 'attempt', model, attempt: attempts }
          let usage = emptyUsage()
          for await (const ev of provider.client!.chat({
            model: model.id,
            messages: req.messages,
            schema: req.schema,
            maxTokens: req.maxTokens,
            temperature: req.temperature,
            signal: req.signal,
            extraBody: model.extraBody,
            meta: req.meta
          })) {
            if (ev.type === 'delta') yield { type: 'delta', text: ev.text }
            else usage = ev.usage
          }
          const costUsd = paid ? computeCost(model, usage) : 0
          const ms = Date.now() - started
          if (this.budget) {
            await this.budget.record({
              time: new Date(),
              agent: req.meta.agent ?? '',
              book: req.meta.book ?? '',
              role: req.meta.role,
              provider: provider.id,
              model: model.id,
              tokensIn: usage.inputTokens,
              tokensCached: usage.cachedInputTokens,
              tokensOut: usage.outputTokens,
              costUsd,
              ms
            })
          }
          yield { type: 'done', model, usage, costUsd, ms }
          return
        } catch (err) {
          if (isAbortError(err) || req.signal?.aborted) throw err
          lastError = err
          yield { type: 'problem', model, kind: problemKind(err), message: err instanceof Error ? err.message : String(err) }
          // nothing listens there (Strata not started): mark it down for every job and go to the next model without retries
          if (err instanceof ProviderError && err.unreachable && provider.concurrencyAuto) {
            if (this.registry.markDown(provider)) this.onProviderDown?.(provider)
            failures.push(`${model.ref}: ${err.message}`)
            break
          }
          // the provider's daily limit is used up (OpenRouter's free-models-per-day): retrying is no use until midnight UTC
          if (isDailyLimitError(err)) {
            if (this.limiter.markDayFull(provider)) this.onProviderDayFull?.(provider)
            failures.push(`${model.ref}: ${err instanceof Error ? err.message : String(err)}`)
            break
          }
          // the provider no longer serves this model (OpenRouter retired a `:free` variant): retrying is no use, and neither is asking again in the next job
          if (isRetiredModelError(err)) {
            if (!this.retired.has(model.ref)) {
              const text = err instanceof Error ? err.message : String(err)
              this.retired.set(model.ref, text)
              this.onModelRetired?.(model, text)
            }
            failures.push(`${model.ref}: ${err instanceof Error ? err.message : String(err)}`)
            break
          }
          // a request too big for this model fails the same way every time: go straight to the next model
          const retryable = err instanceof ProviderError && err.retryable && !isContextError(err)
          if (!retryable || retry === this.opts.retries) {
            failures.push(`${model.ref}: ${err instanceof Error ? err.message : String(err)}`)
            break
          }
          const delay = (err as ProviderError).retryAfterMs ?? this.opts.backoffMs * 2 ** retry
          await this.opts.sleep(delay, req.signal)
        } finally {
          if (reservation) this.budget!.release(reservation)
          if (acquired) this.limiter.release(provider)
        }
      }
    }
    if (!lastError && budgetRefusal) throw new BudgetError(budgetRefusal)
    if (budgetRefusal) failures.push(`paid models skipped: ${budgetRefusal}`)
    // with more than one model, say why each one failed: the last error alone hides the real cause
    if (failures.length > 1) throw new ProviderError(`all models failed. ${failures.map((f) => f.slice(0, 400)).join(' | ')}`)
    throw lastError instanceof Error ? lastError : new ProviderError('all models failed')
  }
}

/** What kind of failure an error is, so the office can say why an agent isn't getting answers. */
export function problemKind(err: unknown): ProblemKind {
  if (isDailyLimitError(err)) return 'day-limit'
  if (err instanceof ProviderError && err.unreachable) return 'down'
  if (isContextError(err)) return 'too-big'
  const status = err instanceof ProviderError ? err.status : undefined
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'no-access'
  if (status === 402) return 'no-credit'
  if (status === 404) return 'not-found'
  if (status !== undefined && status >= 400 && status < 500) return 'bad-request'
  if (status !== undefined && status >= 500) return 'server'
  return 'other'
}

/** A 429 that says a daily request limit is used up (OpenRouter: `free-models-per-day`), not a per-minute one. */
export function isDailyLimitError(err: unknown): boolean {
  if (!(err instanceof ProviderError) || err.status !== 429) return false
  return /per[-_ ]day|daily/i.test(err.message)
}

/**
 * The provider says the model does not exist or was retired: OpenRouter's "has been retired" and "No endpoints found", or a 404 that says
 * the model is not found. Asking again fails the same way. Other 404s (a wrong address) are not matched.
 */
export function isRetiredModelError(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false
  if (err.status !== undefined && err.status !== 404) return false
  const msg = err.message
  if (/has been retired|variant has been retired|no endpoints found/i.test(msg)) return true
  return err.status === 404 && /model[^.]{0,60}(not found|does not exist|not exist)|no such model|unknown model/i.test(msg)
}

/** The request is larger than the model's context window, or the model ran out of tokens before answering. */
export function isContextError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /exceed_context_size|exceeds the available context|context (size|length|window)|maximum context|n_ctx|token limit without an answer/i.test(msg)
}

function abort(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

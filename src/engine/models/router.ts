import { estimateCost } from '../budget/spend'
import type { Budget } from '../budget/spend'
import { ProviderLimiter } from './limiter'
import { computeCost, isPaidModel } from './registry'
import type { ModelInfo, ModelRegistry } from './registry'
import { BudgetError, emptyUsage, isAbortError, ProviderError } from './types'
import type { ChatMessage, RequestMeta, Usage } from './types'

export interface CandidateOptions {
  /** The agent's own `provider/model` override. Goes first. */
  agentModel?: string | null
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

  /** Ordered models for a job: the agent's override, then the role's list. Unavailable providers are dropped. */
  candidates(role: string, o: CandidateOptions = {}): ModelInfo[] {
    const refs = [...(o.agentModel ? [o.agentModel] : []), ...this.registry.roleModelRefs(role)]
    const seen = new Set<string>()
    const list: ModelInfo[] = []
    for (const ref of refs) {
      if (seen.has(ref)) continue
      seen.add(ref)
      const m = this.registry.getModel(ref)
      if (m && m.provider.available && m.provider.client && !m.embedding) list.push(m)
    }
    if (o.avoidFamily) {
      const keep = list.filter((m) => m.family !== o.avoidFamily)
      const avoid = list.filter((m) => m.family === o.avoidFamily)
      return [...keep, ...avoid]
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
    for (const model of models) {
      for (let retry = 0; retry <= this.opts.retries; retry++) {
        if (req.signal?.aborted) throw abort()
        const paid = isPaidModel(model)
        let reservation
        if (paid && this.budget) {
          const est = estimateCost(model, req.messages, req.maxTokens)
          const r = this.budget.reserve(est, req.meta.book ?? '')
          if (!r.ok) {
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
          const retryable = err instanceof ProviderError && err.retryable
          if (!retryable || retry === this.opts.retries) break
          const delay = (err as ProviderError).retryAfterMs ?? this.opts.backoffMs * 2 ** retry
          await this.opts.sleep(delay, req.signal)
        } finally {
          if (reservation) this.budget!.release(reservation)
          if (acquired) this.limiter.release(provider)
        }
      }
    }
    if (!lastError && budgetRefusal) throw new BudgetError(budgetRefusal)
    throw lastError instanceof Error ? lastError : new ProviderError('all models failed')
  }
}

function abort(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

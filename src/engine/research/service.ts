import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import type { EngineEvent } from '../../shared/protocol'
import type { FactoryConfig } from '../../shared/schemas'
import type { AgentStore } from '../agents/agents'
import type { Budget } from '../budget/spend'
import { resolveKey } from '../models/keys'
import type { KeyResolver } from '../models/keys'
import type { ModelRegistry } from '../models/registry'
import type { JobStore } from '../queue/jobs'
import { questionKey, researchJobId, ResearchStore } from './notes'
import { fetchPageText, makeSearchProvider } from './web'
import type { SearchProvider, SearchResult } from './web'

// ---- searching ----

export interface SearchServiceOptions {
  registry: ModelRegistry
  budget?: Budget
  emit?: (e: EngineEvent) => void
  log?: (message: string) => void
  fetchImpl?: typeof fetch
  /** Looks up API keys. Default: environment variable, then the Windows credential store. */
  keys?: KeyResolver
  /** Tests: use these providers instead of the ones in config/providers.md. */
  providers?: SearchProvider[]
  /** Tests: replaces the page download. */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>
}

export interface SearchOutcome {
  provider: string
  results: SearchResult[]
}

/** The search providers of config/providers.md in the order of `search_order`, with spend logging and fallback. */
export class SearchService {
  constructor(private readonly o: SearchServiceOptions) {}

  /** The providers that can be used right now: enabled, with their key, known engine. */
  providers(): SearchProvider[] {
    if (this.o.providers) return this.o.providers
    const { registry } = this.o
    const infos = [...registry.providers.values()].filter((p) => p.kind === 'search' && p.available)
    const order = registry.searchOrder
    infos.sort((a, b) => {
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib)
    })
    const out: SearchProvider[] = []
    for (const p of infos) {
      const provider = makeSearchProvider({ id: p.id, engine: p.searchEngine ?? p.id, baseUrl: p.baseUrl, apiKey: p.apiKeyEnv ? (this.o.keys ?? resolveKey)(p.apiKeyEnv) : undefined, pricePerRequest: p.pricePerRequest }, this.o.fetchImpl)
      if (provider) out.push(provider)
      else this.o.log?.(`search provider ${p.id}: unknown engine "${p.searchEngine}" or no key`)
    }
    return out
  }

  /**
   * Searches with the first provider that gives results. A provider that fails, or has no results, falls through to the next.
   * A paid provider is skipped while a budget cap is reached. Every request that was answered is written to the spend rows.
   */
  async search(query: string, ctx: { signal?: AbortSignal; book?: string | null; agent?: string; limit?: number } = {}): Promise<SearchOutcome | null> {
    for (const p of this.providers()) {
      if (ctx.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      if (p.pricePerRequest > 0 && this.o.budget && !this.o.budget.isExhausted(ctx.book).ok) {
        this.o.log?.(`search provider ${p.id} skipped: a budget cap is reached`)
        continue
      }
      const started = Date.now()
      try {
        const results = await p.search(query, { signal: ctx.signal, limit: ctx.limit ?? 5 })
        await this.recordSpend(p, ctx, Date.now() - started)
        if (results.length > 0) return { provider: p.id, results }
        this.o.log?.(`search provider ${p.id}: no results for "${query}"`)
      } catch (err) {
        if (ctx.signal?.aborted || (err as Error).name === 'AbortError') throw err
        this.o.log?.(`search provider ${p.id} failed: ${(err as Error).message}`)
      }
    }
    return null
  }

  private async recordSpend(p: SearchProvider, ctx: { book?: string | null; agent?: string }, ms: number): Promise<void> {
    if (!this.o.budget) return
    await this.o.budget.record({
      time: new Date(),
      agent: ctx.agent ?? '',
      book: ctx.book ?? '',
      role: 'researcher',
      provider: p.id,
      model: 'search',
      tokensIn: 0,
      tokensCached: 0,
      tokensOut: 0,
      costUsd: p.pricePerRequest,
      ms
    })
    this.o.emit?.({ type: 'spend', provider: p.id, model: 'search', tokensIn: 0, tokensOut: 0, costUsd: p.pricePerRequest, agent: ctx.agent, book: ctx.book ?? undefined })
  }

  /** The text of a page: stripped of scripts and HTML, capped. */
  fetchPage(url: string, signal?: AbortSignal, maxChars = 6000): Promise<string> {
    if (this.o.fetchPage) return this.o.fetchPage(url, signal)
    return fetchPageText(url, { fetchImpl: this.o.fetchImpl, signal, maxChars })
  }
}

// ---- asking ----

export interface AskInput {
  question: string
  /** The book the answer is for. Its notes go in the book's research folder. Without one the answer is shared by the whole library. */
  book?: string | null
  /** An idea (a file in ideas/) the question is about. The notes are shared, because the book does not exist yet. */
  idea?: string
  /** An agent id, or `you`. Shown as the origin of the handover line in the office. */
  askedBy: string
  /** Why it is asked, for the researcher's terminal ("chapter 3 of the draft"). */
  purpose?: string
}

export type AskStatus = 'created' | 'exists' | 'limit' | 'empty' | 'no-researcher'

export interface AskResult {
  status: AskStatus
  /** The research job id (also for `exists`: it was asked before). */
  id: string | null
}

export interface ResearchServiceDeps {
  dataDir: string
  jobs: JobStore
  agents: Pick<AgentStore, 'list'>
  getFactory: () => FactoryConfig
  log: (message: string) => void
  kick: () => void
  emit?: (e: EngineEvent) => void
}

/** Creates research jobs: one place for the per-book limit, the idempotent job ids and the "is there a researcher" check. */
export class ResearchService {
  readonly store: ResearchStore
  private warned = new Set<string>()

  constructor(private readonly d: ResearchServiceDeps) {
    this.store = new ResearchStore(d.dataDir)
  }

  hasResearcher(): boolean {
    return this.d.agents.list().some((a) => a.data.role === 'researcher')
  }

  /** How many research questions this book has asked so far (jobs in any state). */
  private async asked(book: string): Promise<number> {
    const prefix = `research--${book}--`
    let n = 0
    for (const state of ['queued', 'running', 'done', 'failed'] as const) n += (await this.d.jobs.ids(state)).filter((id) => id.startsWith(prefix)).length
    return n
  }

  /**
   * Asks the researcher. The job id comes from the book and the question, so the same question is never asked twice for one book,
   * and a repeat does not count against the book's limit. At the limit the question is dropped (the writer goes on without the notes).
   */
  async ask(i: AskInput): Promise<AskResult> {
    const question = i.question.replace(/\s+/g, ' ').trim()
    if (questionKey(question).length < 3) return { status: 'empty', id: null }
    const book = i.book ?? null
    const id = researchJobId(book, question)
    if (!this.hasResearcher()) {
      this.warnOnce('no-researcher', 'a research question was asked, but there is no researcher in agents/. Hire one in the UI, or the question is skipped.')
      return { status: 'no-researcher', id: null }
    }
    for (const state of ['queued', 'running', 'done', 'failed'] as const) {
      if (await this.d.jobs.read(state, id)) return { status: 'exists', id }
    }
    if (book) {
      const limit = await this.limitFor(book)
      if ((await this.asked(book)) >= limit) {
        this.warnOnce(`limit-${book}`, `book ${book} reached its research limit (${limit} questions, research_limit_per_book in config/factory.md). Further questions are skipped.`)
        return { status: 'limit', id: null }
      }
    }
    const created = await this.d.jobs.enqueue(
      {
        id,
        task: 'research',
        role: 'researcher',
        book,
        requested_by: i.askedBy,
        label: question.length > 100 ? question.slice(0, 97) + '...' : question,
        question,
        purpose: i.purpose ?? '',
        ...(i.idea ? { idea: i.idea } : {})
      } as Parameters<JobStore['enqueue']>[0],
      `Question: ${question}\n\nAsked by: ${i.askedBy}${i.purpose ? `\nWhy: ${i.purpose}` : ''}\nFor: ${book ? `the book ${book}` : i.idea ? `the idea ${i.idea}` : 'the whole library (shared notes)'}\n`
    )
    this.d.kick()
    return { status: created ? 'created' : 'exists', id }
  }

  /** The question limit of a book: non-fiction books research every chapter and get `research_limit_nonfiction`. */
  private async limitFor(book: string): Promise<number> {
    const f = this.d.getFactory()
    try {
      const doc = parseMd(await fs.readFile(path.join(this.d.dataDir, 'books', book, 'book.md'), 'utf8'))
      if (doc.data.nonfiction === true) return f.research_limit_nonfiction
    } catch {
      /* no book file: the normal limit */
    }
    return f.research_limit_per_book
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.d.log(`warning: ${message}`)
    this.d.emit?.({ type: 'engine.warning', message })
  }
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { emptyBrief } from '../shared/brief'
import type { StoryBrief } from '../shared/brief'
import type { Command, EngineEvent, IdeaSummary, SeriesSummary, SettingsSummary, SnapshotEvent } from '../shared/protocol'
import { parseMdWith } from '../shared/md'
import { factorySchema, formatsSchema, qualitySchema, ROLES, settingsSchema } from '../shared/schemas'
import type { FactoryConfig, FormatEntry, QualityConfig, SettingsConfig } from '../shared/schemas'
import { AgentStore } from './agents/agents'
import { Budget } from './budget/spend'
import { LogWriter } from './logs/logs'
import { resolveKey, setStoredKey } from './models/keys'
import { ClientTaskQueue } from './models/client'
import { ModelRegistry, guessFamily, modelDefaultsOf } from './models/registry'
import type { ListedModel } from './models/openaiCompat'
import type { RegistryOptions } from './models/registry'
import { ModelRouter } from './models/router'
import type { RouterOptions } from './models/router'
import { JobStore } from './queue/jobs'
import { Bible } from './memory/bible'
import { MemoryService } from './memory/service'
import { ResearchService, SearchService } from './research/service'
import type { SearchServiceOptions } from './research/service'
import { BookStore, TERMINAL_BOOK_STAGES } from './pipeline/books'
import { Pipeline } from './pipeline/pipeline'
import { Scheduler } from './queue/scheduler'
import { IdeaStore } from './store/ideas'
import { bookRefs, nextSeriesIndex, SeriesStore } from './store/series'
import type { SeriesFile } from './store/series'
import type { IdeaFile } from './store/ideas'
import { ARTICLE_KIND, TopicsFile } from './store/topics'
import { readMd, writeMd } from './store/atomic'
import { sendEpub, smtpTransport } from './publish/kindle'
import type { TransportFactory } from './publish/kindle'
import { agentSummary, bookSummary, formatSummaries, ideaSummaries, modelSummaries, providerSummaries, roleDefaults, seriesSummaries, serverStatuses, topicSummary } from './summary'
import type { WatchEvent } from './store/watcher'

export interface EngineOptions {
  dataDir: string
  emit: (e: EngineEvent) => void
  log?: (message: string) => void
  registry?: RegistryOptions
  router?: RouterOptions
  pollMs?: number
  /** Ask LM Studio and other `discover: true` providers for their models at start. Default true. */
  discover?: boolean
  /** True when Electron main can render cover HTML to PNG. */
  coverRenderer?: boolean
  /** Factory tick interval in ms. Default 5000. */
  tickMs?: number
  /** Builds the mail transport for Send to Kindle. Tests pass a JSON transport. */
  mailTransport?: TransportFactory
  /** Tests: search providers and page fetching for the researcher, instead of the ones in config/providers.md and the network. */
  search?: Pick<SearchServiceOptions, 'providers' | 'fetchPage' | 'fetchImpl'>
}

/** How often `concurrency: auto` providers are asked for their slot count. */
const SLOT_SYNC_MS = 10_000

/** The text below the frontmatter of a config/models.md the engine creates (as in seed/config/models.md). */
const MODELS_MD_BODY = "# Models in the pickers\n\nWhich models the model pickers offer (the agent panel, Role defaults and the default models). The app writes this file from its **Models** panel (the Models button in the top bar): pick a provider, press **Detect models** to list everything it has, and tick the models you want, or add one by its id (with its price for a paid provider). You can also edit it by hand.\n\n- `picked`: models that are not in `providers.md`, ticked from a provider's list or added by id, each with its `provider`, `id`, `context` and the price the provider listed when you picked it (or the one you typed) (`price_in`, `price_out`, `price_cached_in`, USD per 1M tokens). The budget counts them at that price. A paid model is only ticked with a listed price; for one whose price the provider doesn't list (DeepSeek's), add it by id with its price.\n- `hidden`: `provider/model` refs the pickers leave out: models from `providers.md` or found by `discover` that you unticked. A role list in `roles.md` can still name a hidden model.\n- `limits`: per provider, the limits set in the Models panel, over the ones in `providers.md`: `concurrency` (requests at once), `rpm` (per minute) and `rpd` (per day, from midnight UTC). 0 means no limit.\n"

/** The engine core: config, models, budget, agents, jobs and the scheduler, plus the command handler. */
export class Engine {
  readonly registry: ModelRegistry
  /** The model requests of `client` providers, waiting for Claude Code (or another MCP client) to answer them. One per engine: the MCP server is stateless. */
  readonly clientQueue: ClientTaskQueue
  readonly budget: Budget
  readonly router: ModelRouter
  readonly jobs: JobStore
  readonly agents: AgentStore
  readonly logs: LogWriter
  readonly scheduler: Scheduler
  readonly pipeline: Pipeline
  readonly books: BookStore
  readonly topics: TopicsFile
  readonly ideas: IdeaStore
  readonly series: SeriesStore
  readonly bible: Bible
  readonly memory: MemoryService
  readonly research: ResearchService
  readonly search: SearchService
  factory: FactoryConfig = factorySchema.parse({ kind: 'factory' })
  /** `start()` finished: snapshots from now on are complete. */
  private started = false
  /** The last model list each provider gave the Models dialog (`detectModels`), for the prices of the models picked from it. */
  private catalogs = new Map<string, ListedModel[]>()
  quality: QualityConfig = qualitySchema.parse({ kind: 'quality' })
  formats: FormatEntry[] = []
  settings: SettingsConfig = settingsSchema.parse({ kind: 'settings' })
  private knownAgents = new Set<string>()
  /** Where the MCP server listens, once it does. */
  private mcpUrl: string | null = null
  private slotTimer: ReturnType<typeof setInterval> | undefined
  private readonly startedAt = Date.now()
  private readonly log: (m: string) => void
  private readonly emit: (e: EngineEvent) => void

  constructor(private readonly opts: EngineOptions) {
    // every event goes out through here: a stage change also sends the book summary, a finished job wakes the factory
    this.emit = (e) => {
      opts.emit(e)
      if (e.type === 'book.stage') {
        void this.emitBookUpdated(e.book)
        if (e.stage === 'published' || e.stage === 'rejected') void this.releasePins(e.book)
      }
      if (e.type === 'job.done') {
        this.pipeline.kick()
        // a book's job ids start with its slug: the book card shows chapters and words as they grow
        const slug = e.jobId.split('--')[0]
        if (slug && e.jobId.includes('--')) void this.books.read(slug).then((b) => (b ? this.emitBookUpdated(slug) : undefined))
      }
    }
    this.log = opts.log ?? (() => undefined)
    const dir = opts.dataDir
    this.clientQueue = opts.registry?.clientQueue ?? new ClientTaskQueue()
    this.registry = new ModelRegistry(dir, { ...opts.registry, clientQueue: this.clientQueue })
    this.budget = new Budget(dir, {
      onWarn: (message) => {
        this.log(`budget warning: ${message}`)
        this.emit({ type: 'engine.warning', message })
      }
    })
    this.router = new ModelRouter(this.registry, this.budget, opts.router)
    // a request that finds Strata (or LM Studio) not running marks it down for every agent at once, not one agent at a time
    this.router.onProviderDown = (p) => {
      this.log(`models: ${p.id} is down (a request could not reach ${p.baseUrl}), jobs use the next model in their role`)
      this.emit({ type: 'servers', servers: serverStatuses(this.registry) })
      this.scheduler.kick()
    }
    // a provider's daily limit is used up: say so once, and show it in the Models panel
    this.router.onProviderDayFull = (p) => {
      const at = new Date(this.router.limiter.dayResetsAt()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      this.log(`models: ${p.id} used up its requests for today, jobs use the next model in their role until ${at}`)
      this.emit({ type: 'engine.warning', message: `${p.id} used up its requests for today: jobs use their next model until ${at}.` })
      void this.snapshot().then((s) => this.emit(s))
      this.scheduler.kick()
    }
    this.jobs = new JobStore(dir)
    this.agents = new AgentStore(dir)
    this.logs = new LogWriter(dir)
    this.scheduler = new Scheduler({
      jobs: this.jobs,
      agents: this.agents,
      router: this.router,
      budget: this.budget,
      logs: this.logs,
      getFactory: () => this.factory,
      emit: this.emit,
      pollMs: opts.pollMs,
      onAgentsChanged: () => this.syncAgents(),
      isBookPaused: (book) => this.pipeline.pausedBooks.has(book),
      getBookModel: (book, role) => this.bookModel(book, role)
    })
    this.books = new BookStore(dir)
    this.topics = new TopicsFile(dir, () => void this.emitTopics())
    this.ideas = new IdeaStore(dir)
    this.series = new SeriesStore(dir)
    this.bible = new Bible(this.books)
    this.memory = new MemoryService(dir, this.registry)
    this.search = new SearchService({ registry: this.registry, budget: this.budget, emit: this.emit, log: this.log, keys: opts.registry?.keys, clientQueue: this.clientQueue, ...opts.search })
    this.research = new ResearchService({
      dataDir: dir,
      jobs: this.jobs,
      agents: this.agents,
      getFactory: () => this.factory,
      log: this.log,
      kick: () => this.scheduler.kick(),
      emit: this.emit
    })
    this.pipeline = new Pipeline({
      dataDir: dir,
      books: this.books,
      topics: this.topics,
      ideas: this.ideas,
      series: this.series,
      bible: this.bible,
      memory: this.memory,
      research: this.research,
      search: this.search,
      jobs: this.jobs,
      scheduler: this.scheduler,
      getQuality: () => this.quality,
      contextTokens: (role) => this.router.candidates(role)[0]?.context,
      getFormats: () => this.formats,
      getFactory: () => this.factory,
      emit: this.emit,
      log: this.log,
      coverRenderer: !!opts.coverRenderer,
      hasAgent: (role) => this.agents.list().some((a) => a.data.role === role),
      bookChanged: (slug) => void this.emitBookUpdated(slug),
      tickMs: opts.tickMs
    })
  }

  get uptimeMs(): number {
    return Date.now() - this.startedAt
  }

  get dataDir(): string {
    return this.opts.dataDir
  }

  async start(): Promise<void> {
    await this.loadFactory()
    await this.loadQualityAndFormats()
    await this.loadSettings()
    await this.registry.load()
    void this.discoverModels()
    // providers with `concurrency: auto` (Strata) follow the slot count their server reports: asked now and every few seconds,
    // so starting Strata with a "4 at once" or a "one at a time" script needs no change in providers.md
    await this.syncSlots()
    this.slotTimer = setInterval(() => void this.syncSlots(), SLOT_SYNC_MS)
    this.slotTimer.unref?.()
    await this.budget.load()
    // daily request limits count the requests made before this start too
    for (const p of this.registry.providers.values()) this.router.limiter.seedToday(p.id, this.budget.requestsTodayUtc(p.id))
    const rec = await this.jobs.recoverRunning()
    if (rec.requeued.length || rec.dropped.length) {
      this.log(`recovery: ${rec.requeued.length} running job(s) back to queued, ${rec.dropped.length} duplicate(s) dropped`)
    }
    await this.agents.loadAll((file, err) => this.log(`invalid agent file ${file}: ${err.message}`))
    this.knownAgents = new Set(this.agents.list().map((a) => a.id))
    this.scheduler.start()
    await this.pipeline.start()
    await this.budget.writeSummary().catch(() => undefined)
    this.started = true
  }

  /** Asks `concurrency: auto` servers for their slot count; a higher count frees waiting requests at once. */
  private async syncSlots(): Promise<void> {
    let changed
    const wasDown = new Map([...this.registry.providers.values()].map((p) => [p.id, p.down]))
    try {
      changed = await this.registry.syncServerSlots()
    } catch (err) {
      this.log(`could not ask the servers for their slots: ${(err as Error).message}`)
      return
    }
    for (const c of changed) {
      this.log(`models: ${c.provider.id} runs ${c.to} request(s) at once (was ${c.from}), as the server reports`)
      if (c.to > c.from) this.router.limiter.wakeAll(c.provider)
    }
    // a server that stops answering is skipped (its jobs go to the next model in the role) until it answers again
    let upOrDown = false
    for (const p of this.registry.providers.values()) {
      if (!wasDown.has(p.id) || wasDown.get(p.id) === p.down) continue
      upOrDown = true
      this.log(p.down ? `models: ${p.id} is down (${p.baseUrl} does not answer, or has no model loaded), jobs use the next model in their role` : `models: ${p.id} answers again`)
    }
    if (changed.length || upOrDown) {
      this.emit({ type: 'servers', servers: serverStatuses(this.registry) })
      this.scheduler.kick()
    }
  }

  async stop(): Promise<void> {
    if (this.slotTimer) clearInterval(this.slotTimer)
    await this.pipeline.stop()
    await this.scheduler.stop()
    await this.logs.flush()
    await this.budget.flush().catch(() => undefined)
    this.memory.close()
  }

  // ---- config ----

  private factoryFile(): string {
    return path.join(this.dataDir, 'config', 'factory.md')
  }

  async loadFactory(): Promise<void> {
    try {
      const text = await fs.readFile(this.factoryFile(), 'utf8')
      this.factory = parseMdWith(text, factorySchema, this.factoryFile()).data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`config/factory.md: ${(err as Error).message}`)
    }
  }

  async loadQualityAndFormats(): Promise<void> {
    for (const [name, apply] of [
      ['quality', (t: string, f: string) => (this.quality = parseMdWith(t, qualitySchema, f).data)],
      ['formats', (t: string, f: string) => (this.formats = parseMdWith(t, formatsSchema, f).data.formats)]
    ] as const) {
      const file = path.join(this.dataDir, 'config', `${name}.md`)
      try {
        apply(await fs.readFile(file, 'utf8'), file)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`config/${name}.md: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Asks the providers with `discover` which models they have (see `ModelRegistry.discover`), then sends the pickers the new list.
   * Runs at start, and again when a key is stored or providers.md changes: a provider that just got its key lists its models then.
   */
  async discoverModels(): Promise<void> {
    if (this.opts.discover === false) return
    try {
      const r = await this.registry.discover()
      for (const d of r) this.log(`models: ${d.provider} ${d.error ? 'discovery failed: ' + d.error : d.found + ' found'}`)
      if (r.length && this.started) this.emit(await this.snapshot()) // before that, the first snapshot has them
      this.scheduler.kick()
    } catch (err) {
      this.log(`models: discovery failed: ${(err as Error).message}`)
    }
  }

  /** Asks a provider for every model it lists and sends the list to the Models dialog (`models.catalog`). */
  async detectModels(provider: string): Promise<void> {
    const at = new Date().toISOString()
    const local = !!this.registry.providers.get(provider)?.local
    try {
      const listed = await this.registry.catalog(provider)
      this.catalogs.set(provider, listed)
      const models = listed.map((m) => ({
        id: m.id,
        ref: `${provider}/${m.id}`,
        context: m.context,
        priceIn: local ? 0 : m.price?.in,
        priceOut: local ? 0 : m.price?.out,
        pickable: local || !!m.price
      }))
      this.log(`models: ${provider} lists ${models.length} chat model(s)`)
      this.emit({ type: 'models.catalog', provider, models, at })
    } catch (err) {
      this.emit({ type: 'models.catalog', provider, models: [], error: (err as Error).message, at })
    }
  }

  /**
   * Shows models in the pickers or hides them, in config/models.md. Showing a model the engine doesn't know yet adds it to `picked`
   * with the context and price its provider listed; a paid model without a listed price is refused. Hiding a picked model removes it.
   */
  async showModels(refs: string[], shown: boolean): Promise<void> {
    await this.editModelChoices((picked, hidden) => this.applyShowModels(picked, hidden, refs, shown))
  }

  /**
   * Adds a model the provider doesn't list (or that can't be listed: Anthropic, Gemini) to `picked` in config/models.md.
   * A paid provider's model needs both prices, so the budget can count it; a known model is only shown again.
   */
  async addModel(cmd: { provider: string; id: string; priceIn?: number; priceOut?: number; context?: number }): Promise<void> {
    const id = cmd.id.trim()
    const p = this.registry.providers.get(cmd.provider)
    if (!id || !p || p.kind === 'search') return this.log(`addModel: no provider "${cmd.provider}" or an empty id`)
    const price = (v?: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
    const priceIn = p.local ? 0 : price(cmd.priceIn)
    const priceOut = p.local ? 0 : price(cmd.priceOut)
    if (priceIn === undefined || priceOut === undefined) return this.log(`addModel: ${cmd.provider}/${id} needs its price in and out (USD per 1M tokens, 0 for a free model)`)
    const ref = `${cmd.provider}/${id}`
    await this.editModelChoices((picked, hidden) => {
      hidden.delete(ref)
      if (this.registry.models.has(ref) || picked.some((m) => `${String(m.provider)}/${String(m.id)}` === ref)) return
      const context = typeof cmd.context === 'number' && cmd.context > 0 ? Math.round(cmd.context) : undefined
      picked.push({ provider: cmd.provider, id, family: guessFamily(id), ...(context ? { context } : {}), price_in: priceIn, price_out: priceOut })
      this.log(`models: added ${ref}`)
    })
  }

  /**
   * Sets a provider's limits in `limits` of config/models.md, over providers.md: requests at once (not for a `concurrency: auto`
   * server), per minute and per day (0: no limit). A raised limit frees waiting requests at once.
   */
  async setProviderLimits(cmd: { provider: string; concurrency?: number; rpm?: number; rpd?: number }): Promise<void> {
    const p = this.registry.providers.get(cmd.provider)
    if (!p || p.kind === 'search') return this.log(`setProviderLimits: no provider "${cmd.provider}"`)
    const count = (v: number | undefined, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.round(v) : undefined)
    const set: Record<string, number> = {}
    const concurrency = p.concurrencyAuto ? undefined : count(cmd.concurrency, 1)
    if (concurrency !== undefined) set.concurrency = concurrency
    const rpm = count(cmd.rpm, 0)
    if (rpm !== undefined) set.rpm = rpm
    const rpd = count(cmd.rpd, 0)
    if (rpd !== undefined) set.rpd = rpd
    if (!Object.keys(set).length) return
    await this.editModelChoices((_picked, _hidden, limits) => {
      limits[p.id] = { ...(limits[p.id] ?? {}), ...set }
      this.log(`models: ${p.id} limits ${Object.entries(set).map(([k, v]) => `${k} ${v || 'none'}`).join(', ')}`)
    })
    const now = this.registry.providers.get(p.id)
    if (now) this.router.limiter.wakeAll(now)
  }

  /** Reads `picked` and `hidden` of config/models.md, lets `change` edit them, writes the file and sends the pickers the result. */
  private async editModelChoices(change: (picked: Record<string, unknown>[], hidden: Set<string>, limits: Record<string, Record<string, number>>) => void): Promise<void> {
    const file = this.registry.modelsFile()
    let doc
    try {
      doc = await readMd(file)
    } catch {
      doc = { data: { kind: 'models' } as Record<string, unknown>, body: MODELS_MD_BODY }
    }
    const picked = Array.isArray(doc.data.picked) ? (doc.data.picked as Record<string, unknown>[]) : []
    const hidden = new Set(Array.isArray(doc.data.hidden) ? (doc.data.hidden as string[]) : [])
    const limits = doc.data.limits && typeof doc.data.limits === 'object' ? (doc.data.limits as Record<string, Record<string, number>>) : {}
    change(picked, hidden, limits)
    await writeMd(file, { ...doc.data, kind: 'models', picked, hidden: [...hidden].sort(), limits }, doc.body || MODELS_MD_BODY)
    await this.registry.load()
    this.emit(await this.snapshot()) // the pickers follow
    this.scheduler.kick()
  }

  private applyShowModels(picked: Record<string, unknown>[], hidden: Set<string>, refs: string[], shown: boolean): void {
    const isPicked = (ref: string) => picked.findIndex((m) => `${String(m.provider)}/${String(m.id)}` === ref)
    for (const ref of new Set(refs)) {
      const slash = ref.indexOf('/')
      const provider = ref.slice(0, slash)
      const id = ref.slice(slash + 1)
      const p = this.registry.providers.get(provider)
      if (slash < 1 || !p) {
        this.log(`showModels: unknown model ${ref}`)
        continue
      }
      if (!shown) {
        const i = isPicked(ref)
        if (i >= 0) picked.splice(i, 1)
        else hidden.add(ref)
        continue
      }
      hidden.delete(ref)
      if (this.registry.models.has(ref) || isPicked(ref) >= 0) continue
      const m = this.catalogs.get(provider)?.find((x) => x.id === id)
      if (!m) {
        this.log(`showModels: ${provider} has not listed ${id} (detect its models first)`)
        continue
      }
      if (!p.local && !m.price) {
        this.log(`showModels: ${ref} has no listed price, so the budget could not count it: add it to providers.md with its price`)
        continue
      }
      picked.push({
        provider,
        id,
        family: guessFamily(id),
        ...(m.context ? { context: m.context } : {}),
        ...(m.maxOutput ? { max_output: m.maxOutput } : {}),
        price_in: p.local ? 0 : m.price!.in,
        price_out: p.local ? 0 : m.price!.out,
        ...(!p.local && m.price!.cachedIn !== undefined ? { price_cached_in: m.price!.cachedIn } : {})
      })
    }
  }

  /** Persists pause all in config/factory.md. */
  async setPaused(paused: boolean): Promise<void> {
    const file = this.factoryFile()
    let doc
    try {
      doc = await readMd(file)
    } catch {
      doc = { data: { kind: 'factory' } as Record<string, unknown>, body: '' }
    }
    await writeMd(file, { ...doc.data, paused }, doc.body)
    const changed = this.factory.paused !== paused
    this.factory = { ...this.factory, paused }
    if (changed) this.emit({ type: 'factory.paused', paused })
  }

  /** Changes how many books are worked on at the same time (`max_books_in_progress` in config/factory.md). */
  async setMaxBooksInProgress(n: number): Promise<void> {
    const max = Math.min(20, Math.max(1, Math.round(n) || 1))
    if (max === this.factory.max_books_in_progress) return
    const file = this.factoryFile()
    let doc
    try {
      doc = await readMd(file)
    } catch {
      doc = { data: { kind: 'factory' } as Record<string, unknown>, body: '' }
    }
    await writeMd(file, { ...doc.data, max_books_in_progress: max }, doc.body)
    this.factory = { ...this.factory, max_books_in_progress: max }
    this.pipeline.kick() // a higher limit lets the editor-in-chief start a book now
  }

  /**
   * Assigns an agent to one book in progress, or frees it (`book: null`). The agent then only takes that book's jobs.
   * A writer also becomes the book's writer: the book's next writer jobs go to it, and reviewers avoid its model family.
   */
  async assignBook(agentId: string, book: string | null): Promise<void> {
    const def = this.agents.get(agentId)
    if (!def) return this.log(`assignBook: no agent "${agentId}"`)
    if (book !== null) {
      const b = await this.books.read(book)
      if (!b || TERMINAL_BOOK_STAGES.has(b.data.stage)) return this.log(`assignBook: "${book}" is not a book in progress`)
      if (def.data.role === 'writer' && b.data.writer_agent !== def.id) {
        const family = this.router.candidates('writer', { agentModel: def.data.model })[0]?.family
        await this.books.update(book, () => ({ author: def.data.name, writer_agent: def.id, ...(family ? { writer_family: family } : {}) }))
        // writer jobs already queued were meant for the old writer
        for (const job of await this.jobs.list('queued')) {
          if (job.data.book === book && job.data.role === 'writer' && job.data.agent_hint !== def.id) {
            await this.jobs.update('queued', job.id, { agent_hint: def.id }).catch(() => undefined) // claimed meanwhile
          }
        }
        this.log(`${def.id} is now the writer of ${book}`)
        await this.emitBookUpdated(book)
      }
    }
    await this.agents.patch(agentId, { pin: book })
    this.emitAgentUpdated(agentId)
    this.scheduler.kick()
  }

  /** Book slug -> its `role_models`, read from book.md and kept for a few seconds (the scheduler asks for every queued job on every tick). */
  private bookModels = new Map<string, { at: number; models: Record<string, string> }>()

  private async bookModel(book: string, role: string): Promise<string | undefined> {
    let hit = this.bookModels.get(book)
    if (!hit || Date.now() - hit.at > 3000) {
      hit = { at: Date.now(), models: (await this.books.read(book))?.data.role_models ?? {} }
      this.bookModels.set(book, hit)
    }
    return hit.models[role] || undefined
  }

  /** Sets or removes the model a book uses for a role. Its running jobs of that role switch at once. */
  private async setBookModel(book: string, role: string, model: string | null): Promise<void> {
    const b = await this.books.read(book)
    if (!b) return this.log(`setBookModel: no book "${book}"`)
    const next = { ...b.data.role_models }
    if (model) next[role] = model
    else delete next[role]
    await this.books.update(book, () => ({ role_models: next }))
    this.bookModels.delete(book)
    this.log(`book ${book}: ${role} ${model ? `uses ${model}` : 'back to its role list'}`)
    this.scheduler.bookModelChanged(book, role, model ?? undefined)
    await this.emitBookUpdated(book)
    this.scheduler.kick()
  }

  /** A published or rejected book has no more jobs: its assigned agents go back to taking any job. */
  private async releasePins(book: string): Promise<void> {
    for (const def of this.agents.list()) {
      if (def.data.pin !== book) continue
      await this.agents.patch(def.id, { pin: null })
      this.emitAgentUpdated(def.id)
    }
    this.scheduler.kick()
  }

  /** Changes a role default: puts the model first in the role's list in config/roles.md. */
  async setRoleModel(role: string, model: string): Promise<void> {
    const file = path.join(this.dataDir, 'config', 'roles.md')
    const doc = await readMd(file)
    const roles = { ...((doc.data.roles as Record<string, { models?: string[] }> | undefined) ?? {}) }
    const old = roles[role]?.models ?? []
    roles[role] = { ...roles[role], models: [model, ...old.filter((m) => m !== model)] }
    await writeMd(file, { ...doc.data, roles }, doc.body)
    await this.registry.load()
  }

  // ---- file changes ----

  async handleWatch(e: WatchEvent): Promise<void> {
    try {
      if (e.kind === 'agent') {
        const id = path.basename(e.rel, '.md')
        await this.agents.reloadFile(id)
        this.syncAgents()
        this.emitAgentUpdated(id)
      } else if (e.kind === 'topics') {
        await this.emitTopics()
      } else if (e.kind === 'idea') {
        await this.emitIdeas()
        await this.emitSeries() // a story of a series changed: the series list shows it
      } else if (e.kind === 'series') {
        await this.emitSeries()
      } else if (e.kind === 'config') {
        const name = path.basename(e.rel, '.md')
        if (name === 'providers' || name === 'roles' || name === 'models') {
          await this.registry.load()
          if (name !== 'providers') this.scheduler.changeModel() // running jobs follow a changed role list
          this.emit(await this.snapshot()) // the pickers show the models and role defaults
          if (name === 'providers') void this.discoverModels()
        }
        else if (name === 'budget') await this.budget.loadCaps()
        else if (name === 'factory') {
          const before = this.factory.paused
          await this.loadFactory()
          if (before !== this.factory.paused) this.emit({ type: 'factory.paused', paused: this.factory.paused })
        } else if (name === 'settings') {
          await this.loadSettings()
          await this.registry.load() // the role aliases and the LM Studio context may have changed
          this.scheduler.changeModel() // running jobs follow changed default models or their order
        }
        else if (name === 'quality' || name === 'formats') await this.loadQualityAndFormats()
      }
    } catch (err) {
      this.log(`could not reload ${e.rel}: ${(err as Error).message} (keeping the previous version)`)
    }
    this.scheduler.kick()
    if (e.kind !== 'agent') this.pipeline.kick()
  }

  // ---- settings, secrets, agents, topics, books ----

  private settingsFile(): string {
    return path.join(this.dataDir, 'config', 'settings.md')
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings = parseMdWith(await fs.readFile(this.settingsFile(), 'utf8'), settingsSchema, this.settingsFile()).data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`config/settings.md: ${(err as Error).message}`)
    }
    this.registry.setDefaults(modelDefaultsOf(this.settings))
  }

  settingsSummary(): SettingsSummary {
    const s = this.settings
    return {
      kindleAddress: s.kindle_address,
      fromAddress: s.from_address,
      smtpHost: s.smtp_host,
      smtpPort: s.smtp_port,
      smtpUser: s.smtp_user,
      smtpSecure: s.smtp_secure,
      defaultPaidModel: s.default_paid_model,
      defaultStrataModel: s.default_strata_model,
      defaultLmstudioModel: s.default_lmstudio_model,
      modelOrder: s.model_order,
      lmstudioParallel: s.lmstudio_parallel,
      lmstudioContext: s.lmstudio_context,
      lmstudioTtlMinutes: s.lmstudio_ttl_minutes,
      maxBooksInProgress: this.factory.max_books_in_progress
    }
  }

  /** The only secrets the UI may set: the SMTP password and the key variables named in providers.md. */
  allowedSecrets(): string[] {
    const names = new Set(['SCRIPTORIUM_SMTP_PASSWORD'])
    for (const p of this.registry.providers.values()) if (p.apiKeyEnv) names.add(p.apiKeyEnv)
    return [...names]
  }

  secretsSet(): string[] {
    return this.allowedSecrets().filter((n) => !!resolveKey(n))
  }

  /** Builds the draft reader of a book and sends `draft.ready`. */
  async emitDraft(slug: string): Promise<void> {
    try {
      const { dir, pages } = await this.books.buildDraft(slug)
      const chapters = (await this.books.chapters(slug)).map((c) => ({ n: c.n, title: c.title, words: c.words }))
      this.emit({ type: 'draft.ready', book: slug, dir, pages, notes: await this.books.ownerNotes(slug), chapters, at: Date.now() })
    } catch (err) {
      this.log(`readDraft ${slug}: ${(err as Error).message}`)
    }
  }

  /** Tells the UI that an agent's file changed (model override, paused). */
  emitAgentUpdated(id: string): void {
    const def = this.agents.get(id)
    if (def && this.knownAgents.has(id)) this.emit({ type: 'agent.updated', agent: agentSummary(def, this.scheduler, this.router) })
  }

  /** Emits agent.hired / agent.removed for the differences since the last time. */
  syncAgents(): void {
    const now = new Map(this.agents.list().map((a) => [a.id, a]))
    for (const [id, def] of now) {
      if (!this.knownAgents.has(id)) {
        this.knownAgents.add(id)
        this.emit({ type: 'agent.hired', agent: agentSummary(def, this.scheduler, this.router) })
      }
    }
    for (const id of [...this.knownAgents]) {
      if (!now.has(id)) {
        this.knownAgents.delete(id)
        this.emit({ type: 'agent.removed', agent: id })
      }
    }
  }

  async emitTopics(): Promise<void> {
    this.emit({ type: 'topics.updated', topics: (await this.topics.read()).map(topicSummary) })
  }

  /** The owner's open stories and the last used ones, as the UI and MCP list them. */
  async listIdeaSummaries(): Promise<IdeaSummary[]> {
    return ideaSummaries(await this.ideas.list())
  }

  async emitIdeas(): Promise<void> {
    this.emit({ type: 'ideas.updated', ideas: await this.listIdeaSummaries() })
  }

  /** The series with their books in order, as the UI and MCP list them. */
  async listSeriesSummaries(): Promise<SeriesSummary[]> {
    return seriesSummaries({ series: this.series, books: this.books, ideas: this.ideas })
  }

  async emitSeries(): Promise<void> {
    this.emit({ type: 'series.updated', series: await this.listSeriesSummaries() })
  }

  /** Creates a series from a brief (its title names it). Throws when there is no title. */
  async addSeries(brief: StoryBrief): Promise<SeriesFile> {
    const s = await this.series.create(brief)
    this.log(`series "${s.title}" added (${s.slug})`)
    await this.emitSeries()
    return s
  }

  /** Replaces the brief of a series. Throws when there is no such series. */
  async updateSeries(slug: string, brief: StoryBrief): Promise<SeriesFile> {
    const s = await this.series.update(slug, brief)
    this.log(`series "${s.title}" changed (${s.slug})`)
    await this.emitSeries()
    return s
  }

  /**
   * The brief with its series checked and numbered: a story of a series must name a series that exists, and gets the next free
   * `series_index` unless it keeps the one it has (a story moved to another series is numbered again).
   */
  private async withSeries(brief: StoryBrief, was?: IdeaFile): Promise<StoryBrief> {
    const slug = brief.series?.trim()
    if (!slug) {
      const { series: _s, seriesIndex: _i, ...rest } = brief
      return rest
    }
    if (!(await this.series.get(slug))) throw new Error(`no series "${slug}" (list_series shows the slugs)`)
    const keeps = brief.seriesIndex && (!was || was.data.series === slug)
    const seriesIndex = keeps ? brief.seriesIndex : nextSeriesIndex(slug, await bookRefs(this.books), (await this.ideas.list()).filter((i) => i.slug !== was?.slug))
    return { ...brief, series: slug, seriesIndex }
  }

  /**
   * A newspaper article is written for a section (a topic of kind `article`) with an article format, and nothing else is: a brief that names a
   * book topic with an article format, or a section with a book format, is refused. A story with only a format (no topic) is an article of no section.
   */
  private async checkArticleBrief(brief: StoryBrief): Promise<void> {
    const fmt = brief.format ? this.formats.find((f) => f.id === brief.format) : undefined
    const topic = brief.topic ? (await this.topics.read()).find((t) => t.id === brief.topic) : undefined
    const articleFormats = this.formats.filter((f) => f.enabled && f.article).map((f) => f.id).join(', ') || '(no article format is enabled)'
    if (topic?.kind === ARTICLE_KIND && fmt && !fmt.article) {
      throw new Error(`"${topic.id}" is a newspaper section (kind article): its format must be an article format (${articleFormats}), not "${fmt.id}"`)
    }
    if (fmt?.article && topic && topic.kind !== ARTICLE_KIND) {
      throw new Error(`"${fmt.id}" is an article format, but "${topic.id}" is a ${topic.kind} topic: articles go in a newspaper section (a topic of kind article, e.g. news-technology; list_topics shows them)`)
    }
    if (fmt?.article && brief.sourceBook) throw new Error('an article cannot adapt a book (source_book is for visual novel scripts)')
  }

  /** Creates a story from a brief. Throws when the brief is empty, or names an article format and a topic that is not a newspaper section (or the other way round). */
  async addStory(brief: StoryBrief): Promise<IdeaFile> {
    await this.checkArticleBrief(brief)
    brief = await this.withSeries(brief)
    const idea = await this.ideas.createStory(brief)
    this.log(`story "${idea.title}" added (${idea.slug})`)
    await this.emitIdeas()
    if (idea.data.series) await this.emitSeries()
    this.pipeline.kick()
    return idea
  }

  /**
   * The script writer: a story that adapts a published book into a visual novel script (`format` is a script format: linear or with choices).
   * The story waits until the source is published (it is, here) and a book starts from it like from any story. The title defaults to the source's.
   * Throws when the book does not exist or is not published, the format is not an enabled script format, or the same adaptation is already waiting.
   */
  async adaptBook(input: { book: string; format: string; title?: string; notes?: string; models?: Record<string, string> }): Promise<IdeaFile> {
    const src = await this.books.read(input.book)
    if (!src) throw new Error(`no book "${input.book}" (list_books shows the slugs)`)
    if (src.data.article === true) throw new Error(`"${src.data.title}" is a newspaper article: only a book can be adapted into a visual novel`)
    if (src.data.stage !== 'published') throw new Error(`"${src.data.title}" is not published yet (stage ${src.data.stage}): only a finished book can be adapted`)
    const fmt = this.formats.find((f) => f.enabled && f.id === input.format)
    if (!fmt?.script) {
      throw new Error(`"${input.format}" is not a visual novel format. Use one of: ${this.formats.filter((f) => f.enabled && f.script).map((f) => f.id).join(', ') || '(no visual novel format is enabled)'}`)
    }
    if ((await this.ideas.list()).some((i) => i.data.status === 'open' && i.data.source_book === input.book && i.data.format === fmt.id)) {
      throw new Error(`an adaptation of "${src.data.title}" as ${fmt.id} is already waiting for its book`)
    }
    const notes = input.notes?.trim() ?? ''
    const brief: StoryBrief = {
      ...emptyBrief(),
      title: input.title?.trim() || src.data.title,
      premise: `A ${fmt.name.toLowerCase()} script adapted from the owner's published book "${src.data.title}". Keep the book's story, characters, setting and ending.`,
      sections: notes ? [{ heading: 'Notes for the adapter', text: notes }] : [],
      format: fmt.id,
      ...(src.data.genre.trim() ? { genre: src.data.genre.trim() } : {}),
      sourceBook: input.book,
      ...(input.models && Object.keys(input.models).length ? { models: input.models } : {})
    }
    return this.addStory(brief)
  }

  /** Replaces the brief of a story. Throws when there is no such story, or a book was already started from it. */
  async updateStory(slug: string, brief: StoryBrief): Promise<IdeaFile> {
    await this.checkArticleBrief(brief)
    brief = await this.withSeries(brief, (await this.ideas.list()).find((i) => i.slug === slug))
    const idea = await this.ideas.updateStory(slug, brief)
    this.log(`story "${idea.title}" changed (${idea.slug})`)
    await this.emitIdeas()
    await this.emitSeries()
    this.pipeline.kick()
    return idea
  }

  /** The MCP server started (its url) or stopped (null): the snapshot and the UI follow. */
  setMcpUrl(url: string | null): void {
    this.mcpUrl = url
    this.emit({ type: 'mcp.updated', mcp: url ? { url } : null })
  }

  /** Shows a warning in the UI. */
  warn(message: string): void {
    this.log(`warning: ${message}`)
    this.emit({ type: 'engine.warning', message })
  }

  async emitBookUpdated(slug: string): Promise<void> {
    try {
      const book = await bookSummary(this.books, slug, await this.topics.read())
      if (book) this.emit({ type: 'book.updated', book })
    } catch (err) {
      this.log(`book summary for ${slug} failed: ${(err as Error).message}`)
    }
  }

  private async sendToKindle(slug: string): Promise<void> {
    const fail = (error: string) => this.emit({ type: 'kindle.sent', book: slug, ok: false, error })
    const book = await this.books.read(slug)
    if (!book) return fail(`no book "${slug}"`)
    const s = this.settingsSummary()
    if (!s.kindleAddress || !s.fromAddress) return fail('set the Kindle address and the sender address in the settings first')
    if (!this.opts.mailTransport && !s.smtpHost) return fail('set the SMTP server in the settings first')
    const epubPath = this.books.file(slug, 'out', `${slug}.epub`)
    if (book.data.article === true) return fail('an article has no EPUB: it is a web page (out/article.html)')
    if (!(await fs.access(epubPath).then(() => true, () => false))) return fail('this book has no EPUB yet')
    try {
      const transport = (this.opts.mailTransport ?? smtpTransport)(s, resolveKey('SCRIPTORIUM_SMTP_PASSWORD'))
      await sendEpub(transport, s, { title: book.data.title, author: book.data.author ?? 'Unknown', slug, epubPath })
      this.log(`sent ${slug} to ${s.kindleAddress}`)
      this.emit({ type: 'kindle.sent', book: slug, ok: true })
    } catch (err) {
      fail(String((err as Error).message ?? err).slice(0, 300))
    }
  }

  // ---- commands ----

  async handleCommand(cmd: Command): Promise<void> {
    switch (cmd.type) {
      case 'ping':
        this.emit({ type: 'pong', id: cmd.id, at: new Date().toISOString() })
        return
      case 'snapshot':
        this.emit(await this.snapshot())
        return
      case 'checkServers':
        await this.syncSlots()
        this.emit({ type: 'servers', servers: serverStatuses(this.registry) }) // even when nothing changed, so the button stops waiting
        return
      case 'hire': {
        if (!(ROLES as readonly string[]).includes(cmd.role) && !(cmd.role in this.registry.roles.roles)) {
          this.log(`hire: unknown role ${cmd.role}`)
          return
        }
        const def = await this.agents.hire({ role: cmd.role, name: cmd.name, model: cmd.model })
        this.log(`hired ${def.id}`)
        this.syncAgents()
        this.scheduler.kick()
        return
      }
      case 'fire':
        await this.scheduler.fire(cmd.agent, !!cmd.now)
        return
      case 'pause':
        await this.agents.patch(cmd.agent, { paused: true })
        this.emitAgentUpdated(cmd.agent)
        this.scheduler.kick()
        return
      case 'resume':
        await this.agents.patch(cmd.agent, { paused: false })
        this.emitAgentUpdated(cmd.agent)
        this.scheduler.kick()
        return
      case 'stop':
        this.scheduler.stopAgent(cmd.agent)
        return
      case 'assignBook':
        await this.assignBook(cmd.agent, cmd.book)
        return
      case 'pauseAll':
        await this.setPaused(true)
        return
      case 'resumeAll':
        await this.setPaused(false)
        this.scheduler.kick()
        return
      case 'stopNow':
        // Pause first, so aborted jobs don't start again at once.
        await this.setPaused(true)
        this.scheduler.stopAll('stopNow')
        return
      case 'setModel': {
        if (cmd.model !== null && !this.registry.getModel(cmd.model)) {
          this.log(`setModel: unknown model ${cmd.model}`)
          return
        }
        if (cmd.agent) {
          await this.agents.patch(cmd.agent, { model: cmd.model })
          this.emitAgentUpdated(cmd.agent)
          // the job it works on now changes too: a request in flight on another model starts again on the new one
          const moved = this.scheduler.changeModel({ agent: cmd.agent })
          if (moved) this.log(`agent ${cmd.agent}: model changed in ${moved} running job(s)`)
        } else if (cmd.role && cmd.model !== null) {
          await this.setRoleModel(cmd.role, cmd.model)
          this.scheduler.changeModel({ role: cmd.role })
          this.emit(await this.snapshot()) // the new role default for the pickers
        }
        this.scheduler.kick()
        return
      }
      case 'rate': {
        const rating = Math.round(cmd.rating)
        if (!(rating >= 1 && rating <= 5) || !(await this.books.read(cmd.book))) {
          this.log(`rate: bad book "${cmd.book}" or rating ${cmd.rating}`)
          return
        }
        await this.books.update(cmd.book, () => ({ rating, rating_note: cmd.note?.trim() || null }))
        await this.emitBookUpdated(cmd.book)
        return
      }
      case 'readDraft':
        await this.emitDraft(cmd.book)
        return
      case 'addBookNote': {
        const text = cmd.text.trim()
        const book = await this.books.read(cmd.book)
        if (!text || !book) {
          this.log(`addBookNote: no book "${cmd.book}" or an empty note`)
          return
        }
        await this.books.addOwnerNote(cmd.book, text, cmd.chapter ?? null)
        if (cmd.rewrite && cmd.chapter) {
          const ch = (await this.books.chapters(cmd.book)).find((c) => c.n === cmd.chapter)
          if (ch) {
            const unit = `ch${String(ch.n).padStart(2, '0')}`
            // the round stays the chapter's own, so the pipeline's view of the book doesn't change
            await this.jobs.enqueue(
              { id: `${cmd.book}--rewrite--${unit}--note${Date.now()}`, task: 'rewrite_chapter', role: 'writer', book: cmd.book, unit, round: ch.round, agent_hint: book.data.writer_agent, requested_by: 'you' },
              text
            )
            this.log(`book ${cmd.book}: chapter ${ch.n} will be rewritten with your note`)
            this.scheduler.kick()
          }
        }
        await this.emitDraft(cmd.book)
        return
      }
      case 'pauseBook':
        if (!(await this.pipeline.setBookPaused(cmd.book, cmd.paused))) this.log(`pauseBook: no book "${cmd.book}"`)
        else {
          await this.emitBookUpdated(cmd.book)
          this.scheduler.kick()
        }
        return
      case 'retryBook':
        if (!(await this.pipeline.retryBook(cmd.book))) this.log(`retryBook: "${cmd.book}" is not a failed book`)
        else await this.emitBookUpdated(cmd.book)
        return
      case 'setBookModel':
        return this.setBookModel(cmd.book, cmd.role, cmd.model)
      case 'reopenBook': {
        const res = await this.pipeline.reopenBook(cmd.book, cmd.mode, cmd.chapters)
        if (!res.ok) this.log(`reopenBook: ${res.error}`)
        else await this.emitBookUpdated(cmd.book)
        return
      }
      case 'regenerateCover':
        if (!(await this.pipeline.remakeCover(cmd.book))) this.log(`regenerateCover: "${cmd.book}" is not a published book`)
        else await this.emitBookUpdated(cmd.book)
        return
      case 'renameBook':
        if (!(await this.pipeline.renameBook(cmd.book, cmd.title))) this.log(`renameBook: "${cmd.book}" is not a published book, or the title "${cmd.title}" is empty or too long`)
        else await this.emitBookUpdated(cmd.book)
        return
      case 'setTopicActive':
        if (!(await this.topics.setActive(cmd.id, cmd.active))) this.log(`setTopicActive: unknown topic ${cmd.id}`)
        else this.pipeline.kick()
        return
      case 'addTopic': {
        const id = await this.topics.add({ name: cmd.name, kind: cmd.kind, target: cmd.target, active: cmd.active })
        if (!id) this.log(`addTopic: bad name "${cmd.name}" or kind "${cmd.kind}"`)
        else this.pipeline.kick()
        return
      }
      case 'addIdea': {
        const text = cmd.text.trim()
        if (!text) return
        const firstLine = text.split('\n')[0]!.trim()
        const title = firstLine.length > 70 ? firstLine.slice(0, 67).trimEnd() + '...' : firstLine
        await this.ideas.create({ title, pitch: text, topic: cmd.topic ?? null, source: 'user' })
        await this.emitIdeas()
        this.pipeline.kick()
        return
      }
      case 'addStory':
        try {
          await this.addStory(cmd.brief)
        } catch (err) {
          this.log(`addStory: ${(err as Error).message}`)
        }
        return
      case 'adaptBook':
        try {
          await this.adaptBook({ book: cmd.book, format: cmd.format, title: cmd.title, notes: cmd.notes })
        } catch (err) {
          this.warn(`adaptBook: ${(err as Error).message}`)
        }
        return
      case 'addSeries':
        try {
          await this.addSeries(cmd.brief)
        } catch (err) {
          this.log(`addSeries: ${(err as Error).message}`)
        }
        return
      case 'updateSeries':
        try {
          await this.updateSeries(cmd.series, cmd.brief)
        } catch (err) {
          this.log(`updateSeries: ${(err as Error).message}`)
        }
        return
      case 'updateStory':
        try {
          await this.updateStory(cmd.idea, cmd.brief)
        } catch (err) {
          this.log(`updateStory: ${(err as Error).message}`)
        }
        return
      case 'saveSettings': {
        const file = this.settingsFile()
        let doc
        try {
          doc = await readMd(file)
        } catch {
          doc = { data: { kind: 'settings' } as Record<string, unknown>, body: '' }
        }
        const port = Number.isFinite(cmd.smtpPort) && cmd.smtpPort > 0 ? Math.round(cmd.smtpPort) : 587
        const s = this.settings
        await writeMd(
          file,
          {
            ...doc.data,
            kind: 'settings',
            kindle_address: cmd.kindleAddress.trim(),
            from_address: cmd.fromAddress.trim(),
            smtp_host: cmd.smtpHost.trim(),
            smtp_port: port,
            smtp_user: cmd.smtpUser.trim(),
            smtp_secure: !!cmd.smtpSecure,
            default_paid_model: cmd.defaultPaidModel?.trim() || s.default_paid_model,
            default_strata_model: cmd.defaultStrataModel?.trim() || s.default_strata_model,
            default_lmstudio_model: cmd.defaultLmstudioModel?.trim() || s.default_lmstudio_model,
            model_order: cmd.modelOrder ? [...new Set(cmd.modelOrder.filter((g) => g === 'paid' || g === 'strata' || g === 'lmstudio'))] : s.model_order,
            lmstudio_parallel: Math.min(16, Math.max(1, Math.round(cmd.lmstudioParallel ?? s.lmstudio_parallel) || 1)),
            lmstudio_context: Math.max(2048, Math.round(cmd.lmstudioContext ?? s.lmstudio_context) || 32768),
            lmstudio_ttl_minutes: Math.max(1, Math.round(cmd.lmstudioTtlMinutes ?? s.lmstudio_ttl_minutes) || 60)
          },
          doc.body
        )
        if (cmd.maxBooksInProgress !== undefined) await this.setMaxBooksInProgress(cmd.maxBooksInProgress)
        await this.loadSettings()
        await this.registry.load()
        this.scheduler.changeModel() // running jobs follow changed default models or their order
        this.scheduler.kick()
        this.emit(await this.snapshot()) // the role defaults shown in the pickers follow the new aliases
        return
      }
      case 'detectModels':
        await this.detectModels(cmd.provider)
        return
      case 'showModels':
        await this.showModels(cmd.refs, cmd.shown)
        return
      case 'addModel':
        await this.addModel(cmd)
        return
      case 'setProviderLimits':
        await this.setProviderLimits(cmd)
        return
      case 'setSecret': {
        if (!this.allowedSecrets().includes(cmd.name)) {
          this.log(`setSecret: "${cmd.name}" is not a name the app may store`)
          return
        }
        if (!cmd.value) return
        try {
          setStoredKey(cmd.name, cmd.value)
          this.log(`stored secret ${cmd.name}`) // never the value
        } catch (err) {
          this.log(`could not store ${cmd.name}: ${(err as Error).message}`)
        }
        await this.registry.load() // a provider key may have appeared
        this.emit({ type: 'secrets.updated', secretsSet: this.secretsSet() })
        this.scheduler.kick()
        void this.discoverModels() // and with it the models that provider lists
        return
      }
      case 'sendToKindle':
        await this.sendToKindle(cmd.book)
        return
      case 'askResearcher': {
        // from the "Ask researcher" box: tied to a book (its notes), an idea (shared notes) or general (shared notes)
        const book = cmd.book && (await this.books.read(cmd.book)) ? cmd.book : null
        if (cmd.book && !book) this.log(`askResearcher: no book "${cmd.book}", the answer goes to the shared notes`)
        const r = await this.research.ask({ question: cmd.question, book, idea: cmd.idea, askedBy: 'you', purpose: book ? `asked by you for the book ${book}` : cmd.idea ? `asked by you for the idea ${cmd.idea}` : 'asked by you, for the whole library' })
        if (r.status === 'limit') this.emit({ type: 'engine.warning', message: `the book ${book} reached its research limit, the question was not asked` })
        else if (r.status === 'empty') this.log('askResearcher: the question is empty')
        else this.log(`askResearcher: ${r.status} (${r.id ?? 'no job'})`)
        return
      }
      case 'coverRendered':
        await this.pipeline.coverRendered(cmd.book, cmd.ok, cmd.error)
        return
      default:
        this.log(`command "${(cmd as { type: string }).type}" is not implemented yet`)
    }
  }

  async snapshot(): Promise<SnapshotEvent> {
    const topics = await this.topics.read()
    const books: SnapshotEvent['books'] = []
    for (const slug of await this.books.slugs()) {
      const b = await bookSummary(this.books, slug, topics)
      if (b) books.push(b)
    }
    return {
      type: 'snapshot',
      dataDir: this.dataDir,
      uptimeMs: Date.now() - this.startedAt,
      paused: this.factory.paused,
      agents: this.agents.list().map((a) => agentSummary(a, this.scheduler, this.router)),
      books,
      topics: topics.map(topicSummary),
      ideas: await this.listIdeaSummaries(),
      series: await this.listSeriesSummaries(),
      formats: formatSummaries(this.formats),
      models: modelSummaries(this.registry),
      providers: providerSummaries(this.registry, this.router.limiter),
      roleDefaults: roleDefaults(this.registry),
      servers: serverStatuses(this.registry),
      spend: this.budget.snapshot(),
      running: this.scheduler.runningJobs(),
      settings: this.settingsSummary(),
      secretsSet: this.secretsSet(),
      mcp: this.mcpUrl ? { url: this.mcpUrl } : null,
      at: new Date().toISOString()
    }
  }
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command, EngineEvent, SettingsSummary, SnapshotEvent } from '../shared/protocol'
import { parseMdWith } from '../shared/md'
import { factorySchema, formatsSchema, qualitySchema, ROLES, settingsSchema } from '../shared/schemas'
import type { FactoryConfig, FormatEntry, QualityConfig, SettingsConfig } from '../shared/schemas'
import { AgentStore } from './agents/agents'
import { Budget } from './budget/spend'
import { LogWriter } from './logs/logs'
import { resolveKey, setStoredKey } from './models/keys'
import { ModelRegistry } from './models/registry'
import type { RegistryOptions } from './models/registry'
import { ModelRouter } from './models/router'
import type { RouterOptions } from './models/router'
import { JobStore } from './queue/jobs'
import { Bible } from './memory/bible'
import { MemoryService } from './memory/service'
import { ResearchService, SearchService } from './research/service'
import type { SearchServiceOptions } from './research/service'
import { BookStore } from './pipeline/books'
import { Pipeline } from './pipeline/pipeline'
import { Scheduler } from './queue/scheduler'
import { IdeaStore } from './store/ideas'
import { TopicsFile } from './store/topics'
import { readMd, writeMd } from './store/atomic'
import { sendEpub, smtpTransport } from './publish/kindle'
import type { TransportFactory } from './publish/kindle'
import { agentSummary, bookSummary, modelSummaries, roleDefaults, topicSummary } from './summary'
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

/** The engine core: config, models, budget, agents, jobs and the scheduler, plus the command handler. */
export class Engine {
  readonly registry: ModelRegistry
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
  readonly bible: Bible
  readonly memory: MemoryService
  readonly research: ResearchService
  readonly search: SearchService
  factory: FactoryConfig = factorySchema.parse({ kind: 'factory' })
  quality: QualityConfig = qualitySchema.parse({ kind: 'quality' })
  formats: FormatEntry[] = []
  settings: SettingsConfig = settingsSchema.parse({ kind: 'settings' })
  private knownAgents = new Set<string>()
  private readonly startedAt = Date.now()
  private readonly log: (m: string) => void
  private readonly emit: (e: EngineEvent) => void

  constructor(private readonly opts: EngineOptions) {
    // every event goes out through here: a stage change also sends the book summary, a finished job wakes the factory
    this.emit = (e) => {
      opts.emit(e)
      if (e.type === 'book.stage') void this.emitBookUpdated(e.book)
      if (e.type === 'job.done') this.pipeline.kick()
    }
    this.log = opts.log ?? (() => undefined)
    const dir = opts.dataDir
    this.registry = new ModelRegistry(dir, opts.registry)
    this.budget = new Budget(dir, {
      onWarn: (message) => {
        this.log(`budget warning: ${message}`)
        this.emit({ type: 'engine.warning', message })
      }
    })
    this.router = new ModelRouter(this.registry, this.budget, opts.router)
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
      onAgentsChanged: () => this.syncAgents()
    })
    this.books = new BookStore(dir)
    this.topics = new TopicsFile(dir, () => void this.emitTopics())
    this.ideas = new IdeaStore(dir)
    this.bible = new Bible(this.books)
    this.memory = new MemoryService(dir, this.registry)
    this.search = new SearchService({ registry: this.registry, budget: this.budget, emit: this.emit, log: this.log, keys: opts.registry?.keys, ...opts.search })
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
      bookChanged: (slug) => void this.emitBookUpdated(slug),
      tickMs: opts.tickMs
    })
  }

  get dataDir(): string {
    return this.opts.dataDir
  }

  async start(): Promise<void> {
    await this.loadFactory()
    await this.loadQualityAndFormats()
    await this.loadSettings()
    await this.registry.load()
    if (this.opts.discover !== false) {
      void this.registry.discover().then((r) => {
        for (const d of r) this.log(`models: ${d.provider} ${d.error ? 'discovery failed: ' + d.error : d.found + ' found'}`)
        this.scheduler.kick()
      })
    }
    await this.budget.load()
    const rec = await this.jobs.recoverRunning()
    if (rec.requeued.length || rec.dropped.length) {
      this.log(`recovery: ${rec.requeued.length} running job(s) back to queued, ${rec.dropped.length} duplicate(s) dropped`)
    }
    await this.agents.loadAll((file, err) => this.log(`invalid agent file ${file}: ${err.message}`))
    this.knownAgents = new Set(this.agents.list().map((a) => a.id))
    this.scheduler.start()
    await this.pipeline.start()
    await this.budget.writeSummary().catch(() => undefined)
  }

  async stop(): Promise<void> {
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
        await this.agents.reloadFile(path.basename(e.rel, '.md'))
        this.syncAgents()
      } else if (e.kind === 'topics') {
        await this.emitTopics()
      } else if (e.kind === 'config') {
        const name = path.basename(e.rel, '.md')
        if (name === 'providers' || name === 'roles') await this.registry.load()
        else if (name === 'budget') await this.budget.loadCaps()
        else if (name === 'factory') {
          const before = this.factory.paused
          await this.loadFactory()
          if (before !== this.factory.paused) this.emit({ type: 'factory.paused', paused: this.factory.paused })
        } else if (name === 'settings') await this.loadSettings()
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
  }

  settingsSummary(): SettingsSummary {
    const s = this.settings
    return {
      kindleAddress: s.kindle_address,
      fromAddress: s.from_address,
      smtpHost: s.smtp_host,
      smtpPort: s.smtp_port,
      smtpUser: s.smtp_user,
      smtpSecure: s.smtp_secure
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
        this.scheduler.kick()
        return
      case 'resume':
        await this.agents.patch(cmd.agent, { paused: false })
        this.scheduler.kick()
        return
      case 'stop':
        this.scheduler.stopAgent(cmd.agent)
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
        if (cmd.agent) await this.agents.patch(cmd.agent, { model: cmd.model })
        else if (cmd.role && cmd.model !== null) await this.setRoleModel(cmd.role, cmd.model)
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
      case 'setTopicActive':
        if (!(await this.topics.setActive(cmd.id, cmd.active))) this.log(`setTopicActive: unknown topic ${cmd.id}`)
        else this.pipeline.kick()
        return
      case 'addIdea': {
        const text = cmd.text.trim()
        if (!text) return
        const firstLine = text.split('\n')[0]!.trim()
        const title = firstLine.length > 70 ? firstLine.slice(0, 67).trimEnd() + '...' : firstLine
        await this.ideas.create({ title, pitch: text, topic: cmd.topic ?? null, source: 'user' })
        this.pipeline.kick()
        return
      }
      case 'saveSettings': {
        const file = this.settingsFile()
        let doc
        try {
          doc = await readMd(file)
        } catch {
          doc = { data: { kind: 'settings' } as Record<string, unknown>, body: '' }
        }
        const port = Number.isFinite(cmd.smtpPort) && cmd.smtpPort > 0 ? Math.round(cmd.smtpPort) : 587
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
            smtp_secure: !!cmd.smtpSecure
          },
          doc.body
        )
        await this.loadSettings()
        return
      }
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
      models: modelSummaries(this.registry),
      roleDefaults: roleDefaults(this.registry),
      spend: this.budget.snapshot(),
      running: this.scheduler.runningJobs(),
      settings: this.settingsSummary(),
      secretsSet: this.secretsSet(),
      at: new Date().toISOString()
    }
  }
}

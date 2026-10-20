/**
 * Engine <-> UI protocol. The engine sends events and accepts commands.
 * A Transport carries them. Today that is the Electron utilityProcess port. Later it could be a WebSocket.
 */

import type { StoryBrief } from './brief'

export type AgentState = 'working' | 'reviewing' | 'waiting-provider' | 'waiting-research' | 'idle' | 'error' | 'paused'

/**
 * Why a model didn't answer an agent: `day-limit` (the provider's requests for today are used up), `rate-limit` (too many
 * requests now, HTTP 429), `down` (the server isn't running), `too-big` (the request doesn't fit the model's context or answer
 * budget), `no-access` (401/403: key missing or wrong), `no-credit` (402), `not-found` (404: no such model), `bad-request`
 * (another 4xx), `server` (5xx), `budget` (a paid model over a spending cap), `other`.
 */
export type ProblemKind = 'day-limit' | 'rate-limit' | 'down' | 'too-big' | 'no-access' | 'no-credit' | 'not-found' | 'bad-request' | 'server' | 'budget' | 'other'

/** The last failed request of an agent, kept until one of its requests is answered again. */
export interface AgentProblem {
  kind: ProblemKind
  /** `provider/model` that failed. */
  model: string
  /** The error, shortened. */
  message: string
  /** When it happened (ms since epoch). */
  at: number
  /** The job failed for good on it (every model of the role failed), rather than retrying or falling back. */
  failed?: boolean
}

export interface ModelSummary {
  /** `provider/model`, the id used in `setModel` and in config files. */
  ref: string
  provider: string
  model: string
  family: string
  local: boolean
  /** True when the provider is switched on and usable (has a key, or is local). */
  enabled: boolean
  /** The pickers offer it: not hidden in the Models dialog (config/models.md). */
  shown: boolean
  /** Where it comes from: providers.md, the provider's own list (`discover`), or picked in the Models dialog. */
  source: 'config' | 'discovered' | 'picked'
  context?: number
  /** USD per 1M tokens. */
  priceIn: number
  priceOut: number
}

/** A model provider for the Models dialog (search services are left out). */
export interface ProviderSummary {
  id: string
  kind: string
  local: boolean
  /** Switched on and usable (has a key, or is local). */
  available: boolean
  /** Why it isn't available: switched off, or no key. */
  reason?: string
  /** It can list its models (`GET /models`, OpenAI-style providers). */
  canList: boolean
  /** Requests at once. With `concurrencyAuto` the server sets it (Strata, LM Studio), so it can't be changed here. */
  concurrency: number
  concurrencyAuto: boolean
  /** Requests per minute and per day; missing means no limit. */
  rpm?: number
  rpd?: number
  /** Requests sent since midnight UTC, when daily limits start again. */
  requestsToday: number
  /** The daily limit is used up: its jobs use their next model until `dayResetsAt` (epoch ms). */
  dayFull: boolean
  dayResetsAt: number
}

/** A model a provider lists, from `detectModels`. */
export interface CatalogModel {
  id: string
  /** `provider/model`. */
  ref: string
  context?: number
  /** USD per 1M tokens, when the provider lists prices. */
  priceIn?: number
  priceOut?: number
  /** It can be shown in the pickers: local, or with a listed price (a paid model the budget can't price never is). */
  pickable: boolean
}

/** A local model server the engine checks (Strata, LM Studio): running or not, and how many requests it serves at once. */
export interface ServerStatus {
  /** Provider id: `strata`, `lmstudio`. */
  id: string
  down: boolean
  slots: number
}

export interface AgentSummary {
  id: string
  name: string
  role: string
  /** The agent's own override (`provider/model`), or null. */
  model: string | null
  /** The model its running job calls now, else what it will use for its next job: the override, else the role default (first usable model). */
  resolvedModel: string | null
  /** The book the agent is assigned to (`pin` in its file): it only takes that book's jobs. Null when it takes any job. */
  pin: string | null
  paused: boolean
  state: AgentState
  /** What it is doing now, when it has a job. */
  task?: string
  book?: string
  jobId?: string
  /** Its last request failed and none has been answered since. */
  problem?: AgentProblem
}

export interface BookSummary {
  slug: string
  title: string
  author: string | null
  topic: { id: string; name: string } | null
  /** Topic kind: fiction, juvenile-fiction, ... */
  kind: string | null
  format: string
  stage: string
  /** Paused on its own: its jobs wait. */
  paused: boolean
  /** Chapters written so far, and how many the outline plans (null before the outline). */
  chaptersWritten: number
  chaptersPlanned: number | null
  targetWords: number
  /** Review round (0 before the first rewrite). */
  round: number
  /** Why it failed or was rejected. */
  reasons: string[]
  /** Who worked on it (from made.md): per agent, its role, finished jobs, the models it used and what it cost. */
  team: { agent: string; role: string; jobs: number; models: string[]; costUsd: number }[]
  /** The last finished jobs, newest first. */
  steps: { task: string; unit: string; agent: string; model: string }[]
  words: number
  year: number | null
  /** Weighted overall score (1-10), or null before the publisher scored it. */
  score: number | null
  /** Average per dimension. */
  scores: Record<string, number>
  costUsd: number
  rating: number | null
  ratingNote: string | null
  /** Paths are relative to the data folder, with forward slashes. */
  coverPng: string | null
  /** When cover.png was last written (ms), so a remade cover replaces the cached image. */
  coverVersion: number | null
  /** `cover_png` in book.md: requested (being drawn), done, failed, pending (no renderer, headless), or null. */
  coverState: string | null
  epub: string | null
  /** Folder with the unzipped XHTML chapters and `index.html`, for the in-app reader. */
  readerDir: string | null
  /** The reader's pages in reading order (cover, title page, chapters ...); its `index.html` is the contents. */
  readerPages: { file: string; title: string }[]
  publishedAt: string | null
}

export interface TopicSummary {
  id: string
  section: string
  name: string
  kind: string
  active: boolean
  target: number
  done: number
  inProgress: number
}

/** A story (a file in ideas/) for the idea list: the owner's open stories and the last used ones. */
export interface IdeaSummary {
  slug: string
  title: string
  status: 'open' | 'used'
  source: 'user' | 'generated'
  /** Format id the owner fixed, or null. */
  format: string | null
  /** Topic id, or null. */
  topic: string | null
  /** The book made from it, once used. */
  book: string | null
  /** The owner gave the title (the book keeps it). */
  titleFixed: boolean
  characters: number
  /** The series the story belongs to (slug) and its position, when it has one. */
  series?: string
  seriesIndex?: number | null
  /** The whole brief, so the story can be edited. */
  brief: StoryBrief
}

/** One entry of a series' list: a book (any stage) or a story no book has started yet. */
export interface SeriesBookRef {
  /** Book slug, or the story's slug while `kind` is `story`. */
  slug: string
  title: string
  /** Position in the series. */
  index: number
  kind: 'book' | 'story'
  /** The book's stage, or `story` for a story still waiting. */
  stage: string
  score: number | null
}

/** A series (a file in series/): its arc, recurring cast, setting and style as a brief, and its books in order. */
export interface SeriesSummary {
  slug: string
  title: string
  genre: string | null
  format: string | null
  /** Title, premise (the series arc), characters, setting, style and extra sections. */
  brief: StoryBrief
  /** The books (and waiting stories) of the series, in order. */
  books: SeriesBookRef[]
}

/** An enabled format, for the story form's format picker. */
export interface FormatSummary {
  id: string
  name: string
  kinds: string[]
}

export interface SettingsSummary {
  kindleAddress: string
  fromAddress: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpSecure: boolean
  /** `provider/model` behind the role aliases `paid`, `strata` and `lmstudio`. */
  defaultPaidModel: string
  defaultStrataModel: string
  defaultLmstudioModel: string
  /** `model_order` in settings.md: the groups `paid`, `strata`, `lmstudio` in the order every role tries them. Empty: each role's own order. */
  modelOrder: ModelGroup[]
  /** How the engine loads LM Studio models: requests at once, context window, idle minutes before unloading. */
  lmstudioParallel: number
  lmstudioContext: number
  lmstudioTtlMinutes: number
  /** `max_books_in_progress` in config/factory.md: how many books are worked on at the same time. */
  maxBooksInProgress: number
}

export type ModelGroup = 'paid' | 'strata' | 'lmstudio'

export type ModelSettingKey = 'defaultPaidModel' | 'defaultStrataModel' | 'defaultLmstudioModel' | 'modelOrder' | 'lmstudioParallel' | 'lmstudioContext' | 'lmstudioTtlMinutes' | 'maxBooksInProgress'

export interface SnapshotEvent {
  type: 'snapshot'
  dataDir: string
  uptimeMs: number
  /** Pause all. */
  paused: boolean
  agents: AgentSummary[]
  books: BookSummary[]
  topics: TopicSummary[]
  /** The owner's open stories and the last 10 used ones. */
  ideas: IdeaSummary[]
  /** The series (series/), with their books in order. */
  series: SeriesSummary[]
  /** The enabled formats. */
  formats: FormatSummary[]
  /** Every chat model the engine knows, including the LM Studio models found on this machine. The pickers offer the `shown` ones. */
  models: ModelSummary[]
  providers: ProviderSummary[]
  /** Role -> `provider/model` of the role default (first in the role's list). */
  roleDefaults: Record<string, string>
  servers: ServerStatus[]
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  running: { jobId: string; agent: string }[]
  settings: SettingsSummary
  /** Names of secrets that are set (never their values): the SMTP password and provider key variables. */
  secretsSet: string[]
  /** The MCP server's address while it listens (`http://127.0.0.1:7341/mcp`), else null. */
  mcp: { url: string } | null
  at: string
}

export type EngineEvent =
  | { type: 'engine.ready'; pid: number; dataDir: string; at: string }
  | { type: 'engine.heartbeat'; n: number; at: string; uptimeMs: number }
  | { type: 'pong'; id?: string; at: string }
  | SnapshotEvent
  | { type: 'engine.warning'; message: string }
  /** Asks Electron main to render an HTML cover to a PNG and answer with a `coverRendered` command. */
  | { type: 'cover.render'; book: string; htmlPath: string; outPath: string; width: number; height: number }
  | { type: 'agent.state'; agent: string; role: string; state: AgentState; jobId?: string; task?: string; book?: string }
  | { type: 'agent.hired'; agent: AgentSummary }
  | { type: 'agent.removed'; agent: string }
  /** The draft reader of a book is ready: `dir` is relative to the data folder. */
  | {
      type: 'draft.ready'
      book: string
      dir: string
      /** The reader's pages in order: the chapters (with `n`), then "Still to come" and "Your notes" when there are any. */
      pages: { file: string; title: string; n?: number }[]
      notes: string
      chapters: { n: number; title: string; words: number }[]
      at: number
    }
  /** An agent's file changed (its model, paused, ...). */
  | { type: 'agent.updated'; agent: AgentSummary }
  | { type: 'factory.paused'; paused: boolean }
  | { type: 'job.started'; jobId: string; agent: string; task: string; book?: string; model?: string }
  /** A request of the agent failed (`problem`), or one was answered again after that (`null`). */
  | { type: 'agent.problem'; agent: string; problem: AgentProblem | null }
  /** The job moved to another model (a fallback after a failure), so the office shows the one answering now. */
  | { type: 'job.model'; jobId: string; agent: string; model: string }
  | { type: 'job.token'; jobId: string; agent: string; text: string }
  /** A local model server went down, came back or changed its slot count. */
  | { type: 'servers'; servers: ServerStatus[] }
  /** The MCP server started (`url`) or stopped (`null`). */
  | { type: 'mcp.updated'; mcp: { url: string } | null }
  | { type: 'job.done'; jobId: string; agent: string; ok: boolean; result?: string; error?: string }
  | { type: 'handover'; from: string; to: string; label: string; jobId?: string; done?: boolean }
  | {
      type: 'spend'
      provider: string
      model: string
      tokensIn: number
      tokensOut: number
      costUsd: number
      agent?: string
      book?: string
    }
  | { type: 'book.stage'; book: string; stage: string }
  /** A book changed (published, rated, stage change, cover done). Carries the whole summary. */
  | { type: 'book.updated'; book: BookSummary }
  /** topics.md changed (counts, active flags). Carries the whole list. */
  | { type: 'topics.updated'; topics: TopicSummary[] }
  /** ideas/ changed (a story was added, edited or used). Carries the whole list. */
  | { type: 'ideas.updated'; ideas: IdeaSummary[] }
  /** series/ changed (a series was added, edited, or got a book). Carries the whole list. */
  | { type: 'series.updated'; series: SeriesSummary[] }
  | { type: 'kindle.sent'; book: string; ok: boolean; error?: string }
  | { type: 'secrets.updated'; secretsSet: string[] }
  /** The answer to `detectModels`: every chat model the provider lists, or why it couldn't be asked. */
  | { type: 'models.catalog'; provider: string; models: CatalogModel[]; error?: string; at: string }

export type EngineEventType = EngineEvent['type']

export type Command =
  | { type: 'hire'; role: string; name?: string; model?: string }
  | { type: 'fire'; agent: string; now?: boolean }
  | { type: 'pause'; agent: string }
  | { type: 'resume'; agent: string }
  | { type: 'stop'; agent: string }
  /** Assigns an agent to one book in progress (`pin` in its file), or frees it with `book: null`. A writer also becomes the book's writer. */
  | { type: 'assignBook'; agent: string; book: string | null }
  | { type: 'pauseAll' }
  | { type: 'resumeAll' }
  | { type: 'stopNow' }
  /** `model: null` with an `agent` clears that agent's override. */
  | { type: 'setModel'; model: string | null; agent?: string; role?: string }
  | { type: 'askResearcher'; question: string; book?: string; idea?: string }
  /** Writes `rating` (1-5) and `rating_note` to the book's book.md and answers with `book.updated`. */
  | { type: 'rate'; book: string; rating: number; note?: string }
  /** Builds the draft reader of a book that isn't finished (books/<slug>/out/draft/). Answers with `draft.ready`. */
  | { type: 'readDraft'; book: string }
  /** Adds your note to the book's notes.md (the writers follow it). With `rewrite` and a written `chapter`, that chapter is rewritten with the note. Answers with `draft.ready`. */
  | { type: 'addBookNote'; book: string; text: string; chapter?: number | null; rewrite?: boolean }
  /** Pauses or resumes one book (`paused` in its book.md): its jobs wait, so the agents work on the other books. */
  | { type: 'pauseBook'; book: string; paused: boolean }
  /** Puts a failed book's failed jobs back in the queue and continues the book from the stage it failed in. */
  | { type: 'retryBook'; book: string }
  /** Gives a rejected book one more round: `rewrite` (the given chapters, or the ones the reviews name, then reviewed again) or `review` (reviewed again, no rewrite). Then the publisher decides again. */
  /** Sets (or with `model: null` removes) the model one book uses for a role (`role_models` in book.md). Its jobs of that role try it first. */
  | { type: 'setBookModel'; book: string; role: string; model: string | null }
  | { type: 'reopenBook'; book: string; mode: 'rewrite' | 'review'; chapters?: number[] }
  /** Draws a published book's cover again from templates/cover.html and book.md, then rebuilds the EPUB. Answers with `book.updated`. */
  | { type: 'regenerateCover'; book: string }
  /** Gives a published book a new title (its folder and slug stay), then remakes the cover, the EPUB and the reader. Answers with `book.updated`. */
  | { type: 'renameBook'; book: string; title: string }
  /** Mails the EPUB. Answers with `kindle.sent`. */
  | { type: 'sendToKindle'; book: string }
  | { type: 'setTopicActive'; id: string; active: boolean }
  /** Adds a row to the "My topics" table in topics.md, switched on unless `active` is false. */
  | { type: 'addTopic'; name: string; kind: string; target?: number; active?: boolean }
  /** Creates an idea file in ideas/. */
  | { type: 'addIdea'; text: string; topic?: string }
  /** Creates a story from a brief (title, premise, plot, characters, ...) in ideas/. */
  | { type: 'addStory'; brief: StoryBrief }
  /** Replaces the brief of a story that no book has started yet. `idea` is the story's slug. */
  | { type: 'updateStory'; idea: string; brief: StoryBrief }
  /** Creates a series from a brief (title, premise = the series arc, recurring characters, setting, style) in series/. */
  | { type: 'addSeries'; brief: StoryBrief }
  /** Replaces the brief of a series. `series` is its slug. Its books stay. */
  | { type: 'updateSeries'; series: string; brief: StoryBrief }
  /** Asks a provider for every model it has (`GET /models`). Answers with `models.catalog`. */
  | { type: 'detectModels'; provider: string }
  /** Shows models in the pickers, or hides them (config/models.md). A listed model that isn't known yet is added with its listed price. */
  | { type: 'showModels'; refs: string[]; shown: boolean }
  /** Adds a model by its id to `picked` in config/models.md, for one the provider doesn't list. A paid provider needs both prices (USD per 1M tokens, 0 for free). */
  | { type: 'addModel'; provider: string; id: string; priceIn?: number; priceOut?: number; context?: number }
  /**
   * Sets a provider's limits in config/models.md, over providers.md: requests at once (not for a server that reports its own),
   * per minute and per day. 0 for `rpm` or `rpd` means no limit; a field left out keeps its value.
   */
  | { type: 'setProviderLimits'; provider: string; concurrency?: number; rpm?: number; rpd?: number }
  /** The model defaults, LM Studio fields and book limit may be left out: they keep their value. */
  | ({ type: 'saveSettings' } & Omit<SettingsSummary, ModelSettingKey> & Partial<Pick<SettingsSummary, ModelSettingKey>>)
  /** Stores a secret in the Windows credential store. Only the SMTP password and the provider key variables are allowed. */
  | { type: 'setSecret'; name: string; value: string }
  | { type: 'snapshot' }
  | { type: 'ping'; id?: string }
  /** Check the local model servers now (Strata was just started), instead of at the next 10-second check. */
  | { type: 'checkServers' }
  | { type: 'coverRendered'; book: string; ok: boolean; error?: string }

export type CommandType = Command['type']

/** Every command type, as an object so the compiler fails when a new command is not listed (main drops unlisted ones). */
const COMMAND_TYPE_SET: Record<CommandType, true> = {
  hire: true,
  fire: true,
  pause: true,
  resume: true,
  stop: true,
  assignBook: true,
  pauseAll: true,
  resumeAll: true,
  stopNow: true,
  setModel: true,
  askResearcher: true,
  checkServers: true,
  rate: true,
  sendToKindle: true,
  setTopicActive: true,
  addTopic: true,
  addIdea: true,
  addStory: true,
  updateStory: true,
  addSeries: true,
  updateSeries: true,
  saveSettings: true,
  setSecret: true,
  detectModels: true,
  showModels: true,
  addModel: true,
  setProviderLimits: true,
  snapshot: true,
  ping: true,
  coverRendered: true,
  readDraft: true,
  addBookNote: true,
  pauseBook: true,
  retryBook: true,
  reopenBook: true,
  setBookModel: true,
  regenerateCover: true,
  renameBook: true
}

export const COMMAND_TYPES: readonly CommandType[] = Object.keys(COMMAND_TYPE_SET) as CommandType[]

export function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && (COMMAND_TYPES as readonly string[]).includes(type)
}

/** One end of a link: sends `Out` messages and receives `In` messages. */
export interface Transport<Out, In> {
  send(message: Out): void
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: In) => void): () => void
  close(): void
}

/** The engine's end of the link. The UI's end is the mirror: Transport<Command, EngineEvent>. */
export type EngineTransport = Transport<EngineEvent, Command>

/** What the preload script exposes to the renderer as `window.scriptorium`. */
export interface ScriptoriumApi {
  on(handler: (event: EngineEvent) => void): () => void
  send(command: Command): void
}

/**
 * Engine <-> UI protocol. The engine sends events and accepts commands.
 * A Transport carries them. Today that is the Electron utilityProcess port. Later it could be a WebSocket.
 */

export type AgentState = 'working' | 'reviewing' | 'waiting-provider' | 'waiting-research' | 'idle' | 'error' | 'paused'

export interface ModelSummary {
  /** `provider/model`, the id used in `setModel` and in config files. */
  ref: string
  provider: string
  model: string
  family: string
  local: boolean
  /** True when the provider is switched on and usable (has a key, or is local). */
  enabled: boolean
}

export interface AgentSummary {
  id: string
  name: string
  role: string
  /** The agent's own override (`provider/model`), or null. */
  model: string | null
  /** What the agent will use for its next job: the override, else the role default (first usable model). */
  resolvedModel: string | null
  paused: boolean
  state: AgentState
  /** What it is doing now, when it has a job. */
  task?: string
  book?: string
  jobId?: string
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
  epub: string | null
  /** Folder with the unzipped XHTML chapters and `index.html`, for the in-app reader. */
  readerDir: string | null
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
  /** How the engine loads LM Studio models: requests at once, context window, idle minutes before unloading. */
  lmstudioParallel: number
  lmstudioContext: number
  lmstudioTtlMinutes: number
}

export type ModelSettingKey = 'defaultPaidModel' | 'defaultStrataModel' | 'defaultLmstudioModel' | 'lmstudioParallel' | 'lmstudioContext' | 'lmstudioTtlMinutes'

export interface SnapshotEvent {
  type: 'snapshot'
  dataDir: string
  uptimeMs: number
  /** Pause all. */
  paused: boolean
  agents: AgentSummary[]
  books: BookSummary[]
  topics: TopicSummary[]
  /** Every chat model the pickers can offer, including the LM Studio models found on this machine. */
  models: ModelSummary[]
  /** Role -> `provider/model` of the role default (first in the role's list). */
  roleDefaults: Record<string, string>
  spend: { today: number; month: number; dailyCap: number; monthlyCap: number }
  running: { jobId: string; agent: string }[]
  settings: SettingsSummary
  /** Names of secrets that are set (never their values): the SMTP password and provider key variables. */
  secretsSet: string[]
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
  | { type: 'job.token'; jobId: string; agent: string; text: string }
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
  | { type: 'kindle.sent'; book: string; ok: boolean; error?: string }
  | { type: 'secrets.updated'; secretsSet: string[] }

export type EngineEventType = EngineEvent['type']

export type Command =
  | { type: 'hire'; role: string; name?: string; model?: string }
  | { type: 'fire'; agent: string; now?: boolean }
  | { type: 'pause'; agent: string }
  | { type: 'resume'; agent: string }
  | { type: 'stop'; agent: string }
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
  /** Mails the EPUB. Answers with `kindle.sent`. */
  | { type: 'sendToKindle'; book: string }
  | { type: 'setTopicActive'; id: string; active: boolean }
  /** Adds a row to the "My topics" table in topics.md, switched on unless `active` is false. */
  | { type: 'addTopic'; name: string; kind: string; target?: number; active?: boolean }
  /** Creates an idea file in ideas/. */
  | { type: 'addIdea'; text: string; topic?: string }
  /** The model defaults and LM Studio fields may be left out: they keep their value. */
  | ({ type: 'saveSettings' } & Omit<SettingsSummary, ModelSettingKey> & Partial<Pick<SettingsSummary, ModelSettingKey>>)
  /** Stores a secret in the Windows credential store. Only the SMTP password and the provider key variables are allowed. */
  | { type: 'setSecret'; name: string; value: string }
  | { type: 'snapshot' }
  | { type: 'ping'; id?: string }
  | { type: 'coverRendered'; book: string; ok: boolean; error?: string }

export type CommandType = Command['type']

/** Every command type, as an object so the compiler fails when a new command is not listed (main drops unlisted ones). */
const COMMAND_TYPE_SET: Record<CommandType, true> = {
  hire: true,
  fire: true,
  pause: true,
  resume: true,
  stop: true,
  pauseAll: true,
  resumeAll: true,
  stopNow: true,
  setModel: true,
  askResearcher: true,
  rate: true,
  sendToKindle: true,
  setTopicActive: true,
  addTopic: true,
  addIdea: true,
  saveSettings: true,
  setSecret: true,
  snapshot: true,
  ping: true,
  coverRendered: true,
  readDraft: true,
  addBookNote: true,
  pauseBook: true,
  retryBook: true
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

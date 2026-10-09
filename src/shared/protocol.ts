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
}

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
  /** Mails the EPUB. Answers with `kindle.sent`. */
  | { type: 'sendToKindle'; book: string }
  | { type: 'setTopicActive'; id: string; active: boolean }
  /** Creates an idea file in ideas/. */
  | { type: 'addIdea'; text: string; topic?: string }
  | ({ type: 'saveSettings' } & SettingsSummary)
  /** Stores a secret in the Windows credential store. Only the SMTP password and the provider key variables are allowed. */
  | { type: 'setSecret'; name: string; value: string }
  | { type: 'snapshot' }
  | { type: 'ping'; id?: string }
  | { type: 'coverRendered'; book: string; ok: boolean; error?: string }

export type CommandType = Command['type']

export const COMMAND_TYPES: readonly CommandType[] = [
  'hire',
  'fire',
  'pause',
  'resume',
  'stop',
  'pauseAll',
  'resumeAll',
  'stopNow',
  'setModel',
  'askResearcher',
  'rate',
  'sendToKindle',
  'setTopicActive',
  'addIdea',
  'saveSettings',
  'setSecret',
  'snapshot',
  'ping',
  'coverRendered'
]

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

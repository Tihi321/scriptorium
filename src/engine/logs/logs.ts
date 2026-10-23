import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * One call's (job's) writer from `LogWriter.session`: its text goes to the files in one piece.
 * While another session writes to a file, this one keeps its text for that file and the writer adds it when the other has ended.
 */
export class LogSession {
  /** Text kept back for a file another session is writing to. */
  readonly held = new Map<string, string>()
  ended = false

  constructor(
    private readonly writer: LogWriter,
    readonly files: string[]
  ) {}

  write(text: string): void {
    if (!text) return
    for (const file of this.files) this.writer.write(this, file, text)
  }

  /** Lets the next session write. Safe to call twice. */
  end(): void {
    if (this.ended) return
    this.ended = true
    this.writer.release(this)
  }
}

/**
 * Buffered appends to log files. Output is flushed about every 250 ms (and on flush()),
 * so streamed tokens don't cause one write each.
 * Parallel calls (agents running at once) write through a `session` each: one session at a time streams into a file,
 * the others wait with their text, so every call's text stays in one piece in `log.md`.
 */
export class LogWriter {
  private buffers = new Map<string, string>()
  /** The session that is writing to a file now, and the ones waiting for it. */
  private owners = new Map<string, { owner: LogSession; waiting: LogSession[] }>()
  private timer: NodeJS.Timeout | undefined
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly flushMs = 250
  ) {}

  agentLog(agent: string): string {
    return path.join(this.dataDir, 'logs', 'agents', `${agent}.md`)
  }
  bookLog(book: string): string {
    return path.join(this.dataDir, 'books', book, 'log.md')
  }

  append(file: string, text: string): void {
    this.buffers.set(file, (this.buffers.get(file) ?? '') + text)
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush()
      }, this.flushMs)
      this.timer.unref?.()
    }
  }

  /** Appends to the agent's log and, when there is a book, the book's log. */
  both(agent: string, book: string | null | undefined, text: string): void {
    this.append(this.agentLog(agent), text)
    if (book) this.append(this.bookLog(book), text)
  }

  /** A writer for one call: its text for these files (the agent's log and the book's log) is written in one piece. End it when the call is over. */
  session(agent: string, book: string | null | undefined): LogSession {
    return new LogSession(this, book ? [this.agentLog(agent), this.bookLog(book)] : [this.agentLog(agent)])
  }

  /** @internal Used by LogSession. */
  write(session: LogSession, file: string, text: string): void {
    const state = this.owners.get(file)
    if (!state) this.owners.set(file, { owner: session, waiting: [] })
    if (!state || state.owner === session) return this.append(file, text)
    if (!state.waiting.includes(session)) state.waiting.push(session)
    session.held.set(file, (session.held.get(file) ?? '') + text)
  }

  /** @internal Used by LogSession: hands each file the session owned to the next one that waits, with the text it kept. */
  release(session: LogSession): void {
    for (const [file, state] of [...this.owners]) {
      // a session that waits and ends keeps its place: its text is written when it is its turn
      if (state.owner !== session) continue
      let next = state.waiting.shift()
      while (next) {
        this.append(file, next.held.get(file) ?? '')
        next.held.delete(file)
        if (!next.ended) break
        next = state.waiting.shift()
      }
      if (next) state.owner = next
      else this.owners.delete(file)
    }
  }

  /** Writes everything, also the text of sessions that still wait (at shutdown). */
  async close(): Promise<void> {
    for (const state of this.owners.values()) {
      for (const s of state.waiting) for (const [file, text] of s.held) this.append(file, text)
      for (const s of state.waiting) s.held.clear()
    }
    await this.flush()
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const batch = [...this.buffers.entries()]
    this.buffers.clear()
    this.chain = this.chain.then(async () => {
      for (const [file, text] of batch) {
        try {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.appendFile(file, text, 'utf8')
        } catch {
          /* a log failure must not stop the work */
        }
      }
    })
    return this.chain
  }
}

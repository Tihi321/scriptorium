import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomic'

export type TopicKind = 'fiction' | 'nonfiction' | 'juvenile-fiction' | 'juvenile-nonfiction'

export interface TopicRow {
  id: string
  topic: string
  kind: string
  active: boolean
  /** Books wanted. 0 or empty means no limit. */
  target: number
  done: number
  inProgress: number
  /** The `##` heading the row is under. */
  section: string
  /** Index of the line in the file. */
  line: number
}

const TRUE = new Set(['yes', 'y', 'x', 'true', '1', 'on', '✓', '✔'])
export const parseBool = (s: string) => TRUE.has(s.trim().toLowerCase())
const toInt = (s: string) => {
  const n = parseInt(s.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

interface Columns {
  id: number
  topic: number
  kind: number
  active: number
  target: number
  done: number
  inProgress: number
}

/** Splits a table line into raw cells (padding kept). Leading and trailing pipes are optional. */
function rawCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|')
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, '')

function readHeader(cells: string[]): Columns | null {
  const idx = (names: string[]) => cells.findIndex((c) => names.includes(norm(c)))
  const cols = {
    id: idx(['id']),
    topic: idx(['topic', 'name']),
    kind: idx(['kind', 'type']),
    active: idx(['active']),
    target: idx(['target']),
    done: idx(['done']),
    inProgress: idx(['inprogress', 'progress'])
  }
  return Object.values(cols).every((v) => v >= 0) ? cols : null
}

export function parseTopics(text: string): TopicRow[] {
  const rows: TopicRow[] = []
  let section = ''
  let cols: Columns | null = null
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    const h = /^#{2,6}\s+(.*)$/.exec(line)
    if (h) {
      section = h[1]!.trim()
      cols = null
      return
    }
    if (!line.includes('|')) return
    const cells = rawCells(line)
    if (cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) return // separator
    const header = readHeader(cells)
    if (header) {
      cols = header
      return
    }
    if (!cols) return
    const c = cols as Columns
    const id = cells[c.id]?.trim()
    if (!id) return
    rows.push({
      id,
      topic: cells[c.topic]?.trim() ?? '',
      kind: cells[c.kind]?.trim().toLowerCase() ?? '',
      active: parseBool(cells[c.active] ?? ''),
      target: toInt(cells[c.target] ?? ''),
      done: toInt(cells[c.done] ?? ''),
      inProgress: toInt(cells[c.inProgress] ?? ''),
      section,
      line: i
    })
  })
  return rows
}

/** Replaces the text of one cell, keeping the cell's width (alignment) where it fits. */
function setCell(line: string, index: number, value: string): string {
  const lead = line.startsWith('|') ? 1 : 0
  const parts = line.slice(lead).split('|')
  const old = parts[index] ?? ''
  const width = old.length
  let next = ` ${value}`
  next = next.length + 1 <= width ? next.padEnd(width) : `${next} `
  parts[index] = next
  return line.slice(0, lead) + parts.join('|')
}

export type TopicCountChange = Partial<{ done: number; inProgress: number; active: boolean; target: number }>

/**
 * Reads and updates topics.md. Only the cells that change are touched: every other character of the file
 * (your text, column alignment, comments) stays. The file is re-read before each write.
 */
export class TopicsFile {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly onChange?: () => void
  ) {}

  get file(): string {
    return path.join(this.dataDir, 'topics.md')
  }

  async read(): Promise<TopicRow[]> {
    try {
      return parseTopics(await fs.readFile(this.file, 'utf8'))
    } catch {
      return []
    }
  }

  /** Adds `delta` to done and in-progress counts, or sets `active`/`target`. Returns false when the id is unknown. */
  adjust(id: string, delta: { done?: number; inProgress?: number }, set: { active?: boolean; target?: number } = {}): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      let text: string
      try {
        text = await fs.readFile(this.file, 'utf8')
      } catch {
        return false
      }
      const rows = parseTopics(text)
      const row = rows.find((r) => r.id === id)
      if (!row) return false
      const lines = text.split('\n')
      // find the header for this row's table to know column indexes
      let headerIdx = row.line
      let cols: Columns | null = null
      while (headerIdx >= 0 && !cols) {
        const l = lines[headerIdx]!
        if (l.includes('|')) cols = readHeader(rawCells(l))
        headerIdx--
      }
      if (!cols) return false
      let line = lines[row.line]!
      const cr = line.endsWith('\r') ? '\r' : ''
      if (cr) line = line.slice(0, -1)
      const put = (col: number, v: number | string) => (line = setCell(line, col, String(v)))
      if (delta.done) put(cols.done, Math.max(0, row.done + delta.done) || '')
      if (delta.inProgress) put(cols.inProgress, Math.max(0, row.inProgress + delta.inProgress) || '')
      if (set.active !== undefined) put(cols.active, set.active ? 'yes' : 'no')
      if (set.target !== undefined) put(cols.target, set.target || '')
      lines[row.line] = line + cr
      await atomicWrite(this.file, lines.join('\n'))
      this.onChange?.()
      return true
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  setActive(id: string, active: boolean): Promise<boolean> {
    return this.adjust(id, {}, { active })
  }
}

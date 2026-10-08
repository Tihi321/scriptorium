import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Resolves a path given by the renderer against the data folder.
 * Returns null for anything that is not strictly inside it: absolute paths, drive letters, `..`, NUL bytes.
 */
export function resolveInside(dataDir: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('\\\\') || rel.startsWith('/')) return null
  const parts = rel.split(/[\\/]+/)
  if (parts.some((p) => p === '..')) return null
  const root = path.resolve(dataDir)
  const full = path.resolve(root, rel)
  const inside = path.relative(root, full)
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return null
  return full
}

const MAX_READ = 8 * 1024 * 1024

export async function readFileInside(dataDir: string, rel: unknown): Promise<string | null> {
  const full = resolveInside(dataDir, rel)
  if (!full) return null
  try {
    const stat = await fs.stat(full)
    if (!stat.isFile() || stat.size > MAX_READ) return null
    return await fs.readFile(full, 'utf8')
  } catch {
    return null
  }
}

/** Text from `fromByte` to the end. A negative `fromByte` means the last N bytes. */
export async function tailFileInside(dataDir: string, rel: unknown, fromByte: unknown): Promise<{ text: string; size: number } | null> {
  const full = resolveInside(dataDir, rel)
  if (!full || typeof fromByte !== 'number' || !Number.isFinite(fromByte)) return null
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(full, 'r')
    const stat = await handle.stat()
    if (!stat.isFile()) return null
    const size = stat.size
    let start = fromByte < 0 ? Math.max(0, size + fromByte) : Math.min(fromByte, size)
    const length = Math.min(size - start, MAX_READ)
    if (length < size - start) start = size - length
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    let text = buffer.toString('utf8')
    // a cut in the middle of a character or a line: drop the broken first bit
    if (start > 0) {
      text = text.replace(/^[^\n]*\n/, '')
    }
    return { text, size }
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/** The content types the book protocol serves. Anything else is refused. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/**
 * Maps a `scriptorium-book://data/<rel>` URL to a file path. Only `books/<slug>/out/...` is served,
 * and only the file types above.
 */
export function bookUrlToPath(dataDir: string, url: string): { file: string; type: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'scriptorium-book:') return null
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  if (!/^books\/[^/]+\/out\//.test(rel)) return null
  const file = resolveInside(dataDir, rel)
  if (!file) return null
  const type = TYPES[path.extname(file).toLowerCase()]
  return type ? { file, type } : null
}

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseMd } from '../../shared/md'

export type Embedder = (texts: string[], kind: 'document' | 'query') => Promise<number[][]>

export interface IndexedFile {
  /** Path relative to the data folder, with forward slashes. */
  file: string
  book: string
  /** chapter, summary, bible, pitch, blurb, research ... */
  kind: string
  /** A label such as `ch03`. */
  ref: string
  text: string
}

export interface Hit {
  file: string
  idx: number
  book: string
  kind: string
  ref: string
  text: string
  score: number
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex')

/** Splits text into chunks of about `size` characters at paragraph borders. */
export function chunkText(text: string, size = 1200): string[] {
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur)
      cur = ''
    }
    if (p.length > size * 1.5) {
      // a very long paragraph: cut at sentence ends
      for (const part of p.match(/[^.!?]+[.!?]*\s*/g) ?? [p]) {
        if (cur && cur.length + part.length > size) {
          chunks.push(cur.trim())
          cur = ''
        }
        cur += part
      }
    } else cur += (cur ? '\n\n' : '') + p
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

function ftsQuery(q: string): string {
  const words = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])].filter((w) => w.length > 1).slice(0, 40)
  return words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ')
}

/**
 * The search index: one SQLite file (`index/library.sqlite`) with a chunks table, an FTS5 table and a vec0 table.
 * It is only a cache built from the markdown files, and can be deleted and rebuilt with `reindex`.
 */
export class MemoryIndex {
  private db: DatabaseSync
  private dim = 0

  private constructor(
    readonly file: string,
    private readonly embed: Embedder
  ) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file, { allowExtension: true })
    const req = createRequire(__filename)
    // SCRIPTORIUM_SQLITE_VEC points at vec0.dll (vec0.so, vec0.dylib) when the package can't find it, for example in a packaged app
    this.db.loadExtension(process.env.SCRIPTORIUM_SQLITE_VEC || (req('sqlite-vec') as { getLoadablePath(): string }).getLoadablePath())
    this.db.exec(`
      create table if not exists meta(key text primary key, value text);
      create table if not exists files(file text primary key, hash text not null);
      create table if not exists chunks(id integer primary key, file text not null, idx integer not null, book text not null, kind text not null, ref text not null, text text not null);
      create index if not exists chunks_file on chunks(file);
      create virtual table if not exists chunks_fts using fts5(text, tokenize='unicode61');
    `)
    const dim = this.db.prepare("select value from meta where key = 'dim'").get() as { value: string } | undefined
    if (dim) {
      this.dim = Number(dim.value)
      this.db.exec(`create virtual table if not exists chunks_vec using vec0(embedding float[${this.dim}])`)
    }
  }

  static open(dataDir: string, embed: Embedder): MemoryIndex {
    return new MemoryIndex(path.join(dataDir, 'index', 'library.sqlite'), embed)
  }

  close(): void {
    this.db.close()
  }

  private ensureDim(dim: number): void {
    if (this.dim === dim) return
    if (this.dim !== 0) {
      // the embedding model changed: everything has to be embedded again
      this.db.exec('drop table if exists chunks_vec; delete from chunks; delete from chunks_fts; delete from files;')
    }
    this.dim = dim
    this.db.prepare("insert or replace into meta(key, value) values ('dim', ?)").run(String(dim))
    this.db.exec(`create virtual table if not exists chunks_vec using vec0(embedding float[${dim}])`)
  }

  private deleteFileRows(file: string): void {
    const ids = this.db.prepare('select id from chunks where file = ?').all(file) as { id: number }[]
    for (const { id } of ids) {
      this.db.prepare('delete from chunks_fts where rowid = ?').run(id)
      if (this.dim) this.db.prepare('delete from chunks_vec where rowid = ?').run(BigInt(id))
    }
    this.db.prepare('delete from chunks where file = ?').run(file)
    this.db.prepare('delete from files where file = ?').run(file)
  }

  /** Indexes one file. Does nothing when the text hasn't changed. Returns true when it was (re)indexed. */
  async upsert(f: IndexedFile): Promise<boolean> {
    const hash = sha(f.text)
    const old = this.db.prepare('select hash from files where file = ?').get(f.file) as { hash: string } | undefined
    if (old?.hash === hash) return false
    const chunks = chunkText(f.text)
    const vectors: number[][] = []
    for (let i = 0; i < chunks.length; i += 16) vectors.push(...(await this.embed(chunks.slice(i, i + 16), 'document')))
    if (vectors.length) this.ensureDim(vectors[0]!.length)
    this.db.exec('begin')
    try {
      this.deleteFileRows(f.file)
      const ins = this.db.prepare('insert into chunks(file, idx, book, kind, ref, text) values (?, ?, ?, ?, ?, ?)')
      chunks.forEach((text, idx) => {
        const r = ins.run(f.file, idx, f.book, f.kind, f.ref, text)
        const id = BigInt(r.lastInsertRowid)
        this.db.prepare('insert into chunks_fts(rowid, text) values (?, ?)').run(id, text)
        this.db.prepare('insert into chunks_vec(rowid, embedding) values (?, ?)').run(id, new Uint8Array(new Float32Array(vectors[idx]!).buffer))
      })
      this.db.prepare('insert or replace into files(file, hash) values (?, ?)').run(f.file, hash)
      this.db.exec('commit')
    } catch (err) {
      this.db.exec('rollback')
      throw err
    }
    return true
  }

  remove(file: string): void {
    this.deleteFileRows(file)
  }

  files(): string[] {
    return (this.db.prepare('select file from files order by file').all() as { file: string }[]).map((r) => r.file)
  }

  stats(): { files: number; chunks: number; dim: number } {
    return {
      files: (this.db.prepare('select count(*) as n from files').get() as { n: number }).n,
      chunks: (this.db.prepare('select count(*) as n from chunks').get() as { n: number }).n,
      dim: this.dim
    }
  }

  /** Hybrid search: BM25 and nearest-neighbour rankings merged with reciprocal rank fusion. */
  async search(query: string, opts: { book?: string; /** Any of these books (`''` is the shared library, such as the shared research notes). */ books?: string[]; notBook?: string; kinds?: string[]; k?: number } = {}): Promise<Hit[]> {
    const k = opts.k ?? 8
    if (!this.dim || !query.trim()) return []
    const pool = Math.max(30, k * 5)
    const keep = (row: { book: string; kind: string }) =>
      (!opts.book || row.book === opts.book) && (!opts.books || opts.books.includes(row.book)) && (!opts.notBook || row.book !== opts.notBook) && (!opts.kinds || opts.kinds.includes(row.kind))

    const byId = new Map<number, Hit>()
    const load = (id: number): Hit | undefined => {
      const cached = byId.get(id)
      if (cached) return cached
      const r = this.db.prepare('select id, file, idx, book, kind, ref, text from chunks where id = ?').get(id) as
        | { id: number; file: string; idx: number; book: string; kind: string; ref: string; text: string }
        | undefined
      if (!r) return undefined
      const hit: Hit = { file: r.file, idx: r.idx, book: r.book, kind: r.kind, ref: r.ref, text: r.text, score: 0 }
      byId.set(id, hit)
      return hit
    }

    const lexical: number[] = []
    const fq = ftsQuery(query)
    if (fq) {
      const rows = this.db.prepare('select rowid as id from chunks_fts where chunks_fts match ? order by bm25(chunks_fts), rowid limit ?').all(fq, pool * 3) as { id: number }[]
      for (const { id } of rows) {
        const h = load(id)
        if (h && keep(h)) lexical.push(id)
        if (lexical.length >= pool) break
      }
    }
    const semantic: number[] = []
    const [qv] = await this.embed([query], 'query')
    if (qv && qv.length === this.dim) {
      const rows = this.db
        .prepare('select rowid as id, distance from chunks_vec where embedding match ? and k = ? order by distance')
        .all(new Uint8Array(new Float32Array(qv).buffer), pool * 3) as { id: number | bigint; distance: number }[]
      for (const r of rows) {
        const id = Number(r.id)
        const h = load(id)
        if (h && keep(h)) semantic.push(id)
        if (semantic.length >= pool) break
      }
    }
    const score = new Map<number, number>()
    for (const list of [lexical, semantic]) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank + 1)))
    const hits = [...score.entries()].map(([id, s]) => ({ ...load(id)!, score: Number(s.toFixed(8)) }))
    hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.idx - b.idx)
    return hits.slice(0, k)
  }

  /** Nearest existing text of other books, as cosine similarity (vectors are unit length). */
  async nearest(text: string, opts: { notBook: string; kinds: string[] }): Promise<{ book: string; file: string; similarity: number } | null> {
    if (!this.dim) return null
    const [qv] = await this.embed([text], 'query')
    if (!qv || qv.length !== this.dim) return null
    const rows = this.db
      .prepare('select rowid as id, distance from chunks_vec where embedding match ? and k = ? order by distance')
      .all(new Uint8Array(new Float32Array(qv).buffer), 200) as { id: number | bigint; distance: number }[]
    for (const r of rows) {
      const row = this.db.prepare('select file, book, kind from chunks where id = ?').get(Number(r.id)) as { file: string; book: string; kind: string } | undefined
      if (!row || row.book === opts.notBook || !opts.kinds.includes(row.kind)) continue
      return { book: row.book, file: row.file, similarity: Number((1 - (r.distance * r.distance) / 2).toFixed(4)) }
    }
    return null
  }
}

/** Everything in the library that belongs in the index, read from the markdown files. */
export async function collectIndexable(dataDir: string): Promise<IndexedFile[]> {
  const out: IndexedFile[] = []
  const booksDir = path.join(dataDir, 'books')
  let slugs: string[]
  try {
    slugs = (await fs.readdir(booksDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return out
  }
  const add = async (rel: string, book: string, kind: string, ref: string, bodyOnly = true) => {
    try {
      const raw = await fs.readFile(path.join(dataDir, ...rel.split('/')), 'utf8')
      const text = bodyOnly ? parseMd(raw).body.trim() : raw
      if (text) out.push({ file: rel, book, kind, ref, text })
    } catch {
      /* missing */
    }
  }
  const listDir = async (dir: string) => {
    try {
      return (await fs.readdir(path.join(dataDir, ...dir.split('/')), { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort()
    } catch {
      return []
    }
  }
  for (const slug of slugs) {
    const base = `books/${slug}`
    await add(`${base}/pitch.md`, slug, 'pitch', 'pitch')
    for (const n of await listDir(`${base}/chapters`)) await add(`${base}/chapters/${n}`, slug, 'chapter', n.replace(/\.md$/, ''))
    for (const n of await listDir(`${base}/summaries`)) await add(`${base}/summaries/${n}`, slug, 'summary', n.replace(/\.md$/, ''))
    for (const n of await listDir(`${base}/research`)) await add(`${base}/research/${n}`, slug, 'research', n.replace(/\.md$/, ''))
    for (const sub of ['characters', 'places']) for (const n of await listDir(`${base}/bible/${sub}`)) await add(`${base}/bible/${sub}/${n}`, slug, 'bible', `${sub}/${n.replace(/\.md$/, '')}`)
    try {
      const doc = parseMd(await fs.readFile(path.join(dataDir, 'books', slug, 'book.md'), 'utf8'))
      if (typeof doc.data.blurb === 'string' && doc.data.blurb.trim()) out.push({ file: `${base}/book.md#blurb`, book: slug, kind: 'blurb', ref: 'blurb', text: doc.data.blurb.trim() })
    } catch {
      /* no book.md */
    }
  }
  for (const n of await listDir('research')) await add(`research/${n}`, '', 'research', n.replace(/\.md$/, ''))
  return out
}

/** Rebuilds the index from the markdown files: new and changed files are embedded again, removed files are dropped. */
export async function reindex(dataDir: string, index: MemoryIndex): Promise<{ indexed: number; unchanged: number; removed: number }> {
  const files = await collectIndexable(dataDir)
  const present = new Set(files.map((f) => f.file))
  let indexed = 0
  let unchanged = 0
  for (const f of files) {
    if (await index.upsert(f)) indexed++
    else unchanged++
  }
  let removed = 0
  for (const known of index.files()) {
    if (!present.has(known)) {
      index.remove(known)
      removed++
    }
  }
  return { indexed, unchanged, removed }
}

export const indexExists = (dataDir: string) => existsSync(path.join(dataDir, 'index', 'library.sqlite'))

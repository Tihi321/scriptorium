import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { ideaSchema } from '../../shared/schemas'
import type { IdeaFrontmatter } from '../../shared/schemas'
import { writeMd } from './atomic'

export interface IdeaFile {
  slug: string
  file: string
  data: IdeaFrontmatter
  /** The pitch text. */
  body: string
  /** Title from the frontmatter, else the first heading or line of the text. */
  title: string
  /** Sort key: the `created` field, else the file's modification time. */
  createdMs: number
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'idea'

/**
 * The idea bucket: one markdown file per idea in ideas/. Your own files may be as plain as a text file:
 * without frontmatter the first line is the title and the whole text is the pitch.
 */
export class IdeaStore {
  constructor(private readonly dataDir: string) {}

  get dir(): string {
    return path.join(this.dataDir, 'ideas')
  }

  async list(): Promise<IdeaFile[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.md') && !f.includes('.tmp-'))
    } catch {
      return []
    }
    const out: IdeaFile[] = []
    for (const n of names) {
      const file = path.join(this.dir, n)
      try {
        const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
        const doc = parseMd(text, file)
        const parsed = ideaSchema.safeParse(doc.data)
        if (!parsed.success) continue
        const data = parsed.data
        const firstLine = doc.body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() ?? ''
        const created = data.created ? Date.parse(data.created) : NaN
        out.push({
          slug: n.slice(0, -3),
          file,
          data,
          body: doc.body.trim(),
          title: data.title?.trim() || firstLine || n.slice(0, -3),
          createdMs: Number.isFinite(created) ? created : stat.mtimeMs
        })
      } catch {
        /* unreadable idea: skipped */
      }
    }
    return out.sort((a, b) => a.createdMs - b.createdMs || a.slug.localeCompare(b.slug))
  }

  async open(): Promise<IdeaFile[]> {
    return (await this.list()).filter((i) => i.data.status === 'open')
  }

  async create(input: { title: string; pitch: string; topic?: string | null; format?: string | null; source: 'user' | 'generated' }): Promise<IdeaFile> {
    await fs.mkdir(this.dir, { recursive: true })
    const taken = new Set((await fs.readdir(this.dir)).map((f) => f.replace(/\.md$/, '')))
    const base = slugify(input.title)
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    const file = path.join(this.dir, `${slug}.md`)
    const data = {
      kind: 'idea',
      title: input.title,
      topic: input.topic ?? null,
      status: 'open',
      source: input.source,
      format: input.format ?? null,
      created: new Date().toISOString()
    }
    await writeMd(file, data, '\n' + input.pitch.trim() + '\n')
    return { slug, file, data: ideaSchema.parse(data), body: input.pitch.trim(), title: input.title, createdMs: Date.now() }
  }

  /** Marks an idea as used by a book. Keeps everything else in the file as it was. */
  async markUsed(idea: IdeaFile, book: string): Promise<void> {
    const text = await fs.readFile(idea.file, 'utf8')
    const doc = parseMd(text, idea.file)
    await writeMd(idea.file, { ...doc.data, kind: 'idea', status: 'used', book }, doc.body)
  }
}

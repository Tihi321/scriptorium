import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adaptTargetWords } from '../src/engine/pipeline/adapt'
import { BookStore } from '../src/engine/pipeline/books'
import { formatsForKind, variant } from '../src/engine/pipeline/handlers'
import { loadPrompt } from '../src/engine/pipeline/prompts'
import { readVnPack, vnPackFromFolder, writeVnPack } from '../src/engine/publish/vnPack'
import type { VnPack } from '../src/engine/publish/vnPack'
import { parseScript } from '../src/engine/publish/script'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { migratePictureBooks, PICTURE_BOOK_FORMAT_IDS } from '../src/engine/store/migrations'
import { formatEntrySchema, formatsSchema } from '../src/shared/schemas'
import { emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { makeEnv, makePipelineEnv, seedDir, waitFor } from './helpers'

const FIXTURE = path.resolve(__dirname, 'fixtures/vn-pack/picture-book')
const dirs: string[] = []
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-pb-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const seedFormats = async () => formatsSchema.parse(parseMd(await readFile(path.join(seedDir, 'config', 'formats.md'), 'utf8')).data).formats
const pages = (pack: VnPack) => pack.chapters.flatMap((c) => c.scenes)

describe('the picture_book flag and the kids-picture-book format', () => {
  it('parses picture_book, false unless the format says it', () => {
    const plain = formatEntrySchema.parse({ id: 'f', name: 'F', words: [100, 200] })
    expect(plain.picture_book).toBe(false)
    const pb = formatEntrySchema.parse({ id: 'kids-picture-book', name: 'Picture book for children', script: true, picture_book: true, words: [150, 900] })
    expect(pb).toMatchObject({ script: true, picture_book: true, chapters: [1, 1] })
  })

  it('is in the seed with the D9 flags and the page-wise guidance', async () => {
    const seed = await seedFormats()
    const pb = seed.find((f) => f.id === 'kids-picture-book')!
    expect(pb).toMatchObject({
      name: 'Picture book for children',
      enabled: true,
      script: true,
      picture_book: true,
      kinds: ['juvenile-visual-novel'],
      juvenile: true,
      age_band: '3-6',
      words: [150, 900],
      chapters: [1, 1],
      read_aloud: true,
      research: false
    })
    expect(pb.screenplay).toBe(false)
    expect(pb.puzzles).toBe(false)
    // the guidance asks for the page grammar: one scene per page, the picture in the SCENE line, ON SCREEN, 1-3 narration sentences, no dialogue or cues
    for (const phrase of ['12 to 16 pages', 'one scene per page', 'SCENE: line', 'ON SCREEN: line', 'narration sentences', 'speaker lines', 'CG:', 'INSERT:', 'SFX:', 'AMBIENCE:', '---', 'Separate the people with commas']) {
      expect(pb.guidance, phrase).toContain(phrase)
    }
    expect(seed.filter((f) => f.picture_book).map((f) => f.id)).toEqual(['kids-picture-book'])
  })

  it('is never picked at random, whatever the topic kind', async () => {
    const seed = await seedFormats()
    for (const kind of [null, 'juvenile-visual-novel', 'visual-novel', 'juvenile-fiction', 'video', 'article']) {
      expect(formatsForKind(seed, kind).some((f) => f.picture_book), String(kind)).toBe(false)
    }
    // the other visual stories for children are still picked for their kind
    expect(formatsForKind(seed, 'juvenile-visual-novel').map((f) => f.id)).toEqual(['kids-visual-story', 'kids-choice-visual-story'])
  })

  it('picks the _pb prompts for its tasks and _vn for a visual novel', async () => {
    const seed = await seedFormats()
    const pb = seed.find((f) => f.id === 'kids-picture-book')!
    expect(variant(pb, 'outline')).toBe('outline_pb')
    expect(variant(pb, 'draft_chapter')).toBe('draft_chapter_pb')
    expect(variant(pb, 'review')).toBe('review_pb')
    expect(variant(pb, 'humanize_chapter')).toBe('humanize_chapter_pb')
    expect(variant(seed.find((f) => f.id === 'visual-novel')!, 'draft_chapter')).toBe('draft_chapter_vn')
    expect(variant(seed.find((f) => f.id === 'short-film')!, 'draft_chapter')).toBe('draft_chapter_sp')
    expect(variant(seed.find((f) => f.id === 'novel')!, 'draft_chapter')).toBe('draft_chapter')
  })
})

describe('the _pb prompts', () => {
  it('are in the seed with the task of their role, and a role without one uses its plain prompt (never the _vn one)', async () => {
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    const expected: [string, string][] = [
      ['architect', 'outline'],
      ['writer', 'draft_chapter'],
      ['writer', 'rewrite_chapter'],
      ['line-editor', 'review'],
      ['humanizer', 'humanize_chapter']
    ]
    for (const [role, task] of expected) {
      const p = await loadPrompt(dir, role, `${task}_pb`)
      expect(p.raw, `${role}/${task}_pb`).toContain(`task: ${task}`)
      expect(p.raw, `${role}/${task}_pb`).toMatch(/picture book/i)
    }
    const plain = await loadPrompt(dir, 'continuity-checker', 'review_pb')
    expect(plain.raw).toBe((await loadPrompt(dir, 'continuity-checker', 'review')).raw)
    const publish = await loadPrompt(dir, 'publisher', 'publish_pb')
    expect(publish.raw).toBe((await loadPrompt(dir, 'publisher', 'publish')).raw)
  })

  it('gives the writer a real page-by-page picture-book brief, not the visual-novel cue grammar', async () => {
    const draft = parseMd(await readFile(path.join(seedDir, 'prompts', 'writer', 'draft_chapter_pb.md'), 'utf8')).body
    expect(draft).toMatch(/12 to 16 pages/)
    expect(draft).toMatch(/second sentence describes the picture/)
    expect(draft).toMatch(/ON SCREEN:/)
    expect(draft).toMatch(/Never write speaker lines/)
    expect(draft).toMatch(/Never write CG:, INSERT:, SFX:, AMBIENCE:/)
    expect(draft).toMatch(/Separate the people on an ON SCREEN: line with commas \(a semicolon is fine too\)/)
    expect(draft).not.toMatch(/^CG: /m)
    // the review judges the page form and the read-aloud rhythm
    const review = parseMd(await readFile(path.join(seedDir, 'prompts', 'line-editor', 'review_pb.md'), 'utf8')).body
    expect(review).toMatch(/read aloud/i)
    expect(review).toMatch(/one SCENE: line and exactly one ON SCREEN: line per page/i)
    expect(review).toMatch(/no speaker lines/i)
    // the outline plans one chapter and 12 to 16 pages
    const outline = parseMd(await readFile(path.join(seedDir, 'prompts', 'architect', 'outline_pb.md'), 'utf8')).body
    expect(outline).toMatch(/exactly one chapter/i)
    expect(outline).toMatch(/12 to 16/)
    expect(outline).toContain('"story_year"')
    // the humanizer keeps the pages and their one SCENE and ON SCREEN line
    const humanize = parseMd(await readFile(path.join(seedDir, 'prompts', 'humanizer', 'humanize_chapter_pb.md'), 'utf8')).body
    expect(humanize).toMatch(/page count stays the same/i)
    expect(humanize).toMatch(/one SCENE line and its one ON SCREEN line/i)
  })
})

describe('a picture book in the factory', () => {
  it('starts only from a story that fixes kids-picture-book, although the format is never picked at random', async () => {
    const e = await makePipelineEnv()
    try {
      await e.engine.addStory({ ...emptyBrief(), title: 'The Puddle', premise: 'A duck finds a puddle and a friend.', format: 'kids-picture-book' })
      // the book folder can be listed a moment before book.md is written: wait for the file, not just the slug
      const slug = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) {
          try {
            await readFile(path.join(e.dir, 'books', s, 'book.md'), 'utf8')
            return s
          } catch {
            /* still being written */
          }
        }
        return null
      }, 30000, 'the picture book to start')
      const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
      expect(book).toMatchObject({ format: 'kids-picture-book', script: true })
    } finally {
      await e.cleanup()
    }
  }, 60000)
})

describe('picture books are not a visual-novel adaptation target', () => {
  it('adaptTargetWords ignores a picture_book format, like a screenplay', () => {
    const vn = { words: [8000, 25000] as [number, number], script: true }
    expect(adaptTargetWords(5900, vn)).toBe(10030)
    expect(adaptTargetWords(5900, { ...vn, screenplay: true })).toBeNull()
    expect(adaptTargetWords(5900, { words: [150, 900], script: true, picture_book: true })).toBeNull()
  })

  it('adapt_book refuses a picture-book format, and a visual-novel adaptation still works', async () => {
    const e = await makeEnv({ paused: true })
    try {
      await e.engine.books.create('source', { title: 'The Moon Lamp', stage: 'published', format: 'short-story', genre: 'cosy fantasy', target_words: 3000 }, '')
      await expect(e.engine.adaptBook({ book: 'source', format: 'kids-picture-book' })).rejects.toThrow(
        /"kids-picture-book" is a picture-book format: adapt_book turns a published book into a visual novel script or a screenplay, not a picture book/
      )
      // the refusal comes before any story is made
      expect((await e.engine.ideas.list()).filter((i) => i.data.source_book === 'source')).toEqual([])
      // a normal visual-novel adaptation is unaffected
      const vn = await e.engine.adaptBook({ book: 'source', format: 'visual-novel' })
      expect(vn.data).toMatchObject({ format: 'visual-novel', source_book: 'source', status: 'open' })
    } finally {
      await e.cleanup()
    }
  })
})

describe('migratePictureBooks', () => {
  /** The seed's formats.md without the picture-book entry: a data folder from before SCP-46. */
  async function oldFolder(eol = '\n'): Promise<{ dir: string; before: string }> {
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    const file = path.join(dir, 'config', 'formats.md')
    const text = await readFile(file, 'utf8')
    const from = text.indexOf('  - id: kids-picture-book\n')
    const to = text.indexOf('  - id: nonfiction-short\n')
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    await writeFile(file, (text.slice(0, from) + text.slice(to)).replace(/\n/g, eol))
    return { dir, before: await readFile(file, 'utf8') }
  }

  it('appends the seed entry once, keeps the rest of the file and CRLF line endings', async () => {
    const { dir, before } = await oldFolder()
    expect(formatsSchema.parse(parseMd(before).data).formats.some((f) => f.picture_book)).toBe(false)
    const first = await migratePictureBooks(dir, seedDir)
    expect(first.changes).toEqual(['config/formats.md: added the picture-book format (kids-picture-book)'])
    const after = await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')
    const formats = formatsSchema.parse(parseMd(after).data).formats
    expect(formats.find((f) => f.id === 'kids-picture-book')).toMatchObject({ picture_book: true, script: true, enabled: true })
    // only the entry was added: the file before it and its body are the same
    expect(after.startsWith(before.slice(0, before.indexOf('\n---', 1)))).toBe(true)
    expect(after.endsWith(before.slice(before.indexOf('---\n# Formats')))).toBe(true)
    expect((await migratePictureBooks(dir, seedDir)).changes).toEqual([])
    expect(await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')).toBe(after)

    const crlf = await oldFolder('\r\n')
    expect((await migratePictureBooks(crlf.dir, seedDir)).changes).toHaveLength(1)
    const crlfAfter = await readFile(path.join(crlf.dir, 'config', 'formats.md'), 'utf8')
    expect(crlfAfter.replace(/\r\n/g, '')).not.toContain('\n')
    expect(formatsSchema.parse(parseMd(crlfAfter).data).formats.some((f) => f.picture_book)).toBe(true)
  })

  it('leaves a fresh folder, a folder without the file and a folder without a seed alone', async () => {
    const fresh = await tempDir()
    expect((await initDataFolder(fresh, seedDir)).migrated.filter((m) => m.includes('picture-book'))).toEqual([])
    const empty = await tempDir()
    expect((await migratePictureBooks(empty, seedDir)).changes).toEqual([])
    expect((await migratePictureBooks(fresh, undefined)).changes).toEqual([])
    expect(PICTURE_BOOK_FORMAT_IDS).toEqual(['kids-picture-book'])
  })
})

describe('the picture-book fixture (SCP-46)', () => {
  it('writes and reads a v2 pack with 12 to 16 pages and the captions only in the catalog', async () => {
    const dir = await tempDir()
    const books = new BookStore(dir)
    const slug = 'mira-and-the-puddle-duck'
    await cp(FIXTURE, books.file(slug), { recursive: true })
    const written = await writeVnPack(books, slug)
    expect(written.pack.book.format).toBe('kids-picture-book')
    expect(written.pack.version).toBe(2)
    const scenes = pages(written.pack)
    expect(scenes.length).toBeGreaterThanOrEqual(12)
    expect(scenes.length).toBeLessThanOrEqual(16)
    for (const scene of scenes) {
      expect(scene.breakBefore).toBe(false)
      expect(scene.beats[0]!.type).toBe('cast')
      expect(scene.beats.slice(1).every((b) => b.type === 'narration')).toBe(true)
      for (const beat of scene.beats) {
        const cues = beat as { image?: unknown; sfx?: unknown; ambience?: unknown }
        expect(cues.image).toBeUndefined()
        expect(cues.sfx).toBeUndefined()
        expect(cues.ambience).toBeUndefined()
      }
    }
    // the words under the pictures are in the catalog only
    const narration = scenes.flatMap((s) => s.beats.filter((b) => b.type === 'narration').map((b) => b.id))
    expect(Object.keys(written.text.beats).sort()).toEqual(narration.sort())
    expect(written.text.beats['ch01.s01.b002']).toBe('The rain has stopped. The puddle is as round as a plate.')
    expect((await books.read(slug))?.data.vn_version).toBe(2)

    const read = await readVnPack(books, slug)
    expect(read.stale).toBe(false)
    expect(read.problems).toEqual([])
    expect(read.warnings).toEqual([])
    expect(read.pack.book.format).toBe('kids-picture-book')
    expect(read.text.beats).toEqual(written.text.beats)

    // get_script parses the same chapter files: a page is a cast beat and narration, with no cue or speaker beat
    const chapters = await books.chapters(slug)
    const parsed = parseScript(chapters[0]!.body, ['Mira', 'Pip', 'Mama'])
    expect(parsed.scenes).toHaveLength(14)
    for (const page of parsed.scenes) {
      expect(page.beats.filter((b) => b.type === 'cue')).toEqual([])
      expect(page.beats.filter((b) => b.type === 'line')).toEqual([])
      expect(page.beats[0]!.type).toBe('cast')
    }
  })

  it('compiles the committed fixture to exactly its pack and catalog', async () => {
    const result = await vnPackFromFolder(FIXTURE)
    expect(result.warnings).toEqual([])
    expect(result.pack.book.format).toBe('kids-picture-book')
    expect(pages(result.pack)).toHaveLength(14)
  })
})

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { BookStore } from '../src/engine/pipeline/books'
import { buildEpub } from '../src/engine/publish/epub'
import type { EpubBook } from '../src/engine/publish/epub'
import { buildSections, fnv1a32 } from '../src/engine/publish/sections'

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

/** A data folder with the 4-chapter choice fixture as a book. */
async function choiceBook(): Promise<{ books: BookStore; slug: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scp49-'))
  tempDirs.push(dir)
  const books = new BookStore(dir)
  const slug = 'the-lighthouse-letters'
  await fs.cp(path.resolve(__dirname, 'fixtures/vn-pack/choice'), books.file(slug), { recursive: true })
  return { books, slug }
}

async function unzip(file: string): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(await fs.readFile(file))
  const out: Record<string, string> = {}
  for (const name of Object.keys(zip.files)) if (!zip.files[name]!.dir) out[name] = await zip.files[name]!.async('string')
  return out
}

describe('shared section numbering', () => {
  it('gives the golden vector shared with VN Studio', () => {
    expect(fnv1a32('golden')).toBe(386248004)
    expect(buildSections(8, 'golden')).toEqual([1, 4, 2, 8, 5, 3, 7, 6])
    expect(buildSections(5, 'clockless-god')).toEqual([1, 4, 3, 2, 5])
  })
})

describe('gamebook EPUB', () => {
  it('writes numbered sections whose links all resolve, starting at section 1, without chapter titles in the nav', async () => {
    const { books, slug } = await choiceBook()
    const out = await books.buildEpubFile(slug, { gamebook: true })
    expect(out.endsWith(`${slug}-gamebook.epub`)).toBe(true)
    const files = await unzip(out)
    const sections = Object.keys(files).filter((n) => /section-\d{3}\.xhtml$/.test(n))
    expect(sections.sort()).toEqual(['OEBPS/section-001.xhtml', 'OEBPS/section-002.xhtml', 'OEBPS/section-003.xhtml', 'OEBPS/section-004.xhtml'])
    expect(files['OEBPS/nav.xhtml']).toContain('href="section-001.xhtml#s1"')
    expect(files['OEBPS/nav.xhtml']).not.toContain('The Late Boat')
    expect(files['OEBPS/section-001.xhtml']).toContain('Rain needles the grey water')
    expect(Object.keys(files).filter((n) => n.includes('images/'))).toEqual([]) // no ornament, and this fixture has no cover
    let jumps = 0
    for (const [name, text] of Object.entries(files).filter(([n]) => n.endsWith('.xhtml'))) {
      for (const m of text.matchAll(/href="([^"#]+)(?:#([^"]+))?"/g)) {
        const target = files[`OEBPS/${m[1]}`]
        expect(target, `${name} -> ${m[1]}`).toBeDefined()
        if (m[2]) expect(target).toContain(`id="${m[2]}"`)
      }
      for (const m of text.matchAll(/turn to <a href="section-(\d{3})\.xhtml#s(\d+)">section (\d+)<\/a>/gi)) {
        jumps++
        expect([Number(m[1]), Number(m[2])]).toEqual([Number(m[3]), Number(m[3])])
        expect(files[`OEBPS/section-${m[1]}.xhtml`]).toBeDefined()
      }
    }
    expect(jumps).toBe(5) // 2 + 1 choices, 2 endings back to section 1
    expect(Object.values(files).join('')).toContain('The End.')
  })

  it('reuses the stored numbers, calls a changed chapter set stale, and renumbers on request', async () => {
    const { books, slug } = await choiceBook()
    await books.buildEpubFile(slug, { gamebook: true })
    const file = books.file(slug, 'gamebook.json')
    const stored = JSON.parse(await fs.readFile(file, 'utf8')) as { seed: string; sections: Record<string, number> }
    expect(stored.seed).toBe(slug)
    expect(Object.values(stored.sections)).toEqual(buildSections(4, slug))
    // a hand-edited map is kept: a re-export (and the PDF) must give the same numbers
    await fs.writeFile(file, JSON.stringify({ ...stored, sections: { '1': 1, '2': 3, '3': 2, '4': 4 } }))
    const files = await unzip(await books.buildEpubFile(slug, { gamebook: true }))
    expect(files['OEBPS/section-003.xhtml']).toContain('Morning comes')
    // another chapter set: stale, until renumber
    await fs.writeFile(file, JSON.stringify({ ...stored, sections: { '1': 1, '2': 2, '3': 3 } }))
    await expect(books.buildEpubFile(slug, { gamebook: true })).rejects.toThrow(/other chapters/)
    await books.buildEpubFile(slug, { gamebook: { renumber: true } })
    const again = JSON.parse(await fs.readFile(file, 'utf8')) as { sections: Record<string, number> }
    expect(Object.keys(again.sections)).toEqual(['1', '2', '3', '4'])
  })

  it('says the Croatian jump text for hr', async () => {
    const { books, slug } = await choiceBook()
    const files = await unzip(await books.buildEpubFile(slug, { gamebook: { lang: 'hr' } }))
    const all = Object.values(files).join('')
    expect(all).toMatch(/Wait at the harbour wall, idi na <a href="section-\d{3}\.xhtml#s\d+">odlomak \d+<\/a>\./)
    expect(all).toContain('Idi na <a href="section-001.xhtml#s1">odlomak 1</a> za novi početak.')
  })
})

describe('default EPUB mode', () => {
  it('is unchanged for the same input (hash of the unzipped entries, taken before SCP-49)', async () => {
    const book: EpubBook = {
      title: 'The Lighthouse Letters',
      author: 'Mara Quill',
      uuid: '11111111-2222-3333-4444-555555555555',
      subject: 'Mystery',
      description: "A keeper's daughter waits.",
      year: 2026,
      modified: new Date('2026-01-02T03:04:05Z'),
      genreClass: 'g-mystery',
      chapters: [
        { title: 'The Late Boat', body: 'Mara waits on the harbour wall.\n\nThe tide turns.', choices: [{ text: 'Wait at the harbour wall', to: 2 }, { text: 'Row out to find him', to: 3 }] },
        { title: 'The Empty Harbour', body: 'Morning comes.', ending: 'bittersweet' },
        { title: 'The Letter in the Lamp', body: 'A letter in the lamp room.', choices: [{ text: 'Take the letter to the keeper', to: 4 }] },
        { title: 'The Lighthouse Answers', body: 'The keeper lights the lamp.', ending: 'hopeful' }
      ]
    }
    // zip entry dates are the time of the build, so the archive bytes differ between runs: compare names and contents
    const zip = await JSZip.loadAsync(await buildEpub(book))
    const h = createHash('sha256')
    for (const name of Object.keys(zip.files).sort()) h.update(name + '\0').update(await zip.files[name]!.async('uint8array')).update('\0')
    expect(h.digest('hex')).toBe('56bff2b4d489620d9a4626cfb1825eeb2b5441d9ee0479f81672c9d950dc78ae')
  })
})

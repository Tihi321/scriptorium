import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookStore } from '../src/engine/pipeline/books'
import { buildGamebookPdf } from '../src/engine/publish/pdf'

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

/** pdfkit has no parser: the PDF is read as raw bytes (latin1). Objects, annotations and the name tree are plain text. */
const raw = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
const linkTargets = (pdf: string) => [...pdf.matchAll(/\/S \/GoTo\s*\/D \((s\d+)\)/g)].map((m) => m[1]!)
const destinations = (pdf: string) => new Map([...pdf.matchAll(/\((s\d+)\) \[(\d+) 0 R \/XYZ/g)].map((m) => [m[1]!, m[2]!]))

describe('gamebook PDF', () => {
  it('starts every section on its own page, links every choice and restart to an existing section, and keeps Croatian letters', async () => {
    const hr = 'Čovjek šapće: žaba, đak, ćevap, ŠĐŽČĆ.'
    const long = Array.from({ length: 40 }, (_, i) => `${hr} ${i}`).join('\n\n') // takes several pages
    const bytes = await buildGamebookPdf({
      title: 'Test',
      author: 'A. Writer',
      lang: 'hr',
      compress: false,
      sections: [
        { no: 1, body: long, choices: [{ text: 'Ako otvoriš vrata', to: 3 }, { text: 'Ako odeš', to: 2 }] },
        { no: 3, body: 'Dalje.', ending: 'kraj' },
        { no: 2, body: 'Kraj.', ending: 'kraj' }
      ]
    })
    const pdf = raw(bytes)
    expect(pdf.startsWith('%PDF-')).toBe(true)
    const pages = (pdf.match(/\/Type \/Page\b/g) ?? []).length
    expect(pages).toBeGreaterThan(3) // section 1 alone runs over several pages
    const dests = destinations(pdf)
    expect([...dests.keys()].sort()).toEqual(['s1', 's2', 's3'])
    expect(new Set(dests.values()).size).toBe(3) // three different pages: one section per page start
    expect((pdf.match(/\/Subtype \/Link/g) ?? []).length).toBe(2 + 2) // 2 choices + a restart link on each of the 2 endings
    expect(linkTargets(pdf).sort()).toEqual(['s1', 's1', 's2', 's3'])
    for (const target of linkTargets(pdf)) expect(dests.has(target)).toBe(true)
    expect(pdf).toContain('/Lang (hr)')
    expect(pdf).toContain('/FontFile2')
    // the ToUnicode map of the embedded font carries every Croatian letter used
    const cmap = pdf.slice(pdf.indexOf('beginbfrange'), pdf.indexOf('endbfrange'))
    for (const ch of 'ČĆĐŠŽčćđšž') expect(cmap, ch).toContain(`<${ch.codePointAt(0)!.toString(16).padStart(4, '0')}>`)
  })

  it('writes out/<slug>-gamebook.pdf from the same stored numbers as the gamebook EPUB', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scp50-'))
    tempDirs.push(dir)
    const books = new BookStore(dir)
    const slug = 'the-lighthouse-letters'
    await fs.cp(path.resolve(__dirname, 'fixtures/vn-pack/choice'), books.file(slug), { recursive: true })
    await books.buildEpubFile(slug, { gamebook: true }) // makes gamebook.json
    const stored = JSON.parse(await fs.readFile(books.file(slug, 'gamebook.json'), 'utf8')) as { sections: Record<string, number> }
    const out = await books.buildGamebookPdf(slug)
    expect(out?.endsWith(`${slug}-gamebook.pdf`)).toBe(true)
    const pdf = raw(await fs.readFile(out!))
    expect([...destinations(pdf).keys()].sort()).toEqual(Object.values(stored.sections).map((n) => `s${n}`).sort())
    expect((pdf.match(/\/Subtype \/Link/g) ?? []).length).toBe(5) // 3 choices + 2 endings, as in the EPUB test
  })
})

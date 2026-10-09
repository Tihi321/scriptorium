import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { coverAuthorSize, coverPatternSvg, coverTitleSize, ORNAMENT_GENRES, ornamentSvg, PATTERN_KINDS, patternKind } from '../src/engine/publish/art'
import { fillCover } from '../src/engine/publish/cover'
import { buildEpub } from '../src/engine/publish/epub'
import { writeReaderDir } from '../src/engine/publish/reader'

function assertBalanced(xml: string, name: string): void {
  const stack: string[] = []
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (m[1]) expect(stack.pop(), `${name}: closing </${m[2]}>`).toBe(m[2])
    else stack.push(m[2]!)
  }
  expect(stack, `${name}: unclosed tags`).toEqual([])
}

const book = (genreClass: string) => ({
  title: 'The Lantern Keeper',
  author: 'Mara Quill',
  uuid: '11111111-2222-3333-4444-555555555555',
  subject: 'Fantasy',
  description: 'A short test book about a lantern.',
  year: 2026,
  modified: new Date('2026-01-01T00:00:00Z'),
  genreClass,
  chapters: [
    { title: 'One', body: 'Hello there.' },
    { title: 'Two', body: 'More words here.' }
  ]
})

describe('cover pattern', () => {
  it('is the same for the same title and differs between titles', () => {
    expect(coverPatternSvg('The Sleepy Fox')).toBe(coverPatternSvg('The Sleepy Fox'))
    expect(coverPatternSvg('  the sleepy fox ')).toBe(coverPatternSvg('The Sleepy Fox'))
    const titles = ['The Sleepy Fox', 'Orbit', 'Seven Letters to the Sea', 'Stars Over Harbour Street', 'The Dot Collector', 'A Guide to Bread']
    expect(new Set(titles.map((t) => coverPatternSvg(t))).size).toBe(titles.length)
    // all four kinds are reachable from titles
    const kinds = new Set(Array.from({ length: 60 }, (_v, i) => patternKind(`Title ${i}`)))
    expect(kinds.size).toBe(PATTERN_KINDS.length)
  })

  it.each(PATTERN_KINDS)('draws a valid SVG for kind %s', (kind) => {
    const svg = coverPatternSvg('Some Title', 1600, 2560, kind)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('viewBox="0 0 1600 2560"')
    expect(svg.endsWith('</svg>')).toBe(true)
    assertBalanced(svg, kind)
    expect(svg).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('fills the template with the pattern and sizes that keep the title off the author', () => {
    const html = fillCover('<body>{{pattern_svg}}<h1 style="font-size:{{title_size}}px">{{title}}</h1><p style="font-size:{{author_size}}px">{{author}}</p></body>', {
      title: 'A & B',
      author: 'Me',
      genre: 'Fantasy',
      year: 2026,
      genreClass: 'g-fantasy'
    })
    expect(html).toContain('<svg class="pattern"')
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('{{')
    expect(coverTitleSize('x'.repeat(80))).toBeLessThan(coverTitleSize('Orbit'))
    expect(coverAuthorSize('A very long author name indeed, Jr.')).toBeLessThan(coverAuthorSize('Mara Quill'))
  })
})

describe('chapter ornaments', () => {
  it.each(ORNAMENT_GENRES)('%s is a valid standalone SVG', (g) => {
    const svg = ornamentSvg(g)
    expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 240 48"/)
    assertBalanced(svg, g)
    expect(svg).not.toMatch(/NaN|undefined/)
  })
  it('differs per genre and falls back for an unknown one', () => {
    expect(new Set(ORNAMENT_GENRES.map((g) => ornamentSvg(g))).size).toBe(ORNAMENT_GENRES.length)
    expect(ornamentSvg('g-unknown')).toBe(ornamentSvg('g-literary'))
  })
  it('covers every genre class the cover code can pick', () => {
    expect(ORNAMENT_GENRES.sort()).toEqual(
      ['g-adventure', 'g-bedtime', 'g-children', 'g-fantasy', 'g-historical', 'g-horror', 'g-humor', 'g-literary', 'g-mystery', 'g-nonfiction', 'g-romance', 'g-scifi'].sort()
    )
  })
})

describe('EPUB and reader with ornaments', () => {
  it('the EPUB has the ornament file, an image/svg+xml manifest item, and every chapter shows it', async () => {
    const zip = await JSZip.loadAsync(await buildEpub(book('g-fantasy')))
    expect(await zip.file('OEBPS/images/ornament.svg')!.async('string')).toBe(ornamentSvg('g-fantasy'))
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<item id="ornament" href="images/ornament.svg" media-type="image/svg+xml"/>')
    const items = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)" media-type="([^"]+)"/g)]
    expect(items.length).toBeGreaterThan(4)
    for (const [, id, href, type] of items) {
      expect(zip.file(`OEBPS/${href}`), `${id} ${href}`).toBeTruthy()
      expect(type).toMatch(/^(application\/xhtml\+xml|text\/css|image\/svg\+xml|image\/png)$/)
    }
    expect(new Set(items.map((i) => i[1])).size).toBe(items.length)
    for (const f of ['OEBPS/chapter-01.xhtml', 'OEBPS/chapter-02.xhtml']) {
      const x = await zip.file(f)!.async('string')
      expect(x).toContain('<img src="images/ornament.svg" alt=""/>')
      assertBalanced(x, f)
      expect(x.indexOf('class="ornament"')).toBeLessThan(x.indexOf('<h2>'))
    }
    expect(await zip.file('OEBPS/style.css')!.async('string')).toContain('.ornament')
    // the file is declared once, in the manifest, and not duplicated inline
    expect(opf.match(/ornament\.svg/g)).toHaveLength(1)
  })

  it('the EPUB uses a different ornament for a different genre', async () => {
    const a = await (await JSZip.loadAsync(await buildEpub(book('g-fantasy')))).file('OEBPS/images/ornament.svg')!.async('string')
    const b = await (await JSZip.loadAsync(await buildEpub(book('g-scifi')))).file('OEBPS/images/ornament.svg')!.async('string')
    expect(a).not.toBe(b)
  })

  it('the reader folder has the ornament file and shows it in every chapter', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'scrip-art-'))
    try {
      await writeReaderDir(path.join(dir, 'reader'), book('g-mystery'))
      expect(await readFile(path.join(dir, 'reader', 'images', 'ornament.svg'), 'utf8')).toBe(ornamentSvg('g-mystery'))
      for (const f of ['chapter-01.xhtml', 'chapter-02.xhtml']) {
        const x = await readFile(path.join(dir, 'reader', f), 'utf8')
        expect(x).toContain('<img src="images/ornament.svg" alt=""/>')
      }
      expect(await readFile(path.join(dir, 'reader', 'style.css'), 'utf8')).toContain('.ornament')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

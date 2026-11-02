import { existsSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { gamebookPhrases } from './sections'

/**
 * The gamebook as a PDF (SCP-50, text only): the same numbered sections as the gamebook EPUB (SCP-49), written in number order.
 * Each section starts a new A5 page with its number in large type; the chapter text follows (it may take more pages); then each choice as
 * `{choice text}{sep}turn to section N.` where "section N" is a link to that section, or "The End." and a link back to section 1.
 * The footer carries "section N" / "odlomak N" (never the word "page"), as in VN Studio's export. The only bookmark is "Start: section 1" (no spoilers).
 * pdfkit (^0.20) and the font Lora (SIL OFL, resources/fonts/) were chosen by the VNO-54 spike (HUB-25).
 */

export interface GamebookPdfSection {
  /** The section number printed on the page. */
  no: number
  /** Chapter text: markdown-ish paragraphs separated by blank lines. No title. */
  body: string
  /** `to` is a section number. */
  choices?: { text: string; to: number }[]
  /** Set (any text) on an ending. */
  ending?: string
}

export interface GamebookPdfBook {
  title: string
  author?: string
  lang: string
  sections: GamebookPdfSection[]
  /** Folder with Lora-Regular.ttf and Lora-Bold.ttf. Default: found by `fontDir()`. */
  fontDir?: string
  /** pdfkit compresses streams by default; tests turn it off to read the bytes. */
  compress?: boolean
}

/**
 * The folder with the bundled fonts: `resources/fonts` of the repo (dev and tests) or of the app (packaged: `files` in electron-builder.config.cjs puts it
 * next to `out/`, and the engine bundle is `out/engine/index.js`). Found by walking up from this file; SCRIPTORIUM_FONTS overrides.
 */
export function fontDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SCRIPTORIUM_FONTS) return path.resolve(env.SCRIPTORIUM_FONTS)
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'resources', 'fonts')
    if (existsSync(path.join(candidate, 'Lora-Regular.ttf'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('the PDF font (resources/fonts/Lora-Regular.ttf) was not found; set SCRIPTORIUM_FONTS to its folder')
}

/** Plain text of a chapter: paragraphs, no markdown marks. A scene break (`***`, `---`) becomes a centred "* * *". */
function paragraphs(body: string): { text: string; rule: boolean }[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^([*_-]\s*){3,}$/.test(p)) return { text: '* * *', rule: true }
      const text = p
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2')
        .replace(/\s*\n\s*/g, ' ')
      return { text, rule: false }
    })
}

const A5: [number, number] = [419.53, 595.28]
const MARGIN = { top: 48, bottom: 56, left: 42, right: 42 }

export async function buildGamebookPdf(book: GamebookPdfBook): Promise<Uint8Array> {
  const dir = book.fontDir ?? fontDir()
  const regular = path.join(dir, 'Lora-Regular.ttf')
  const bold = path.join(dir, 'Lora-Bold.ttf')
  const p = gamebookPhrases(book.lang)
  const sections = [...book.sections].sort((a, b) => a.no - b.no)

  const doc = new PDFDocument({
    size: A5,
    margins: MARGIN,
    bufferPages: true,
    compress: book.compress !== false,
    lang: book.lang,
    displayTitle: true,
    font: regular,
    info: { Title: book.title, ...(book.author ? { Author: book.author } : {}), Creator: 'Scriptorium', Producer: 'Scriptorium (pdfkit)' }
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })

  const width = A5[0] - MARGIN.left - MARGIN.right
  /** The section number of each page (first page is index 0), for the footer. */
  const pageSection: number[] = []
  doc.on('pageAdded', () => pageSection.push(current))
  let current = sections[0]?.no ?? 0

  /** "turn to section N." with "section N" a link; the text before and after stays plain (the link must not leak onto the next fragment). */
  const jump = (lead: string, phrase: string, no: number, opts: PDFKit.Mixins.TextOptions) => {
    const word = `${p.section.toLowerCase()} ${no}`
    const at = phrase.indexOf(word)
    doc.font(regular).fontSize(11.5)
    if (opts.align === 'center') {
      // pdfkit misplaces centred `continued` fragments (they overprint): centre a one-line jump by hand, else set it left
      const { align: _align, ...rest } = opts
      const line = doc.widthOfString(lead + phrase)
      if (line < width) doc.x = MARGIN.left + (width - line) / 2
      opts = { ...rest, width: Math.min(width, line + 1) }
    }
    if (at < 0) {
      doc.text(lead + phrase, opts)
      return
    }
    doc.text(lead + phrase.slice(0, at), { ...opts, continued: true })
    doc.text(word, { ...opts, continued: true, goTo: `s${no}`, underline: true })
    doc.text(phrase.slice(at + word.length), { ...opts, continued: false, goTo: null as unknown as string, underline: false })
    doc.x = MARGIN.left
  }

  sections.forEach((s, i) => {
    current = s.no
    if (i === 0) {
      // pdfkit starts with page 1 already: it is the first section's page
      pageSection.push(current)
    } else doc.addPage()
    doc.addNamedDestination(`s${s.no}`)
    if (i === 0 && s.no === 1) doc.outline.addItem(p.start(1))
    doc.font(bold).fontSize(46).fillColor('#000').text(String(s.no), { width, align: 'center' })
    doc.moveDown(0.6)
    doc.font(regular).fontSize(11.5)
    for (const para of paragraphs(s.body)) {
      doc.text(para.text, { width, align: para.rule ? 'center' : 'left', lineGap: 2, paragraphGap: 7 })
    }
    doc.moveDown(0.6)
    if (s.choices?.length) {
      for (const ch of s.choices) jump(`${paragraphs(ch.text)[0]?.text ?? ch.text}${p.sep}`, p.turn(ch.to), ch.to, { width, lineGap: 2, paragraphGap: 8 })
    } else if (s.ending) {
      doc.font(bold).fontSize(14).text(p.theEnd, { width, align: 'center', paragraphGap: 8 })
      jump('', p.startAgain(1), 1, { width, align: 'center', lineGap: 2 })
    }
  })

  // footers, on every page, without letting pdfkit add a page for text under the bottom margin
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.font(regular).fontSize(9).fillColor('#555').text(pageSection[i] ? `${p.section.toLowerCase()} ${pageSection[i]}` : '', MARGIN.left, A5[1] - 34, { width, align: 'center', lineBreak: false })
    doc.page.margins.bottom = bottom
  }
  doc.flushPages()
  doc.end()
  await done
  return new Uint8Array(Buffer.concat(chunks))
}

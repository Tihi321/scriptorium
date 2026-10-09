import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ornamentHtml, ornamentSvg } from './art'
import { BOOK_CSS } from './epub'
import { escapeXml, markdownToXhtml, xhtmlPage } from './xhtml'

export interface ReaderBook {
  title: string
  author: string
  blurb?: string
  year: number
  chapters: { title: string; body: string }[]
  /** Genre class (`g-fantasy` ...) that picks the chapter ornament. */
  genreClass?: string
  /** Path of cover.png, when it exists. */
  coverPngPath?: string
}

/**
 * Writes the book unzipped to `dir` for the in-app reader: the same XHTML chapters as the EPUB, the CSS,
 * a cover page, a title page and an `index.html` with the table of contents.
 */
export async function writeReaderDir(dir: string, book: ReaderBook): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(path.join(dir, 'images'), { recursive: true })
  const write = (name: string, text: string) => fs.writeFile(path.join(dir, name), text, 'utf8')
  await write('style.css', BOOK_CSS + '\nnav.toc ol { list-style: none; padding: 0; }\nnav.toc li { margin: 0.4em 0; }\n')
  await fs.writeFile(path.join(dir, 'images', 'ornament.svg'), ornamentSvg(book.genreClass ?? ''), 'utf8')
  let cover = `<div class="titlepage"><h1>${escapeXml(book.title)}</h1><p class="author">${escapeXml(book.author)}</p></div>`
  if (book.coverPngPath) {
    try {
      await fs.copyFile(book.coverPngPath, path.join(dir, 'images', 'cover.png'))
      cover = `<div class="cover"><img src="images/cover.png" alt="Cover of ${escapeXml(book.title)}"/></div>`
    } catch {
      /* keep the text cover */
    }
  }
  await write('cover.xhtml', xhtmlPage(book.title, cover))
  await write(
    'title.xhtml',
    xhtmlPage(
      book.title,
      `<div class="titlepage"><h1>${escapeXml(book.title)}</h1><p class="author">${escapeXml(book.author)}</p>${book.blurb ? `<p>${escapeXml(book.blurb)}</p>` : ''}<p class="ai">Written by an AI writer (${escapeXml(book.author)}) and edited by AI reviewers, made with Scriptorium. ${book.year}.</p></div>`
    )
  )
  const single = book.chapters.length === 1
  const links: string[] = []
  for (const [i, c] of book.chapters.entries()) {
    const file = `chapter-${String(i + 1).padStart(2, '0')}.xhtml`
    const next = i + 1 < book.chapters.length ? `<p class="next"><a href="chapter-${String(i + 2).padStart(2, '0')}.xhtml">Next chapter</a></p>` : ''
    await write(file, xhtmlPage(c.title, `${ornamentHtml()}
<h2>${escapeXml(single ? book.title : c.title)}</h2>\n${markdownToXhtml(c.body)}\n${next}<p><a href="index.html">Contents</a></p>`))
    links.push(`<li><a href="${file}">${escapeXml(single ? book.title : c.title)}</a></li>`)
  }
  await write(
    'index.html',
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${escapeXml(book.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>
<div class="titlepage"><h1>${escapeXml(book.title)}</h1><p class="author">${escapeXml(book.author)}</p></div>
<nav class="toc"><h2>Contents</h2>
<ol>
<li><a href="cover.xhtml">Cover</a></li>
<li><a href="title.xhtml">Title page</a></li>
${links.join('\n')}
</ol></nav>
</body></html>
`
  )
}

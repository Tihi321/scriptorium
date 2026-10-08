import JSZip from 'jszip'
import { escapeXml, markdownToXhtml, xhtmlPage } from './xhtml'

export interface EpubChapter {
  title: string
  /** Markdown prose. */
  body: string
}

export interface EpubBook {
  title: string
  author: string
  /** `urn:uuid:...` or a bare uuid. */
  uuid: string
  subject: string
  description: string
  year: number
  modified: Date
  chapters: EpubChapter[]
  /** PNG bytes. When present the cover page uses the image and the OPF marks it as cover-image. */
  coverPng?: Uint8Array
  /** Extra subjects (keywords). */
  subjects?: string[]
}

export const BOOK_CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; margin: 5%; }
h1, h2, h3 { font-family: Georgia, serif; text-align: center; }
h2 { margin: 2em 0 1em; }
p { margin: 0 0 0.9em; text-indent: 0; }
hr.scene-break { border: 0; text-align: center; margin: 1.5em 0; }
hr.scene-break:after { content: "* * *"; }
blockquote { margin: 1em 2em; font-style: italic; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage .author { font-size: 1.2em; margin-top: 1.5em; }
.titlepage .ai { font-size: 0.8em; margin-top: 3em; color: #555; }
.cover img { width: 100%; height: auto; }
`

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Builds an EPUB 3 file: mimetype first and stored, container.xml, OPF, nav, cover, title page, chapters, CSS. */
export async function buildEpub(book: EpubBook): Promise<Uint8Array> {
  const id = book.uuid.startsWith('urn:uuid:') ? book.uuid : `urn:uuid:${book.uuid}`
  const zip = new JSZip()
  // no separate folder entries: only real files are in the archive
  const put = (name: string, data: string | Uint8Array, opts: JSZip.JSZipFileOptions = {}) => zip.file(name, data, { createFolders: false, ...opts })
  put('mimetype', 'application/epub+zip', { compression: 'STORE' })
  put(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  )
  put('OEBPS/style.css', BOOK_CSS)

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>'
  ]
  const spine: string[] = ['<itemref idref="cover"/>', '<itemref idref="titlepage"/>']

  if (book.coverPng) {
    put('OEBPS/images/cover.png', book.coverPng)
    manifest.push('<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>')
    put(
      'OEBPS/cover.xhtml',
      xhtmlPage(book.title, `<div class="cover"><img src="images/cover.png" alt="Cover of ${escapeXml(book.title)}"/></div>`, { epubType: 'cover' })
    )
  } else {
    put(
      'OEBPS/cover.xhtml',
      xhtmlPage(book.title, `<div class="titlepage"><h1>${escapeXml(book.title)}</h1><p class="author">${escapeXml(book.author)}</p></div>`, { epubType: 'cover' })
    )
  }

  put(
    'OEBPS/title.xhtml',
    xhtmlPage(
      book.title,
      `<div class="titlepage">
<h1>${escapeXml(book.title)}</h1>
<p class="author">${escapeXml(book.author)}</p>
<p class="ai">Written by an AI writer (${escapeXml(book.author)}) and edited by AI reviewers, made with Scriptorium. ${book.year}.</p>
</div>`,
      { epubType: 'titlepage' }
    )
  )

  const single = book.chapters.length === 1
  const navItems: string[] = []
  book.chapters.forEach((c, i) => {
    const n = String(i + 1).padStart(2, '0')
    const file = `chapter-${n}.xhtml`
    const heading = single ? `<h2>${escapeXml(book.title)}</h2>` : `<h2>${escapeXml(c.title)}</h2>`
    put(`OEBPS/${file}`, xhtmlPage(c.title, `${heading}\n${markdownToXhtml(c.body)}`, { epubType: 'chapter' }))
    manifest.push(`<item id="ch${n}" href="${file}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="ch${n}"/>`)
    navItems.push(`<li><a href="${file}">${escapeXml(single ? book.title : c.title)}</a></li>`)
  })

  put(
    'OEBPS/nav.xhtml',
    xhtmlPage(
      'Contents',
      `<nav epub:type="toc" id="toc">
<h2>Contents</h2>
<ol>
<li><a href="title.xhtml">Title page</a></li>
${navItems.join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
<li><a epub:type="bodymatter" href="${book.chapters.length ? 'chapter-01.xhtml' : 'title.xhtml'}">Start of the book</a></li>
</ol>
</nav>`
    )
  )

  const subjects = [book.subject, ...(book.subjects ?? [])].filter((s, i, a) => s && a.indexOf(s) === i)
  put(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator id="creator">${escapeXml(book.author)}</dc:creator>
    <dc:language>en</dc:language>
${subjects.map((s) => `    <dc:subject>${escapeXml(s)}</dc:subject>`).join('\n')}
    <dc:description>${escapeXml(book.description)}</dc:description>
    <dc:contributor id="contributor">Scriptorium (AI)</dc:contributor>
    <dc:date>${book.year}</dc:date>
    <meta property="dcterms:modified">${iso(book.modified)}</meta>
    <meta property="role" refines="#contributor" scheme="marc:relators">bkp</meta>
    <meta name="ai-written" content="true"/>${book.coverPng ? '\n    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
    <itemref idref="nav" linear="no"/>
  </spine>
</package>
`
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
}

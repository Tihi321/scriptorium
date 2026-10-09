export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(text: string): string {
  let t = escapeXml(text)
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  t = t.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  return t
}

/** A small markdown subset for prose (paragraphs, headings, scene breaks, quotes, emphasis) to well-formed XHTML. */
export function markdownToXhtml(md: string): string {
  const blocks = md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  const out: string[] = []
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(block)
    if (h && !block.includes('\n')) {
      const level = Math.min(6, h[1]!.length + 1) // the chapter title is h2, so shift down
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`)
    } else if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$|^#$/.test(block)) {
      out.push('<hr class="scene-break"/>')
    } else if (block.startsWith('>')) {
      const text = block.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')
      out.push(`<blockquote><p>${inline(text).replace(/\n/g, '<br/>')}</p></blockquote>`)
    } else {
      out.push(`<p>${inline(block).replace(/\n/g, '<br/>')}</p>`)
    }
  }
  return out.join('\n')
}

export function xhtmlPage(title: string, bodyHtml: string, opts: { css?: string; bodyClass?: string; epubType?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="${opts.css ?? 'style.css'}"/>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}${opts.epubType ? ` epub:type="${opts.epubType}"` : ''}>
${bodyHtml}
</body>
</html>
`
}

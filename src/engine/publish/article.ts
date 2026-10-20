import { escapeXml, markdownToXhtml } from './xhtml'

/** The name on the masthead of every article page. */
export const MASTHEAD = 'Scriptorium'

export interface ArticleSource {
  n: number
  url: string
  title: string
  retrieved: string
}

export interface ArticleInput {
  headline: string
  standfirst: string
  /** The newspaper section (the topic's name), or empty. */
  section: string
  /** The writer's pen name. */
  byline: string
  date: Date
  /** The article text: markdown paragraphs (and `## ` subheads) with `[n]` source numbers. */
  body: string
  /** The sources the text cites, numbered as in the text. */
  sources: ArticleSource[]
}

/** "20 October 2026", always in UTC so the page does not depend on the machine's time zone. */
export const articleDate = (d: Date): string => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

/** Reading time in whole minutes, at 220 words a minute, at least 1. */
export const readMinutes = (text: string): number => Math.max(1, Math.round(words(text) / 220))

/** `[2]`, `[2, 3]` or `[2][3]` in the text, as small linked numbers that point to the reference list; a number with no source is dropped. */
function linkCitations(html: string, known: Set<number>): string {
  return html.replace(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g, (_m, list: string) =>
    list
      .split(/[,;]/)
      .map((x) => Number(x))
      .filter((n) => known.has(n))
      .map((n) => `<sup class="cite"><a href="#ref-${n}">${n}</a></sup>`)
      .join('')
  )
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f3ec; color: #1d1b17; font-family: Georgia, 'Times New Roman', serif; line-height: 1.65; }
.paper { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; background: #fffdf8; min-height: 100vh; }
.masthead { border-bottom: 3px double #1d1b17; padding-bottom: .5rem; margin-bottom: 1.5rem; font-variant: small-caps; letter-spacing: .18em; font-size: 1.1rem; font-weight: bold; text-align: center; }
.section { font: bold .78rem/1 Arial, Helvetica, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #8a2b1c; margin: 0 0 .6rem; }
h1 { font-size: 2.1rem; line-height: 1.15; margin: 0 0 .7rem; }
.standfirst { font-size: 1.2rem; line-height: 1.45; color: #3c382f; margin: 0 0 1rem; font-weight: normal; }
.byline { font: .85rem/1.4 Arial, Helvetica, sans-serif; color: #5a554a; border-top: 1px solid #d8d2c3; border-bottom: 1px solid #d8d2c3; padding: .5rem 0; margin: 0 0 1.5rem; }
.byline b { color: #1d1b17; }
.body p { margin: 0 0 1.05rem; }
.body > p:first-of-type::first-letter { float: left; font-size: 3.2rem; line-height: .9; padding: .25rem .5rem 0 0; font-weight: bold; }
.body h3 { font-size: 1.25rem; margin: 1.8rem 0 .6rem; }
.body blockquote { margin: 1.2rem 0; padding-left: 1rem; border-left: 3px solid #8a2b1c; color: #3c382f; font-style: italic; }
.body hr { border: 0; border-top: 1px solid #d8d2c3; margin: 1.6rem 0; }
sup.cite { font: .7rem/1 Arial, Helvetica, sans-serif; margin-left: .1rem; }
sup.cite a { color: #8a2b1c; text-decoration: none; }
.refs { margin-top: 2.5rem; border-top: 1px solid #d8d2c3; padding-top: 1rem; font: .85rem/1.5 Arial, Helvetica, sans-serif; color: #3c382f; }
.refs h2 { font-size: 1rem; margin: 0 0 .6rem; }
.refs ol { margin: 0; padding-left: 1.6rem; }
.refs li { margin-bottom: .45rem; word-break: break-word; }
.refs a { color: #1d4f8a; }
.note { margin-top: 1.5rem; font: .75rem/1.4 Arial, Helvetica, sans-serif; color: #7a7466; }
`

/** The article as one standalone, styled HTML page: masthead, section, headline, standfirst, byline, date, text and numbered references. */
export function buildArticleHtml(a: ArticleInput): string {
  const known = new Set(a.sources.map((s) => s.n))
  const body = linkCitations(markdownToXhtml(a.body), known)
  const refs = a.sources.length
    ? `<section class="refs" id="references">
<h2>References</h2>
<ol>
${a.sources
  .map((s) => `<li id="ref-${s.n}" value="${s.n}">${s.title ? `${escapeXml(s.title.replace(/\s+/g, ' ').trim())}. ` : ''}<a href="${escapeXml(s.url)}" rel="noopener noreferrer">${escapeXml(s.url)}</a>${s.retrieved ? `. Retrieved ${escapeXml(s.retrieved)}` : ''}.</li>`)
  .join('\n')}
</ol>
</section>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(a.headline)} | ${MASTHEAD}</title>
<style>${CSS}</style>
</head>
<body>
<article class="paper">
<header>
<div class="masthead">${MASTHEAD}</div>
${a.section ? `<p class="section">${escapeXml(a.section)}</p>` : ''}
<h1>${escapeXml(a.headline)}</h1>
${a.standfirst ? `<p class="standfirst">${escapeXml(a.standfirst)}</p>` : ''}
<p class="byline">By <b>${escapeXml(a.byline || 'Scriptorium staff')}</b> &middot; <time datetime="${a.date.toISOString().slice(0, 10)}">${articleDate(a.date)}</time> &middot; ${readMinutes(a.body)} min read</p>
</header>
<div class="body">
${body}
</div>
${refs}
<p class="note">Written by an AI newsroom from the sources listed above and checked by an AI fact-checker. Check the sources before you rely on it.</p>
</article>
</body>
</html>
`
}

/** The same article as markdown: headline, standfirst, byline, text and the numbered references. */
export function buildArticleMarkdown(a: ArticleInput): string {
  const lines = [`# ${a.headline}`, '']
  if (a.standfirst) lines.push(`*${a.standfirst}*`, '')
  lines.push(`By ${a.byline || 'Scriptorium staff'}${a.section ? `, ${a.section}` : ''}, ${articleDate(a.date)}`, '', a.body.trim(), '')
  if (a.sources.length) {
    lines.push('## References', '')
    for (const s of a.sources) lines.push(`[${s.n}] ${s.title ? `${s.title.replace(/\s+/g, ' ').trim()}. ` : ''}${s.url}${s.retrieved ? ` (retrieved ${s.retrieved})` : ''}`, '')
  }
  return lines.join('\n')
}

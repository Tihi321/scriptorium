/** Demo data for the library: topics, books, covers and a small reader page. Only used by the dev harness. */
import type { BookSummary, TopicSummary } from '../../shared/protocol'

export interface FakeBook {
  slug: string
  title: string
  stage: string
  topic: number
  rating: number | null
  note: string | null
  paused?: boolean
  notes?: string
  /** The published book this one adapts into a visual novel script (its slug). */
  source?: string
  /** Its title, for "adapted from". */
  sourceTitle?: string
}

export interface FakeTopic {
  id: string
  name: string
  kind: string
  section: string
  active: boolean
  target: number
}

export function makeTopics(): FakeTopic[] {
  return [
    { id: 'jfic-bedtime-and-dreams', name: 'Bedtime & Dreams', kind: 'juvenile-fiction', section: 'Children', active: true, target: 5 },
    { id: 'jfic-animals', name: 'Animals & Friends', kind: 'juvenile-fiction', section: 'Children', active: true, target: 5 },
    { id: 'fic-mystery', name: 'Cosy Mystery', kind: 'fiction', section: 'Fiction', active: true, target: 4 },
    { id: 'fic-sf', name: 'Quiet Science Fiction', kind: 'fiction', section: 'Fiction', active: false, target: 4 },
    { id: 'nf-history', name: 'Short Histories', kind: 'nonfiction', section: 'Non-fiction', active: true, target: 3 },
    { id: 'fic-historical', name: 'Historical Fiction', kind: 'fiction', section: 'Fiction', active: false, target: 4 },
    { id: 'nf-printing', name: 'History of Books & Printing', kind: 'nonfiction', section: 'Non-fiction', active: false, target: 3 },
    { id: 'jnon-pirates', name: 'Pirates (juvenile fact book)', kind: 'juvenile-nonfiction', section: 'Children', active: false, target: 5 },
    { id: 'law-civics', name: 'Civics Basics', kind: 'nonfiction', section: 'Law & Politics', active: false, target: 5 }
  ]
}

export function makeBooks(): FakeBook[] {
  const b = (slug: string, title: string, stage: string, topic: number, rating: number | null = null): FakeBook => ({ slug, title, stage, topic, rating, note: null })
  return [
    b('the-lantern-and-the-fox', 'The Lantern and the Fox', 'drafting', 1),
    b('moon-bakery-bedtime', 'Moon Bakery Bedtime', 'editing', 0),
    b('ship-of-quiet-stars', 'Ship of Quiet Stars', 'drafting', 3),
    b('a-short-history-of-salt', 'A Short History of Salt', 'outline', 4),
    b('the-clockmakers-daughter', "The Clockmaker's Daughter", 'editing', 5),
    b('hedgehog-hospital', 'Hedgehog Hospital', 'published', 1, 4),
    b('the-moons-blanket', "The Moon's Blanket", 'published', 0),
    b('sleepy-owl-lullaby', 'The Sleepy Owl', 'published', 0),
    b('the-tea-shop-murders', 'The Tea Shop Murders', 'published', 2),
    b('dragon-in-the-attic', 'Dragon in the Attic', 'idea', 1),
    b('the-grey-lighthouse', 'The Grey Lighthouse', 'rejected', 2)
  ]
}

export function topicSummaries(topics: FakeTopic[], books: FakeBook[]): TopicSummary[] {
  return topics.map((t, i) => ({
    id: t.id,
    section: t.section,
    name: t.name,
    kind: t.kind,
    active: t.active,
    target: t.target,
    done: books.filter((b) => b.topic === i && b.stage === 'published').length,
    inProgress: books.filter((b) => b.topic === i && !['published', 'rejected'].includes(b.stage)).length
  }))
}

export function bookSummary(b: FakeBook, topics: FakeTopic[]): BookSummary {
  const published = b.stage === 'published'
  const t = topics[b.topic]!
  return {
    slug: b.slug,
    title: b.title,
    author: 'Mara Quill',
    topic: { id: t.id, name: t.name },
    kind: t.kind,
    format: b.source ? 'visual-novel' : t.kind === 'juvenile-fiction' ? 'bedtime-toddler' : 'short-story',
    ...(b.source ? { sourceBook: { slug: b.source, title: b.sourceTitle ?? b.source } } : {}),
    stage: b.stage,
    paused: !!b.paused,
    chaptersWritten: published ? 3 : 1,
    chaptersPlanned: 3,
    targetWords: 1500,
    round: 0,
    reasons: [],
    team: [{ agent: 'writer-mara-quill', role: 'writer', jobs: 3, models: ['deepseek/deepseek-flash'], costUsd: 0.003 }],
    steps: [{ task: 'draft_chapter', unit: 'ch01', agent: 'writer-mara-quill', model: 'deepseek/deepseek-flash' }],
    words: 450 + b.slug.length * 120,
    year: 2026,
    score: published ? 7.8 : null,
    scores: published ? { structure: 8, prose: 7.5, continuity: 8, age_fit: 8.5 } : {},
    costUsd: published ? 0.021 : 0.004,
    rating: b.rating,
    ratingNote: b.note,
    coverPng: published ? `books/${b.slug}/out/cover.png` : null,
    coverVersion: null,
    coverState: published ? 'done' : null,
    epub: published ? `books/${b.slug}/out/${b.slug}.epub` : null,
    readerDir: published ? `books/${b.slug}/out/reader` : null,
    readerPages: published ? READER_PAGES : [],
    publishedAt: published ? '2026-10-08T12:00:00Z' : null
  }
}

/** The demo reader's pages after the contents. */
const READER_PAGES = [
  { file: 'chapter-01.xhtml', title: 'Chapter 1' },
  { file: 'chapter-02.xhtml', title: 'Chapter 2' }
]

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/** Resolves `books/<slug>/out/...` to something a browser can show: an SVG cover, or a blob page for the reader. */
export function makeBookUrl(books: FakeBook[]): (rel: string) => string {
  const blobs = new Map<string, string>()
  return (rel) => {
    const m = /^books\/([^/]+)\/out\/(.*)$/.exec(rel)
    const book = books.find((x) => x.slug === m?.[1])
    if (!m || !book) return 'about:blank'
    if (m[2] === 'cover.png') {
      const hue = [...book.slug].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340"><rect width="240" height="340" fill="hsl(${hue},55%,45%)"/>` +
        `<rect x="14" y="14" width="212" height="312" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>` +
        `<text x="120" y="160" text-anchor="middle" font-family="Georgia" font-size="22" fill="#fff">${esc(book.title)}</text>` +
        `<text x="120" y="300" text-anchor="middle" font-family="Georgia" font-size="14" fill="#fff">Mara Quill</text></svg>`
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
    }
    const page = /^reader\/(.+)$/.exec(m[2]!)?.[1]
    if (page === 'index.html' || READER_PAGES.some((p) => p.file === page)) {
      const key = `${book.slug}/${page}`
      let url = blobs.get(key)
      if (!url) {
        const n = READER_PAGES.findIndex((p) => p.file === page) + 1
        const body =
          n === 0
            ? `<h1>${esc(book.title)}</h1><p><i>Mara Quill</i></p><nav><h2>Contents</h2><ol>${READER_PAGES.map((p) => `<li><a href="${p.file}">${p.title}</a></li>`).join('')}</ol></nav>` +
              `<h2 id="ch1">Chapter 1</h2><p>Once upon a time a small fox carried a lantern through the quiet fields.</p>`
            : `<h2>Chapter ${n}</h2><p>${n === 1 ? 'Once upon a time a small fox carried a lantern through the quiet fields.' : 'The fox set the lantern down and the fields went to sleep.'}</p>`
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;max-width:34em;margin:2em auto;line-height:1.5}</style></head><body>${body}</body></html>`
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        blobs.set(key, url)
      }
      return url
    }
    return 'about:blank'
  }
}

import { useEffect, useMemo, useState } from 'react'
import { emptyBrief } from '../../shared/brief'
import type { BookSummary } from '../../shared/protocol'
import { bookUrl, openFolder, sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { frontPage, newspaperArticles, openArticles } from '../store/shelves'
import { officeStore } from '../store/store'

/** The article formats the form offers when the engine lists none (older engines). */
const FALLBACK_FORMATS = [
  { id: 'article', name: 'Newspaper article' },
  { id: 'feature-article', name: 'Feature article' }
]

const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** "Write an article": the section (a topic of kind article), the subject, the angle, and the format. Sends the story; the factory writes it. */
function WriteArticle() {
  const topics = useOffice((s) => s.topics)
  const formats = useOffice((s) => s.formats)
  const sections = useMemo(() => topics.filter((t) => t.kind === 'article'), [topics])
  const options = useMemo(() => {
    const list = formats.filter((f) => f.kinds.includes('article'))
    return list.length ? list : FALLBACK_FORMATS
  }, [formats])
  const [section, setSection] = useState('')
  const [subject, setSubject] = useState('')
  const [angle, setAngle] = useState('')
  const [format, setFormat] = useState('article')
  const [sent, setSent] = useState(false)
  const chosen = section || sections.find((t) => t.active)?.id || sections[0]?.id || ''
  const full = { width: '100%', boxSizing: 'border-box' } as const

  const send = () => {
    const text = subject.trim()
    if (!text || !chosen) return
    // no title: the editor-in-chief gives it a working headline, and the publisher makes the headline final
    sendCommand({
      type: 'addStory',
      brief: { ...emptyBrief(), premise: text, sections: angle.trim() ? [{ heading: 'Angle', text: angle.trim() }] : [], format, topic: chosen }
    })
    setSubject('')
    setAngle('')
    setSent(true)
    setTimeout(() => setSent(false), 3500)
  }

  return (
    <div className="stack write-article" data-testid="write-article">
      <div className="panel-title">Write an article</div>
      <span className="dim">The factory researches recent news, writes it, has it fact-checked and publishes it on the front page.</span>
      <label className="stack">
        <span className="dim">Section</span>
        <select style={full} value={chosen} onChange={(e) => setSection(e.target.value)} data-testid="article-section">
          {sections.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {sections.length === 0 && <option value="">No newspaper sections (topics of kind article)</option>}
        </select>
      </label>
      <label className="stack">
        <span className="dim">Subject</span>
        <input style={full} value={subject} placeholder="What is it about? e.g. the new EU rules on AI" onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} data-testid="article-subject" />
      </label>
      <label className="stack">
        <span className="dim">Angle (optional)</span>
        <textarea style={full} rows={3} value={angle} placeholder="The question it answers, or the view it takes" onChange={(e) => setAngle(e.target.value)} data-testid="article-angle" />
      </label>
      <label className="stack">
        <span className="dim">Format</span>
        <select style={full} value={format} onChange={(e) => setFormat(e.target.value)} data-testid="article-format">
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id === 'feature-article' ? 'Feature (long)' : f.id === 'article' ? 'Article (short)' : f.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row spread">
        <span className="dim" data-testid="article-status">
          {sent ? 'Sent: the factory starts the article now. Follow it below.' : ''}
        </span>
        <button className="primary" disabled={!subject.trim() || !chosen} onClick={send} data-testid="article-submit">
          Write it
        </button>
      </div>
    </div>
  )
}

/** One article of the front page: headline, standfirst, byline and date. A click opens the page. */
function ArticleRow({ article, onOpen }: { article: BookSummary; onOpen(): void }) {
  const when = article.publishedAt ? new Date(article.publishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : ''
  return (
    <button className="article-row" onClick={onOpen} data-testid={`article-${article.slug}`}>
      <b className="article-headline">{article.headline ?? article.title}</b>
      {article.standfirst && <span className="article-standfirst">{article.standfirst}</span>}
      <span className="dim article-byline">
        By {article.author ?? 'Scriptorium staff'}
        {when ? `, ${when} UTC` : ''}
      </span>
    </button>
  )
}

/** The article page (out/article.html) in a frame: no scripts, and the book protocol serves only this book's files. */
function ArticleViewer({ article, onClose }: { article: BookSummary; onClose(): void }) {
  const src = article.articlePage ? bookUrl(article.articlePage) : null
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="reader" onClick={(e) => e.stopPropagation()} data-testid="article-viewer">
        <div className="row spread reader-bar">
          <b>{article.headline ?? article.title}</b>
          <span className="row">
            <button onClick={() => void openFolder(`books/${article.slug}`)} data-testid="article-folder">
              Open folder
            </button>
            <button
              onClick={() => {
                onClose()
                officeStore.getState().openBookCard(article.slug)
              }}
              data-testid="article-card"
            >
              Details
            </button>
            <button onClick={onClose} data-testid="article-close">
              Close
            </button>
          </span>
        </div>
        {src ? <iframe title={`Article: ${article.title}`} src={src} sandbox="" className="reader-frame" data-testid="article-frame" /> : <div className="empty">This article has no page yet.</div>}
      </div>
    </div>
  )
}

/**
 * The newspaper: the front page (published articles by day, then by section), the form to write an article, and the articles
 * still being written. Articles are books of medium `article`: no cover, no EPUB, a single page.
 */
export function NewspaperView() {
  const bookViews = useOffice((s) => s.books)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const articles = useMemo(() => newspaperArticles(Object.values(bookViews).flatMap((v) => (v.summary ? [v.summary] : []))), [bookViews])
  const days = useMemo(() => frontPage(articles), [articles])
  const working = useMemo(() => openArticles(articles), [articles])
  const open = openSlug ? articles.find((a) => a.slug === openSlug) : undefined
  const published = articles.filter((a) => a.stage === 'published').length

  return (
    <div className="library newspaper" data-testid="newspaper">
      <div className="shelves front-page">
        <div className="row spread">
          <div className="panel-title">Newspaper</div>
          <span className="dim" data-testid="newspaper-count">
            {published} published, {working.length} in progress
          </span>
        </div>
        {days.length === 0 && (
          <div className="empty" data-testid="newspaper-empty">
            No articles yet. Switch a newspaper section on in the topic list, or write one with the form.
          </div>
        )}
        {days.map((day) => (
          <section className="paper-day" key={day.day} data-testid={`day-${day.day}`}>
            <header>
              <b>{dayLabel(day.day)}</b>
            </header>
            {day.sections.map((s) => (
              <div className="paper-section" key={s.name} data-testid={`section-${day.day}-${s.name}`}>
                <div className="paper-section-name">{s.name}</div>
                {s.articles.map((a) => (
                  <ArticleRow key={a.slug} article={a} onOpen={() => setOpenSlug(a.slug)} />
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="library-side">
        <WriteArticle />
        <div className="stack in-progress" data-testid="articles-in-progress">
          <div className="panel-title">In progress</div>
          {working.length === 0 && <span className="dim">No article is being written.</span>}
          {working.map((a) => (
            <button className="article-working" key={a.slug} onClick={() => officeStore.getState().openBookCard(a.slug)} data-testid={`working-${a.slug}`}>
              <span>{a.headline ?? a.title}</span>
              <span className="pill">{a.stage}</span>
            </button>
          ))}
        </div>
      </div>
      {open && <ArticleViewer article={open} onClose={() => setOpenSlug(null)} />}
    </div>
  )
}

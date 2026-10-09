import { useMemo, useState } from 'react'
import type { BookSummary } from '../../shared/protocol'
import { buildShelves } from '../store/shelves'
import { bookUrl } from '../api'
import { TopicOverview } from './Topics'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'
import { bookColor } from '../store/model'

export function CoverImage({ book, className }: { book: BookSummary; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (book.coverPng && !failed) {
    return <img className={className} src={bookUrl(book.coverPng)} alt={`Cover of ${book.title}`} onError={() => setFailed(true)} />
  }
  return (
    <div className={`${className ?? ''} cover-fallback`} style={{ background: bookColor(book.slug) }}>
      <span>{book.title}</span>
    </div>
  )
}

function BookOnShelf({ book }: { book: BookSummary }) {
  return (
    <button className="shelf-book" onClick={() => officeStore.getState().openBookCard(book.slug)} title={`${book.title} by ${book.author ?? 'unknown'}`} data-testid={`shelf-book-${book.slug}`}>
      <CoverImage book={book} className="shelf-cover" />
      <span className="shelf-title">{book.title}</span>
      {book.rating ? <span className="stars-small">{'★'.repeat(book.rating)}</span> : null}
    </button>
  )
}

export function LibraryView() {
  const topics = useOffice((s) => s.topics)
  const bookViews = useOffice((s) => s.books)
  const [showRejected, setShowRejected] = useState(false)
  const books = useMemo(() => Object.values(bookViews).flatMap((v) => (v.summary ? [v.summary] : [])), [bookViews])
  const shelves = useMemo(() => buildShelves(topics, books), [topics, books])
  const rejected = useMemo(() => books.filter((b) => b.stage === 'rejected'), [books])
  const publishedCount = books.filter((b) => b.stage === 'published').length

  return (
    <div className="library" data-testid="library">
      <div className="shelves">
        <div className="row spread">
          <div className="panel-title">Library</div>
          <span className="dim">
            {publishedCount} published, {shelves.length} shelves
          </span>
        </div>
        {shelves.length === 0 && <div className="empty">No shelves yet. Switch a topic on in the list and books will appear here when they are published.</div>}
        {shelves.map((shelf) => (
          <section className={`shelf${shelf.books.length === 0 ? ' shelf-empty' : ''}`} key={shelf.id} data-testid={`shelf-${shelf.id}`}>
            <header>
              <b>{shelf.name}</b>
              <span className="dim">
                {shelf.topic ? `${shelf.topic.done} of ${shelf.topic.target} done${shelf.topic.inProgress ? `, ${shelf.topic.inProgress} in progress` : ''}` : `${shelf.books.length} books`}
              </span>
            </header>
            <div className="shelf-row">
              {shelf.books.map((b) => (
                <BookOnShelf key={b.slug} book={b} />
              ))}
              {shelf.books.length === 0 && <span className="empty-slot">Empty shelf: waiting for its first book</span>}
            </div>
          </section>
        ))}
        <section className="shelf rejected">
          <header>
            <b>Rejected</b>
            <button onClick={() => setShowRejected(!showRejected)} data-testid="toggle-rejected">
              {showRejected ? 'Hide' : 'Show'} ({rejected.length})
            </button>
          </header>
          {showRejected && (
            <div className="shelf-row">
              {rejected.map((b) => (
                <BookOnShelf key={b.slug} book={b} />
              ))}
              {rejected.length === 0 && <span className="empty-slot">Nothing was rejected.</span>}
            </div>
          )}
        </section>
      </div>
      <TopicOverview />
    </div>
  )
}

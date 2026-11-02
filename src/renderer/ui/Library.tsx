import { useMemo, useState } from 'react'
import type { BookSummary } from '../../shared/protocol'
import { buildShelves, type Shelf } from '../store/shelves'
import { NO_FILTER, filterActive, filterBooks, typeBadge } from '../store/bookTypes'
import { bookUrl } from '../api'
import { SeriesPanel } from './Series'
import { TopicOverview } from './Topics'
import { LibraryToolbar } from './LibraryToolbar'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'
import { bookColor } from '../store/model'

export function CoverImage({ book, className }: { book: BookSummary; className?: string }) {
  // the version makes a remade cover load instead of the cached one; a new version also gets a new try after an error
  const src = book.coverPng ? `${bookUrl(book.coverPng)}${book.coverVersion ? `?v=${book.coverVersion}` : ''}` : null
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && src !== failedSrc) {
    return <img className={className} src={src} alt={`Cover of ${book.title}`} onError={() => setFailedSrc(src)} />
  }
  return (
    <div className={`${className ?? ''} cover-fallback`} style={{ background: bookColor(book.slug) }}>
      <span>{book.title}</span>
    </div>
  )
}

function BookOnShelf({ book }: { book: BookSummary }) {
  const formats = useOffice((s) => s.formats)
  const badge = typeBadge(book.format)
  const formatName = formats.find((f) => f.id === book.format)?.name ?? book.format
  return (
    <button className="lib-book" onClick={() => officeStore.getState().openBookCard(book.slug)} title={`${book.title} by ${book.author ?? 'unknown'}`} data-testid={`shelf-book-${book.slug}`}>
      <span className="lib-cover-wrap">
        <CoverImage book={book} className="lib-cover" />
        {badge && (
          <span className={`badge t-${badge.group}`} title={formatName}>
            {badge.text}
          </span>
        )}
      </span>
      <span className="shelf-title">{book.title}</span>
      {book.sourceBook && (
        <span className="lib-from" data-testid={`from-${book.slug}`}>
          from {book.sourceBook.title}
        </span>
      )}
      {book.rating ? <span className="stars-small">{'★'.repeat(book.rating)}</span> : null}
    </button>
  )
}

function shelfMeta(shelf: Shelf): string {
  const n = `${shelf.books.length} ${shelf.books.length === 1 ? 'book' : 'books'}`
  if (!shelf.topic) return n
  return `${n}, ${shelf.topic.done} of ${shelf.topic.target} for the topic${shelf.topic.inProgress ? `, ${shelf.topic.inProgress} in progress` : ''}`
}

type SideTab = 'topics' | 'series'
const SIDE_KEY = 'scriptorium.librarySide'

function loadSide(): { open: boolean; tab: SideTab } {
  try {
    const v = JSON.parse(localStorage.getItem(SIDE_KEY) ?? 'null') as { open?: unknown; tab?: unknown } | null
    return { open: v?.open !== false, tab: v?.tab === 'series' ? 'series' : 'topics' }
  } catch {
    return { open: true, tab: 'topics' }
  }
}

export function LibraryView() {
  const topics = useOffice((s) => s.topics)
  const bookViews = useOffice((s) => s.books)
  const filter = useOffice((s) => s.libraryFilter)
  const groupBy = useOffice((s) => s.libraryGroupBy)
  const [showRejected, setShowRejected] = useState(false)
  const [side, setSideState] = useState(loadSide)
  const setSide = (next: { open: boolean; tab: SideTab }) => {
    setSideState(next)
    try {
      localStorage.setItem(SIDE_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: the choice lasts until the page closes
    }
  }
  // the Library holds books only: the newspaper articles are on their own tab
  const books = useMemo(() => Object.values(bookViews).flatMap((v) => (v.summary && v.summary.medium !== 'article' ? [v.summary] : [])), [bookViews])
  const published = useMemo(() => books.filter((b) => b.stage === 'published'), [books])
  const active = filterActive(filter)
  const shelves = useMemo(() => buildShelves(topics, filterBooks(books, filter), { groupBy, sources: books, hideEmpty: active }), [topics, books, filter, groupBy, active])
  const rejected = useMemo(() => books.filter((b) => b.stage === 'rejected'), [books])
  const { setLibraryFilter, setLibraryGroupBy } = officeStore.getState()

  return (
    <div className="lib" data-testid="library">
      <LibraryToolbar
        books={published}
        filter={filter}
        groupBy={groupBy}
        published={published.length}
        shelves={shelves.length}
        sideOpen={side.open}
        onFilter={setLibraryFilter}
        onGroupBy={setLibraryGroupBy}
        onToggleSide={() => setSide({ ...side, open: !side.open })}
      />
      <div className={`lib-body${side.open ? '' : ' side-closed'}`}>
        <div className="lib-shelves">
          {shelves.length === 0 && !active && <div className="lib-empty">No shelves yet. Switch a topic on in the list and books will appear here when they are published.</div>}
          {shelves.length === 0 && active && (
            <div className="lib-empty">
              No books match.{' '}
              <button onClick={() => setLibraryFilter({ ...NO_FILTER })} data-testid="library-clear">
                Clear the filters
              </button>
            </div>
          )}
          {shelves.map((shelf) => (
            <section className={`lib-shelf${shelf.books.length === 0 ? ' empty' : ''}`} key={shelf.id} data-testid={`shelf-${shelf.id}`}>
              <header>
                <h3 title={shelf.name}>{shelf.name}</h3>
                <span className="dim">{shelfMeta(shelf)}</span>
              </header>
              <div className="lib-row">
                {shelf.books.map((b) => (
                  <BookOnShelf key={b.slug} book={b} />
                ))}
                {shelf.books.length === 0 && <span className="lib-empty-slot">Empty shelf: waiting for its first book</span>}
              </div>
              <div className="lib-ledge" />
            </section>
          ))}
          <section className="lib-shelf rejected">
            <header>
              <h3>Rejected</h3>
              <button onClick={() => setShowRejected(!showRejected)} data-testid="toggle-rejected">
                {showRejected ? 'Hide' : 'Show'} ({rejected.length})
              </button>
            </header>
            {showRejected && (
              <>
                <div className="lib-row">
                  {rejected.map((b) => (
                    <BookOnShelf key={b.slug} book={b} />
                  ))}
                  {rejected.length === 0 && <span className="lib-empty-slot">Nothing was rejected.</span>}
                </div>
                <div className="lib-ledge" />
              </>
            )}
          </section>
        </div>
        {side.open && (
          <aside className="lib-side">
            <div className="lib-side-tabs" role="tablist">
              {(['topics', 'series'] as const).map((tab) => (
                <button key={tab} role="tab" aria-selected={side.tab === tab} className={side.tab === tab ? 'on' : ''} onClick={() => setSide({ ...side, tab })} data-testid={`library-side-tab-${tab}`}>
                  {tab === 'topics' ? 'Topics' : 'Series'}
                </button>
              ))}
            </div>
            <div className="lib-side-body">{side.tab === 'topics' ? <TopicOverview /> : <SeriesPanel />}</div>
          </aside>
        )}
      </div>
    </div>
  )
}

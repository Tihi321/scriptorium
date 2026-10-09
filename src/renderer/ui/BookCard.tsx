import { useEffect, useState } from 'react'
import { bookUrl, openFolder, sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { formatUsd } from '../store/model'
import { officeStore } from '../store/store'
import { CoverImage } from './Library'

function Stars({ value, onPick }: { value: number; onPick(n: number): void }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'star on' : 'star'} onClick={() => onPick(n)} data-testid={`rate-${n}`} aria-label={`${n} stars`}>
          ★
        </button>
      ))}
    </span>
  )
}

export function BookCard() {
  const slug = useOffice((s) => s.openBook)
  const reading = useOffice((s) => s.reading)
  const book = useOffice((s) => (s.openBook ? s.books[s.openBook]?.summary : undefined))
  const kindle = useOffice((s) => (s.openBook ? s.kindle[s.openBook] : undefined))
  const [rating, setRating] = useState(0)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setRating(book?.rating ?? 0)
    setNote(book?.ratingNote ?? '')
    setSaved(false)
  }, [slug, book?.rating, book?.ratingNote])

  if (!slug || !book) return null
  const close = () => officeStore.getState().openBookCard(null)

  if (reading) {
    const src = book.readerDir ? bookUrl(`${book.readerDir.replace(/\/+$/, '')}/index.html`) : null
    return (
      <div className="dialog-backdrop" onClick={close}>
        <div className="reader" onClick={(e) => e.stopPropagation()} data-testid="reader">
          <div className="row spread reader-bar">
            <b>{book.title}</b>
            <span className="row">
              <button onClick={() => officeStore.getState().setReading(false)} data-testid="reader-back">
                Back to card
              </button>
              <button onClick={close}>Close</button>
            </span>
          </div>
          {src ? (
            // No scripts, no same-origin access, and the protocol only serves this book's files.
            <iframe title={`Reader: ${book.title}`} src={src} sandbox="" className="reader-frame" data-testid="reader-frame" />
          ) : (
            <div className="empty">This book has no reader folder yet.</div>
          )}
        </div>
      </div>
    )
  }

  const scores = Object.entries(book.scores)
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog book-card" onClick={(e) => e.stopPropagation()} data-testid="book-card">
        <div className="book-card-top">
          <CoverImage book={book} className="card-cover" />
          <div className="stack">
            <div className="panel-title" data-testid="card-title">
              {book.title}
            </div>
            <div className="kv">
              <span>Author</span>
              <span>{book.author ?? 'unknown'}</span>
              <span>Topic</span>
              <span>{book.topic?.name ?? 'none'}</span>
              <span>Kind</span>
              <span>
                {book.kind ?? 'n/a'}, {book.format}
              </span>
              <span>Year</span>
              <span>{book.year ?? 'n/a'}</span>
              <span>Length</span>
              <span>{book.words.toLocaleString()} words</span>
              <span>Score</span>
              <span>{book.score !== null ? `${book.score.toFixed(1)} / 10` : 'not scored'}</span>
              <span>Cost</span>
              <span>{formatUsd(book.costUsd)}</span>
              <span>Rating</span>
              <span data-testid="card-rating">{book.rating ? '★'.repeat(book.rating) : 'not rated'}</span>
            </div>
          </div>
        </div>
        {scores.length > 0 && (
          <div className="scores">
            {scores.map(([k, v]) => (
              <span className="pill" key={k}>
                {k.replace(/_/g, ' ')} {v.toFixed(1)}
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!book.readerDir} onClick={() => officeStore.getState().setReading(true)} data-testid="card-read">
            Read
          </button>
          <button onClick={() => void openFolder(`books/${book.slug}`)} data-testid="card-folder">
            Open folder
          </button>
          <button
            disabled={!book.epub || kindle?.state === 'sending'}
            onClick={() => {
              officeStore.getState().markKindleSending(book.slug)
              sendCommand({ type: 'sendToKindle', book: book.slug })
            }}
            data-testid="card-kindle"
          >
            Send to Kindle
          </button>
          <span data-testid="kindle-status" className={kindle?.state === 'error' ? 'err' : 'dim'}>
            {kindle?.state === 'sending' ? 'sending...' : kindle?.state === 'ok' ? 'Sent.' : kindle?.state === 'error' ? `Failed: ${kindle.error ?? 'unknown error'}` : ''}
          </span>
        </div>
        <div className="stack" style={{ marginTop: 10 }}>
          <span className="dim">Your rating</span>
          <Stars value={rating} onPick={setRating} />
          <textarea rows={2} placeholder="A note (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="rate-note" />
          <div className="row spread">
            <span className="dim">{saved ? 'Saved.' : ''}</span>
            <span className="row">
              <button
                className="primary"
                disabled={rating === 0}
                data-testid="rate-save"
                onClick={() => {
                  sendCommand({ type: 'rate', book: book.slug, rating, ...(note.trim() ? { note: note.trim() } : {}) })
                  setSaved(true)
                }}
              >
                Save rating
              </button>
              <button onClick={close} data-testid="card-close">
                Close
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

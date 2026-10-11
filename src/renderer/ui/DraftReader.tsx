import { useEffect, useState } from 'react'
import { bookUrl, sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'

/**
 * Reads a book that isn't finished: the chapters written so far and what the outline still plans.
 * Next to it: pause the book, and leave notes the writers follow (optionally rewriting one chapter with the note).
 */
export function DraftReader() {
  const slug = useOffice((s) => s.draftBook)
  const draft = useOffice((s) => s.draft)
  const book = useOffice((s) => (s.draftBook ? s.books[s.draftBook] : undefined))
  const [text, setText] = useState('')
  const [chapter, setChapter] = useState('')
  const [rewrite, setRewrite] = useState(false)

  useEffect(() => {
    if (slug) sendCommand({ type: 'readDraft', book: slug })
    setText('')
    setChapter('')
    setRewrite(false)
  }, [slug])

  if (!slug) return null
  const close = () => officeStore.getState().openDraft(null)
  const ready = draft?.book === slug ? draft : null
  const paused = !!book?.summary?.paused
  const src = ready ? `${bookUrl(`${ready.dir}/index.html`)}?v=${ready.at}` : null
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="reader draft-reader" onClick={(e) => e.stopPropagation()} data-testid="draft-reader">
        <div className="row spread reader-bar">
          <b>
            {book?.title ?? slug} <span className="dim">(draft)</span>
          </b>
          <span className="row">
            <button onClick={() => sendCommand({ type: 'readDraft', book: slug })} title="Build the draft again with the latest chapters">
              Refresh
            </button>
            <button
              onClick={() => sendCommand({ type: 'pauseBook', book: slug, paused: !paused })}
              title="Paused: this book's jobs wait (running ones finish), so you can read and leave notes"
              data-testid="draft-pause"
            >
              {paused ? 'Resume writing' : 'Stop writing'}
            </button>
            <button onClick={close}>Close</button>
          </span>
        </div>
        <div className="draft-body">
          {src ? (
            // No scripts, no same-origin access, and the protocol only serves the book's out/ folder.
            <iframe title={`Draft: ${book?.title ?? slug}`} src={src} sandbox="" className="reader-frame" data-testid="draft-frame" />
          ) : (
            <div className="empty reader-frame">Building the draft...</div>
          )}
          <div className="draft-notes">
            <b>Your notes</b>
            <span className="dim">The writers follow these in every chapter they write or rewrite from now on.</span>
            {ready?.notes ? <pre data-testid="draft-notes">{ready.notes}</pre> : <span className="dim">No notes yet.</span>}
            <textarea value={text} placeholder="What should change? For example: less description, more dialogue; Mara should not trust the captain yet." onChange={(e) => setText(e.target.value)} data-testid="note-text" />
            <select value={chapter} onChange={(e) => setChapter(e.target.value)} data-testid="note-chapter">
              <option value="">About the whole book</option>
              {(ready?.chapters ?? []).map((c) => (
                <option key={c.n} value={String(c.n)}>
                  Chapter {c.n}: {c.title}
                </option>
              ))}
            </select>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" style={{ width: 'auto' }} disabled={!chapter} checked={rewrite && !!chapter} onChange={(e) => setRewrite(e.target.checked)} data-testid="note-rewrite" />
              Rewrite this chapter with my note
            </label>
            <button
              className="primary"
              disabled={!text.trim()}
              data-testid="note-add"
              onClick={() => {
                sendCommand({ type: 'addBookNote', book: slug, text: text.trim(), chapter: chapter ? Number(chapter) : null, rewrite: rewrite && !!chapter })
                setText('')
                setRewrite(false)
              }}
            >
              Add note
            </button>
            {paused && <span className="dim">Writing is stopped. Resume it when you are done; a chapter rewrite waits until then too.</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

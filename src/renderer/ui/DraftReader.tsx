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
  /** The page showing: a file of the draft folder (index.html is the contents). */
  const [page, setPage] = useState('')

  useEffect(() => {
    if (slug) sendCommand({ type: 'readDraft', book: slug })
    setText('')
    setChapter('')
    setRewrite(false)
    setPage('')
  }, [slug])

  const ready = draft?.book === slug ? draft : null
  const pages = ready?.pages ?? []
  // start at chapter 1 (or the contents when nothing is written yet); keep the page when the draft is rebuilt
  const current = page && (page === 'index.html' || pages.some((p) => p.file === page)) ? page : (pages[0]?.file ?? 'index.html')
  const at = pages.findIndex((p) => p.file === current)
  const go = (file: string) => {
    setPage(file)
    // a chapter page: the note is about that chapter, unless you picked another one
    const n = pages.find((p) => p.file === file)?.n
    if (n !== undefined && !text.trim()) setChapter(String(n))
  }
  const step = (d: number) => {
    const next = pages[at + d]
    if (next) go(next.file)
  }

  useEffect(() => {
    if (!slug) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!slug) return null
  const close = () => officeStore.getState().openDraft(null)
  const paused = !!book?.summary?.paused
  const src = ready ? `${bookUrl(`${ready.dir}/${current}`)}?v=${ready.at}` : null
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="reader draft-reader" onClick={(e) => e.stopPropagation()} data-testid="draft-reader">
        <div className="row spread reader-bar">
          <b>
            {book?.title ?? slug} <span className="dim">(draft)</span>
          </b>
          <span className="row draft-nav">
            <button onClick={() => step(-1)} disabled={at <= 0} title="Previous page (left arrow)" data-testid="draft-prev">
              ◀
            </button>
            <select value={current} onChange={(e) => go(e.target.value)} data-testid="draft-page">
              <option value="index.html">Contents</option>
              {pages.map((p) => (
                <option key={p.file} value={p.file}>
                  {p.title}
                </option>
              ))}
            </select>
            <button onClick={() => step(1)} disabled={at < 0 || at >= pages.length - 1} title="Next page (right arrow)" data-testid="draft-next">
              ▶
            </button>
          </span>
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

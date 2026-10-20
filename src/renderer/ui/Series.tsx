import { useState } from 'react'
import { emptyBrief } from '../../shared/brief'
import type { StoryBrief } from '../../shared/brief'
import type { SeriesSummary } from '../../shared/protocol'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'

/** What the form sends: empty characters left out, empty genre and format not set. */
function cleaned(b: StoryBrief): StoryBrief {
  return {
    ...b,
    title: b.title.trim(),
    characters: b.characters.filter((c) => c.name.trim()),
    sections: b.sections.filter((s) => s.heading.trim()),
    format: b.format || undefined,
    genre: b.genre?.trim() || undefined
  }
}

function SeriesBooks({ series }: { series: SeriesSummary }) {
  const books = useOffice((s) => s.books)
  if (series.books.length === 0) return <div className="dim">No book yet.</div>
  return (
    <ol className="series-books" data-testid={`series-books-${series.slug}`}>
      {series.books.map((b) => {
        // a started book shows its live stage and score; a story waiting for its book shows "story"
        const live = b.kind === 'book' ? books[b.slug]?.summary : undefined
        const stage = live?.stage ?? b.stage
        const score = live?.score ?? b.score
        return (
          <li key={`${b.kind}-${b.slug}`} data-testid={`series-book-${b.slug}`}>
            <span className="name">{b.title}</span>{' '}
            <span className="dim" data-testid={`series-book-stage-${b.slug}`}>
              {stage === 'story' ? 'waiting' : stage}
              {typeof score === 'number' ? `, ${score.toFixed(1)}` : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Series in the library: books that continue each other, with their recurring characters, setting and style.
 * Each series lists its books in order (stage, score). "Next book" opens the story form with the series selected:
 * the new story is book N+1, and waits until the books before it are published.
 */
export function SeriesPanel() {
  const series = useOffice((s) => s.series)
  const formats = useOffice((s) => s.formats)
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState<StoryBrief>(emptyBrief)
  // the slug of the series being edited, or null for a new one
  const [editing, setEditing] = useState<string | null>(null)
  const set = (patch: Partial<StoryBrief>) => setBrief((b) => ({ ...b, ...patch }))
  const setCharacter = (n: number, patch: Partial<StoryBrief['characters'][number]>) => set({ characters: brief.characters.map((c, i) => (i === n ? { ...c, ...patch } : c)) })
  const reset = () => {
    setBrief(emptyBrief())
    setEditing(null)
  }
  const save = () => {
    const b = cleaned(brief)
    if (!b.title) return
    sendCommand(editing ? { type: 'updateSeries', series: editing, brief: b } : { type: 'addSeries', brief: b })
    reset()
    setOpen(false)
  }
  const edit = (s: SeriesSummary) => {
    setBrief(s.brief)
    setEditing(s.slug)
    setOpen(true)
  }
  const full = { width: '100%', boxSizing: 'border-box' } as const

  return (
    <aside className="series-panel card" data-testid="series-panel">
      <h3>Series</h3>
      {series.length === 0 && <div className="dim">No series yet. A series keeps its characters and what happened from one book to the next.</div>}
      {series.map((s) => (
        <section className="series-item" key={s.slug} data-testid={`series-${s.slug}`}>
          <div className="row spread">
            <b data-testid={`series-title-${s.slug}`}>{s.title}</b>
            <span className="dim">{s.genre ?? ''}</span>
          </div>
          <SeriesBooks series={s} />
          <div className="row">
            <button className="small" data-testid={`series-next-${s.slug}`} title="Describe the next book of this series" onClick={() => officeStore.getState().setStorySeries(s.slug)}>
              Next book
            </button>
            <button className="small" data-testid={`series-edit-${s.slug}`} onClick={() => edit(s)}>
              Edit
            </button>
          </div>
        </section>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <button
          onClick={() => {
            if (open && editing) reset()
            setOpen(!open)
          }}
          data-testid="series-new"
        >
          {open ? 'Hide the series form' : 'New series'}
        </button>
      </div>
      {open && (
        <div className="stack series-form" style={{ marginTop: 6 }} data-testid="series-form">
          <span className="dim">{editing ? `Editing "${series.find((s) => s.slug === editing)?.title ?? editing}"` : 'Every book of the series gets this premise, cast, setting and style.'}</span>
          <input style={full} value={brief.title} placeholder="Series title" data-testid="series-title" onChange={(e) => set({ title: e.target.value })} />
          <div className="row">
            <input style={{ flex: 1, minWidth: 0 }} value={brief.genre ?? ''} placeholder="Genre" data-testid="series-genre" onChange={(e) => set({ genre: e.target.value })} />
            <select style={{ flex: 1, minWidth: 0 }} value={brief.format ?? ''} data-testid="series-format" onChange={(e) => set({ format: e.target.value || undefined })}>
              <option value="">Format: any</option>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <textarea style={full} rows={3} value={brief.premise} placeholder="Premise: the arc of the whole series" data-testid="series-premise" onChange={(e) => set({ premise: e.target.value })} />
          {brief.characters.map((c, n) => (
            <div key={n} className="stack" data-testid="series-character">
              <div className="row">
                <input style={{ flex: 1, minWidth: 0 }} value={c.name} placeholder="Name" data-testid="series-char-name" onChange={(e) => setCharacter(n, { name: e.target.value })} />
                <input style={{ flex: 1, minWidth: 0 }} value={c.role} placeholder="Role" data-testid="series-char-role" onChange={(e) => setCharacter(n, { role: e.target.value })} />
                <button className="small" title="Remove this character" data-testid="series-char-remove" onClick={() => set({ characters: brief.characters.filter((_, i) => i !== n) })}>
                  Remove
                </button>
              </div>
              <textarea style={full} rows={2} value={c.description} placeholder="Description: looks, voice, history" data-testid="series-char-desc" onChange={(e) => setCharacter(n, { description: e.target.value })} />
            </div>
          ))}
          <div className="row">
            <button onClick={() => set({ characters: [...brief.characters, { name: '', role: '', description: '' }] })} data-testid="series-add-character">
              + Recurring character
            </button>
          </div>
          <textarea style={full} rows={2} value={brief.setting} placeholder="Setting: where and when" data-testid="series-setting" onChange={(e) => set({ setting: e.target.value })} />
          <textarea style={full} rows={2} value={brief.style} placeholder="Style: voice, tone, how it should read" data-testid="series-style" onChange={(e) => set({ style: e.target.value })} />
          <div className="row">
            <button className="primary" disabled={!brief.title.trim()} onClick={save} data-testid="series-save">
              {editing ? 'Save changes' : 'Save series'}
            </button>
            {(editing || brief.title.trim()) && (
              <button onClick={reset} data-testid="series-clear">
                {editing ? 'New series' : 'Clear'}
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

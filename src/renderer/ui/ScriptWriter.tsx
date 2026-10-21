import { useState } from 'react'
import type { BookSummary } from '../../shared/protocol'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'

/** The visual novel formats the script writer offers when the engine lists none (older engines). */
const FALLBACK = [
  { id: 'visual-novel', name: 'Visual novel' },
  { id: 'choice-visual-novel', name: 'Visual novel with choices' }
]

const isChoices = (id: string) => id.includes('choice')

/**
 * The script writer: adapts a published book into a visual novel script. The owner picks linear (one story, no choices) or
 * with choices (the book's own ending stays one canon path), an optional title and notes for the adapter. "Adapt" sends the
 * story; the factory starts the book at once, because the source is published.
 */
export function ScriptWriter({ book, onDone }: { book: BookSummary; onDone(): void }) {
  const formats = useOffice((s) => s.formats)
  const options = formats.filter((f) => f.kinds.includes('visual-novel'))
  const choices = options.length ? options : FALLBACK
  const [format, setFormat] = useState(choices.find((f) => !isChoices(f.id))?.id ?? choices[0]!.id)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [sent, setSent] = useState(false)
  const full = { width: '100%', boxSizing: 'border-box' } as const
  const adapt = () => {
    sendCommand({ type: 'adaptBook', book: book.slug, format, ...(title.trim() ? { title: title.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) })
    setSent(true)
  }
  return (
    <div className="stack script-writer" data-testid="script-writer">
      <div className="panel-title">Script writer</div>
      <span className="dim">
        Turns "{book.title}" into a visual novel script that VN Studio can import. The story, characters and ending of the book stay; the architect compresses it into chapters of script scenes.
      </span>
      <label className="stack">
        <span className="dim">Kind of visual novel</span>
        <select style={full} value={format} onChange={(e) => setFormat(e.target.value)} disabled={sent} data-testid="adapt-format">
          {choices.map((f) => (
            <option key={f.id} value={f.id}>
              {isChoices(f.id) ? 'With choices' : 'Linear'} ({f.name})
            </option>
          ))}
        </select>
      </label>
      <span className="dim" data-testid="adapt-format-hint">
        {isChoices(format) ? "The reader picks at the end of chapters. The book's own ending stays one canon path; the other paths branch off it." : 'One story from start to end, no choices, like the book.'}
      </span>
      <input style={full} value={title} placeholder={`Title (optional, default "${book.title}")`} disabled={sent} data-testid="adapt-title" onChange={(e) => setTitle(e.target.value)} />
      <textarea style={full} rows={3} value={notes} placeholder="Notes for the adapter (optional): what to keep, cut or change" disabled={sent} data-testid="adapt-notes" onChange={(e) => setNotes(e.target.value)} />
      <div className="row spread">
        <span className="dim" data-testid="adapt-status">
          {sent ? 'Sent: the factory starts the script now. Follow it on the whiteboard.' : ''}
        </span>
        <span className="row">
          <button className="primary" disabled={sent} onClick={adapt} data-testid="adapt-submit">
            Adapt
          </button>
          <button onClick={onDone} data-testid="adapt-close">
            {sent ? 'Close' : 'Back to card'}
          </button>
        </span>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'

export function AskResearcher() {
  const books = useOffice((s) => s.books)
  const [question, setQuestion] = useState('')
  const [book, setBook] = useState('')
  const [sent, setSent] = useState(false)
  const submit = () => {
    const q = question.trim()
    if (!q) return
    sendCommand({ type: 'askResearcher', question: q, ...(book ? { book } : {}) })
    setQuestion('')
    setSent(true)
    setTimeout(() => setSent(false), 2500)
  }
  return (
    <div className="card" data-testid="ask-researcher">
      <h3>Ask researcher</h3>
      <div className="stack">
        <textarea
          rows={2}
          placeholder="A question for the researcher"
          value={question}
          data-testid="ask-question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
          }}
        />
        <select value={book} onChange={(e) => setBook(e.target.value)} data-testid="ask-book">
          <option value="">No book</option>
          {Object.values(books).map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.title}
            </option>
          ))}
        </select>
        <div className="row spread">
          <span className="dim">{sent ? 'Sent.' : 'Ctrl+Enter sends'}</span>
          <button className="primary" onClick={submit} disabled={!question.trim()} data-testid="ask-send">
            Ask
          </button>
        </div>
      </div>
    </div>
  )
}

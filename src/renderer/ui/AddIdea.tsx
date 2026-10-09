import { useState } from 'react'
import { sendCommand } from '../api'

/** The idea bucket: one line in, one idea file out. */
export function AddIdea() {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendCommand({ type: 'addIdea', text: t })
    setText('')
    setSent(true)
    setTimeout(() => setSent(false), 2500)
  }
  return (
    <div className="card" data-testid="add-idea">
      <h3>Idea bucket</h3>
      <div className="row">
        <input
          style={{ flex: 1, minWidth: 0 }}
          value={text}
          placeholder="A book you would like"
          data-testid="idea-text"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="primary" disabled={!text.trim()} onClick={submit} data-testid="idea-add">
          Add
        </button>
      </div>
      <span className="dim">{sent ? 'Added to the bucket.' : 'Your ideas are picked before generated ones.'}</span>
    </div>
  )
}

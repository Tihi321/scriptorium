import { useState } from 'react'

/** One-line warning; a click shows the whole text; the x hides it until a different warning arrives. */
export function WarnStrip({ text }: { text: string | undefined }) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  if (!text || text === dismissed) return null
  return (
    <div className="warn-strip" data-testid="warn-strip" data-open={open}>
      <span className="warn-icon" aria-hidden="true">
        ⚠
      </span>
      <button className="warn-text" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Show one line' : 'Show the full text'}>
        {text}
      </button>
      <button className="ghost warn-x" onClick={() => setDismissed(text)} aria-label="Dismiss warning" data-testid="warn-dismiss">
        ×
      </button>
    </div>
  )
}

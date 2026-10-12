import { useEffect } from 'react'

/**
 * ◀ page picker ▶ for a reader folder, whose `index.html` is the contents and comes before `pages`.
 * The left and right arrow keys turn the page too (not while typing in a field).
 */
export function PageNav({ pages, current, onGo, testId }: { pages: { file: string; title: string }[]; current: string; onGo(file: string): void; testId: string }) {
  const order = ['index.html', ...pages.map((p) => p.file)]
  const at = order.indexOf(current)
  const step = (d: number) => {
    const next = order[at + d]
    if (at >= 0 && next) onGo(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <span className="row page-nav">
      <button onClick={() => step(-1)} disabled={at <= 0} title="Previous page (left arrow)" data-testid={`${testId}-prev`}>
        ◀
      </button>
      <select value={current} onChange={(e) => onGo(e.target.value)} data-testid={`${testId}-page`}>
        <option value="index.html">Contents</option>
        {pages.map((p) => (
          <option key={p.file} value={p.file}>
            {p.title}
          </option>
        ))}
      </select>
      <button onClick={() => step(1)} disabled={at < 0 || at >= order.length - 1} title="Next page (right arrow)" data-testid={`${testId}-next`}>
        ▶
      </button>
    </span>
  )
}

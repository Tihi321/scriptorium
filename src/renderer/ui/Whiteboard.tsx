import { useMemo } from 'react'
import { STAGE_COLUMNS, stageColumn, type BookView } from '../store/model'
import { useAgentList, useOffice } from '../store/hooks'
import { agentsPerBook, officeStore } from '../store/store'

export function Whiteboard() {
  const books = useOffice((s) => s.books)
  const highlight = useOffice((s) => s.highlightBook)
  const agents = useAgentList()
  const perBook = useMemo(() => agentsPerBook(agents), [agents])
  const columns = useMemo(() => {
    const out: Record<string, BookView[]> = {}
    for (const b of Object.values(books)) (out[stageColumn(b.stage)] ??= []).push(b)
    return out
  }, [books])
  const names = [...STAGE_COLUMNS, ...(columns.other ? (['other'] as const) : [])]
  return (
    <div className="card" data-testid="whiteboard">
      <h3>
        Whiteboard <span>{Object.keys(books).length} books</span>
      </h3>
      {names.map((col) => (
        <div className="board-col" key={col}>
          <div className="col-title">
            {col} ({columns[col]?.length ?? 0})
          </div>
          {(columns[col] ?? []).map((b) => (
            <button
              key={b.slug}
              className={`book-chip${highlight === b.slug ? ' active' : ''}`}
              onClick={() => officeStore.getState().toggleHighlightBook(b.slug)}
              title={`${b.title} (${b.stage}). Click to highlight its agents.`}
              data-testid={`book-${b.slug}`}
            >
              <span className="swatch" style={{ background: b.color }} />
              <span className="name">{b.title}</span>
              <span className="dim">{perBook[b.slug] ? `${perBook[b.slug]} on it` : ''}</span>
            </button>
          ))}
        </div>
      ))}
      {highlight && (
        <div className="row spread">
          <button onClick={() => officeStore.getState().setTerminal(true, 'book')}>Book log</button>
          <button onClick={() => officeStore.getState().toggleHighlightBook(null)}>Clear highlight</button>
        </div>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { STAGE_COLUMNS, stageColumn, type BookView } from '../store/model'
import { useAgentList, useOffice } from '../store/hooks'
import { agentsPerBook, officeStore } from '../store/store'
import { sendCommand } from '../api'

const TERMINAL = new Set(['published', 'rejected', 'failed'])

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
              <span className="dim">{b.summary?.paused ? 'paused' : perBook[b.slug] ? `${perBook[b.slug]} on it` : ''}</span>
            </button>
          ))}
        </div>
      ))}
      {highlight && books[highlight] && <BookInfo book={books[highlight]} onIt={perBook[highlight] ?? 0} />}
      {highlight && (
        <div className="row spread wrap">
          <button onClick={() => officeStore.getState().setTerminal(true, 'book')}>Book log</button>
          {books[highlight] && !['published', 'idea', 'new'].includes(books[highlight].stage) && (
            <button onClick={() => officeStore.getState().openDraft(highlight)} title="Read what is written so far, and leave notes for the writers" data-testid="read-draft">
              Read draft
            </button>
          )}
          {books[highlight] && !TERMINAL.has(books[highlight].stage) && (
            <button
              onClick={() => sendCommand({ type: 'pauseBook', book: highlight, paused: !books[highlight]!.summary?.paused })}
              title="Paused: this book's jobs wait and the agents work on the other books. Running jobs finish."
              data-testid="pause-book"
            >
              {books[highlight].summary?.paused ? 'Resume book' : 'Pause book'}
            </button>
          )}
          {books[highlight]?.stage === 'failed' && (
            <button
              onClick={() => sendCommand({ type: 'retryBook', book: highlight })}
              title="Put the failed jobs back in the queue and continue the book"
              data-testid="retry-book"
            >
              Retry
            </button>
          )}
          <button onClick={() => officeStore.getState().toggleHighlightBook(null)}>Clear highlight</button>
        </div>
      )}
    </div>
  )
}

/** Where a highlighted book stands: stage, chapters and words so far, and why it failed. */
function BookInfo({ book, onIt }: { book: BookView; onIt: number }) {
  const agents = useOffice((s) => s.agents)
  const nameOf = (id: string) => agents[id]?.name ?? id
  const b = book.summary
  if (!b) return <div className="dim book-info">{book.title}: {book.stage}</div>
  const pct = (n: number, of: number) => (of > 0 ? ` (${Math.round((n / of) * 100)}%)` : '')
  return (
    <div className="kv book-info" data-testid="book-info">
      <span>Stage</span>
      <span>
        {b.stage}
        {b.round ? `, review round ${b.round}` : ''}
        {b.paused ? ' (paused)' : ''}
      </span>
      <span>Chapters</span>
      <span>{b.chaptersPlanned !== null ? `${b.chaptersWritten} of ${b.chaptersPlanned} written${pct(b.chaptersWritten, b.chaptersPlanned)}` : `${b.chaptersWritten} written, no outline yet`}</span>
      <span>Words</span>
      <span>
        {b.words.toLocaleString('en-US')} of about {b.targetWords.toLocaleString('en-US')}
        {pct(b.words, b.targetWords)}
      </span>
      <span>Format</span>
      <span>{b.format}{b.topic ? `, ${b.topic.name}` : ''}</span>
      {b.author && (
        <>
          <span>Writer</span>
          <span>{b.author}</span>
        </>
      )}
      <span>Agents</span>
      <span>{onIt ? `${onIt} on it now` : 'none right now'}</span>
      <span>Cost</span>
      <span>{b.costUsd.toFixed(3)} USD</span>
      {b.reasons.length > 0 && (
        <>
          <span>{b.stage === 'failed' ? 'Failed' : 'Why'}</span>
          <span className={b.stage === 'failed' ? 'err' : ''}>{b.reasons.join('; ')}</span>
        </>
      )}
      {b.team.length > 0 && (
        <>
          <span>Team</span>
          <span data-testid="book-team">
            {b.team.map((t) => (
              <div key={t.agent} title={`${t.models.join(', ')}; ${t.costUsd.toFixed(3)} USD`}>
                {nameOf(t.agent)} <span className="dim">({t.role.replace(/-/g, ' ')}, {t.jobs} job{t.jobs === 1 ? '' : 's'})</span>
              </div>
            ))}
          </span>
        </>
      )}
      {b.steps.length > 0 && (
        <>
          <span>Last steps</span>
          <span>
            {b.steps.map((st, i) => (
              <div key={i} className="dim" title={st.model}>
                {st.task.replace(/_/g, ' ')}
                {st.unit && st.unit !== 'book' ? ` ${st.unit}` : ''} by {nameOf(st.agent)}
              </div>
            ))}
          </span>
        </>
      )}
    </div>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { files } from '../api'
import { useOffice } from '../store/hooks'
import { formatUsd } from '../store/model'
import { jobToText, jobType, mergeJobs, parseLog, type JobLog } from '../store/logModel'
import { officeStore } from '../store/store'

const PAGE = 40
const OUTPUT_PREVIEW = 6000
const LIVE_TAIL = 24_000
const HISTORY_BYTES = 262_144

function fmtTime(ms: number): string {
  if (!ms) return '--:--:--'
  return new Date(ms).toLocaleTimeString([], { hour12: false })
}

async function loadFullRequest(jobId: string): Promise<string> {
  for (const state of ['running', 'done', 'failed', 'queued']) {
    const text = await files.readFile(`jobs/${state}/${jobId}.md`)
    if (text !== null) return text
  }
  return '(the job file could not be read)'
}

function JobBlock({ job, live }: { job: JobLog; live: boolean }) {
  const [full, setFull] = useState(false)
  const [request, setRequest] = useState<string | null>(null)
  const output = job.output
  const long = output.length > OUTPUT_PREVIEW
  const shown = live
    ? output.length > LIVE_TAIL
      ? '[...]\n' + output.slice(output.length - LIVE_TAIL)
      : output
    : long && !full
      ? output.slice(0, OUTPUT_PREVIEW) + '\n[...]'
      : output
  const running = job.finishedAt === undefined && !job.fromHistory
  const cls = running ? 'running' : job.ok === false ? 'failed' : 'ok'
  return (
    <div className={`job ${cls}`} data-testid="job-block" data-job={job.jobId}>
      <div className="job-head">
        {fmtTime(job.startedAt)} {job.task || '(task)'} {running && <span className="dim">running...</span>}
      </div>
      <div className="job-meta">
        job {job.jobId} | requested by {job.requestedBy ?? (job.fromHistory ? '?' : 'engine')} | {job.agent}
        {job.book ? ` | book ${job.book}` : ''}
        {job.model ? ` | ${job.model}` : ''}
      </div>
      {job.context.length > 0 && (
        <details>
          <summary className="section">
            given: {job.context.length} items, {job.context.reduce((n, c) => n + c.tokens, 0)} tokens
          </summary>
          {job.context.map((c, i) => (
            <div key={i} className="job-meta">
              - {c.name} ({c.tokens} tokens)
            </div>
          ))}
        </details>
      )}
      <div>
        <button onClick={() => (request === null ? void loadFullRequest(job.jobId).then(setRequest) : setRequest(null))} data-testid="expand-request">
          {request === null ? 'Expand full request' : 'Hide full request'}
        </button>
        {request !== null && <pre className="job-meta">{request.length > 30_000 ? request.slice(0, 30_000) + '\n[...]' : request}</pre>}
      </div>
      {shown && <pre className="out">{shown}</pre>}
      {long && !live && !full && <button onClick={() => setFull(true)}>Show all {output.length} characters</button>}
      {job.error ? (
        <pre className="err">error: {job.error}</pre>
      ) : job.result ? (
        <pre className="section">
          result: {job.result}
          {job.destination ? `  -> ${job.destination}` : ''}
        </pre>
      ) : null}
      {(job.tokensIn !== undefined || job.costUsd !== undefined) && (
        <div className="nums">
          {job.model ? `${job.model} | ` : ''}
          {job.tokensIn ?? 0} in / {job.tokensOut ?? 0} out tokens | {formatUsd(job.costUsd ?? 0)}
          {job.seconds !== undefined ? ` | ${job.seconds}s` : job.finishedAt ? ` | ${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s` : ''}
        </div>
      )}
    </div>
  )
}

export function Terminal() {
  const open = useOffice((s) => s.terminalOpen)
  const mode = useOffice((s) => s.terminalMode)
  const selectedAgent = useOffice((s) => s.selectedAgent)
  const highlightBook = useOffice((s) => s.highlightBook)
  const agents = useOffice((s) => s.agents)
  const books = useOffice((s) => s.books)
  const jobs = useOffice((s) => s.jobs)
  const jobsByAgent = useOffice((s) => s.jobsByAgent)
  const jobsByBook = useOffice((s) => s.jobsByBook)

  const [bookPick, setBookPick] = useState('')
  const book = highlightBook ?? bookPick ?? ''
  const agentId = selectedAgent
  const key = mode === 'agent' ? (agentId ? `logs/agents/${agentId}.md` : '') : book ? `books/${book}/log.md` : ''

  const [history, setHistory] = useState<JobLog[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [pages, setPages] = useState(1)
  const [stick, setStick] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setHistory([])
    setLoaded(false)
    setPages(1)
    setStick(true)
    if (!key) return
    void files.tailFile(key, -HISTORY_BYTES).then((r) => {
      if (cancelled) return
      setHistory(r ? parseLog(r.text, agentId ?? '').map((j) => (j.agent ? j : { ...j, agent: agentId ?? '' })) : [])
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [key, agentId])

  const liveIds = mode === 'agent' ? (agentId ? jobsByAgent[agentId] : undefined) : book ? jobsByBook[book] : undefined
  const all = useMemo(() => {
    const live = (liveIds ?? []).map((id) => jobs[id]).filter((j): j is JobLog => !!j)
    return mergeJobs(history, live)
  }, [history, liveIds, jobs])

  const types = useMemo(() => [...new Set(all.map((j) => jobType(j.task)).filter(Boolean))], [all])
  const bookSlugs = useMemo(() => [...new Set(all.map((j) => j.book).filter((b): b is string => !!b))], [all])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((j) => (!bookFilter || j.book === bookFilter) && (!typeFilter || jobType(j.task) === typeFilter) && (!q || jobToText(j).toLowerCase().includes(q)))
  }, [all, query, bookFilter, typeFilter])
  const visible = filtered.slice(Math.max(0, filtered.length - pages * PAGE))

  // auto-scroll to the bottom unless the user scrolled up
  const lastLen = visible.length ? visible[visible.length - 1]!.output.length : 0
  useLayoutEffect(() => {
    const el = logRef.current
    if (el && stick) el.scrollTop = el.scrollHeight
  }, [visible.length, lastLen, stick, open])

  const onScroll = useCallback(() => {
    const el = logRef.current
    if (!el) return
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }, [])

  const copy = () => {
    const text = filtered.map(jobToText).join('\n\n')
    void navigator.clipboard?.writeText(text).catch(() => undefined)
  }

  if (!open) return null
  const title = mode === 'agent' ? (agentId ? (agents[agentId]?.name ?? agentId) : 'no agent selected') : book ? (books[book]?.title ?? book) : 'no book selected'
  return (
    <div className="terminal" data-testid="terminal">
      <div className="terminal-bar">
        <span className="tabs row">
          <button className={mode === 'agent' ? 'on' : ''} onClick={() => officeStore.getState().setTerminal(true, 'agent')} data-testid="tab-agent">
            Agent
          </button>
          <button className={mode === 'book' ? 'on' : ''} onClick={() => officeStore.getState().setTerminal(true, 'book')} data-testid="tab-book">
            Book
          </button>
        </span>
        <b data-testid="terminal-title">{title}</b>
        {mode === 'book' && !highlightBook && (
          <select value={bookPick} onChange={(e) => setBookPick(e.target.value)}>
            <option value="">pick a book</option>
            {Object.values(books).map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="terminal-search" />
        <select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)} title="Filter by book">
          <option value="">all books</option>
          {bookSlugs.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Filter by job type">
          <option value="">all job types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button onClick={copy} data-testid="terminal-copy">
          Copy
        </button>
        <span className="dim">
          {filtered.length} jobs{!loaded && key ? ', loading history...' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => officeStore.getState().setTerminal(false)} data-testid="terminal-close">
          Close
        </button>
      </div>
      <div className="log" ref={logRef} onScroll={onScroll} data-testid="terminal-log">
        {filtered.length > visible.length && <button onClick={() => setPages((p) => p + 1)}>Show {Math.min(PAGE, filtered.length - visible.length)} earlier jobs</button>}
        {visible.length === 0 && <div className="empty">{key ? 'Nothing logged yet. Live output appears here.' : 'Click an agent in the office, or a book on the whiteboard.'}</div>}
        {visible.map((j, i) => (
          <JobBlock key={j.jobId} job={j} live={i === visible.length - 1 && j.finishedAt === undefined} />
        ))}
        {!stick && (
          <button
            className="jump"
            onClick={() => {
              setStick(true)
            }}
          >
            Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}

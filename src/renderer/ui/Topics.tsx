import { useMemo, useState } from 'react'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'
import { groupTopics } from '../store/shelves'

/**
 * The topic overview in the library: a tick box per topic (it edits `topics.md` through `setTopicActive`),
 * grouped by section, the emptiest first, with done / target and the books in progress. A filter box finds a topic
 * in the 400 or so rows.
 */
export function TopicOverview() {
  const topics = useOffice((s) => s.topics)
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupTopics(topics, { query, activeOnly }), [topics, query, activeOnly])
  const activeCount = topics.filter((t) => t.active).length
  const done = topics.reduce((n, t) => n + t.done, 0)
  const inProgress = topics.reduce((n, t) => n + t.inProgress, 0)
  const shown = groups.reduce((n, g) => n + g.topics.length, 0)
  return (
    <aside className="topic-list card" data-testid="topic-list">
      <h3>Topics, emptiest first</h3>
      <div className="row">
        <input style={{ flex: 1, minWidth: 0 }} value={query} placeholder="Filter topics" data-testid="topic-filter" onChange={(e) => setQuery(e.target.value)} />
        <label className="row dim" title="Only topics that are switched on">
          <input type="checkbox" checked={activeOnly} data-testid="topic-active-only" onChange={(e) => setActiveOnly(e.target.checked)} />
          on
        </label>
      </div>
      <div className="dim" data-testid="topic-summary">
        {activeCount} of {topics.length} on, {done} done, {inProgress} in progress{query || activeOnly ? `, ${shown} shown` : ''}. Each row: done/target.
      </div>
      {groups.length === 0 && <div className="empty">{topics.length === 0 ? 'No topics yet.' : 'No topic matches.'}</div>}
      {groups.map((g) => {
        const open = toggled[g.section] ?? g.open
        return (
          <section className="topic-group" key={g.section} data-testid={`topic-section-${g.section}`}>
            <button className="topic-group-head" aria-expanded={open} onClick={() => setToggled({ ...toggled, [g.section]: !open })}>
              <span>{open ? '▾' : '▸'}</span>
              <b>{g.section}</b>
              <span className="dim">
                {g.active ? `${g.active} on, ` : ''}
                {g.done}/{g.target}
                {g.inProgress ? ` +${g.inProgress}` : ''}
              </span>
            </button>
            {open &&
              g.topics.map((t) => (
                <label className="topic-row" key={t.id} title={`${t.section} / ${t.kind}${t.target ? '' : ' (no limit)'}`}>
                  <input type="checkbox" checked={t.active} data-testid={`topic-${t.id}`} onChange={(e) => sendCommand({ type: 'setTopicActive', id: t.id, active: e.target.checked })} />
                  <span className="name">{t.name}</span>
                  <span className="dim" data-testid={`topic-count-${t.id}`}>
                    {t.done}/{t.target || '∞'}
                    {t.inProgress ? ` +${t.inProgress}` : ''}
                  </span>
                </label>
              ))}
          </section>
        )
      })}
    </aside>
  )
}

import type { LibraryFilter, TypeGroup } from '../store/bookTypes'
import { TYPE_GROUPS, filterActive, typeCounts } from '../store/bookTypes'
import type { BookSummary } from '../../shared/protocol'

interface Props {
  books: BookSummary[]
  filter: LibraryFilter
  groupBy: 'topic' | 'type'
  published: number
  shelves: number
  sideOpen: boolean
  onFilter(patch: Partial<LibraryFilter>): void
  onGroupBy(v: 'topic' | 'type'): void
  onToggleSide(): void
}

/** The Library's header: title and counts, search, Group by, the side column toggle, and the type chips. */
export function LibraryToolbar({ books, filter, groupBy, published, shelves, sideOpen, onFilter, onGroupBy, onToggleSide }: Props) {
  const counts = typeCounts(books, filter)
  const chip = (id: TypeGroup | 'all', label: string, n: number) => {
    const selected = filter.group === id
    if (n === 0 && !selected && id !== 'all') return null
    return (
      <button key={id} className={`lib-chip${selected ? ' on' : ''}`} aria-pressed={selected} onClick={() => onFilter({ group: id })} data-testid={`type-chip-${id}`}>
        {label} <span className="lib-chip-n">{n}</span>
      </button>
    )
  }
  return (
    <div className="lib-toolbar">
      <div className="lib-toolbar-top">
        <h2 className="lib-title">Library</h2>
        <span className="dim" data-testid="library-counts">
          {published} published, {shelves} {shelves === 1 ? 'shelf' : 'shelves'}
        </span>
        <span className="lib-spacer" />
        <input
          type="search"
          className="lib-search"
          placeholder="Search titles, authors"
          aria-label="Search titles and authors"
          value={filter.query}
          onChange={(e) => onFilter({ query: e.target.value })}
          data-testid="library-search"
        />
        <div className="lib-segment" role="group" aria-label="Group by">
          <span className="dim">Group by</span>
          <button className={groupBy === 'topic' ? 'on' : ''} aria-pressed={groupBy === 'topic'} onClick={() => onGroupBy('topic')} data-testid="group-by-topic">
            Topic
          </button>
          <button className={groupBy === 'type' ? 'on' : ''} aria-pressed={groupBy === 'type'} onClick={() => onGroupBy('type')} data-testid="group-by-type">
            Type
          </button>
        </div>
        <button className={`lib-side-toggle${sideOpen ? ' on' : ''}`} aria-pressed={sideOpen} onClick={onToggleSide} data-testid="library-side-toggle">
          Topics &amp; series
        </button>
      </div>
      <div className="lib-chips" role="group" aria-label="Filter by type">
        {chip('all', 'All', counts.all)}
        {TYPE_GROUPS.map((g) => chip(g.id, g.label, counts[g.id]))}
        {(counts.choices > 0 || filter.choices) && (
          <>
            <span className="lib-divider" aria-hidden="true" />
            <button className={`lib-chip choices${filter.choices ? ' on' : ''}`} aria-pressed={filter.choices} onClick={() => onFilter({ choices: !filter.choices })} data-testid="choices-toggle">
              With choices <span className="lib-chip-n">{counts.choices}</span>
            </button>
          </>
        )}
        {filterActive(filter) && (
          <button className="lib-clear-inline" onClick={() => onFilter({ group: 'all', choices: false, query: '' })}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

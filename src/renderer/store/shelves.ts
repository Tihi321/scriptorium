import type { BookSummary, TopicSummary } from '../../shared/protocol'

export interface Shelf {
  id: string
  name: string
  topic: TopicSummary | null
  books: BookSummary[]
}

/** The newspaper articles among these books (medium `article`). The Library shows none of them: they have their own tab. */
export const newspaperArticles = (books: BookSummary[]): BookSummary[] => books.filter((b) => b.medium === 'article')

/** Articles that are not published (being written, rejected or failed), newest started first is not known: in the order given. */
export const openArticles = (articles: BookSummary[]): BookSummary[] => articles.filter((a) => a.stage !== 'published')

export interface FrontPageDay {
  /** `YYYY-MM-DD` (UTC). */
  day: string
  sections: { name: string; articles: BookSummary[] }[]
}

/**
 * The front page: the published articles by day (newest day first), and inside a day by section (A to Z, "Other" last), newest article first.
 * An article with no publication time is left out.
 */
export function frontPage(articles: BookSummary[]): FrontPageDay[] {
  const byDay = new Map<string, Map<string, BookSummary[]>>()
  for (const a of articles) {
    if (a.stage !== 'published' || !a.publishedAt) continue
    const day = a.publishedAt.slice(0, 10)
    const section = a.topic?.name ?? 'Other'
    const sections = byDay.get(day) ?? new Map<string, BookSummary[]>()
    sections.set(section, [...(sections.get(section) ?? []), a])
    byDay.set(day, sections)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, sections]) => ({
      day,
      sections: [...sections.entries()]
        .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
        .map(([name, list]) => ({ name, articles: [...list].sort((x, y) => (y.publishedAt ?? '').localeCompare(x.publishedAt ?? '')) }))
    }))
}

/** Published books per topic (articles are not books: they are left out). Shelves exist for active topics and for topics that have books. */
export function buildShelves(topics: TopicSummary[], books: BookSummary[]): Shelf[] {
  const published = books.filter((b) => b.stage === 'published' && b.medium !== 'article')
  const byTopic = new Map<string, BookSummary[]>()
  for (const b of published) {
    const id = b.topic?.id ?? '_other'
    byTopic.set(id, [...(byTopic.get(id) ?? []), b])
  }
  const shelves: Shelf[] = []
  for (const t of topics) {
    // the newspaper sections have no shelf: their articles are on the Newspaper tab
    if (t.kind === 'article') {
      byTopic.delete(t.id)
      continue
    }
    const list = byTopic.get(t.id) ?? []
    if (t.active || list.length) shelves.push({ id: t.id, name: t.name, topic: t, books: list })
    byTopic.delete(t.id)
  }
  // books whose topic is not in topics.md any more
  for (const [id, list] of byTopic) shelves.push({ id, name: id === '_other' ? 'Other' : (list[0]?.topic?.name ?? id), topic: null, books: list })
  return shelves
}

/** Topics with the emptiest first (fewest finished books against the target). */
export function emptiestFirst(topics: TopicSummary[]): TopicSummary[] {
  const ratio = (t: TopicSummary) => (t.target > 0 ? t.done / t.target : t.done > 0 ? 1 : 0.999)
  return [...topics].sort((a, b) => ratio(a) - ratio(b) || a.name.localeCompare(b.name))
}

export interface TopicGroup {
  section: string
  topics: TopicSummary[]
  /** Topics of the section that are switched on, books done and wanted, books in progress (of the topics shown). */
  active: number
  done: number
  target: number
  inProgress: number
  /** Opens by default: a filter is set, or the section has a topic that is on or has books. */
  open: boolean
}

const fillOf = (t: TopicSummary) => (t.target > 0 ? t.done / t.target : t.done > 0 ? 1 : 0.999)

/**
 * The topic overview: topics grouped by section. Inside a section the emptiest topic comes first, and the emptiest
 * sections (the lowest mean fill) come first. `query` keeps topics whose name, section, kind or id contain every word of it.
 */
export function groupTopics(topics: TopicSummary[], opts: { query?: string; activeOnly?: boolean } = {}): TopicGroup[] {
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const shown = topics.filter((t) => {
    if (opts.activeOnly && !t.active) return false
    const hay = `${t.name} ${t.section} ${t.kind} ${t.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const order: string[] = []
  const bySection = new Map<string, TopicSummary[]>()
  for (const t of shown) {
    if (!bySection.has(t.section)) {
      bySection.set(t.section, [])
      order.push(t.section)
    }
    bySection.get(t.section)!.push(t)
  }
  const groups = order.map((section): TopicGroup & { fill: number } => {
    const list = emptiestFirst(bySection.get(section)!)
    return {
      section,
      topics: list,
      active: list.filter((t) => t.active).length,
      done: list.reduce((n, t) => n + t.done, 0),
      target: list.reduce((n, t) => n + t.target, 0),
      inProgress: list.reduce((n, t) => n + t.inProgress, 0),
      open: words.length > 0 || list.some((t) => t.active || t.done > 0 || t.inProgress > 0),
      fill: list.reduce((n, t) => n + fillOf(t), 0) / list.length
    }
  })
  const index = new Map(order.map((s, i) => [s, i]))
  groups.sort((a, b) => a.fill - b.fill || index.get(a.section)! - index.get(b.section)!)
  return groups.map(({ fill: _fill, ...g }) => g)
}

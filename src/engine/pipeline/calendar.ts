import type { Bible } from '../memory/bible'
import type { BookStore } from './books'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A weekday or month as written: the full name or its first three letters (Sept too). Case does not matter for weekdays; months start with a capital. */
const weekdayIndex = (w: string): number => WEEKDAYS.findIndex((d) => d.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3)
const monthIndex = (m: string): number => {
  if (!/^[A-Z]/.test(m)) return -1
  const lower = m.toLowerCase().replace(/\.$/, '')
  return MONTHS.findIndex((x) => x.toLowerCase() === lower || (lower.length >= 3 && x.toLowerCase().startsWith(lower.slice(0, 3)) && (lower.length === 3 || lower === 'sept')))
}

const WD = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?'
const MO = '[A-Z][a-z]{2,8}\\.?'
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?'
/** "Saturday 24 October 2026", "Sat, 24 Oct", "24th of October". */
const DAY_MONTH = new RegExp(`(?:\\b(${WD}),?\\s+)?\\b${DAY}\\s+(?:of\\s+)?(${MO})(?:,?\\s+(\\d{4})\\b)?`, 'g')
/** "Saturday, October 24, 2026", "Oct 24". */
const MONTH_DAY = new RegExp(`(?:\\b(${WD}),?\\s+)?\\b(${MO})\\s+${DAY}\\b(?:,?\\s+(\\d{4})\\b)?`, 'g')

export interface DateMention {
  /** The text as written, with its weekday when it had one. */
  said: string
  day: number
  /** 0 to 11. */
  month: number
  year?: number
  /** 0 (Sunday) to 6, when the text names a weekday. */
  weekday?: number
}

/** The dates a text names with a month (day-month and month-day, with an optional weekday and year). A bare number or month is not one. */
export function datesIn(text: string): DateMention[] {
  const out: DateMention[] = []
  const seen = new Set<number>()
  const add = (m: RegExpExecArray, parts: { wd?: string; day: string; month: string; year?: string }) => {
    const month = monthIndex(parts.month)
    const day = Number(parts.day)
    if (month < 0 || day < 1 || day > 31 || seen.has(m.index)) return
    seen.add(m.index)
    const weekday = parts.wd ? weekdayIndex(parts.wd) : -1
    out.push({ said: m[0].trim(), day, month, ...(parts.year ? { year: Number(parts.year) } : {}), ...(weekday >= 0 ? { weekday } : {}) })
  }
  for (const m of text.matchAll(DAY_MONTH)) add(m as RegExpExecArray, { wd: m[1], day: m[2]!, month: m[3]!, year: m[4] })
  for (const m of text.matchAll(MONTH_DAY)) add(m as RegExpExecArray, { wd: m[1], month: m[2]!, day: m[3]!, year: m[4] })
  return out
}

/** The weekday of a date in the proleptic Gregorian calendar ("Saturday"). `month` is 1 to 12. */
export function weekdayOf(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!
}

export interface WeekdaySlip {
  said: string
  date: string
  actual: string
}

/** The dates of a text whose weekday is wrong. A date with no year of its own is taken in `year`. */
export function weekdayMismatches(text: string, year: number): WeekdaySlip[] {
  const out: WeekdaySlip[] = []
  for (const d of datesIn(text)) {
    if (d.weekday === undefined) continue
    const y = d.year ?? year
    const actual = weekdayOf(y, d.month + 1, d.day)
    if (WEEKDAYS[d.weekday] !== actual) out.push({ said: d.said, date: `${d.day} ${MONTHS[d.month]} ${y}`, actual })
  }
  return out
}

/**
 * The year a story is set in: `story_year` of book.md when it is set, else the year (1000 to 2999) that the book's own texts name
 * most often (the brief's setting, the bible's setting and style, the pitch, the timeline), else null.
 */
export function storyYear(book: { story_year?: unknown }, texts: string[]): number | null {
  if (typeof book.story_year === 'number' && Number.isInteger(book.story_year)) return book.story_year
  const count = new Map<number, number>()
  for (const t of texts) for (const m of t.matchAll(/\b([12]\d{3})\b/g)) count.set(Number(m[1]), (count.get(Number(m[1])) ?? 0) + 1)
  let best: number | null = null
  for (const [y, n] of count) if (best === null || n > count.get(best)! || (n === count.get(best)! && y > best)) best = y
  return best
}

const SERIES_CANON = 'Facts that come from the earlier books of the series (the series section) are canon: never report them as contradictions.'

/**
 * A block for a prompt: the story's year and the weekday of every date the text names (at most 30), the weekday slips the engine found,
 * and the rule that notes about weekdays, dates or years must agree with it. Without a year it says not to report them as errors.
 */
export function calendarSection(year: number | null, text: string): string {
  if (year === null) {
    return `## The story's calendar\nThe story's year is not stated: do not report a weekday or a count of years as an error unless the text contradicts itself. ${SERIES_CANON}`
  }
  const seen = new Set<string>()
  const days: string[] = []
  for (const d of datesIn(text)) {
    const y = d.year ?? year
    const key = `${d.day}-${d.month}-${y}`
    if (seen.has(key) || days.length >= 30) continue
    seen.add(key)
    days.push(`${d.day} ${MONTHS[d.month]}${d.year ? ` ${d.year}` : ''} = ${weekdayOf(y, d.month + 1, d.day)}`)
  }
  const slips = weekdayMismatches(text, year)
  return [
    `## The story's calendar`,
    `The story is set in ${year} (from the book's own files). Do not assume the current year.${days.length ? ` The dates this text names fall on: ${days.join(', ')}.` : ''}` +
      (slips.length ? ` The engine found these weekday slips in the text: ${slips.map((s) => `"${s.said}" (${s.date} is a ${s.actual})`).join('; ')}.` : ''),
    `A note about a weekday, a date or a count of years must agree with this calendar. ${SERIES_CANON}`
  ].join('\n')
}

/** The year of a book's story, from `story_year` or from the texts that set the scene. */
export async function storyYearOf(d: { books: BookStore; bible: Bible }, slug: string): Promise<number | null> {
  const book = (await d.books.read(slug))?.data
  if (!book) return null
  if (typeof book.story_year === 'number') return book.story_year
  const brief = await d.books.brief(slug)
  const texts = [brief?.setting ?? '', (await d.books.pitch(slug)) ?? '', await d.bible.style(slug), await d.books.bible(slug), (await d.books.readText(slug, 'bible', 'timeline.md')) ?? '']
  return storyYear(book, texts)
}

/** `calendarSection` for a book and the text a prompt is about. */
export async function calendarFor(d: { books: BookStore; bible: Bible }, slug: string, text: string): Promise<string> {
  return calendarSection(await storyYearOf(d, slug), text)
}

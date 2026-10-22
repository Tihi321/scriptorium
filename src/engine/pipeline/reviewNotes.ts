import type { ZodType } from 'zod'
import type { ChatMessage } from '../models/types'
import type { JobContext } from '../queue/scheduler'
import { chatJson } from './llm'
import type { JsonResult } from './llm'
import { appendToPrompt, loadPrompt } from './prompts'

/** Added to a reviewer prompt that an older data folder still has without the `problems` field (the seed prompts have it). */
export const PROBLEMS_RULE = `Besides "notes", give "problems": a list of strings, one for every concrete finding: where it is (the chapter and a short quote), what is wrong, and what to change. It is required when the verdict is "revise", so the writer gets every finding. "chapters" holds chapter numbers only, as plain numbers; put the details in "problems".`

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const text = (o: Obj, ...keys: string[]): string => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** The chapter number an object names (`chapter`, `n`, `ch` or `number`; a number or a numeric string), or undefined. */
function chapterOf(o: Obj): number | undefined {
  for (const k of ['chapter', 'n', 'ch', 'number']) {
    const v = o[k]
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** One finding written as an object by a model, as a line of text: `Chapter 11: <issue> Quote: "..." Established: "..." Fix: ...`. */
export function problemText(o: Obj): string {
  const ch = chapterOf(o)
  const issue = text(o, 'issue', 'problem', 'description', 'text', 'type', 'kind')
  const quote = text(o, 'quote', 'quote_new', 'quote_chapter')
  const established = text(o, 'quote_established', 'quote_bible')
  const fix = text(o, 'fix', 'suggestion', 'change')
  const body = [issue, quote ? `Quote: "${quote}"` : '', established ? `Established: "${established}"` : '', fix ? `Fix: ${fix}` : ''].filter(Boolean).join(' ')
  if (!body) return ''
  return ch === undefined ? body : `Chapter ${ch}: ${body}`
}

/**
 * A reviewer's JSON before it is checked: models put the itemised findings into `chapters` as objects instead of numbers, and a repair
 * round then drops them. Here each object becomes its chapter number plus a line in `problems`, a numeric string becomes a number, and
 * objects in `problems` become strings. Anything else is left for the schema to judge.
 */
export function normalizeReviewJson(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const out: Obj = { ...raw }
  const problems: string[] = []
  const take = (item: unknown) => {
    if (typeof item === 'string') {
      if (item.trim()) problems.push(item.trim())
    } else if (isObj(item)) {
      const t = problemText(item)
      if (t) problems.push(t)
    }
  }
  if (Array.isArray(raw.problems)) raw.problems.forEach(take)
  else if (typeof raw.problems === 'string') take(raw.problems)
  if (Array.isArray(raw.chapters)) {
    const numbers: number[] = []
    for (const item of raw.chapters) {
      if (typeof item === 'number') numbers.push(item)
      else if (typeof item === 'string' && /^\s*\d+\s*$/.test(item)) numbers.push(Number(item))
      else if (isObj(item)) {
        const n = chapterOf(item)
        if (n !== undefined) numbers.push(n)
        const t = problemText(item)
        if (t) problems.push(t)
      }
    }
    out.chapters = [...new Set(numbers)]
  }
  if (problems.length || 'problems' in raw) out.problems = problems
  return out
}

const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+\S/

/**
 * Why a "revise" has no usable notes, or null when it has. A revise must say what to change: notes that are too short, that promise a list
 * ("three fixes below") and give none or fewer, or that stop in the middle of a sentence, are not enough, unless `problems` carries the findings.
 */
export function notesProblem(verdict: string, notes: string, problems: string[]): string | null {
  if (verdict !== 'revise') return null
  const n = notes.trim()
  const lines = n.split('\n')
  const items = lines.filter((l) => LIST_ITEM.test(l)).length
  const total = items + problems.length
  if (n.length < 40 && problems.length === 0) return 'the notes are too short to say what to change'
  if ((/\b(below|as follows|the following|here are)\b/i.test(n) || /:\s*$/.test(n)) && total === 0) return 'the notes promise a list of fixes but give none'
  const promised = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:[\w-]+\s+){0,2}(?:fixes|problems|issues|changes|points|items|concerns|errors|slips)\b/i.exec(n)
  if (promised) {
    const count = COUNTS[promised[1]!.toLowerCase()] ?? Number(promised[1])
    if (count >= 2 && count <= 10 && count > total) return `the notes promise ${count} items but give ${total}`
  }
  const last = lines.filter((l) => l.trim()).pop() ?? ''
  if (problems.length === 0 && !LIST_ITEM.test(last) && !/[.!?"'”’)\]]$/.test(n)) return 'the notes stop in the middle of a sentence'
  return null
}

/** The body of a review file: the notes, then every problem as a numbered item. */
export function reviewBody(notes: string, problems: string[]): string {
  const body = notes.trim()
  if (!problems.length) return body
  return `${body}\n\n## Problems\n\n${problems.map((p, i) => `${i + 1}. ${p.replace(/\s*\n\s*/g, ' ')}`).join('\n')}`
}

/** A reviewer prompt from an older data folder has no `problems` field: the engine's own rule is added to it. */
export async function ensureProblemsRule(dataDir: string, messages: ChatMessage[], role: string, task: string): Promise<void> {
  if (!(await loadPrompt(dataDir, role, task)).raw.includes('"problems"')) appendToPrompt(messages, PROBLEMS_RULE)
}

export interface NotesCheck<T> {
  /** The verdict that counts (a revise with good scores is a pass: no notes are needed then). */
  effective: (value: T) => string
  notes: (value: T) => string
  problems: (value: T) => string[]
  /** Another attempt of the job is left (the job is retried when the notes are still unusable). */
  retryLeft: boolean
  maxTokens?: number
}

/**
 * Makes sure a revise says what to change. When the notes are unusable (see `notesProblem`) the model is asked once more in the same job,
 * with its first answer in the conversation; when they still are, the job fails (so it runs again) unless this was its last attempt,
 * which keeps what there is and logs a warning: a book never fails over this.
 */
export async function withUsableNotes<T>(ctx: JobContext, messages: ChatMessage[], schema: ZodType<T>, first: JsonResult<T>, check: NotesCheck<T>): Promise<JsonResult<T>> {
  const reason = check.effective(first.value) === 'revise' ? notesProblem('revise', check.notes(first.value), check.problems(first.value)) : null
  if (!reason) return first
  ctx.log(`the check said revise without usable notes (${reason}): asking again`)
  const follow: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: first.chat.text.slice(0, 6000) },
    {
      role: 'user',
      content: `Your verdict is revise, but ${reason}. Reply again with the whole JSON object: the same verdict and scores, and every problem in "problems", one item each: where it is (chapter and a short quote), what is wrong, and what to change.`
    }
  ]
  const second = await chatJson(ctx, follow, schema, { maxTokens: check.maxTokens, temperature: 0.2, normalize: normalizeReviewJson })
  const again = check.effective(second.value) === 'revise' ? notesProblem('revise', check.notes(second.value), check.problems(second.value)) : null
  const merged: JsonResult<T> = { ...second, cost: first.cost + second.cost }
  if (!again) return merged
  if (check.retryLeft) throw new Error(`the check said revise without usable notes: ${again}`)
  ctx.log(`warning: the check said revise without usable notes (${again}); kept as it is, this was the last attempt`)
  return merged
}

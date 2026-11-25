// The idea fable (SCP-71): one chapter that holds a story, then back matter (a debrief, a three-question quiz, the sources, a Go deeper list and a
// fixed closing line). These pure functions split the chapter, read the owner's concept card from the brief, check what the writer made of the back
// matter and write the parts the engine owns (sources, Go deeper, closing line) so the model never writes them.
import type { StoryBrief } from '../../shared/brief'

/** The line that starts the back matter of an idea fable. */
export const FABLE_BACK_HEADING = '## What just happened'
/** The fixed closing line (REQ-0033, word for word). Written by the engine only; never put it in a prompt. */
export const FABLE_DISCLAIMER = 'This story is original fiction. It is not a summary of these books and is not affiliated with or endorsed by their authors or publishers.'

const QUIZ_HEADING = '## Quiz'
const ANSWERS_HEADING = '### Answers'
const DEEPER_HEADING = '## Go deeper'
// what a model may write of its own in place of the engine's blocks: `**Sources**`, `**Sources:**`, `## Sources`, `### Sources`, `## Go Deeper`, `**Go deeper.**` ...
const SOURCES_RE = /^(\*\*sources[.:]?\*\*[.:]?|#{1,6}\s*sources[.:]?)\s*$/i
// bold Sources label followed on the same line by a list marker, `[1]`, a URL, or a colon (inside or after the bold) and a citation; `**Sources** of stress pile up [2].` is a debrief sentence and does not match
const INLINE_SOURCES_RE = /^\*\*sources([.:]?)\*\*([.:]?)[ \t]*(.*)$/i
const isInlineSources = (line: string): boolean => {
  const m = INLINE_SOURCES_RE.exec(line)
  if (!m || !m[3]) return false
  return m[1] === ':' || m[2] === ':' || /^(\d+[.)]\s|\[\d)/.test(m[3]) || /http/i.test(m[3])
}
const DEEPER_RE =/^(\*\*go deeper[.:]?\*\*[.:]?|#{1,6}\s*go deeper[.:]?)\s*$/i
const LEAD_INS =['**The idea.**', '**Where it showed up.**', '**How to use it tomorrow.**']

const lf = (s: string): string => s.replace(/\r\n?/g, '\n')
const paragraphs = (s: string): string[] => lf(s).split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
const firstLine = (p: string): string => p.split('\n', 1)[0]!.trim()

/** The story and the back matter of a chapter: split at the first line that is exactly `## What just happened` (trailing spaces allowed). `back` is '' when there is none; it starts with the heading. Both trimmed. */
export function splitFable(body: string): { story: string; back: string } {
  const text = lf(body)
  const m = /^## What just happened[ \t]*$/m.exec(text)
  if (!m) return { story: text.trim(), back: '' }
  return { story: text.slice(0, m.index).trim(), back: text.slice(m.index).trim() }
}

/** True when the first non-blank line of the text is exactly `## What just happened` (trailing spaces allowed): a reply that holds only back matter. */
export const startsWithFableBack = (text: string): boolean => /^## What just happened[ \t]*$/.test(lf(text).trimStart().split('\n', 1)[0]!)

/** The story part (the whole text when there is no back matter). */
export const storyPart = (body: string): string => splitFable(body).story

/** Story + back matter, one blank line between. */
export function joinFable(story: string, back: string): string {
  const s = story.trim()
  const b = back.trim()
  return b ? `${s}\n\n${b}` : s
}

export interface FableCard {
  card: string
  keyFacts: string[]
  sources: string[]
  books: string[]
}

/** The card of the owner's brief: the lines of the sections named (case-insensitive) "Key facts", "Sources" and "Go deeper" (non-empty lines, trimmed, list numbering "1. " kept as written); `card` is the text of the "Concept card" section. Missing sections give empty arrays / ''. */
export function fableCard(brief: StoryBrief | null): FableCard {
  const sections = brief?.sections ?? []
  const named = (name: string) => sections.filter((s) => s.heading.trim().toLowerCase() === name).map((s) => s.text).join('\n')
  const lines = (name: string) => lf(named(name)).split('\n').map((l) => l.trim()).filter(Boolean)
  return { card: named('concept card').trim(), keyFacts: lines('key facts'), sources: lines('sources'), books: lines('go deeper') }
}

/** The model's part of a back matter: the paragraphs from the heading through the quiz answers, without a Sources paragraph, a Go deeper section (and anything after it) or the closing line. */
function modelParagraphs(back: string): string[] {
  const out: string[] = []
  let inSources = false
  for (const p of paragraphs(back)) {
    const first = firstLine(p)
    if (DEEPER_RE.test(first)) break
    if (SOURCES_RE.test(first)) {
      inSources = true
      continue
    }
    // a one-line Sources paragraph with the citation on the same line: `**Sources:** Adams et al.`, `**Sources** [1] ...`, `**Sources** 1. ...`, `**Sources** https://...`
    if (isInlineSources(first)) {
      inSources = false
      continue
    }
    // the numbered list of a Sources heading written on a line of its own
    if (inSources && /^\d+[.)]\s/.test(first)) continue
    inSources = false
    const kept = p.split('\n').filter((l) => l.trim() !== FABLE_DISCLAIMER).join('\n').trim()
    if (kept) out.push(kept)
  }
  return out
}

/** The back matter as published: the model's part (from the heading through the quiz answers) with any `**Sources**` paragraph, any `## Go deeper` section and anything after it, and any line equal to FABLE_DISCLAIMER removed; then the Sources paragraph inserted before `## Quiz` and the Go deeper section plus FABLE_DISCLAIMER appended, both from the card. Idempotent: assembling an assembled back matter gives the same text. With no back matter returns ''. With an empty `sources` or `books` the matching block is left out (the disclaimer is always added when there is back matter). */
export function assembleFableBack(back: string, card: FableCard): string {
  if (!back.trim()) return ''
  const parts = modelParagraphs(back)
  if (card.sources.length) {
    const numbered = card.sources.map((s, i) => (/^\d+[.)]\s/.test(s) ? s : `${i + 1}. ${s}`))
    const block = `**Sources**\n${numbered.join('\n')}`
    const at = parts.findIndex((p) => firstLine(p) === QUIZ_HEADING)
    if (at >= 0) parts.splice(at, 0, block)
    else parts.push(block)
  }
  if (card.books.length) parts.push(DEEPER_HEADING, card.books.join('\n'))
  parts.push(FABLE_DISCLAIMER)
  return parts.join('\n\n')
}

/** What is wrong with a back matter (the model's part; engine-owned blocks are ignored), as short English lines; [] when it is fine. */
export function fableBackProblems(back: string, card: FableCard): string[] {
  const parts = modelParagraphs(back)
  if (!parts.length || firstLine(parts[0]!) !== FABLE_BACK_HEADING) return ['no back matter (## What just happened)']
  const problems: string[] = []
  const quizAt = parts.findIndex((p) => firstLine(p) === QUIZ_HEADING)
  const answersAt = parts.findIndex((p) => firstLine(p) === ANSWERS_HEADING)
  const debrief = parts.slice(1, quizAt >= 0 ? quizAt : parts.length).join('\n\n')

  // 2. the three lead-ins, in order
  const at = LEAD_INS.map((l) => debrief.indexOf(l))
  LEAD_INS.forEach((l, i) => {
    if (at[i]! < 0) problems.push(`the debrief has no ${l} paragraph`)
  })
  if (at.every((x) => x >= 0) && !(at[0]! < at[1]! && at[1]! < at[2]!)) problems.push('the debrief lead-ins are not in the order The idea, Where it showed up, How to use it tomorrow')

  // 3. key-fact references
  const refs = (text: string) => [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
  const total = card.keyFacts.length
  if (total === 0) problems.push('the brief has no Key facts section')
  else {
    if (refs(debrief).length === 0) problems.push('the debrief cites no key fact like [1]')
    for (const n of [...new Set(refs(parts.join('\n\n')))]) if (n < 1 || n > total) problems.push(`[${n}] is not a key fact of the card (it has ${total})`)
  }

  // 4. the quiz
  if (quizAt < 0) problems.push('no ## Quiz section')
  else {
    const lines = parts.slice(quizAt + 1, answersAt > quizAt ? answersAt : parts.length).join('\n').split('\n').map((l) => l.trim()).filter(Boolean)
    const blocks: string[][] = []
    for (const l of lines) {
      if (/^\*\*\d+\./.test(l)) blocks.push([l])
      else if (blocks.length) blocks[blocks.length - 1]!.push(l)
      else problems.push('the quiz has a line before its first question')
    }
    if (blocks.length !== 3) problems.push(`the quiz has ${blocks.length} questions (it needs exactly 3)`)
    blocks.slice(0, 3).forEach((b, i) => {
      const q = i + 1
      if (!new RegExp(`^\\*\\*${q}\\. .+\\*\\*$`).test(b[0]!)) problems.push(`question ${q} must be a bold line like **${q}. text**`)
      const opts = b.slice(1)
      if (opts.length !== 4 || !opts.every((o, k) => new RegExp(`^${'ABCD'[k]}\\) .+`).test(o))) problems.push(`question ${q} needs exactly four options A) B) C) D), one per line`)
    })
  }

  // 5. the answers
  if (answersAt < 0) problems.push('no ### Answers section')
  else {
    const ans = parts.slice(answersAt + 1)
    const nums = ans.map((p) => /^([1-3])\. ([A-D])\. .+/s.exec(p)?.[1])
    if (ans.length !== 3 || nums.some((x) => !x) || new Set(nums).size !== 3) problems.push('### Answers needs exactly 3 paragraphs like "1. B. why", one per question')
  }
  return problems
}

/** Appended to every reviewer prompt of a fable. */
export const FABLE_REVIEW_NOTE =
  'This book is an idea fable. Its chapter is a story, then back matter from the heading "What just happened" on: a short debrief, a three-question quiz with answers, the sources, a Go deeper list of real books and a fixed closing line. The back matter belongs to the format: do not ask to remove, shorten or merge it into the story, and do not count the books it names as imitation. Judge the story for your area. In the back matter flag only a fact that is not one of the key facts of the owner\'s Concept card (the owner\'s story brief below has them), a quiz answer marked wrong, or a debrief that describes a moment the story does not have.'

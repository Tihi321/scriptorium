/**
 * Prompt leaks: a model (Claude over the client queue, mostly) sometimes ends a chapter with the instructions it was given, word for word.
 * The instruction lines of a prompt are collected here, an answer is searched for them, and a leak at the very end is cut off.
 */

/** At most this many instruction lines are kept for one prompt. */
const MAX_LINES = 80
/** A line shorter than this is too common to count as an instruction. */
const MIN_LENGTH = 40
/** After a leak, a line this short (a stray heading, a blank-ish fragment) does not stop the tail from being cut. */
const SHORT_LINE = 25

/** The text as compared: lower case, no markdown emphasis, single spaces. */
const normalize = (s: string): string => s.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

/** The sentences of a text with no variable in them, long enough to be an instruction. */
function sentencesOf(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      if (part.includes('\u0000')) continue
      const n = normalize(part)
      if (n.length >= MIN_LENGTH) out.push(n)
    }
  }
  return out
}

/**
 * The lines of a prompt template that the engine fixed (no `{{variable}}` in them), and the first two instruction paragraphs of every
 * section it appended, as normalised sentences. At most 80, without duplicates.
 */
export function instructionLines(templateBody: string, appended: string[] = []): string[] {
  const rendered = templateBody.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '\u0000')
  const lines = [...sentencesOf(rendered)]
  for (const section of appended) {
    // the first two paragraphs that hold an instruction (a paragraph of only variables, like {{ways_in}}, is not one)
    let taken = 0
    for (const paragraph of section.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)) {
      const found = sentencesOf(paragraph)
      if (found.length === 0) continue
      lines.push(...found)
      if (++taken >= 2) break
    }
  }
  return [...new Set(lines)].slice(0, MAX_LINES)
}

/** The instruction lines that are found in the answer (normalised). Empty for a clean answer. */
export function findLeaks(answer: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  const text = normalize(answer)
  return lines.filter((l) => text.includes(l))
}

/**
 * Cuts a leak off the end of an answer: from the earliest line that holds an instruction line, when everything after it is leak
 * or short. Returns the answer unchanged (`cut: false`) when it has no leak, and null when a leak sits in the middle of the text.
 */
export function stripTrailingLeak(answer: string, lines: string[]): { text: string; cut: boolean } | null {
  if (findLeaks(answer, lines).length === 0) return { text: answer, cut: false }
  const rows = answer.split('\n')
  const leaky = rows.map((r) => r.trim() !== '' && findLeaks(r, lines).length > 0)
  for (let i = 0; i < rows.length; i++) {
    if (!leaky[i]) continue
    let tail = true
    for (let k = i + 1; k < rows.length; k++) {
      const t = rows[k]!.trim()
      if (t && !leaky[k] && t.length >= SHORT_LINE) {
        tail = false
        break
      }
    }
    if (!tail) continue
    const text = rows.slice(0, i).join('\n').trimEnd()
    // a leak left in the text before the tail is a leak in the middle
    return findLeaks(text, lines).length > 0 ? null : { text, cut: true }
  }
  return null
}

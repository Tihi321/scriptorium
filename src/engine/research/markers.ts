/**
 * `[RESEARCH: question]` markers: the way a writer on any model asks for a fact while writing ("mark and keep going").
 * The engine turns each marker into a research job, and a fix-up job later replaces the marked sentence.
 */

export interface Marker {
  /** The marker as written. */
  raw: string
  question: string
  /** Position of the marker in the text. */
  index: number
}

const markerRe = () => /\[RESEARCH:\s*([^\]\n]{3,300}?)\s*\]/gi

export function findMarkers(text: string): Marker[] {
  return [...text.matchAll(markerRe())].map((m) => ({ raw: m[0], question: m[1]!.trim(), index: m.index! }))
}

export const hasMarkers = (text: string): boolean => markerRe().test(text)

/** Removes every marker (and the space before it) and leaves the sentence as written. The last resort when no fix is available. */
export function stripMarkers(text: string): string {
  return text.replace(/[ \t]*\[RESEARCH:\s*[^\]\n]{3,300}?\s*\]/gi, '').replace(/[ \t]+\n/g, '\n')
}

const isEnd = (c: string | undefined) => c === '.' || c === '!' || c === '?'

function sentenceStart(text: string, pos: number): number {
  for (let i = pos; i > 0; i--) {
    if (text[i - 1] === '\n') return i
    if (isEnd(text[i - 1]) && /\s/.test(text[i] ?? '')) {
      let j = i
      while (j < text.length && /[ \t]/.test(text[j]!)) j++
      return j
    }
  }
  return 0
}

function sentenceEnd(text: string, pos: number): number {
  for (let i = pos; i < text.length; i++) {
    if (text[i] === '\n') return i
    if (isEnd(text[i]) && (i + 1 >= text.length || /[\s"'”)]/.test(text[i + 1]!))) {
      let j = i + 1
      while (j < text.length && /["'”)]/.test(text[j]!)) j++
      return j
    }
  }
  return text.length
}

/**
 * The span of text a marker is about: the sentence before it when the marker follows a finished sentence
 * ("It took three weeks. [RESEARCH: ...]"), else the sentence it sits in. The span includes the marker.
 */
export function markerSpan(text: string, m: Marker): { start: number; end: number } {
  const before = text.slice(0, m.index)
  const trimmed = before.replace(/[ \t]+$/, '')
  const afterMarker = m.index + m.raw.length
  if (trimmed.length > 0 && !trimmed.endsWith('\n') && /[.!?"'”)]$/.test(trimmed)) {
    return { start: sentenceStart(text, Math.max(0, trimmed.length - 1)), end: afterMarker }
  }
  return { start: sentenceStart(text, m.index), end: Math.max(afterMarker, sentenceEnd(text, afterMarker)) }
}

/** The text of the span, for the fix-up prompt. */
export function markerSentence(text: string, m: Marker): string {
  const { start, end } = markerSpan(text, m)
  return text.slice(start, end).trim()
}

/**
 * Replaces the marked sentence of each marker with the corrected sentence. `fixes` is keyed by the marker's position in the text (0 first).
 * A marker without a usable fix is only removed, so the text never keeps a marker. Returns the new text and how many sentences were replaced.
 */
export function applyMarkerFixes(text: string, fixes: Map<number, string>): { text: string; replaced: number } {
  let out = text
  let replaced = 0
  const total = findMarkers(text).length
  // from the last marker to the first, so earlier positions stay valid
  for (let i = total - 1; i >= 0; i--) {
    const ms = findMarkers(out)
    const m = ms[i]
    if (!m) continue
    const fix = fixes.get(i)?.replace(/\[RESEARCH:[^\]]*\]/gi, '').trim()
    if (fix && fix.length >= 8) {
      const { start, end } = markerSpan(out, m)
      out = out.slice(0, start) + fix + out.slice(end)
      replaced++
    } else {
      out = out.slice(0, m.index).replace(/[ \t]+$/, '') + out.slice(m.index + m.raw.length)
    }
  }
  return { text: stripMarkers(out), replaced }
}

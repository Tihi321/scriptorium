import { analyzeRepetition } from '../memory/repetition'
import { findMarkers } from '../research/markers'
import type { Scheduler } from '../queue/scheduler'
import { CAST, LINE, SCENE } from '../publish/xhtml'
import { pad2, countWords } from './books'
import { cleanProse } from './llm'
import { instructionLines, stripTrailingLeak } from './leak'
import { buildMessages } from './prompts'
import { bibleFor } from './nfcontext'
import { settleScenePlaces } from './scriptPlaces'
import { formatVars, recordMade, Run, stripLeadingHeading, storyBriefSection, unitNumber, variant } from './handlers'
import type { PipelineDeps } from './handlers'

/** The humanized chapter may differ from the original by this share of its words (either way), else the original is kept. */
export const HUMANIZE_WORD_TOLERANCE = 0.1

/** The humanized chapter is refused when its share of verbless fragments rose by more than this, and by half again or more. */
export const FRAGMENT_RISE = 0.08

/** Phrases and habits that make prose read as machine-written. `min`: how often it has to occur in one chapter to be worth a mention. */
const TELLS: { label: string; re: RegExp; min: number }[] = [
  { label: '"for a long time" / "for a long moment" / "a long moment"', re: /\b(for )?a long (time|moment|while|beat)\b/gi, min: 1 },
  { label: 'sentences that open with "It was"', re: /(^|[.!?]["”']?\s+)It was\b/g, min: 2 },
  { label: '"did not look / say / answer ..." negation beats', re: /\b(did not|didn't|didn’t|does not|doesn't) (look|say|answer|speak|move|turn|reply|respond|flinch|blink)\b/gi, min: 2 },
  { label: '"not X, but Y" / "it was not X. It was Y" reversals', re: /\b(?:was|is|were) not [^.!?]{3,60}[.;,] (?:it|she|he|they) (?:was|were|is)\b|\bnot (?:just|only|merely) [^.!?]{3,60}, but\b/gi, min: 1 },
  { label: '"a testament to"', re: /\ba testament to\b/gi, min: 1 },
  { label: '"tapestry"', re: /\btapestr(?:y|ies)\b/gi, min: 1 },
  { label: '"little did"', re: /\blittle did (?:he|she|they|we|i|you)\b/gi, min: 1 },
  { label: '"the weight of"', re: /\bthe weight of\b/gi, min: 1 },
  { label: '"a mixture / symphony / dance of ..."', re: /\ba (?:symphony|dance|mixture|whirlwind|kaleidoscope|cacophony) of\b/gi, min: 1 },
  { label: '"something like" / "something in his/her/their ..." vagueness', re: /\bsomething (?:like|in (?:his|her|their|the))\b/gi, min: 2 },
  { label: 'em dashes', re: /—|\s--\s/g, min: 4 },
  { label: 'rows of three ("A, B, and C")', re: /\b[\p{L}'-]+, [\p{L}'-]+,? and [\p{L}'-]+\b/gu, min: 3 },
  { label: 'a moral or a neat lesson to end on', re: /\b(?:and )?(?:she|he|they|we|i) (?:knew|understood|realized|realised|learned) (?:that )?(?:[^.!?]{0,40})?(?:would never be the same|was (?:enough|home)|(?:had|have) always been)\b|\bthat (?:was|is) what (?:really )?mattered\b/gi, min: 1 }
]

export interface TellCount {
  label: string
  count: number
  /** A few of the places, as the text has them. */
  examples: string[]
}

/** The machine-prose habits found in one chapter (only the ones that occur often enough to matter). */
export function aiTells(text: string): TellCount[] {
  const out: TellCount[] = []
  for (const t of TELLS) {
    const found = [...text.matchAll(t.re)]
    if (found.length < t.min) continue
    const examples = found.slice(0, 3).map((m) => {
      const at = m.index ?? 0
      return text.slice(Math.max(0, at - 30), at + m[0].length + 40).replace(/\s+/g, ' ').trim()
    })
    out.push({ label: t.label, count: found.length, examples })
  }
  return out
}

/**
 * What the script found in chapter `n`: repeated phrases, openers and gesture tics (the repetition counter, over the chapters
 * up to this one, keeping what touches this chapter) and the machine-prose habits of this chapter. Says so when it found nothing.
 */
export function ticReport(chapters: { n: number; text: string }[], n: number): string {
  const so = chapters.filter((c) => c.n <= n)
  const rep = analyzeRepetition(so.length ? so : chapters)
  const touches = (c: { chapters: number[] }) => c.chapters.includes(n)
  const line = (kind: string, c: { text: string; count: number; chapters: number[] }) => `- ${kind} "${c.text}": ${c.count} times so far${c.chapters.length > 1 ? `, also in chapter ${c.chapters.filter((x) => x !== n).join(', ')}` : ''}`
  const lines = [
    ...rep.phrases.filter(touches).map((c) => line('repeated phrase', c)),
    ...rep.openers.filter(touches).map((c) => line('repeated sentence opening', c)),
    ...rep.gestures.filter(touches).map((c) => line('gesture tic', c)),
    ...aiTells(so.find((c) => c.n === n)?.text ?? '').map((t) => `- ${t.label}: ${t.count} time(s), for example: ${t.examples.map((e) => `"${e}"`).join(' / ')}`)
  ]
  return lines.length ? lines.join('\n') : '(the script found nothing that stands out. Look for the habits in the list above yourself.)'
}

/** The structure of a visual novel script: how many scene lines, on-screen lines and spoken lines, and who speaks, in order. */
export function scriptStructure(text: string): { scenes: number; cast: number; speakers: string[] } {
  let scenes = 0
  let cast = 0
  const speakers: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,6}\s+/.test(line) || SCENE.test(line)) scenes++
    else if (CAST.test(line)) cast++
    else {
      const m = LINE.exec(line)
      if (m && !/^(scene|on screen)$/i.test(m[1]!.trim())) speakers.push(m[1]!.trim())
    }
  }
  return { scenes, cast, speakers }
}

const citations = (text: string) => (text.match(/\[\d+\]/g) ?? []).sort().join('')

/** The numbers and years of a text (digits, with a decimal or thousands part), without the source numbers [n]. */
export function numberTokens(text: string): Set<string> {
  return new Set(text.replace(/\[\d+\]/g, ' ').match(/\d+(?:[.,]\d+)*/g) ?? [])
}

const NAME_WORD = /\p{Lu}[\p{L}\p{M}'’-]*/gu

/** Units and abbreviations that are written with a capital and are not names ("50 Hz", "3 GHz", "12 MW"). */
const UNITS = new Set(['Hz', 'MHz', 'GHz', 'THz', 'MW', 'GW', 'TW', 'Wh', 'Ah', 'Pa', 'MPa', 'GPa', 'GB', 'MB', 'KB', 'TB', 'Mbps', 'Gbps', 'Kbps'])

const nameKey = (w: string) => w.toLowerCase().replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, '')

/**
 * Capitalised words of `text` that are new: not at the start of a sentence (or a line, or a quotation), and, in lower case without
 * a possessive 's, not a word of `known` (the original chapter and the bible). A sentence's first word is skipped because every
 * word is capitalised there, so a new name that opens a sentence is only found when it is followed by another capitalised word
 * ("Captain Rourke": Rourke is checked).
 */
export function newNames(text: string, known: string): string[] {
  const have = new Set((known.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) ?? []).map(nameKey))
  const out: string[] = []
  for (const m of text.matchAll(NAME_WORD)) {
    const at = m.index ?? 0
    const before = text.slice(0, at).replace(/[ \t]+$/, '')
    const lead = before === '' || /[\n.!?…:;"“”‘'’([—-]$/.test(before)
    if (lead) continue
    const w = m[0]
    if (w.length < 2) continue // "I"
    // a unit or an abbreviation next to a number is not a name ("50 Hz", "the hum at 50 Hz")
    if (UNITS.has(w) || /\d[\d.,]*\s*$/.test(before)) continue
    const key = nameKey(w)
    if (key && !have.has(key) && !out.includes(w)) out.push(w)
  }
  return out
}

const AUXILIARIES = new Set(
  'is are was were be been being am has have had do does did can could will would shall should may might must'.split(' ')
)
/** Irregular past tenses and common verbs that carry a sentence without an `-ed` ending. */
const COMMON_VERBS = new Set(
  'said ran went saw took came made knew felt found heard left held told thought stood sat got gave kept began fell grew lay met put rose slept spoke swam threw woke wrote brought caught drew drove flew hid hung lost paid rode rang sang sent shook shut sank spent struck taught tore understood won'.split(' ')
)

/** The sentence has a verb cue: an auxiliary or a modal, a past tense, a pronoun followed by a word, or a name followed by a word ending in -s. */
function hasVerbCue(sentence: string): boolean {
  const words = sentence.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.some((w) => AUXILIARIES.has(w) || COMMON_VERBS.has(w) || (w.length > 3 && w.endsWith('ed')))) return true
  if (/\b(?:i|you|he|she|it|we|they)\s+[\p{L}']+/iu.test(sentence)) return true
  return /\b\p{Lu}[\p{Ll}]+\s+[\p{Ll}]{2,}s\b/u.test(sentence)
}

/**
 * The share of the narration's sentences that are fragments: three words or fewer, or with no verb cue. Speech inside quotes is left out,
 * and so are the SCENE, ON SCREEN and speaker lines of a script (only its narration lines count).
 */
export function fragmentShare(text: string, script = false): number {
  let narration = text.replace(/\r\n/g, '\n')
  if (script) {
    narration = narration
      .split('\n')
      .filter((l) => {
        const line = l.trim()
        if (!line || /^#{1,6}\s/.test(line) || /^(\*\s*){3,}$|^-{3,}$/.test(line) || SCENE.test(line) || CAST.test(line)) return false
        const m = LINE.exec(line)
        return !(m && !/^(scene|on screen)$/i.test(m[1]!.trim()))
      })
      .join('\n')
  } else {
    narration = narration.replace(/"[^"\n]*"|\u201c[^\u201d]*\u201d/g, ' ')
  }
  const sentences = narration
    .split(/(?<=[.!?\u2026])["\u201d')\]]*\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s))
  if (sentences.length === 0) return 0
  const fragments = sentences.filter((s) => (s.match(/[\p{L}\p{N}']+/gu) ?? []).length <= 3 || !hasVerbCue(s)).length
  return fragments / sentences.length
}

const ENGLISH_WORDS = new Set(
  ('the and of to a in is was he she it you that not for on with as his her had have but they at be this from or by are were we i what when there all would their said an so if out up one about who them then no will my me him could into just over than been do did does its your more some how now only can like back down off after before where why which here still even too very because through while again never our us these those any much own other both each every such until though during without between against under around once away must should might may am has'
  ).split(' ')
)
const FOREIGN_WORDS = new Set(
  'le la les des est je vous pas que et une dans pour avec nous elle el los las es y por con para pero del der die das und ist nicht ich ein eine mit von auf il che non di per sono della nel'.split(' ')
)

/** The share of English function words among the words of a text (0 for a text with no words). */
export function englishShare(text: string): number {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  return words.length ? words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length : 0
}

/** The lines of six or more words that are not English: almost no English function word, and two or more French, Spanish, German or Italian ones. */
export function foreignLines(text: string): number {
  let n = 0
  for (const line of text.split('\n')) {
    const words = line.toLowerCase().match(/[\p{L}']+/gu) ?? []
    if (words.length < 6) continue
    const english = words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length
    const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length
    if (english < 0.1 && foreign >= 2) n++
  }
  return n
}

/**
 * Why a humanized chapter can't replace the original, or null when it can: a different length (over the tolerance), a lost
 * `[RESEARCH: ...]` marker, a script whose scene, on-screen or speaker lines changed, or non-fiction whose source numbers changed. 
 * Also (SCP-13): more em dashes than the original, a number or year lost or added, a capitalised name that is neither in the original nor in the bible.
 */
export function humanizeProblem(original: string, revised: string, opts: { script?: boolean; nonfiction?: boolean; /** The bible's text: the names in it are known too. */ bible?: string } = {}): string | null {
  const before = countWords(original)
  const after = countWords(revised)
  if (after < 20) return `the answer is only ${after} words`
  if (after < before * (1 - HUMANIZE_WORD_TOLERANCE) || after > before * (1 + HUMANIZE_WORD_TOLERANCE)) {
    return `${after} words against ${before} (more than ${HUMANIZE_WORD_TOLERANCE * 100}% different)`
  }
  const marks = (t: string) => findMarkers(t).map((m) => m.question).sort().join('|')
  if (marks(original) !== marks(revised)) return 'a [RESEARCH: ...] marker was changed or lost'
  const dashes = (t: string) => (t.match(/—/g) ?? []).length
  if (dashes(revised) > dashes(original)) return `it added em dashes (${dashes(original)} before, ${dashes(revised)} after)`
  const nums = numberTokens(original)
  const nums2 = numberTokens(revised)
  const lost = [...nums].filter((x) => !nums2.has(x))
  const added = [...nums2].filter((x) => !nums.has(x))
  if (lost.length || added.length) return `the numbers changed (${[...lost.map((x) => `lost ${x}`), ...added.map((x) => `added ${x}`)].slice(0, 6).join(', ')})`
  const fresh = newNames(revised, `${original}\n${opts.bible ?? ''}`)
  if (fresh.length) return `it brought in a name that is not in the chapter or the bible (${fresh.slice(0, 5).join(', ')})`
  // SCP-14: a version that broke sentences into verbless fragments, or changed the language of lines, is not livelier, only worse
  const frag0 = fragmentShare(original, opts.script)
  const frag1 = fragmentShare(revised, opts.script)
  if (frag1 - frag0 > FRAGMENT_RISE && frag1 > frag0 * 1.5) return `it broke sentences into fragments (${Math.round(frag0 * 100)}% before, ${Math.round(frag1 * 100)}% after)`
  const foreign0 = foreignLines(original)
  const foreign1 = foreignLines(revised)
  const english0 = englishShare(original)
  if (foreign1 > foreign0 || (english0 > 0 && englishShare(revised) < english0 * 0.7)) return `it changed the language of ${Math.max(1, foreign1 - foreign0)} line(s)`
  if (opts.script) {
    const a = scriptStructure(original)
    const b = scriptStructure(revised)
    if (a.scenes !== b.scenes || a.cast !== b.cast || a.speakers.length !== b.speakers.length || a.speakers.join('|') !== b.speakers.join('|')) {
      return `the script lines changed (scenes ${a.scenes} to ${b.scenes}, on-screen lines ${a.cast} to ${b.cast}, speaker lines ${a.speakers.length} to ${b.speakers.length})`
    }
  }
  if (opts.nonfiction && citations(original) !== citations(revised)) return 'the source numbers [n] changed'
  return null
}

/**
 * The humanizer: one job per chapter, after the chapter is drafted (and again after a rewrite round). It rewrites the
 * whole chapter so it reads like a person wrote it, and keeps the story. `humanized` in the chapter file records the round;
 * `round` stays as it is (like the research fix-up). Article formats get their own `_article` prompt through `variant`.
 */
export function registerHumanizerHandlers(sched: Scheduler, d: PipelineDeps): void {
  sched.register('humanize_chapter', async (ctx) => {
    const run = new Run(ctx)
    const slug = ctx.job.book!
    const n = unitNumber(ctx.job.unit)
    const book = (await d.books.read(slug))!.data
    const fmt = d.getFormats().find((f) => f.id === book.format)
    if (!fmt) throw new Error(`unknown format ${book.format} (see config/formats.md)`)
    const chapters = await d.books.chapters(slug)
    const current = chapters.find((c) => c.n === n)
    if (!current) throw new Error(`chapter ${n} does not exist`)

    // the bible's style and voices (a long book: the style and a short digest of every entry; a short book: the whole bible)
    let bible: string
    if (fmt.nonfiction) bible = await bibleFor(d, slug, true)
    else if (fmt.long) bible = [await d.bible.style(slug), await d.bible.digest(slug)].filter(Boolean).join('\n\n')
    else bible = await d.books.bible(slug)
    const prev = chapters.find((c) => c.n === n - 1)
    const previousEnding = prev ? prev.body.slice(-1500) : ''
    const vars = {
      title: book.title,
      chapter_n: n,
      chapter_title: current.title,
      chapter_text: current.body,
      chapter_words: current.words,
      bible: bible || '(no bible: keep the voice the chapter already has)',
      tics: ticReport(chapters.map((c) => ({ n: c.n, text: c.body })), n),
      previous_ending: previousEnding ? `How the previous chapter ended (for the voice only, do not write it again):\n${previousEnding}` : '',
      ...formatVars(fmt, book.target_words)
    }
    const { messages, version, template } = await buildMessages(d.dataDir, ctx, 'humanizer', variant(fmt, 'humanize_chapter'), vars)
    run.version = version
    const owner = await storyBriefSection(d, slug)
    if (owner) messages[messages.length - 1]!.content += `\n\n${owner}`
    const r = await run.chat({ messages, maxTokens: Math.max(4000, current.words * 6), temperature: 0.8 })
    let revised = stripLeadingHeading(cleanProse(r.text))
    // a model that ends with the instructions it was given: the tail is cut, a leak in the middle refuses the version
    const forbid = instructionLines(template)
    const leak = stripTrailingLeak(revised, forbid)
    let leakProblem: string | null = null
    if (!leak) leakProblem = 'it repeats the task instructions in the middle of the text'
    else if (leak.cut) {
      ctx.log(`humanizer: the answer ended with the task instructions: cut off`)
      revised = leak.text
    }
    const problem = leakProblem ?? humanizeProblem(current.body, revised, { script: !!fmt.script, nonfiction: !!fmt.nonfiction, bible })
    if (problem) ctx.log(`humanizer: chapter ${n} kept as it was: ${problem}`)
    let body = problem ? current.body : revised
    // a script keeps the bible's names for its SCENE places (the humanizer may have worded one differently), and a place the bible lacks is added to it
    if (!problem && fmt.script) body = await settleScenePlaces(d, slug, n, body, (m) => ctx.log(`humanizer: ${m}`))
    // the round is the chapter's own (it stays), `humanized` says in which book round the pass ran: a pass that was refused counts too, so it is not asked again
    await d.books.writeChapter(slug, {
      n,
      title: current.title,
      round: current.round,
      body,
      agent: current.agent, // the writer stays the writer of the chapter; the humanizer's work is in made.md
      model: problem ? undefined : r.model.ref,
      fixes: current.fixes,
      humanized: ctx.job.round
    })
    await recordMade(d, slug, run)
    return {
      result: problem ? `chapter ${n} kept as it was (${problem})` : `chapter ${n} humanized: ${countWords(current.body)} to ${countWords(body)} words`,
      resultPath: `books/${slug}/chapters/ch-${pad2(n)}.md`
    }
  })
}

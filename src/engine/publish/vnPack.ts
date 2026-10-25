import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { parsePuzzleEntries } from '../../shared/puzzles'
import type { PuzzleEntry } from '../../shared/puzzles'
import type { BookStore, OutlineChapter } from '../pipeline/books'
import { checkBranches, isBranching } from '../pipeline/branches'
import { clueIdsOf, puzzleProblems, puzzlesOf } from '../pipeline/puzzles'
import { moveTrailingCues } from '../pipeline/scriptPlaces'
import { entryKey, sameName } from '../memory/bible'
import { atomicWrite } from '../store/atomic'
import { parseLightBible, parseScript } from './script'
import type { ScriptScene } from './script'
import { uniqueVnKey, vnKey } from './vnKey'

/**
 * The VN pack compiler (HUB-16 contract; `docs/visual-novel.md` "The VN pack (v2)").
 *
 * A visual-novel book folder gets two files:
 * - `vn/pack.json`: the language-independent template (keys, looks, scene and cue descriptions, branch targets, puzzle cores). Never translated.
 * - `vn/text/<lang>.json`: the source catalog, the only translatable document (title, titles, names, line and narration text, puzzle prose).
 *
 * The IDs are VN Studio's (contract §3) and the script grammar is Scriptorium's own (`parseScript`): this module only walks its scenes and
 * beats, it does not parse scripts again. Nothing here calls a model; an unknown speaker or place gets a synthetic key and a warning, never a
 * failed book.
 */

// ---- the template (vn/pack.json) --------------------------------------------------------------------------------------

export type PackKind = 'linear' | 'choice'

/** A picture cue: `display` full or insert, the untranslated description, and optionally the asset key (an `EVIDENCE:` item). */
export interface PackImageCue {
  display: 'full' | 'insert'
  text: string
  key?: string
}

interface BeatCues {
  /** Omitted: unchanged. Null: hide the picture. */
  image?: PackImageCue | null
  sfx?: { text: string }
  /** Omitted: unchanged. Null: stop the ambience. */
  ambience?: { text: string } | null
}

export interface PackCastEntry {
  charKey: string
  look?: string
}

export type PackBeat =
  | ({ id: string; type: 'cast'; cast: PackCastEntry[] } & BeatCues)
  | ({ id: string; type: 'line'; speakerKey: string; expression: string; aliasKey?: string } & BeatCues)
  | ({ id: string; type: 'narration' } & BeatCues)
  | ({ id: string; type: 'puzzle'; puzzle: string } & BeatCues)

type BeatDraft = PackBeat extends infer B ? (B extends PackBeat ? Omit<B, 'id'> : never) : never

export interface PackScene {
  id: string
  /** The bible place's key, or null when the place is not in the bible (VN Studio then derives the background from `placeText`). */
  placeKey: string | null
  placeText: string
  time: string | null
  /** The background prompt material: the narration right after `SCENE:` plus the place's looks. Never translated. */
  description: string
  breakBefore: boolean
  beats: PackBeat[]
}

export interface PackChapter {
  n: number
  isEnding: boolean
  choices: { index: number; to: number }[]
  scenes: PackScene[]
}

export interface PackCharacter {
  key: string
  looks: string
  voice?: string
  aliasKeys: string[]
}

export interface PackPlace {
  key: string
  name: string
  looks: string
}

export interface PackPuzzleLink {
  type: 'character' | 'place' | 'image'
  key: string
}

/** A puzzle of the template: the core unchanged, its links and where each clue is found. The names and prose live in the catalog. */
export interface PackPuzzle {
  key: string
  kind: string
  data?: Record<string, unknown>
  chapter?: number
  clueAt?: Record<string, string>
  links?: Record<string, PackPuzzleLink>
  onFail?: Record<string, unknown>
  hints?: boolean
  verified?: Record<string, unknown>
}

export interface VnPack {
  format: 'vn-pack'
  version: 2
  packHash: string
  book: {
    slug: string
    format: string
    kind: PackKind
    primaryLang: string
    genre: string
    style: string
    author: string
    coverBrief: string
    sourceHash: string
  }
  characters: PackCharacter[]
  places: PackPlace[]
  chapters: PackChapter[]
  puzzles: PackPuzzle[]
}

// ---- the catalog (vn/text/<lang>.json) ---------------------------------------------------------------------------------

export interface VnTextPuzzle {
  names: Record<string, string>
  text: Record<string, string>
}

export interface VnTextCatalog {
  format: 'vn-text'
  version: 2
  lang: string
  packHash: string
  title: string
  blurb?: string
  chapterTitles: Record<string, string>
  sceneTitles: Record<string, string>
  choiceTexts: Record<string, string>
  endings: Record<string, string>
  characterNames: Record<string, string>
  beats: Record<string, string>
  puzzles?: Record<string, VnTextPuzzle>
}

// ---- input and results -------------------------------------------------------------------------------------------------

export interface VnPackSource {
  /** Path below the book folder, forward slashes (`chapters/ch-01.md`). */
  relpath: string
  text: string
}

export interface VnPackChapterInput {
  n: number
  title: string
  body: string
}

export interface VnPackInput {
  slug: string
  title: string
  author?: string | null
  genre?: string | null
  format: string
  blurb?: string | null
  coverBrief?: string | null
  primaryLang?: string
  bible: string
  outline: { chapters: OutlineChapter[] } | null
  chapters: VnPackChapterInput[]
  puzzles: PuzzleEntry[]
  /** The authored files, in the order of the contract's `sourceHash` (`book.md`, `outline.md`, ...). */
  sources: VnPackSource[]
}

export interface CompileResult {
  pack: VnPack
  text: VnTextCatalog
  warnings: string[]
  sourceHash: string
}

/** A pack that cannot be written: a catalog value would be empty, or the book is not a visual novel. */
export class VnPackError extends Error {}

// ---- hashes (contract §2) ----------------------------------------------------------------------------------------------

/** JSON with object keys sorted at every depth, arrays in order, no whitespace: the bytes `packHash` is taken over. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) as string
  if (Array.isArray(value)) return `[${value.map((x) => canonicalJson(x)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`
}

const sha256 = (data: string): string => `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`

/** SHA-256 of the canonical JSON of the pack without its `packHash`. */
export function packHashOf(pack: Omit<VnPack, 'packHash'> & { packHash?: string }): string {
  const { packHash: _packHash, ...rest } = pack
  void _packHash
  return sha256(canonicalJson(rest))
}

/** SHA-256 over the authored files, each as `relpath + "\0" + bytes + "\0"`, in the order given (contract §2). */
export function sourceHashOf(sources: VnPackSource[]): string {
  const h = createHash('sha256')
  for (const s of sources) {
    h.update(s.relpath, 'utf8')
    h.update('\0', 'utf8')
    h.update(s.text, 'utf8')
    h.update('\0', 'utf8')
  }
  return `sha256:${h.digest('hex')}`
}

// ---- helpers -----------------------------------------------------------------------------------------------------------

/** One line, no runs of whitespace, no edges: the shape of every catalog value (contract §5). */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const pad3 = (n: number) => String(n).padStart(3, '0')
export const sceneIdOf = (chapter: number, index: number) => `ch${pad2(chapter)}.s${pad2(index)}`
export const beatIdOf = (scene: string, index: number) => `${scene}.b${pad3(index)}`

const firstNumber = (name: string): number => {
  const m = /\d+/.exec(name)
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER
}

interface CharInfo {
  key: string
  name: string
  aliases: string[]
}

interface PlaceInfo {
  key: string
  name: string
  looks: string
}

// ---- the compiler ------------------------------------------------------------------------------------------------------

interface ClueRef {
  puzzle: string
  clue: string
  text: string
  draft: BeatDraft
}

interface EvidenceRef {
  key: string
  imageKey: string
  draft: BeatDraft
}

interface PuzzleRef {
  key: string
  draft: BeatDraft
}

interface TestimonyBlock {
  witness: string
  statements: { speaker: string; text: string }[]
}

interface SceneBuild {
  drafts: BeatDraft[]
  texts: (string | undefined)[]
  clues: ClueRef[]
  evidence: EvidenceRef[]
  puzzles: PuzzleRef[]
  testimonies: TestimonyBlock[]
  breakSeen: boolean
}

interface BuildContext {
  chapter: number
  warnings: string[]
  /** A speaker line's character key: an unknown label gets a synthetic speaker. */
  resolveCharKey(label: string): string
  /** An `ON SCREEN:` entry's character key, or null for a prop, a page, a crowd or a sentence (dropped, never synthesized). */
  knownCharKey(label: string): string | null
  /** The alias key (`petra#1`) of an alias as the bible writes it, when a speaker line was spoken under it (contract §4). */
  aliasKeyOf(alias: string): string | undefined
}

/**
 * Compiles a book folder's authored files into the pack and its source catalog. Pure: no disk, no model. The callers
 * (`vnPackFromFolder`, `vnPackFromBook`) read the files and pass them here.
 */
export function compileVnPack(input: VnPackInput): CompileResult {
  const warnings: string[] = []
  const lang = singleLine(input.primaryLang ?? '') || 'en'
  const bible = parseLightBible(input.bible)
  const sourceHash = sourceHashOf(input.sources)

  // ---- characters (contract §3: `vnKey`, collisions `_2` in bible order and a warning, aliases `<key>#<n>`) ----
  const usedCharKeys = new Set<string>()
  const packChars: PackCharacter[] = []
  const chars: CharInfo[] = []
  const characterNames: Record<string, string> = {}
  const aliasNames: Record<string, string> = {}
  /** The alias key of an alias as written (`the girl` -> `petra#1`), for the speaker lines spoken under it. */
  const aliasKeyByText = new Map<string, string>()
  for (const c of bible.characters) {
    const { key, collision } = uniqueVnKey(c.name, usedCharKeys)
    if (collision) warnings.push(`two bible characters give the key "${vnKey(c.name)}": the later one is "${key}"`)
    const aliasKeys = c.aliases.map((alias, i) => {
      const aliasKey = `${key}#${i + 1}`
      aliasNames[aliasKey] = singleLine(alias)
      aliasKeyByText.set(entryKey(alias), aliasKey)
      return aliasKey
    })
    chars.push({ key, name: c.name, aliases: c.aliases })
    characterNames[key] = c.name
    for (const aliasKey of aliasKeys) characterNames[aliasKey] = aliasNames[aliasKey]!
    packChars.push({ key, looks: c.looks, ...(singleLine(c.voice) ? { voice: singleLine(c.voice) } : {}), aliasKeys })
  }

  const syntheticChars: PackCharacter[] = []
  const syntheticCharByName = new Map<string, string>()
  const syntheticCharNames = new Map<string, string>()
  const charByName = (name: string): CharInfo | null => {
    const k = entryKey(name)
    return (
      chars.find((c) => entryKey(c.name) === k) ??
      chars.find((c) => c.key === k || c.key === vnKey(name)) ??
      (() => {
        const same = chars.filter((c) => sameName(c.name, name))
        return same.length === 1 ? same[0]! : null
      })()
    )
  }
  /** The bible character (or one of its aliases) a label names, C token and key included; null for anything else. */
  const findChar = (label: string): CharInfo | null => {
    const token = singleLine(label)
    const cToken = /^C(\d+)$/.exec(token)
    if (cToken && chars[Number(cToken[1]) - 1]) return chars[Number(cToken[1]) - 1]!
    const found = charByName(token)
    if (found) return found
    return chars.find((c) => c.aliases.some((a) => entryKey(a) === entryKey(token))) ?? null
  }
  /** The key of a character an `ON SCREEN:` entry names; a prop, a page, a crowd or a sentence is null (contract §4). */
  const knownCharKey = (label: string): string | null => findChar(label)?.key ?? null
  /** The character key of a speaker line: an unknown label gets a synthetic speaker (contract §4). */
  const resolveCharKey = (label: string): string => {
    const token = singleLine(label)
    const found = findChar(token)
    if (found) return found.key
    const seen = syntheticCharByName.get(entryKey(token))
    if (seen) return seen
    let key = ''
    for (let i = 1; !key; i++) {
      const candidate = `speaker_${i}`
      if (!usedCharKeys.has(candidate)) key = candidate
    }
    usedCharKeys.add(key)
    syntheticCharByName.set(entryKey(token), key)
    syntheticCharNames.set(key, token || `Speaker ${key}`)
    syntheticChars.push({ key, looks: '', aliasKeys: [] })
    characterNames[key] = token || key
    warnings.push(`speaker "${token || '(empty)'}" is not in the bible: synthetic character ${key} (no sheet or sprite)`)
    return key
  }

  // ---- places (contract §3: `vnKey`; a place the bible does not have keeps its text and a null key) ----
  const usedPlaceKeys = new Set<string>()
  const packPlaces: PackPlace[] = []
  const places: PlaceInfo[] = []
  for (const p of bible.places) {
    const { key, collision } = uniqueVnKey(p.name, usedPlaceKeys)
    if (collision) warnings.push(`two bible places give the key "${vnKey(p.name)}": the later one is "${key}"`)
    places.push({ key, name: p.name, looks: p.looks })
    packPlaces.push({ key, name: p.name, looks: p.looks })
  }
  const unknownPlaces = new Set<string>()
  const resolvePlace = (placeText: string): PlaceInfo | null => {
    const text = singleLine(placeText)
    if (!text) return null
    const k = entryKey(text)
    const known =
      places.find((p) => entryKey(p.name) === k) ??
      places.find((p) => p.key === k) ??
      (() => {
        const same = places.filter((p) => sameName(p.name, text))
        return same.length === 1 ? same[0]! : null
      })()
    if (known) return known
    if (!unknownPlaces.has(k)) {
      unknownPlaces.add(k)
      warnings.push(`place "${text}" is not in the bible: the scene keeps its place text (placeKey null)`)
    }
    return null
  }

  // ---- chapters, scenes and beats ----
  const chapterInputs = [...input.chapters].sort((a, b) => a.n - b.n)
  const outlineChapters = input.outline?.chapters ?? []
  const branching = isBranching(outlineChapters)
  const kind: PackKind = branching ? 'choice' : 'linear'
  let cleaned: OutlineChapter[] = outlineChapters
  if (branching) {
    try {
      cleaned = checkBranches(outlineChapters) as OutlineChapter[]
    } catch (err) {
      warnings.push(`the choice map of the outline is broken (${(err as Error).message}): the pack keeps it as written`)
    }
  }
  const outlineByN = new Map(cleaned.map((c) => [c.n, c]))
  const lastN = chapterInputs.length ? chapterInputs[chapterInputs.length - 1]!.n : 0
  const names = bible.characters.map((c) => c.name)

  const packChapters: PackChapter[] = []
  const chapterTitles: Record<string, string> = {}
  const sceneTitles: Record<string, string> = {}
  const choiceTexts: Record<string, string> = {}
  const endings: Record<string, string> = {}
  const beatTexts: Record<string, string> = {}
  /** Per puzzle: the story's own words of a clue, and the board of every clue (clue id -> beat id). */
  const puzzleStoryText = new Map<string, Record<string, string>>()
  const puzzleStoryNames = new Map<string, Record<string, string>>()
  const puzzleClueBeat = new Map<string, Record<string, string>>()
  const puzzleChapter = new Map<string, number>()
  const evidenceBeat = new Map<string, string>()
  const evidenceImageKeys = new Set<string>()
  const testimonyBlocks: TestimonyBlock[] = []
  const storyTextOf = (puzzle: string): Record<string, string> => {
    let m = puzzleStoryText.get(puzzle)
    if (!m) puzzleStoryText.set(puzzle, (m = {}))
    return m
  }
  const storyNamesOf = (puzzle: string): Record<string, string> => {
    let m = puzzleStoryNames.get(puzzle)
    if (!m) puzzleStoryNames.set(puzzle, (m = {}))
    return m
  }
  const clueBeatsOf = (puzzle: string): Record<string, string> => {
    let m = puzzleClueBeat.get(puzzle)
    if (!m) puzzleClueBeat.set(puzzle, (m = {}))
    return m
  }

  let pendingBreak = false
  for (const ch of chapterInputs) {
    const outline = outlineByN.get(ch.n)
    const trailing = moveTrailingCues(ch.body)
    if (trailing.moved.length) {
      warnings.push(`chapter ${ch.n}: ${trailing.moved.length} cue line(s) end a scene (VN Studio drops them): ${trailing.moved.join(' | ').slice(0, 300)}`)
    }
    const parsed = parseScript(ch.body, names, bible.characters)
    const context: BuildContext = { chapter: ch.n, warnings, resolveCharKey, knownCharKey, aliasKeyOf: (alias) => aliasKeyByText.get(entryKey(alias)) }

    const scenes: PackScene[] = []
    let sceneIndex = 0
    for (const scene of parsed.scenes) {
      const built = buildSceneBeats(scene, context)
      const breakAfter = built.breakSeen
      if (!built.drafts.length) {
        if (scene.place || scene.beats.length) {
          warnings.push(`chapter ${ch.n}: a scene${scene.place ? ` ("${singleLine(scene.place)}")` : ''} has no beat after its cues: left out of the pack`)
        }
        if (breakAfter) pendingBreak = true
        continue
      }
      sceneIndex++
      const id = sceneIdOf(ch.n, sceneIndex)
      const place = resolvePlace(scene.place)
      const beats = built.drafts.map((draft, i) => {
        const beat = { id: beatIdOf(id, i + 1), ...draft } as PackBeat
        const text = built.texts[i]
        if (text !== undefined) beatTexts[beat.id] = required(text, `the text of ${beat.id}`)
        return beat
      })
      const beatIdOfDraft = (draft: BeatDraft): string => beats[built.drafts.indexOf(draft)]!.id
      for (const c of built.clues) {
        storyTextOf(c.puzzle)[c.clue] = singleLine(c.text)
        clueBeatsOf(c.puzzle)[c.clue] = beatIdOfDraft(c.draft)
      }
      for (const e of built.evidence) {
        evidenceBeat.set(e.key, beatIdOfDraft(e.draft))
        evidenceImageKeys.add(e.imageKey)
      }
      for (const z of built.puzzles) puzzleChapter.set(z.key, ch.n)
      testimonyBlocks.push(...built.testimonies)

      const title = singleLine([scene.place, scene.time].filter(Boolean).join(', ')) || `Scene ${sceneIndex}`
      sceneTitles[id] = required(title, `the title of scene ${id}`)
      scenes.push({
        id,
        placeKey: place?.key ?? null,
        placeText: singleLine(scene.place),
        time: singleLine(scene.time) || null,
        description: singleLine([scene.background, place?.looks ?? ''].filter(Boolean).join(' ')),
        breakBefore: pendingBreak,
        beats
      })
      pendingBreak = breakAfter
    }
    if (!scenes.length) warnings.push(`chapter ${ch.n}: no scene with a beat: the chapter has no scenes in the pack`)

    const isEnding = kind === 'choice' ? !(outline?.choices?.length ?? 0) : ch.n === lastN
    const choices = (outline?.choices ?? []).map((c, index) => ({ index, to: c.to }))
    packChapters.push({ n: ch.n, isEnding, choices, scenes })
    chapterTitles[String(ch.n)] = required(ch.title || `Chapter ${ch.n}`, `the title of chapter ${ch.n}`)
    for (const [index, c] of (outline?.choices ?? []).entries()) {
      choiceTexts[`${ch.n}:${index}`] = required(c.text, `choice ${ch.n}:${index}`)
    }
    if (isEnding) endings[String(ch.n)] = singleLine(outline?.ending ?? '') || 'The End'
  }
  if (pendingBreak) warnings.push('the last chapter ends with a scene break: there is no scene after it to break')

  // a testimony puzzle's statements are the story's words of the TESTIMONY block (VN Studio's legacy importer does the same)
  const testimonyPuzzles = input.puzzles.filter((p) => coreKind(p) === 'testimony')
  for (const p of testimonyPuzzles) {
    const core = coreOf(p)
    const statements = Array.isArray(core?.statements) ? (core!.statements as { id?: unknown }[]) : []
    const witness = singleLine(p.testimony?.witness ?? '') || singleLine(p.names?.wit ?? '')
    const block = testimonyBlocks.find((b) => witness && (sameName(b.witness, witness) || entryKey(b.witness) === entryKey(witness))) ?? (testimonyBlocks.length === 1 && testimonyPuzzles.length === 1 ? testimonyBlocks[0] : undefined)
    if (!block) {
      warnings.push(`puzzle "${p.key}": there is no TESTIMONY: block for ${witness || 'its witness'}: the canonical statements are used`)
      continue
    }
    statements.forEach((st, i) => {
      const id = typeof st.id === 'string' ? st.id : ''
      const spoken = block.statements[i]?.text
      if (id && spoken) storyTextOf(p.key)[id] = singleLine(spoken)
    })
    if (!storyNamesOf(p.key).wit) storyNamesOf(p.key).wit = block.witness
  }

  // ---- puzzles ----
  const chapterBodies = chapterInputs.map((c) => ({ n: c.n, body: c.body }))
  for (const problem of puzzleProblems(chapterBodies, input.puzzles)) warnings.push(problem.text)
  const packPuzzles: PackPuzzle[] = []
  const catalogPuzzles: Record<string, VnTextPuzzle> = {}
  for (const p of input.puzzles) {
    const core = coreOf(p)
    const kindOfPuzzle = coreKind(p) || p.kind || 'murdle'
    const clueAt: Record<string, string> = { ...(puzzleClueBeat.get(p.key) ?? {}) }
    const coreEvidence = Array.isArray((core as { evidence?: unknown } | undefined)?.evidence) ? ((core as { evidence: { id?: unknown }[] }).evidence ?? []) : []
    const testimonyEvidence = p.testimony?.evidence ?? []
    coreEvidence.forEach((ev, i) => {
      const id = typeof ev.id === 'string' ? ev.id : ''
      const key = testimonyEvidence[i]?.key
      const beat = key ? evidenceBeat.get(key) : undefined
      if (id && beat) clueAt[id] = beat
    })
    const chapter = puzzleChapter.get(p.key) ?? p.chapter
    const links = puzzleLinks(p, core, chars, places, evidenceImageKeys, evidenceBeat)
    packPuzzles.push({
      key: p.key,
      kind: kindOfPuzzle,
      ...(core ? { data: core as Record<string, unknown> } : {}),
      ...(chapter ? { chapter } : {}),
      ...(Object.keys(clueAt).length ? { clueAt } : {}),
      ...(Object.keys(links).length ? { links } : {}),
      ...(p.onFail !== undefined ? { onFail: p.onFail as Record<string, unknown> } : {}),
      ...(p.hints !== undefined ? { hints: Boolean(p.hints) } : {}),
      ...(p.verified !== undefined ? { verified: p.verified as Record<string, unknown> } : {})
    })

    // the catalog: every name and every prose of the puzzle, the story's own words where the book has them
    const canonical = Object.fromEntries(Object.entries(p.text ?? {}).map(([id, value]) => [id, singleLine(String(value))]).filter(([, value]) => value))
    const text: Record<string, string> = { ...canonical, ...(puzzleStoryText.get(p.key) ?? {}) }
    for (const id of clueIdsOf(p)) {
      if (!text[id]) throw new VnPackError(`puzzle "${p.key}": clue ${id} has no prose (it is not in bible/puzzles.md and no CLUE: line tells it)`)
    }
    const puzzleNames = Object.fromEntries(Object.entries(p.names ?? {}).map(([id, value]) => [id, singleLine(String(value))]).filter(([, value]) => value))
    catalogPuzzles[p.key] = { names: { ...puzzleNames, ...(puzzleStoryNames.get(p.key) ?? {}) }, text }
  }

  // ---- the template and its hash ----
  const body: Omit<VnPack, 'packHash'> = {
    format: 'vn-pack',
    version: 2,
    book: {
      slug: input.slug,
      format: input.format,
      kind,
      primaryLang: lang,
      genre: singleLine(input.genre ?? ''),
      style: bible.style,
      author: singleLine(input.author ?? ''),
      coverBrief: singleLine(input.coverBrief ?? ''),
      sourceHash
    },
    characters: [...packChars, ...syntheticChars],
    places: packPlaces,
    chapters: packChapters,
    puzzles: packPuzzles
  }
  const pack: VnPack = { format: 'vn-pack', version: 2, packHash: '', book: body.book, characters: body.characters, places: body.places, chapters: body.chapters, puzzles: body.puzzles }
  pack.packHash = packHashOf(pack)

  // ---- the catalog ----
  const text: VnTextCatalog = {
    format: 'vn-text',
    version: 2,
    lang,
    packHash: pack.packHash,
    title: required(input.title, 'the book title'),
    ...(singleLine(input.blurb ?? '') ? { blurb: singleLine(input.blurb ?? '') } : {}),
    chapterTitles,
    sceneTitles,
    choiceTexts,
    endings,
    characterNames,
    beats: beatTexts,
    ...(Object.keys(catalogPuzzles).length ? { puzzles: catalogPuzzles } : {})
  }
  return { pack, text, warnings, sourceHash }
}

/** A catalog value must be single-line and non-empty (contract §5): an empty one refuses the write instead of shipping an untranslatable key. */
function required(value: string, what: string): string {
  const text = singleLine(value)
  if (!text) throw new VnPackError(`${what} has no text: the catalog would carry an empty value`)
  return text
}

const coreOf = (p: PuzzleEntry): Record<string, unknown> | undefined => (p.core && typeof p.core === 'object' ? (p.core as Record<string, unknown>) : undefined)

const coreKind = (p: PuzzleEntry): string => {
  const core = coreOf(p)
  return core && typeof core.kind === 'string' ? core.kind : ''
}

/** The item ids a puzzle shows (murdle/logic: the categories; knights: the speakers; testimony: the witness and the evidence). */
function puzzleEntityIds(core: Record<string, unknown> | undefined): string[] {
  if (!core) return []
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  if (core.kind === 'knights') return list(core.speakers)
  if (core.kind === 'testimony') {
    const evidence = Array.isArray(core.evidence) ? (core.evidence as { id?: unknown }[]) : []
    return ['wit', ...evidence.map((e) => (typeof e.id === 'string' ? e.id : '')).filter(Boolean)]
  }
  if (core.kind === 'quiz') {
    const questions = Array.isArray(core.questions) ? (core.questions as { options?: unknown }[]) : []
    return questions.flatMap((q) => list(q.options))
  }
  const categories = Array.isArray(core.categories) ? (core.categories as { items?: unknown }[]) : []
  return categories.flatMap((c) => list(c.items))
}

/** The links of a puzzle item to what it is in the story, as VN Studio's legacy importer works them out (contract §4 `links`). */
function puzzleLinks(p: PuzzleEntry, core: Record<string, unknown> | undefined, chars: CharInfo[], places: PlaceInfo[], evidenceImageKeys: Set<string>, evidenceBeat: Map<string, string>): Record<string, PackPuzzleLink> {
  const links: Record<string, PackPuzzleLink> = {}
  const names = p.names ?? {}
  for (const id of puzzleEntityIds(core)) {
    const name = singleLine(String(names[id] ?? ''))
    if (!name) continue
    const character = chars.find((c) => sameName(c.name, name) || entryKey(c.name) === entryKey(name))
    if (character) {
      links[id] = { type: 'character', key: character.key }
      continue
    }
    const place = places.find((pl) => sameName(pl.name, name) || entryKey(pl.name) === entryKey(name))
    if (place && core?.kind !== 'testimony') {
      links[id] = { type: 'place', key: place.key }
      continue
    }
    const imageKey = vnKey(name)
    if (evidenceImageKeys.has(imageKey)) links[id] = { type: 'image', key: imageKey }
  }
  // a testimony's evidence ids are pictures (the EVIDENCE: lines), paired with the bible's evidence list by order
  if (coreKind(p) === 'testimony' && Array.isArray(core?.evidence)) {
    const evidence = (core!.evidence as { id?: unknown }[]) ?? []
    const keys = p.testimony?.evidence ?? []
    evidence.forEach((ev, i) => {
      const id = typeof ev.id === 'string' ? ev.id : ''
      const key = keys[i]?.key
      if (!id || !key) return
      if (!evidenceBeat.has(key) && links[id]) return
      links[id] = { type: 'image', key: vnKey(key) }
    })
  }
  return links
}

// ---- scenes and beats --------------------------------------------------------------------------------------------------

/**
 * One parsed scene's beats as the pack's four kinds (contract §4). Cues attach to the next beat; `CLUE` and `EVIDENCE` become narration
 * (an evidence item also shows its insert), `TESTIMONY` statements line beats, `PUZZLE` a puzzle beat, `---` a break (not a beat). A cue
 * with no beat after it in its scene follows VN Studio: an SFX goes on the scene's last beat when that has none, the others are dropped with
 * a warning.
 */
function buildSceneBeats(scene: ScriptScene, ctx: BuildContext): SceneBuild {
  const drafts: BeatDraft[] = []
  const texts: (string | undefined)[] = []
  const clues: ClueRef[] = []
  const evidence: EvidenceRef[] = []
  const puzzles: PuzzleRef[] = []
  const testimonies: TestimonyBlock[] = []
  const pending: BeatCues = {}
  const takeCues = (): BeatCues => {
    const out: BeatCues = {}
    if (pending.image !== undefined) out.image = pending.image
    if (pending.sfx !== undefined) out.sfx = pending.sfx
    if (pending.ambience !== undefined) out.ambience = pending.ambience
    delete pending.image
    delete pending.sfx
    delete pending.ambience
    return out
  }
  const add = (draft: BeatDraft, text?: string): BeatDraft => {
    Object.assign(draft, takeCues())
    drafts.push(draft)
    texts.push(text)
    return draft
  }
  /**
   * The last expression of every speaker in this scene (contract §4, docs/visual-novel.md "Without a bracket, keep the last one"): a
   * line with no bracket inherits it, and only a speaker with none yet in the scene gets `neutral`. Reset with the scene.
   */
  const lastExpression = new Map<string, string>()
  const lineDraft = (speaker: string, expression: string, alias?: string): BeatDraft => {
    const aliasKey = alias ? ctx.aliasKeyOf(alias) : undefined
    const speakerKey = ctx.resolveCharKey(speaker)
    const written = singleLine(expression)
    if (written) lastExpression.set(speakerKey, written)
    const resolved = written || lastExpression.get(speakerKey) || 'neutral'
    return { type: 'line', speakerKey, expression: resolved, ...(aliasKey ? { aliasKey } : {}) }
  }
  const trailing = (what: string) => ctx.warnings.push(`chapter ${ctx.chapter}: ${what} at the end of a scene has no beat to play with: dropped`)
  let breakSeen = false

  for (const beat of scene.beats) {
    if (beat.type === 'break') {
      breakSeen = true
      continue
    }
    if (beat.type === 'cue') {
      const text = beat.text === null ? null : singleLine(beat.text)
      if (beat.cue === 'cg' || beat.cue === 'insert') {
        pending.image = text === null ? null : { display: beat.cue === 'insert' ? 'insert' : 'full', text }
      } else if (beat.cue === 'ambience') {
        pending.ambience = text === null ? null : { text }
      } else if (text) {
        pending.sfx = { text }
      }
      continue
    }
    if (beat.type === 'cast') {
      const cast: PackCastEntry[] = []
      for (const entry of beat.cast) {
        const charKey = ctx.knownCharKey(entry.name)
        if (!charKey) {
          // a prop, a page, a crowd or a whole sentence: not a cast entry, and never a synthetic character (contract §4)
          ctx.warnings.push(`chapter ${ctx.chapter}: ON SCREEN entry "${singleLine(entry.name)}" is not a bible character or alias: dropped`)
          continue
        }
        if (cast.some((c) => c.charKey === charKey)) continue
        const look = singleLine(entry.look)
        cast.push({ charKey, ...(look ? { look } : {}) })
      }
      if (cast.length) add({ type: 'cast', cast })
      continue
    }
    if (beat.type === 'line') {
      add(lineDraft(beat.speaker, beat.expression, beat.alias), beat.text)
      continue
    }
    if (beat.type === 'narration') {
      add({ type: 'narration' }, beat.text)
      continue
    }
    if (beat.type === 'clue') {
      const draft = add({ type: 'narration' }, beat.text)
      clues.push({ puzzle: beat.puzzle, clue: beat.clue, text: singleLine(beat.text), draft })
      continue
    }
    if (beat.type === 'evidence') {
      const draft = add({ type: 'narration' }, beat.text)
      const imageKey = vnKey(beat.key)
      // an INSERT: line right before the evidence wins (VN Studio's rule); otherwise the item shows its own insert
      if ((draft as BeatDraft & BeatCues).image === undefined) {
        Object.assign(draft, { image: { display: 'insert' as const, key: imageKey, text: singleLine(beat.text) } })
      }
      evidence.push({ key: beat.key, imageKey, draft })
      continue
    }
    if (beat.type === 'puzzle') {
      puzzles.push({ key: beat.puzzle, draft: add({ type: 'puzzle', puzzle: beat.puzzle }) })
      continue
    }
    // testimony: its statements are ordinary line beats (no beat for TESTIMONY or END TESTIMONY)
    for (const statement of beat.statements) add(lineDraft(statement.speaker, statement.expression, statement.alias), statement.text)
    testimonies.push({ witness: beat.witness, statements: beat.statements.map((s) => ({ speaker: s.speaker, text: singleLine(s.text) })) })
  }

  // an SFX left at the end of the scene goes on its last beat when that beat has none
  if (pending.sfx && drafts.length) {
    const last = drafts[drafts.length - 1] as BeatDraft & BeatCues
    if (!last.sfx) {
      last.sfx = pending.sfx
      delete pending.sfx
    }
  }
  if (pending.image !== undefined) trailing('a picture cue')
  if (pending.ambience !== undefined) trailing('an ambience cue')
  if (pending.sfx !== undefined) trailing('an SFX cue')

  // an evidence picture is hidden at the next beat of its scene unless that beat shows or hides a picture itself
  for (const e of evidence) {
    const at = drafts.indexOf(e.draft)
    if (at < 0) continue
    const beat = drafts[at] as BeatDraft & BeatCues
    if (!beat.image || (beat.image as PackImageCue).key !== e.imageKey) continue
    const next = drafts[at + 1] as (BeatDraft & BeatCues) | undefined
    if (next && next.image === undefined) next.image = null
  }

  return { drafts, texts, clues, evidence, puzzles, testimonies, breakSeen }
}

// ---- reading and writing a book folder ---------------------------------------------------------------------------------

export interface AuthoredBook {
  sources: VnPackSource[]
  book: Record<string, unknown>
  bible: string
  outline: { chapters: OutlineChapter[] } | null
  chapters: VnPackChapterInput[]
  puzzles: PuzzleEntry[]
  coverBrief: string
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** The cover brief paragraph: the body without its heading and the note about the cover template. */
export function coverBriefOf(body: string): string {
  const kept = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/templates\/cover\.html/i.test(line) && !/^This brief is for the image milestone/i.test(line))
  return singleLine(kept.join(' '))
}

/** The outline's chapters from its frontmatter, the way `BookStore.outline` reads them. */
export function outlineOf(data: Record<string, unknown>): { chapters: OutlineChapter[] } {
  const raw = Array.isArray(data.chapters) ? (data.chapters as Record<string, unknown>[]) : []
  const chapters = raw.map((c, i): OutlineChapter => ({
    n: Number(c.n ?? i + 1),
    title: String(c.title ?? `Chapter ${i + 1}`),
    summary: String(c.summary ?? ''),
    ...(Array.isArray(c.choices) ? { choices: (c.choices as Record<string, unknown>[]).map((ch) => ({ text: String(ch.text ?? ''), to: Number(ch.to) })) } : {}),
    ...(typeof c.ending === 'string' ? { ending: c.ending } : {})
  }))
  return { chapters }
}

/**
 * Reads the authored files of a book folder. `sourceHash` covers the ones the pack is made from, in the contract's order (§2): `outline.md`,
 * `bible/bible.md`, `bible/puzzles.md`, `cover-brief.md`, then `chapters/*.md` sorted by the first number in the file name. `book.md` is read
 * but not hashed: Scriptorium writes cover fields into it after the pack is built (a `book.md`-only change needs `build_vn_pack`).
 */
export async function readAuthoredBook(dir: string): Promise<AuthoredBook> {
  const sources: VnPackSource[] = []
  const take = async (relpath: string): Promise<string | null> => {
    const text = await readText(path.join(dir, ...relpath.split('/')))
    if (text !== null) sources.push({ relpath, text })
    return text
  }
  const bookText = await readText(path.join(dir, 'book.md'))
  if (bookText === null) throw new VnPackError(`no book.md in ${dir}: there is no book to compile`)
  const outlineText = await take('outline.md')
  const bibleText = await take('bible/bible.md')
  const puzzlesText = await take('bible/puzzles.md')
  const coverText = await take('cover-brief.md')

  const chapterFiles = (await fs.readdir(path.join(dir, 'chapters')).catch(() => [] as string[])).filter((f) => /\.md$/i.test(f))
  chapterFiles.sort((a, b) => firstNumber(a) - firstNumber(b) || a.localeCompare(b))
  const chapters: VnPackChapterInput[] = []
  for (const name of chapterFiles) {
    const text = await take(`chapters/${name}`)
    if (text === null) continue
    const doc = parseMd(text)
    const n = Number(doc.data.n ?? firstNumber(name))
    chapters.push({ n, title: String(doc.data.title ?? `Chapter ${n}`), body: doc.body.trim() })
  }

  const book = parseMd(bookText).data
  return {
    sources,
    book,
    bible: bibleText ? parseMd(bibleText).body.trim() : '',
    outline: outlineText ? outlineOf(parseMd(outlineText).data) : null,
    chapters,
    puzzles: puzzlesText ? parsePuzzleEntries(parseMd(puzzlesText).data.puzzles) : [],
    coverBrief: coverText ? coverBriefOf(parseMd(coverText).body) : ''
  }
}

export const vnDir = (bookDir: string) => path.join(bookDir, 'vn')
export const packFileOf = (bookDir: string) => path.join(vnDir(bookDir), 'pack.json')
export const textFileOf = (bookDir: string, lang: string) => path.join(vnDir(bookDir), 'text', `${lang}.json`)

/** Compiles the book in `dir` from its files (a published book folder, a test fixture, or a copy made by a hub script). */
export async function vnPackFromFolder(dir: string, opts: { puzzles?: PuzzleEntry[] } = {}): Promise<CompileResult & { book: AuthoredBook }> {
  const authored = await readAuthoredBook(dir)
  const data = authored.book
  const result = compileVnPack({
    slug: String(data.slug ?? path.basename(dir)),
    title: String(data.title ?? ''),
    author: typeof data.author === 'string' ? data.author : '',
    genre: String(data.genre ?? ''),
    format: String(data.format ?? ''),
    blurb: typeof data.blurb === 'string' ? data.blurb : '',
    coverBrief: authored.coverBrief,
    primaryLang: typeof data.primaryLang === 'string' ? data.primaryLang : 'en',
    bible: authored.bible,
    outline: authored.outline,
    chapters: authored.chapters,
    puzzles: opts.puzzles ?? authored.puzzles,
    sources: authored.sources
  })
  return { ...result, book: authored }
}

/** Compiles a book of the data folder with the engine's own reads (bible, outline, chapters, puzzles): what the publish hook and the tools use. */
export async function vnPackFromBook(books: BookStore, slug: string): Promise<CompileResult & { book: AuthoredBook }> {
  const dir = books.dir(slug)
  const authored = await readAuthoredBook(dir)
  if (!(await books.read(slug))) throw new VnPackError(`no book "${slug}" in ${books.root}`)
  const [outline, chapters, puzzles] = await Promise.all([books.outline(slug), books.chapters(slug), puzzlesOf({ books }, slug)])
  const data = authored.book
  const result = compileVnPack({
    slug,
    title: String(data.title ?? ''),
    author: typeof data.author === 'string' ? data.author : '',
    genre: String(data.genre ?? ''),
    format: String(data.format ?? ''),
    blurb: typeof data.blurb === 'string' ? data.blurb : '',
    coverBrief: authored.coverBrief,
    primaryLang: typeof data.primaryLang === 'string' ? data.primaryLang : 'en',
    bible: await books.bible(slug),
    outline,
    chapters: chapters.map((c) => ({ n: c.n, title: c.title, body: c.body })),
    puzzles,
    sources: authored.sources
  })
  return { ...result, book: authored }
}

/** The pack file as it is written: pretty-printed for diffs; `packHash` always comes from canonical JSON. */
export function renderPack(pack: VnPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`
}

/** The catalog file as it is written. */
export function renderCatalog(text: VnTextCatalog): string {
  return `${JSON.stringify(text, null, 2)}\n`
}

/**
 * Compiles and writes `vn/pack.json` and `vn/text/<lang>.json` atomically, and puts `vn_version: 2` into `book.md`. A failure before the
 * write leaves book.md untouched. Returns the result and the two paths.
 */
export async function writeVnPack(books: BookStore, slug: string): Promise<CompileResult & { packPath: string; textPath: string }> {
  const book = await books.read(slug)
  if (!book) throw new VnPackError(`no book "${slug}"`)
  const result = await vnPackFromBook(books, slug)
  const dir = books.dir(slug)
  const packPath = packFileOf(dir)
  const textPath = textFileOf(dir, result.text.lang)
  await atomicWrite(packPath, renderPack(result.pack))
  await atomicWrite(textPath, renderCatalog(result.text))
  if (book.data.vn_version !== 2) await books.update(slug, () => ({ vn_version: 2 }))
  return { ...result, packPath, textPath }
}

// ---- reading a pack back (the tools, the stale check) ------------------------------------------------------------------

export interface ReadVnPackResult {
  pack: VnPack
  text: VnTextCatalog
  packPath: string
  textPath: string
  packHash: string
  sourceHash: string
  /** The authored files changed since the pack was made: warn, never use silently (contract §8.7). */
  stale: boolean
  /** Catalog key problems and hash mismatches. */
  problems: string[]
  warnings: string[]
}

/** The composite keys a catalog must have: every chapter title, scene title, choice, ending, name, beat text and puzzle. */
export function expectedCatalogKeys(pack: VnPack): {
  chapterTitles: string[]
  sceneTitles: string[]
  choiceTexts: string[]
  endings: string[]
  characterNames: string[]
  beats: string[]
  puzzles: string[]
} {
  const chapterTitles: string[] = []
  const sceneTitles: string[] = []
  const choiceTexts: string[] = []
  const endings: string[] = []
  const characterNames: string[] = []
  const beats: string[] = []
  for (const c of pack.chapters) {
    chapterTitles.push(String(c.n))
    if (c.isEnding) endings.push(String(c.n))
    for (const choice of c.choices) choiceTexts.push(`${c.n}:${choice.index}`)
    for (const s of c.scenes) {
      sceneTitles.push(s.id)
      for (const b of s.beats) if (b.type === 'line' || b.type === 'narration') beats.push(b.id)
    }
  }
  for (const ch of pack.characters) characterNames.push(ch.key, ...ch.aliasKeys)
  return { chapterTitles, sceneTitles, choiceTexts, endings, characterNames, beats, puzzles: pack.puzzles.map((p) => p.key) }
}

const compareKeys = (where: string, expected: string[], actual: Record<string, unknown>, problems: string[]) => {
  const have = new Set(Object.keys(actual))
  const want = new Set(expected)
  const missing = expected.filter((k) => !have.has(k))
  const extra = Object.keys(actual).filter((k) => !want.has(k))
  if (missing.length) problems.push(`${where}: missing ${missing.join(', ')}`)
  if (extra.length) problems.push(`${where}: unknown ${extra.join(', ')}`)
}

/** Validates a catalog against the contract's shape (§5, §8): key sets, single-line non-empty values, no structural labels. */
export function catalogProblems(pack: VnPack, text: VnTextCatalog): string[] {
  const problems: string[] = []
  if (text.format !== 'vn-text') problems.push(`the catalog format is "${String(text.format)}", not "vn-text"`)
  if (text.version !== 2) problems.push(`the catalog version is ${String(text.version)}, not 2`)
  if (text.packHash !== pack.packHash) problems.push(`the catalog's packHash ${text.packHash} is not the pack's ${pack.packHash}`)
  const keys = expectedCatalogKeys(pack)
  compareKeys('chapterTitles', keys.chapterTitles, text.chapterTitles ?? {}, problems)
  compareKeys('sceneTitles', keys.sceneTitles, text.sceneTitles ?? {}, problems)
  compareKeys('choiceTexts', keys.choiceTexts, text.choiceTexts ?? {}, problems)
  compareKeys('endings', keys.endings, text.endings ?? {}, problems)
  compareKeys('characterNames', keys.characterNames, text.characterNames ?? {}, problems)
  compareKeys('beats', keys.beats, text.beats ?? {}, problems)
  compareKeys('puzzles', keys.puzzles, text.puzzles ?? {}, problems)
  const STRUCTURE = /^\s*(SCENE|ON SCREEN|NARRATION|NARRATOR|CG|INSERT|SFX|AMBIENCE|CLUE|EVIDENCE|PUZZLE|TESTIMONY)\s*:/i
  const values: [string, unknown][] = []
  for (const field of ['title', 'blurb'] as const) if (typeof text[field] === 'string') values.push([field, text[field]])
  for (const field of ['chapterTitles', 'sceneTitles', 'choiceTexts', 'endings', 'characterNames', 'beats'] as const) {
    for (const [k, v] of Object.entries((text[field] ?? {}) as Record<string, unknown>)) values.push([`${field}.${k}`, v])
  }
  for (const [key, puzzle] of Object.entries(text.puzzles ?? {})) {
    for (const [id, v] of Object.entries(puzzle.names ?? {})) values.push([`puzzles.${key}.names.${id}`, v])
    for (const [id, v] of Object.entries(puzzle.text ?? {})) values.push([`puzzles.${key}.text.${id}`, v])
  }
  for (const [key, value] of values) {
    if (typeof value !== 'string') {
      problems.push(`${key}: not a string`)
      continue
    }
    if (!singleLine(value)) problems.push(`${key}: empty`)
    else if (value.includes('\n') || value.includes('\r')) problems.push(`${key}: more than one line`)
    else if (STRUCTURE.test(value)) problems.push(`${key}: starts with a script keyword`)
    else if (/\bch\d{2}\.s\d{2}(\.b\d{3})?\b/.test(value)) problems.push(`${key}: carries a scene or beat id`)
  }
  return problems
}

/** Reads the pack and catalog of a book folder, checks the hashes and the key sets, and reports a stale `sourceHash`. */
export async function readVnPack(books: BookStore, slug: string): Promise<ReadVnPackResult> {
  const dir = books.dir(slug)
  const packPath = packFileOf(dir)
  const raw = await readText(packPath)
  if (raw === null) throw new VnPackError(`no vn/pack.json in books/${slug}: run build_vn_pack first`)
  let pack: VnPack
  try {
    pack = JSON.parse(raw) as VnPack
  } catch (err) {
    throw new VnPackError(`vn/pack.json of "${slug}" is not JSON (${(err as Error).message})`)
  }
  if (pack.format !== 'vn-pack') throw new VnPackError(`vn/pack.json of "${slug}" has format ${String(pack.format)}, not "vn-pack" (a v1 folder has no pack: run build_vn_pack)`)
  if (pack.version !== 2) throw new VnPackError(`vn/pack.json of "${slug}" has version ${String(pack.version)}; this Scriptorium writes version 2 only`)
  const lang = pack.book?.primaryLang || 'en'
  const textPath = textFileOf(dir, lang)
  const textRaw = await readText(textPath)
  if (textRaw === null) throw new VnPackError(`the pack of "${slug}" has no text/${lang}.json catalog`)
  const text = JSON.parse(textRaw) as VnTextCatalog
  const problems: string[] = []
  const warnings: string[] = []
  const actualHash = packHashOf(pack)
  if (actualHash !== pack.packHash) problems.push(`packHash ${pack.packHash} does not match the pack's contents (${actualHash})`)
  problems.push(...catalogProblems(pack, text))
  const authored = await readAuthoredBook(dir)
  const sourceHash = sourceHashOf(authored.sources)
  const stale = sourceHash !== pack.book.sourceHash
  if (stale) warnings.push(`the pack is stale: the authored files changed (sourceHash ${sourceHash} is not the pack's ${pack.book.sourceHash})`)
  return { pack, text, packPath, textPath, packHash: pack.packHash, sourceHash, stale, problems, warnings }
}

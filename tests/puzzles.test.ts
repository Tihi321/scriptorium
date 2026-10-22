import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatsForKind } from '../src/engine/pipeline/handlers'
import { humanizeProblem, scriptStructure } from '../src/engine/pipeline/humanizerHandlers'
import { instructionLines } from '../src/engine/pipeline/leak'
import { clueChapters, clueIdsOf, evidenceKeysOf, placePuzzles, puzzleLinesOf, puzzleProblems, puzzlesChapterSection, puzzlesOutlineSection, puzzleViews, solutionWords } from '../src/engine/pipeline/puzzles'
import { parseScript } from '../src/engine/publish/script'
import { cueOf, puzzleLineOf, scriptToXhtml } from '../src/engine/publish/xhtml'
import { writeMd } from '../src/engine/store/atomic'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { migratePuzzles, PUZZLE_FORMAT_IDS } from '../src/engine/store/migrations'
import { briefOf, emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { parsePuzzleEntries } from '../src/shared/puzzles'
import type { PuzzleEntry } from '../src/shared/puzzles'
import { formatsSchema } from '../src/shared/schemas'
import { makePipelineEnv, seedDir, waitFor } from './helpers'

/** The puzzle core VN Studio makes (seed 1, medium), with the names and canonical sentences of vno_puzzle_generate. */
const DINNER: PuzzleEntry = parsePuzzleEntries([
  {
    key: 'dinner',
    kind: 'murdle',
    title: 'The Dinner Party',
    core: {
      format: 1,
      kind: 'murdle',
      size: 3,
      seed: 1,
      band: 'medium',
      categories: [
        { key: 'suspect', items: ['s1', 's2', 's3'] },
        { key: 'weapon', items: ['w1', 'w2', 'w3'] },
        { key: 'place', items: ['p1', 'p2', 'p3'] }
      ],
      solution: { s1: { place: 'p1', weapon: 'w1' }, s2: { place: 'p3', weapon: 'w2' }, s3: { place: 'p2', weapon: 'w3' } },
      clues: [
        { id: 'c1', type: 'not', a: 's2', b: 'w1' },
        { id: 'c2', type: 'either', a: 'p2', b: ['w1', 'w3'] },
        { id: 'c3', type: 'either', a: 's2', b: ['p2', 'p3'] },
        { id: 'c4', type: 'not', a: 's3', b: 'w1' },
        { id: 'c5', type: 'is', a: 's3', b: 'p2' }
      ],
      murder: { place: 'p1', answer: { suspect: 's1', weapon: 'w1', place: 'p1' } },
      difficulty: { steps: 27, score: 37 },
      steps: []
    },
    names: { s1: 'Colonel Ash', s2: 'Doctor Birch', s3: 'Miss Cole', w1: 'rope', w2: 'candlestick', w3: 'poison', p1: 'library', p2: 'kitchen', p3: 'garden' },
    text: {
      c1: 'Doctor Birch did not have the rope.',
      c2: 'Either the rope or the poison was in the kitchen.',
      c3: 'Doctor Birch was either in the kitchen or the garden.',
      c4: 'Miss Cole did not have the rope.',
      c5: 'Miss Cole was in the kitchen.',
      murder: 'The body was found in the library.'
    }
  }
])[0]!

const COURT: PuzzleEntry = parsePuzzleEntries([
  { key: 'court', kind: 'testimony', testimony: { witness: 'Miss Cole', breaks: [{ statement: 2, evidence: 'pocket_watch' }], evidence: [{ key: 'pocket_watch', description: 'A pocket watch, stopped at 9:10' }] } }
])[0]!

describe('the puzzle lines', () => {
  it('reads the four lines and END TESTIMONY, Croatian keywords and bold marks too', () => {
    expect(puzzleLineOf('CLUE: dinner/c2: The rope was either in the kitchen or the garden, Hartley noted.')).toEqual({ kind: 'clue', puzzle: 'dinner', clue: 'c2', text: 'The rope was either in the kitchen or the garden, Hartley noted.' })
    expect(puzzleLineOf('**CLUE:** dinner/murder: The body: found, late.')).toEqual({ kind: 'clue', puzzle: 'dinner', clue: 'murder', text: 'The body: found, late.' })
    expect(puzzleLineOf('trag: dinner/c1: Uže nije bilo kod njega.')).toMatchObject({ kind: 'clue', clue: 'c1' })
    expect(puzzleLineOf('EVIDENCE: pocket_watch: A pocket watch, stopped at 9:10, its glass cracked.')).toEqual({ kind: 'evidence', key: 'pocket_watch', text: 'A pocket watch, stopped at 9:10, its glass cracked.' })
    expect(puzzleLineOf('DOKAZ: sat: Džepni sat.')).toMatchObject({ kind: 'evidence', key: 'sat' })
    expect(puzzleLineOf('PUZZLE: dinner (murdle)')).toEqual({ kind: 'puzzle', puzzle: 'dinner', puzzleKind: 'murdle' })
    expect(puzzleLineOf('PUZZLE: dinner')).toEqual({ kind: 'puzzle', puzzle: 'dinner', puzzleKind: null })
    expect(puzzleLineOf('ZAGONETKA: večera (murdle)')).toBeNull() // ids are ASCII
    expect(puzzleLineOf('ZAGONETKA: vecera (Murdle)')).toEqual({ kind: 'puzzle', puzzle: 'vecera', puzzleKind: 'murdle' })
    expect(puzzleLineOf('TESTIMONY: Miss Cole')).toEqual({ kind: 'testimony', witness: 'Miss Cole' })
    expect(puzzleLineOf('SVJEDOČENJE: Gospođica Cole')).toEqual({ kind: 'testimony', witness: 'Gospođica Cole' })
    for (const end of ['END TESTIMONY', 'end testimony', '**END TESTIMONY**', 'KRAJ SVJEDOČENJA']) expect(puzzleLineOf(end), end).toEqual({ kind: 'end-testimony' })
  })

  it('is null for a line that does not fit, and never collides with the cue or the screenplay lines', () => {
    for (const line of ['CLUE: no slash here', 'CLUE: a/b', 'MARA: Hello.', 'SCENE: The barn, night', 'ON SCREEN: Mara', 'PUZZLE: two words', 'The clue is on the table.']) expect(puzzleLineOf(line), line).toBeNull()
    // none of the visual novel picture and sound lines, and none of the screenplay lines, is a puzzle line
    for (const line of ['CG: a picture', 'INSERT: a page', 'SFX: a door', 'AMBIENCE: rain', 'END CG', 'SHOT (wide, 6s): a pier', 'MUSIC: piano', 'TITLE: Dusk']) expect(puzzleLineOf(line), line).toBeNull()
    // and no puzzle line is a cue
    for (const line of ['CLUE: dinner/c1: x', 'EVIDENCE: k: x', 'PUZZLE: dinner', 'TESTIMONY: Mara', 'END TESTIMONY']) expect(cueOf(line), line).toBeNull()
  })
})

describe('parseScript: puzzle beats', () => {
  const BODY = [
    'SCENE: The kitchen, night',
    'CLUE: dinner/c5: Miss Cole was in the kitchen, Hartley saw.',
    'A knife block, one knife short.',
    'ON SCREEN: Hartley (tired)',
    'EVIDENCE: pocket_watch: A pocket watch, stopped at 9:10.',
    'PUZZLE: dinner (murdle)',
    'TESTIMONY: Miss Cole',
    'MISS COLE (calm): I was in the garden all evening.',
    'THE COOK: I never touched the poison.',
    'END TESTIMONY',
    'HARTLEY: Hm.',
    'TESTIMONY: Colonel Ash',
    'COLONEL ASH: Nonsense.',
    'He turns away.',
    'PUZZLE: court'
  ].join('\n')

  it('makes one beat per line; a testimony holds its statements in order and ends at END TESTIMONY or at a line of another kind', () => {
    const { scenes } = parseScript(BODY, ['Hartley', 'Miss Cole', 'Colonel Ash'], [{ name: 'Miss Cole', aliases: ['the cook'] }])
    const beats = scenes[0]!.beats
    expect(beats[0]).toEqual({ type: 'clue', puzzle: 'dinner', clue: 'c5', text: 'Miss Cole was in the kitchen, Hartley saw.' })
    expect(scenes[0]!.background).toBe('A knife block, one knife short.')
    expect(beats[1]).toMatchObject({ type: 'cast' })
    expect(beats[2]).toEqual({ type: 'evidence', key: 'pocket_watch', text: 'A pocket watch, stopped at 9:10.' })
    expect(beats[3]).toEqual({ type: 'puzzle', puzzle: 'dinner', kind: 'murdle' })
    expect(beats[4]).toEqual({
      type: 'testimony',
      witness: 'Miss Cole',
      statements: [
        { n: 1, speaker: 'Miss Cole', expression: 'calm', text: 'I was in the garden all evening.' },
        { n: 2, speaker: 'Miss Cole', expression: '', text: 'I never touched the poison.', alias: 'the cook' }
      ]
    })
    expect(beats[5]).toMatchObject({ type: 'line', speaker: 'Hartley', text: 'Hm.' })
    // no END TESTIMONY: the narration line closes it
    expect(beats[6]).toEqual({ type: 'testimony', witness: 'Colonel Ash', statements: [{ n: 1, speaker: 'Colonel Ash', expression: '', text: 'Nonsense.' }] })
    expect(beats[7]).toEqual({ type: 'narration', text: 'He turns away.' })
    expect(beats[8]).toEqual({ type: 'puzzle', puzzle: 'court', kind: null })
    // never a speaker called CLUE, EVIDENCE, PUZZLE or TESTIMONY
    expect(JSON.stringify(beats)).not.toMatch(/"speaker":"(CLUE|EVIDENCE|PUZZLE|TESTIMONY)"/)
  })

  it('a puzzle line right after SCENE keeps the background, and a SCENE closes a testimony', () => {
    const { scenes } = parseScript('SCENE: A, day\nPUZZLE: p\nA room.\nTESTIMONY: Mara\nMARA: One.\nSCENE: B, night\nMARA: Two.')
    expect(scenes[0]).toMatchObject({ background: 'A room.' })
    expect(scenes[0]!.beats.at(-1)).toMatchObject({ type: 'testimony', statements: [{ n: 1, text: 'One.' }] })
    expect(scenes[1]!.beats).toEqual([{ type: 'line', speaker: 'MARA', expression: '', text: 'Two.' }])
  })

  it('the layout shows them as notes, the puzzle with its clue list, and a screenplay does not read them', () => {
    const views = { dinner: { title: 'The Dinner Party', clues: [{ id: 'c1', text: 'Doctor Birch did not have the rope.' }] } }
    const html = scriptToXhtml(BODY, { puzzles: views })
    expect(html).toContain('<p class="vn-clue"><span class="vn-label">Clue:</span> Miss Cole was in the kitchen, Hartley saw.</p>')
    expect(html).toContain('<p class="vn-evidence"><span class="vn-label">Evidence:</span> A pocket watch, stopped at 9:10.</p>')
    expect(html).toContain('<div class="vn-puzzle"><p class="vn-puzzle-title"><span class="vn-label">Puzzle:</span> The Dinner Party</p>\n<ul>\n<li>Doctor Birch did not have the rope.</li>\n</ul></div>')
    expect(html).toContain('<span class="vn-label">Testimony:</span> Miss Cole')
    expect(html).toContain('End of testimony')
    expect(html).toContain('<div class="vn-puzzle"><p class="vn-puzzle-title"><span class="vn-label">Puzzle:</span> court</p></div>')
    expect(html).not.toMatch(/vn-speaker">(CLUE|EVIDENCE|PUZZLE|TESTIMONY)/)
    expect(scriptToXhtml('CLUE: a/b: x', { screenplay: true })).toContain('vn-speaker">CLUE')
  })
})

describe('the humanizer guard keeps the puzzle lines', () => {
  const script = [
    'SCENE: The kitchen, night',
    'Rain ticks on the glass and the stove is cold again tonight.',
    'CLUE: dinner/c5: Miss Cole was in the kitchen, Hartley saw her there at nine.',
    'HARTLEY (tired): It was her, or it was somebody who wanted it to look like her.',
    'EVIDENCE: pocket_watch: A pocket watch, stopped at 9:10, its glass cracked.',
    'PUZZLE: dinner (murdle)',
    'TESTIMONY: Miss Cole',
    'MISS COLE: I was in the garden all evening and I never saw the colonel at all.',
    'END TESTIMONY'
  ].join('\n')

  it('lists them, and refuses a version in which one changed in any word, was dropped or moved', () => {
    const s = scriptStructure(script)
    expect(s.puzzleLines).toEqual(puzzleLinesOf(script))
    expect(s.puzzleLines).toHaveLength(5)
    expect(s.speakers).toEqual(['HARTLEY', 'MISS COLE'])
    expect(humanizeProblem(script, script.replace('Rain ticks on the glass', 'Rain taps at the glass'), { script: true })).toBeNull()
    expect(humanizeProblem(script, script.replace('saw her there at nine', 'saw her at nine sharp'), { script: true })).toMatch(/script lines changed/)
    expect(humanizeProblem(script, script.replace('PUZZLE: dinner (murdle)\n', ''), { script: true })).toMatch(/script lines changed/)
    expect(humanizeProblem(script, script.replace('MISS COLE: I was', 'MISS COLE: Me, I was'), { script: true })).toBeNull() // a statement is a speaker line: its words are free
  })
})

describe('the puzzle helpers', () => {
  it('reads clue ids, evidence keys and the solution in words from the core', () => {
    expect(clueIdsOf(DINNER)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(solutionWords(DINNER)).toBe('suspect: Colonel Ash, weapon: rope, place: library')
    expect(clueIdsOf(COURT)).toEqual([])
    expect(evidenceKeysOf(COURT)).toEqual(['pocket_watch'])
    expect(solutionWords(COURT)).toContain('statement 2 is broken by the evidence pocket_watch')
    expect(puzzleViews([DINNER]).dinner).toEqual({ title: 'The Dinner Party', clues: expect.arrayContaining([{ id: 'c1', text: 'Doctor Birch did not have the rope.' }]) })
  })

  it('places a puzzle in the chapter the architect named, else in a later chapter (never chapter 1 of several), and spreads the clues over the chapters before it', () => {
    expect(placePuzzles([DINNER], 4, { dinner: 3 })[0]!.chapter).toBe(3)
    expect(placePuzzles([DINNER], 4)[0]!.chapter).toBe(4)
    expect(placePuzzles([DINNER], 1)[0]!.chapter).toBe(1)
    expect(placePuzzles([DINNER], 4, { dinner: 99 })[0]!.chapter).toBe(4) // a chapter that does not exist is ignored
    const two = placePuzzles([DINNER, { ...DINNER, key: 'second' }], 5)
    expect(two.map((p) => p.chapter)).toEqual([3, 5])
    expect(clueChapters(DINNER, 3)).toEqual({ c1: 1, c2: 1, c3: 2, c4: 2, c5: 3 })
    expect(clueChapters(DINNER, 1)).toEqual({ c1: 1, c2: 1, c3: 1, c4: 1, c5: 1 })
    expect(placePuzzles([DINNER], 4, { dinner: 3 })[0]!.clueAt).toEqual({ c1: 1, c2: 1, c3: 2, c4: 2, c5: 3 })
  })

  const placed = placePuzzles([DINNER], 3, { dinner: 3 })
  const plant = (ids: string[]) => ids.map((id) => `CLUE: dinner/${id}: ${DINNER.text[id]}`).join('\n')
  const book = (c1: string, c2: string, c3: string) => [
    { n: 1, body: `SCENE: A, day\n${c1}\nMARA: Hi.` },
    { n: 2, body: `SCENE: B, day\n${c2}\nMARA: Hi.` },
    { n: 3, body: `SCENE: C, day\n${c3}\nMARA: Hi.` }
  ]

  it('the check passes a book that plants every clue before the puzzle, and names what is wrong otherwise', () => {
    expect(puzzleProblems(book(plant(['c1', 'c2']), plant(['c3', 'c4']), `${plant(['c5'])}\nPUZZLE: dinner (murdle)`), placed)).toEqual([])
    // a missing clue is reported for the chapter planned to plant it
    const missing = puzzleProblems(book(plant(['c1', 'c2']), plant(['c3']), `${plant(['c5'])}\nPUZZLE: dinner`), placed)
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ chapter: 2 })
    expect(missing[0]!.text).toMatch(/chapter 2 must plant the clue\(s\) c4 as CLUE: dinner\/<id>: lines \(before PUZZLE: dinner in chapter 3\)/)
    // a clue after the puzzle line does not count
    const late = puzzleProblems(book(plant(['c1', 'c2']), plant(['c3', 'c4']), `PUZZLE: dinner\n${plant(['c5'])}`), placed)
    expect(late[0]!.text).toMatch(/c5/)
    // no puzzle line, two puzzle lines, an unknown clue, an unknown puzzle
    expect(puzzleProblems(book(plant(['c1', 'c2']), plant(['c3', 'c4']), plant(['c5'])), placed)[0]).toMatchObject({ chapter: 3 })
    expect(puzzleProblems(book(plant(['c1', 'c2']), plant(['c3', 'c4']), plant(['c5'])), placed)[0]!.text).toMatch(/no PUZZLE: dinner line \(it belongs in chapter 3\)/)
    expect(puzzleProblems(book(`${plant(['c1', 'c2'])}\nPUZZLE: dinner`, plant(['c3', 'c4']), `${plant(['c5'])}\nPUZZLE: dinner`), placed).some((p) => /written 2 times/.test(p.text))).toBe(true)
    const odd = puzzleProblems(book(`${plant(['c1', 'c2'])}\nCLUE: dinner/c9: x\nCLUE: other/c1: y`, plant(['c3', 'c4']), `${plant(['c5'])}\nPUZZLE: dinner\nPUZZLE: ghost`), placed)
    expect(odd.map((p) => p.text).join('\n')).toMatch(/c9 is not a clue of the puzzle/)
    expect(odd.map((p) => p.text).join('\n')).toMatch(/CLUE: other\/c1 names a puzzle the book does not have/)
    expect(odd.map((p) => p.text).join('\n')).toMatch(/PUZZLE: ghost is not a puzzle of the book/)
  })

  it('the check wants the evidence of a testimony planted before it, and a TESTIMONY block', () => {
    const court = placePuzzles([COURT], 2, { court: 2 })
    const ok = [{ n: 1, body: 'SCENE: A, day\nEVIDENCE: pocket_watch: A watch.\nMARA: Hi.' }, { n: 2, body: 'SCENE: B, day\nTESTIMONY: Miss Cole\nMISS COLE: One.\nMISS COLE: Two.\nEND TESTIMONY\nPUZZLE: court (testimony)' }]
    expect(puzzleProblems(ok, court)).toEqual([])
    const noEvidence = [{ n: 1, body: 'SCENE: A, day\nMARA: Hi.' }, ok[1]!]
    expect(puzzleProblems(noEvidence, court)[0]!.text).toMatch(/evidence pocket_watch is not planted/)
    const noBlock = [ok[0]!, { n: 2, body: 'SCENE: B, day\nPUZZLE: court (testimony)\nMARA: Hi.' }]
    expect(puzzleProblems(noBlock, court)[0]!.text).toMatch(/no TESTIMONY: Miss Cole block/)
  })

  it('the prompt sections name the clues to plant in each chapter, the puzzle line and the truth; the example lines are under 40 characters', () => {
    const placedAt3 = placePuzzles([DINNER], 3, { dinner: 3 })
    const outline = puzzlesOutlineSection(placedAt3, [3, 8])
    expect(outline).toContain('"puzzles": ["<key>"]')
    expect(outline).toContain('The Dinner Party (key dinner, murdle)')
    expect(outline).toContain('Colonel Ash')
    const ch1 = puzzlesChapterSection(placedAt3, 1, 3)
    expect(ch1).toContain('- dinner/c1: Doctor Birch did not have the rope.')
    expect(ch1).toContain('- dinner/c2: Either the rope or the poison was in the kitchen.')
    expect(ch1).not.toContain('dinner/c3')
    expect(ch1).not.toContain('write the line PUZZLE')
    const ch3 = puzzlesChapterSection(placedAt3, 3, 3)
    expect(ch3).toContain('- dinner/c5: Miss Cole was in the kitchen.')
    expect(ch3).toContain('write the line PUZZLE: dinner')
    expect(ch3).toContain('The truth: suspect: Colonel Ash, weapon: rope, place: library')
    expect(ch3).toContain('The note of the puzzle: The body was found in the library.')
    expect(puzzlesChapterSection([], 1, 3)).toBe('')
    const examples = ch1.split('\n').filter((l) => /^(CLUE|EVIDENCE|PUZZLE|TESTIMONY|END TESTIMONY)\b/.test(l))
    expect(examples.length).toBe(5)
    expect(examples.every((l) => l.length < 40)).toBe(true)
    // so a chapter that holds the example lines is not taken for a leak
    expect(instructionLines('', [ch1]).filter((l) => examples.some((e) => l === e.toLowerCase()))).toEqual([])
  })
})

describe('the brief carries the puzzles', () => {
  it('briefOf reads valid puzzle entries from the frontmatter and drops the rest', () => {
    const brief = briefOf({ title: 'T', puzzles: [DINNER, { nokey: true }, { key: 'bad key' }] }, 'A story.')
    expect(brief.puzzles).toHaveLength(1)
    expect(brief.puzzles![0]).toMatchObject({ key: 'dinner', kind: 'murdle', names: { s1: 'Colonel Ash' } })
    expect(briefOf({}, 'A story.').puzzles).toBeUndefined()
  })
})

describe('the mystery-with-puzzles format', () => {
  it('is in the seed, never picked by a topic, and added to an older data folder once', async () => {
    const seed = formatsSchema.parse(parseMd(await readFile(path.join(seedDir, 'config', 'formats.md'), 'utf8')).data).formats
    const f = seed.find((x) => x.id === 'mystery-puzzle-visual-novel')!
    expect(f).toMatchObject({ enabled: true, script: true, puzzles: true, humanize: false, kinds: [], chapters: [3, 8] })
    expect(f.screenplay).toBe(false)
    for (const kind of [null, 'visual-novel', 'video', 'fiction']) expect(formatsForKind(seed, kind).some((x) => x.puzzles), String(kind)).toBe(false)

    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    const file = path.join(dir, 'config', 'formats.md')
    const text = await readFile(file, 'utf8')
    const cut = text.indexOf('  - id: mystery-puzzle-visual-novel\n')
    await writeFile(file, text.slice(0, cut) + text.slice(text.indexOf('---\n# Formats')))
    expect((await initDataFolder(dir, seedDir)).migrated).toEqual([expect.stringMatching(/added the puzzle format \(mystery-puzzle-visual-novel\)/)])
    expect(await readFile(file, 'utf8')).toBe(text)
    expect((await initDataFolder(dir, seedDir)).migrated).toEqual([])
    expect(PUZZLE_FORMAT_IDS).toEqual(['mystery-puzzle-visual-novel'])
    expect((await migratePuzzles(dir, undefined)).changes).toEqual([])
  })
})

const tmp: string[] = []
afterEach(async () => {
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})
const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-pz-'))
  tmp.push(dir)
  return dir
}

describe('a mystery with puzzles through the pipeline (mock models)', () => {
  const lastUser = (req: { messages: { role: string; content: string }[] }) => req.messages.filter((m) => m.role === 'user').pop()!.content

  async function pzEnv() {
    return makePipelineEnv({
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'mystery-puzzle-visual-novel' ? { ...f, words: [150, 600], chapters: [3, 3], max_rounds: 1 } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
  }

  /** A script chapter: the clues the prompt asks to plant, the puzzle line when it asks for one, and dialogue to the length. */
  const chapterOf = (t: string, o: { plant: boolean; puzzle: boolean }) => {
    const words = Number(/chapter should be about (\d+) words/.exec(t)?.[1] ?? 100)
    const lines = ['SCENE: Hay Barn, night', 'Moonlight on straw.']
    if (o.plant) for (const m of t.matchAll(/^- (\w+)\/(\w+): (.+)$/gm)) lines.push(`CLUE: ${m[1]}/${m[2]}: ${m[3]} Hartley noted it.`)
    for (let i = 0; lines.join(' ').split(/\s+/).length < words; i++) lines.push(`HARTLEY (calm): The barn smells of rope and rain tonight, number ${i}.`)
    if (o.puzzle && /write the line PUZZLE: dinner/.test(t)) lines.splice(lines.length - 1, 0, 'PUZZLE: dinner (murdle)')
    return lines.join('\n')
  }

  const outline = (req: { messages: { role: string; content: string }[] }) => {
    expect(lastUser(req)).toContain('"puzzles": ["<key>"]')
    return JSON.stringify({
      chapters: [
        { title: 'The Body', summary: 'Hartley finds the body in the library.', puzzles: [] },
        { title: 'The Guests', summary: 'Hartley questions the guests.', puzzles: [] },
        { title: 'The Answer', summary: 'Hartley names the culprit.', puzzles: ['dinner'] }
      ],
      characters: [{ name: 'Hartley', description: 'a tired detective in a grey coat', voice: 'dry' }],
      places: [{ name: 'Hay Barn', description: 'a dim barn' }],
      threads: [],
      setting: 'a country house',
      style: 'quiet'
    })
  }

  it('places the puzzle, plants every clue before it, publishes, and lays the lines out', async () => {
    const e = await pzEnv()
    try {
      const drafts: string[] = []
      e.mock.on({ task: 'outline' }, outline)
      e.mock.on({ task: 'draft_chapter' }, (req) => (drafts.push(lastUser(req)), chapterOf(lastUser(req), { plant: true, puzzle: true })))
      await e.engine.addStory({ ...emptyBrief(), title: 'The Dinner Party', premise: 'A body in the library.', format: 'mystery-puzzle-visual-novel', puzzles: [DINNER] })
      const slug = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) if ((await e.engine.books.read(s))?.data.stage === 'published') return s
        return null
      }, 150000, 'the published puzzle book')
      const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
      expect(book).toMatchObject({ format: 'mystery-puzzle-visual-novel', script: true, puzzles: true })
      // bible/puzzles.md: the entry as handed over, placed and with the planned chapter of each clue
      const file = parseMd(await readFile(path.join(e.dir, 'books', slug, 'bible', 'puzzles.md'), 'utf8'))
      expect(file.data.kind).toBe('puzzles')
      const entry = parsePuzzleEntries(file.data.puzzles)[0]!
      expect(entry).toMatchObject({ key: 'dinner', chapter: 3, names: { s1: 'Colonel Ash' }, text: { c1: 'Doctor Birch did not have the rope.' }, clueAt: { c1: 1, c2: 1, c3: 2, c4: 2, c5: 3 } })
      expect((entry.core as { solution: unknown }).solution).toEqual(DINNER.core!.solution)
      expect(file.body).toContain('The truth: suspect: Colonel Ash, weapon: rope, place: library.')
      // the first draft was told to plant c1 and c2, the third to write the puzzle line
      expect(drafts[0]).toContain('- dinner/c1: Doctor Birch did not have the rope.')
      expect(drafts[0]).not.toContain('write the line PUZZLE')
      expect(drafts.some((t) => /write the line PUZZLE: dinner/.test(t))).toBe(true)
      // every clue is in a CLUE line before the PUZZLE line, and the layout shows them
      const chapters = await e.engine.books.chapters(slug)
      expect(puzzleProblems(chapters, [entry])).toEqual([])
      expect(chapters.map((c) => c.body).join('\n')).toMatch(/CLUE: dinner\/c5: Miss Cole was in the kitchen\./)
      const html = scriptToXhtml(chapters[2]!.body, { puzzles: puzzleViews([entry]) })
      expect(html).toContain('<span class="vn-label">Puzzle:</span> The Dinner Party')
      expect(html).toContain('<li>Miss Cole was in the kitchen.</li>')
      // every reviewer was told what the puzzle lines are
      const reviews = await readdir(path.join(e.dir, 'books', slug, 'reviews'))
      expect(reviews.some((f) => /continuity-checker/.test(f))).toBe(true)
      const cont = parseMd(await readFile(path.join(e.dir, 'books', slug, 'reviews', reviews.find((f) => /continuity-checker/.test(f))!), 'utf8'))
      expect(cont.data.verdict).toBe('pass')
    } finally {
      await e.cleanup()
    }
  }, 200000)

  it('a clue that is not planted makes the continuity review say revise and names the clue and the chapter', async () => {
    const e = await pzEnv()
    try {
      e.mock.on({ task: 'outline' }, outline)
      e.mock.on({ task: 'draft_chapter' }, (req) => chapterOf(lastUser(req), { plant: false, puzzle: true }))
      await e.engine.addStory({ ...emptyBrief(), title: 'The Dinner Party', premise: 'A body in the library.', format: 'mystery-puzzle-visual-novel', puzzles: [DINNER] })
      const found = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) {
          const dir = path.join(e.dir, 'books', s, 'reviews')
          const name = (await readdir(dir).catch(() => [] as string[])).find((f) => /^book-continuity-checker-r0/.test(f))
          if (name) return { dir, name }
        }
        return null
      }, 150000, 'the continuity review')
      const review = parseMd(await readFile(path.join(found.dir, found.name), 'utf8'))
      expect(review.data.verdict).toBe('revise')
      expect(review.data.chapters).toEqual(expect.arrayContaining([1, 2, 3]))
      expect(review.body).toContain("The engine's puzzle check found")
      expect(review.body).toMatch(/puzzle dinner: chapter 1 must plant the clue\(s\) c1, c2 /)
      expect(review.body).toMatch(/puzzle dinner: chapter 3 must plant the clue\(s\) c5 /)
    } finally {
      await e.cleanup()
    }
  }, 200000)
})

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BookStore } from '../src/engine/pipeline/books'
import {
  beatIdOf,
  canonicalJson,
  catalogProblems,
  expectedCatalogKeys,
  packHashOf,
  readAuthoredBook,
  readVnPack,
  renderCatalog,
  renderPack,
  sceneIdOf,
  sourceHashOf,
  VnPackError,
  vnPackFromFolder,
  writeVnPack
} from '../src/engine/publish/vnPack'
import type { VnPack, VnPackInput, VnTextCatalog } from '../src/engine/publish/vnPack'
import { parseScript } from '../src/engine/publish/script'
import { scriptToXhtml } from '../src/engine/publish/xhtml'
import { uniqueVnKey, vnKey } from '../src/engine/publish/vnKey'

const FIXTURES = path.resolve(__dirname, '../tests/fixtures/vn-pack')
const names = ['soother', 'choice', 'mystery-puzzle'] as const
const dirOf = (name: string) => path.join(FIXTURES, name)

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, 'utf8')) as T

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

/** Every translatable value of a catalog, with its dotted key (the contract's §5 list). */
function catalogValues(text: VnTextCatalog): [string, string][] {
  const out: [string, string][] = []
  if (typeof text.title === 'string') out.push(['title', text.title])
  if (typeof text.blurb === 'string') out.push(['blurb', text.blurb])
  for (const field of ['chapterTitles', 'sceneTitles', 'choiceTexts', 'endings', 'characterNames', 'beats'] as const) {
    for (const [key, value] of Object.entries(text[field] ?? {})) out.push([`${field}.${key}`, value])
  }
  for (const [key, puzzle] of Object.entries(text.puzzles ?? {})) {
    for (const [id, value] of Object.entries(puzzle.names ?? {})) out.push([`puzzles.${key}.names.${id}`, value])
    for (const [id, value] of Object.entries(puzzle.text ?? {})) out.push([`puzzles.${key}.text.${id}`, value])
  }
  return out
}

/** A minimal compile input for the rules that no fixture needs (cues, unknown speakers, breaks, ids). */
const BIBLE = [
  '## Characters',
  '- **Mara**: Small and wiry, a yellow raincoat. Voice: dry',
  '- **Kessler**: Bald and broad, a grey coat. Aliases: the bald man. Voice: slow',
  '',
  '## Places',
  '- **The barn**: A red barn with straw on the floor.',
  '- **The cellar**: A low cellar under the inn.',
  '',
  '## Style',
  'Rain-soaked.'
].join('\n')

function inline(over: Partial<VnPackInput> = {}): VnPackInput {
  return {
    slug: 'inline-book',
    title: 'Inline Book',
    author: 'Test',
    genre: 'Mystery',
    format: 'visual-novel',
    primaryLang: 'en',
    bible: BIBLE,
    outline: null,
    chapters: [{ n: 1, title: 'One', body: 'SCENE: The barn, night\nMARA: Hello.\n' }],
    puzzles: [],
    sources: [
      { relpath: 'outline.md', text: '---\nkind: outline\n---\n' },
      { relpath: 'bible/bible.md', text: BIBLE },
      { relpath: 'chapters/ch-01.md', text: '---\nkind: chapter\nn: 1\n---\n' }
    ],
    ...over
  }
}

const compile = async (name: (typeof names)[number]) => vnPackFromFolder(dirOf(name))

describe('vnKey (VN Studio slugKey, contract §3)', () => {
  it('agrees with the contract’s shared test vectors', () => {
    expect(vnKey('Petra')).toBe('petra')
    expect(vnKey('Mango')).toBe('mango')
    expect(vnKey("Petra's House")).toBe('petra_s_house')
    expect(vnKey('Šime')).toBe('sime')
    expect(vnKey('The Bald Man')).toBe('the_bald_man')
  })

  it('prefixes a key that does not start with a letter and adds a hash when letters had no Latin form', () => {
    expect(vnKey('3rd Landing')).toBe('x_3rd_landing')
    expect(vnKey('灯')).toMatch(/^x_[0-9a-f]{6}$/)
    expect(vnKey('灯')).toBe(vnKey('灯'))
    expect(vnKey('灯')).not.toBe(vnKey('水'))
  })

  it('suffixes a collision in bible order', () => {
    const used = new Set<string>()
    expect(uniqueVnKey('Petra', used)).toEqual({ key: 'petra', collision: 0 })
    expect(uniqueVnKey('Petra', used)).toEqual({ key: 'petra_2', collision: 2 })
    expect(uniqueVnKey('Petra', used)).toEqual({ key: 'petra_3', collision: 3 })
  })
})

describe('canonical JSON and hashes', () => {
  it('sorts object keys at every depth and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,2]},"b":1}')
    expect(canonicalJson([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]')
  })

  it('hashes the pack without its packHash, and the authored files in the given order', () => {
    const pack = { format: 'vn-pack', version: 2, packHash: 'sha256:old', book: { slug: 'x' } } as unknown as VnPack
    const one = packHashOf(pack)
    const two = packHashOf({ ...pack, packHash: 'sha256:other' })
    expect(one).toBe(two)
    expect(one).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(sourceHashOf([{ relpath: 'book.md', text: 'a' }])).not.toBe(sourceHashOf([{ relpath: 'book.md', text: 'b' }]))
    expect(sourceHashOf([{ relpath: 'a', text: 'x' }])).not.toBe(sourceHashOf([{ relpath: 'b', text: 'x' }]))
  })
})

describe('the canonical fixture packs', () => {
  for (const name of names) {
    it(`compiles ${name} exactly to its committed vn/pack.json and vn/text/en.json, with no warning`, async () => {
      const result = await compile(name)
      const pack = await readJson<VnPack>(path.join(dirOf(name), 'vn', 'pack.json'))
      const text = await readJson<VnTextCatalog>(path.join(dirOf(name), 'vn', 'text', 'en.json'))
      expect(result.pack).toEqual(pack)
      expect(result.text).toEqual(text)
      expect(result.pack.packHash).toBe(result.text.packHash)
      expect(result.pack.packHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.sourceHash).toBe(result.pack.book.sourceHash)
      expect(result.warnings).toEqual([])
      // the pretty file is exactly what the compiler renders, so a fixture diff shows a code change
      expect(renderPack(pack)).toBe(await fs.readFile(path.join(dirOf(name), 'vn', 'pack.json'), 'utf8'))
      expect(renderCatalog(text)).toBe(await fs.readFile(path.join(dirOf(name), 'vn', 'text', 'en.json'), 'utf8'))
    })

    it(`keeps display text out of the ${name} template and structure out of its catalog`, async () => {
      const { pack, text } = await compile(name)
      expect(pack).not.toHaveProperty('title')
      expect(pack).not.toHaveProperty('blurb')
      for (const chapter of pack.chapters) {
        for (const scene of chapter.scenes) {
          for (const beat of scene.beats) {
            expect(beat).not.toHaveProperty('text')
            // a cue's `text` is an art description, not display text: take it out and no line's words remain in the template
            const cues = beat as { image?: { text?: string } | null; sfx?: { text?: string }; ambience?: { text?: string } | null }
            for (const cue of [cues.image, cues.sfx, cues.ambience]) if (cue) delete (cue as { text?: string }).text
          }
        }
      }
      const template = JSON.stringify(pack)
      const displayTexts: [string, string][] = [['title', text.title], ...(text.blurb ? ([['blurb', text.blurb]] as [string, string][]) : [])]
      for (const field of ['chapterTitles', 'sceneTitles', 'choiceTexts', 'endings', 'beats'] as const) {
        for (const [key, value] of Object.entries(text[field] ?? {})) displayTexts.push([`${field}.${key}`, value])
      }
      for (const [key, value] of displayTexts) expect(template, `${key}: ${value}`).not.toContain(value)
      // puzzle names and prose live in the catalog only; the template carries the core, the links and where its clues are found
      for (const puzzle of pack.puzzles) {
        expect(puzzle).not.toHaveProperty('names')
        expect(puzzle).not.toHaveProperty('text')
      }
      expect(catalogProblems(pack, text)).toEqual([])
      for (const [key, value] of catalogValues(text)) {
        expect(value, key).toBe(value.replace(/\s+/g, ' ').trim())
        expect(value, key).not.toMatch(/^(bg|sheet|sprite|cg|sfx|amb|music|voice|cover)_/)
        expect(value, key).not.toMatch(/\bch\d{2}\.s\d{2}(\.b\d{3})?\b/)
      }
    })

    it(`numbers the ${name} scenes and beats the way the contract says`, async () => {
      const { pack } = await compile(name)
      const ids = new Set<string>()
      for (const chapter of pack.chapters) {
        let sceneIndex = 0
        for (const scene of chapter.scenes) {
          sceneIndex++
          const expected = sceneIdOf(chapter.n, sceneIndex)
          expect(scene.id).toBe(expected)
          expect(scene.beats.length, scene.id).toBeGreaterThan(0)
          scene.beats.forEach((beat, i) => {
            expect(beat.id).toBe(beatIdOf(expected, i + 1))
            expect(ids.has(beat.id), beat.id).toBe(false)
            ids.add(beat.id)
          })
        }
      }
      const first = pack.chapters[0]!.scenes[0]!
      expect(first.id).toBe('ch01.s01')
      expect(first.beats[0]!.id).toBe('ch01.s01.b001')
    })
  }
})

describe('the soother fixture: cast, looks, cues and aliases', () => {
  it('has the bible keys, the alias keys and the alias display names', async () => {
    const { pack, text } = await compile('soother')
    expect(pack.characters.map((c) => c.key)).toEqual(['petra', 'mango', 'grumble'])
    expect(pack.characters[0]).toMatchObject({ key: 'petra', aliasKeys: ['petra#1', 'petra#2'] })
    expect(text.characterNames).toMatchObject({ petra: 'Petra', 'petra#1': 'the girl', 'petra#2': 'little storm' })
    expect(pack.places.map((p) => p.key)).toEqual(['petra_s_garden', 'bubble_gum_volcano', 'the_golden_cave'])
  })

  it('attaches a cue to the next beat, ends the picture where one does, and resolves an alias speaker', async () => {
    const { pack, text } = await compile('soother')
    const first = pack.chapters[0]!.scenes[0]!
    const byId = (id: string) => first.beats.find((b) => b.id === id)!
    expect(byId('ch01.s01.b003')).toMatchObject({ type: 'line', speakerKey: 'petra', expression: 'grumpy', ambience: { text: 'birds in the garden' } })
    // no bracket: the speaker keeps the last expression of the scene (docs: "Without a bracket, keep the last one")
    expect(byId('ch01.s01.b004')).toMatchObject({ expression: 'grumpy', sfx: { text: 'a baby wailing indoors' } })
    expect(byId('ch01.s01.b005')).toMatchObject({ type: 'narration', image: { display: 'full', text: 'Petra throws the soother over the mountains' } })
    expect(byId('ch01.s01.b007')).toMatchObject({ type: 'cast', image: null })
    // THE GIRL is Petra's alias: the beat is her, the text is the words only, and aliasKey keeps the name tag for VN Studio
    expect(byId('ch01.s01.b006')).toMatchObject({ type: 'line', speakerKey: 'petra', expression: 'worried', aliasKey: 'petra#1' })
    expect(text.beats['ch01.s01.b006']).toBe('Oops.')
    // a line under the character's own name has no aliasKey
    expect(byId('ch01.s01.b003')).not.toHaveProperty('aliasKey')
    // an INSERT: line before a speaker line is that beat's picture
    const second = pack.chapters[0]!.scenes[1]!
    expect(second.beats.find((b) => b.id === 'ch01.s02.b002')).toMatchObject({ image: { display: 'insert', text: 'a blue soother on a cushion of gum' } })
    expect(text.sceneTitles['ch01.s02']).toBe('The bubble-gum volcano, morning')
    expect(text.beats['ch01.s01.b001']).toBe('The sun is warm and the clothesline flaps.')
  })
})

describe('the choice fixture: map, choices and endings', () => {
  it('matches the outline map and puts the text in the catalog', async () => {
    const { pack, text } = await compile('choice')
    expect(pack.book.kind).toBe('choice')
    expect(pack.chapters.map((c) => c.n)).toEqual([1, 2, 3, 4])
    expect(pack.chapters[0]).toMatchObject({ isEnding: false, choices: [{ index: 0, to: 2 }, { index: 1, to: 3 }] })
    expect(pack.chapters[1]).toMatchObject({ isEnding: true, choices: [] })
    expect(pack.chapters[2]).toMatchObject({ isEnding: false, choices: [{ index: 0, to: 4 }] })
    expect(pack.chapters[3]).toMatchObject({ isEnding: true, choices: [] })
    expect(text.choiceTexts).toEqual({ '1:0': 'Wait at the harbour wall', '1:1': 'Row out to find him', '3:0': 'Take the letter to the keeper' })
    expect(text.endings).toEqual({ '2': 'bittersweet: the boat is found, empty', '4': 'hopeful: the boat turns for home' })
    expect(text.chapterTitles).toEqual({ '1': 'The Late Boat', '2': 'The Empty Harbour', '3': 'The Letter in the Lamp', '4': 'The Lighthouse Answers' })
    // Mara's unbracketed "Then I will keep mine." keeps her worried face from the scene's first line
    const first = pack.chapters[0]!.scenes[0]!
    expect(first.beats.find((b) => b.id === 'ch01.s01.b006')).toMatchObject({ type: 'line', speakerKey: 'mara', expression: 'worried' })
  })
})

describe('the mystery-puzzle fixture: puzzles, clues, evidence, testimony', () => {
  it('keeps the core unchanged and the clue/evidence/testimony beats where the contract maps them', async () => {
    const { pack, text } = await compile('mystery-puzzle')
    const puzzle = pack.puzzles[0]!
    expect(puzzle).toMatchObject({ key: 'dinner', kind: 'murdle', chapter: 2, hints: true, onFail: { mode: 'retry' } })
    expect(puzzle.data).toMatchObject({ format: 1, kind: 'murdle', size: 3 })
    expect(puzzle.clueAt).toEqual({ c1: 'ch01.s01.b003', c2: 'ch01.s01.b004', c3: 'ch01.s01.b005', c4: 'ch01.s01.b006' })
    expect(puzzle.links).toMatchObject({ s1: { type: 'character', key: 'colonel_ash' }, s2: { type: 'character', key: 'miss_cole' }, p1: { type: 'place', key: 'the_library' } })
    expect(puzzle.verified).toMatchObject({ unique: true, deducible: true, by: 'vno_puzzle_generate' })
    const scene = pack.chapters[0]!.scenes[0]!
    // CLUE lines are narration beats; the narration beat text is in the catalog
    expect(scene.beats.find((b) => b.id === 'ch01.s01.b003')).toEqual({ id: 'ch01.s01.b003', type: 'narration' })
    // EVIDENCE is narration plus its own insert, keyed by the evidence key
    expect(scene.beats.find((b) => b.id === 'ch01.s01.b007')).toMatchObject({ type: 'narration', image: { display: 'insert', key: 'pocket_watch', text: 'A pocket watch, stopped at 9:10, its glass cracked.' } })
    // the picture of the evidence is hidden at the next beat
    expect(scene.beats.find((b) => b.id === 'ch01.s01.b008')).toMatchObject({ image: null })
    // Miss Cole's unbracketed line keeps her calm face from earlier in the scene
    expect(scene.beats.find((b) => b.id === 'ch01.s01.b009')).toMatchObject({ type: 'line', speakerKey: 'miss_cole', expression: 'calm' })
    // PUZZLE is a puzzle beat; TESTIMONY statements are line beats
    const second = pack.chapters[1]!.scenes[0]!
    expect(second.beats.find((b) => b.type === 'puzzle')).toMatchObject({ type: 'puzzle', puzzle: 'dinner' })
    // the second statement (no bracket) also keeps calm
    expect(second.beats.find((b) => b.id === 'ch02.s01.b004')).toMatchObject({ type: 'line', speakerKey: 'miss_cole', expression: 'calm' })
    expect(text.beats['ch02.s01.b003']).toBe('I was in the kitchen all evening.')
    expect(text.beats['ch02.s01.b004']).toBe('I never touched the poison.')
    // the puzzle's prose is the story's own words, and the canonical murder note is kept
    expect(text.puzzles!.dinner!.text).toEqual({
      c1: "The rope was in Colonel Ash's hands, Miss Cole noted.",
      c2: "The poison was Miss Cole's, and everyone knew it.",
      c3: 'Colonel Ash had been in the library all evening.',
      c4: 'Miss Cole was in the kitchen when the clocks stopped.',
      murder: 'The body was found in the library.'
    })
    expect(catalogProblems(pack, text)).toEqual([])
  })
})

describe('compileVnPack: cues, breaks, numbering, unknown names', () => {
  it('puts a picture that stops on the next beat, and moves a trailing SFX onto the scene’s last beat', async () => {
    const { pack, warnings } = await import('../src/engine/publish/vnPack').then((m) =>
      m.compileVnPack(
        inline({
          chapters: [
            {
              n: 1,
              title: 'One',
              body: [
                'SCENE: The barn, night',
                'AMBIENCE: rain on the roof',
                'SFX: a gate',
                'CG: a lantern in the dark',
                'MARA (worried): Who is there?',
                'INSERT: a letter',
                'MARA: Read it.',
                'END CG',
                'MARA: Go.',
                'CG: a figure in the doorway',
                'SFX: a bell',
                'CG: a face at the window'
              ].join('\n')
            }
          ]
        })
      )
    )
    const beats = pack.chapters[0]!.scenes[0]!.beats
    expect(beats).toHaveLength(3)
    expect(beats[0]).toMatchObject({ type: 'line', speakerKey: 'mara', image: { display: 'full', text: 'a lantern in the dark' }, ambience: { text: 'rain on the roof' }, sfx: { text: 'a gate' } })
    expect(beats[1]).toMatchObject({ image: { display: 'insert', text: 'a letter' } })
    // END CG hides the picture at the next beat; a trailing SFX goes on that last beat, and the trailing CG has no beat after it and is dropped
    expect(beats[2]).toMatchObject({ image: null, sfx: { text: 'a bell' } })
    expect(warnings.join(' ')).toMatch(/a picture cue at the end of a scene has no beat to play with: dropped/)
  })

  it('numbers only the scenes that have a beat, and marks a scene a `---` came before', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack, warnings } = compileVnPack(
      inline({
        chapters: [
          {
            n: 1,
            title: 'One',
            body: ['SCENE: The barn, night', 'MARA: One.', '---', 'SCENE: The cellar, midnight', 'MARA: Down here.'].join('\n')
          },
          {
            n: 2,
            title: 'Two',
            body: ['SCENE: The barn, night', 'CG: a cart', '---', 'SCENE: The cellar, dawn', 'MARA: Up again.'].join('\n')
          }
        ]
      })
    )
    const scenes = pack.chapters[0]!.scenes
    expect(scenes.map((s) => s.id)).toEqual(['ch01.s01', 'ch01.s02'])
    expect(scenes[0]).toMatchObject({ breakBefore: false, placeKey: 'the_barn' })
    expect(scenes[1]).toMatchObject({ breakBefore: true, placeKey: 'the_cellar' })
    // a scene with only a cue has no beat: it is left out, and the `---` after it still breaks the next scene
    const second = pack.chapters[1]!.scenes
    expect(second.map((s) => s.id)).toEqual(['ch02.s01'])
    expect(second[0]).toMatchObject({ breakBefore: true, placeKey: 'the_cellar' })
    expect(warnings.join(' ')).toMatch(/has no beat after its cues: left out of the pack/)
  })

  it('reads a SCENE with a description as place and time, keeps the time raw, and puts the rest in the description', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack } = compileVnPack(
      inline({
        chapters: [
          {
            n: 1,
            title: 'One',
            body: [
              'SCENE: The barn, midday. Rain drums on the roof.',
              'MARA: Hm.',
              '---',
              'SCENE: The old mill house, near the river. Dust everywhere.',
              'MARA: Again.',
              '---',
              'SCENE: Dragon Land, near a bubble-gum volcano. The sky is green.',
              'MARA: Third.'
            ].join('\n')
          }
        ]
      })
    )
    const scenes = pack.chapters[0]!.scenes
    // place + time + the rest after the first full stop in the description (with the place looks)
    expect(scenes[0]).toMatchObject({ placeKey: 'the_barn', placeText: 'The barn', time: 'midday' })
    expect(scenes[0]!.description).toBe('Rain drums on the roof. A red barn with straw on the floor.')
    // no time in the tail: the whole head before the first full stop is the place; not in the bible -> null key, text kept
    expect(scenes[1]).toMatchObject({ placeKey: null, placeText: 'The old mill house, near the river', time: null })
    expect(scenes[1]!.description).toBe('Dust everywhere.')
    // a comma before a non-time phrase is part of the place
    expect(scenes[2]).toMatchObject({ placeKey: null, placeText: 'Dragon Land, near a bubble-gum volcano', time: null })
  })

  it('gives a line without a bracket the speaker’s last expression in the scene, and resets with the scene', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack } = compileVnPack(
      inline({
        chapters: [
          {
            n: 1,
            title: 'One',
            body: [
              'SCENE: The barn, night',
              'MARA (worried): One.',
              'MARA: Two.',
              'KESSLER: Three.',
              'MARA (angry): Four.',
              'MARA: Five.',
              '---',
              'SCENE: The cellar, midnight',
              'MARA: Six.'
            ].join('\n')
          }
        ]
      })
    )
    const expressions = pack.chapters[0]!.scenes.flatMap((s) => s.beats.flatMap((b) => (b.type === 'line' ? [`${b.speakerKey}:${b.expression}`] : [])))
    expect(expressions).toEqual(['mara:worried', 'mara:worried', 'kessler:neutral', 'mara:angry', 'mara:angry', 'mara:neutral'])
  })

  it('gives an unknown speaker a synthetic key, keeps an unknown place’s text with a null key, and still compiles', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack, text, warnings } = compileVnPack(
      inline({
        chapters: [{ n: 1, title: 'One', body: ['SCENE: The harbour, midnight', 'THE STRANGER (cold): Who are you?', 'MARA: Nobody.'].join('\n') }]
      })
    )
    expect(pack.characters.map((c) => c.key)).toEqual(['mara', 'kessler', 'speaker_1'])
    expect(pack.characters[2]).toMatchObject({ key: 'speaker_1', looks: '', aliasKeys: [] })
    expect(text.characterNames.speaker_1).toBe('THE STRANGER')
    // an unknown place invents nothing: placeKey null, the text stays, the bible's places are untouched
    expect(pack.chapters[0]!.scenes[0]).toMatchObject({ placeKey: null, placeText: 'The harbour' })
    expect(pack.places.map((p) => p.key)).toEqual(['the_barn', 'the_cellar'])
    expect(warnings.join(' ')).toMatch(/synthetic character speaker_1/)
    expect(warnings.join(' ')).toMatch(/place "The harbour" is not in the bible: the scene keeps its place text \(placeKey null\)/)
    expect(catalogProblems(pack, text)).toEqual([])
  })

  it('drops an ON SCREEN prop, page or sentence with a warning and never makes a character of it', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack, text, warnings } = compileVnPack(
      inline({
        chapters: [
          {
            n: 1,
            title: 'One',
            body: ['SCENE: The barn, night', 'ON SCREEN: Mara (raincoat), the soother spinning in the sky', 'ON SCREEN: A sign that reads "LOST THINGS OFFICE"', 'MARA: Hm.'].join('\n')
          }
        ]
      })
    )
    // only the bible character is cast; no synthetic character and no cast beat for a props-only line
    expect(pack.characters.map((c) => c.key)).toEqual(['mara', 'kessler'])
    expect(text.characterNames).toEqual({ mara: 'Mara', kessler: 'Kessler', 'kessler#1': 'the bald man' })
    const beats = pack.chapters[0]!.scenes[0]!.beats
    expect(beats).toHaveLength(2)
    expect(beats[0]).toEqual({ id: 'ch01.s01.b001', type: 'cast', cast: [{ charKey: 'mara', look: 'raincoat' }] })
    expect(beats[1]).toMatchObject({ type: 'line', speakerKey: 'mara' })
    expect(warnings.join(' ')).toMatch(/ON SCREEN entry "the soother spinning in the sky" is not a bible character or alias: dropped/)
    expect(warnings.join(' ')).toMatch(/ON SCREEN entry "A sign that reads "LOST THINGS OFFICE"" is not a bible character or alias: dropped/)
    expect(catalogProblems(pack, text)).toEqual([])
  })

  it('keeps the aliasKey of a line spoken under an alias (by spelling or by alias key) and omits it otherwise', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    const { pack, text } = compileVnPack(
      inline({
        chapters: [{ n: 1, title: 'One', body: ['SCENE: The barn, night', 'THE BALD MAN (grim): Sit.', 'KESSLER: Enough.', 'kessler#1: Softly, now.'].join('\n') }]
      })
    )
    const beats = pack.chapters[0]!.scenes[0]!.beats
    expect(beats[0]).toMatchObject({ type: 'line', speakerKey: 'kessler', expression: 'grim', aliasKey: 'kessler#1' })
    expect(beats[1]).toMatchObject({ type: 'line', speakerKey: 'kessler' })
    expect(beats[1]).not.toHaveProperty('aliasKey')
    expect(beats[2]).toMatchObject({ type: 'line', speakerKey: 'kessler', aliasKey: 'kessler#1' })
    expect(text.characterNames['kessler#1']).toBe('the bald man')
  })

  it('refuses a catalog value that would be empty', async () => {
    const { compileVnPack } = await import('../src/engine/publish/vnPack')
    expect(() => compileVnPack(inline({ chapters: [{ n: 1, title: 'One', body: 'SCENE: The barn, night\nMARA: Hello.' }], title: '' }))).toThrow(VnPackError)
  })
})

describe('parser hardening (SCP-45)', () => {
  it('reads N:, NARRATION: and NARRATOR: as narration, not as speakers', () => {
    const { scenes } = parseScript(['SCENE: The barn, night', 'N: One.', 'NARRATION: Two.', 'NARRATOR (calm): Three.'].join('\n'))
    expect(scenes[0]!.beats).toEqual([
      { type: 'narration', text: 'One.' },
      { type: 'narration', text: 'Two.' },
      { type: 'narration', text: 'Three.' }
    ])
    // the old book label is not left in the text, and a screenplay keeps its NARRATOR speaker
    expect(scriptToXhtml(['SCENE: The barn, night', 'NARRATION: Two.'].join('\n'))).toContain('<p class="vn-narration">Two.</p>')
    expect(scriptToXhtml('SCENE: A pier, dusk\nNARRATOR: Every evening.', { screenplay: true })).toContain('<span class="vn-speaker">NARRATOR</span> Every evening.')
  })

  it('maps a C<n>, a bible key and an alias key speaker token to the character', () => {
    const bible = [{ name: 'Petra', aliases: ['the girl'] }, { name: 'Mango', aliases: [] }]
    const { scenes } = parseScript(['SCENE: The barn, night', 'C1 (worried): Oops.', 'mango: Ooh, shiny!', 'petra#1: I am Petra.'].join('\n'), ['Petra', 'Mango'], bible)
    expect(scenes[0]!.beats).toEqual([
      { type: 'line', speaker: 'Petra', expression: 'worried', text: 'Oops.' },
      { type: 'line', speaker: 'Mango', expression: '', text: 'Ooh, shiny!' },
      { type: 'line', speaker: 'Petra', expression: '', text: 'I am Petra.', alias: 'the girl' }
    ])
  })

  it('reads a screenplay direction that looks like a speaker label as narration, not as a character', () => {
    const body = ['SCENE: The barn, night', 'MARA: Hm.', 'SMASH CUT TO: Grumble sets the soother down.'].join('\n')
    const { scenes } = parseScript(body)
    expect(scenes[0]!.beats).toEqual([
      { type: 'line', speaker: 'MARA', expression: '', text: 'Hm.' },
      { type: 'narration', text: 'Grumble sets the soother down.' }
    ])
    const html = scriptToXhtml(body)
    expect(html).toContain('<p class="vn-narration">Grumble sets the soother down.</p>')
    expect(html).not.toMatch(/vn-speaker">SMASH/)
  })

  it('never reads a cue or puzzle keyword as a speaker, even when the line does not fit its pattern', () => {
    const { scenes } = parseScript(['SCENE: The barn, night', 'MARA: Hm.', 'CLUE: no slash here', 'EVIDENCE: just words', 'AMBIENCE: rain'].join('\n'))
    expect(scenes[0]!.beats).toEqual([
      { type: 'line', speaker: 'MARA', expression: '', text: 'Hm.' },
      { type: 'narration', text: 'CLUE: no slash here' },
      { type: 'narration', text: 'EVIDENCE: just words' },
      { type: 'cue', cue: 'ambience', text: 'rain' }
    ])
    const html = scriptToXhtml(['SCENE: The barn, night', 'MARA: Hm.', 'CLUE: no slash here'].join('\n'))
    expect(html).not.toMatch(/vn-speaker">CLUE/)
    expect(html).toContain('<p class="vn-narration">CLUE: no slash here</p>')
  })
})

describe('writing and reading a pack of a book folder', () => {
  it('writes the pack and catalog atomically, sets vn_version, and reads them back without problems or staleness', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scp45-pack-'))
    tempDirs.push(dir)
    const books = new BookStore(dir)
    const slug = 'the-soother-fell-into-dragon-land'
    await fs.cp(dirOf('soother'), books.file(slug), { recursive: true })
    const written = await writeVnPack(books, slug)
    expect(written.packPath).toBe(books.file(slug, 'vn', 'pack.json'))
    expect(written.textPath).toBe(books.file(slug, 'vn', 'text', 'en.json'))
    expect((await books.read(slug))?.data.vn_version).toBe(2)
    expect(written.pack.packHash).toBe(packHashOf(written.pack))
    expect(written.pack.book.sourceHash).toBe(written.sourceHash)
    // the hash covers the authored script files in the contract's order, and not book.md
    const authored = await readAuthoredBook(books.dir(slug))
    expect(authored.sources.map((s) => s.relpath)).toEqual(['outline.md', 'bible/bible.md', 'cover-brief.md', 'chapters/ch-01.md', 'chapters/ch-02.md'])
    expect(sourceHashOf(authored.sources)).toBe(written.sourceHash)
    const readBack = await readVnPack(books, slug)
    expect(readBack.stale).toBe(false)
    expect(readBack.problems).toEqual([])
    expect(readBack.warnings).toEqual([])
    expect(readBack.text.title).toBe('The Soother Fell Into Dragon Land')
    // a book.md-only change (the cover the publisher requests) does not make the pack stale
    await books.update(slug, () => ({ cover_png: 'done' }))
    expect((await readVnPack(books, slug)).stale).toBe(false)
    // a chapter edit makes the sourceHash stale: it is reported, never ignored
    const chapterFile = books.chapterFile(slug, 1)
    await fs.appendFile(chapterFile, '\nMARA: One more line.\n', 'utf8')
    const stale = await readVnPack(books, slug)
    expect(stale.stale).toBe(true)
    expect(stale.warnings.join(' ')).toMatch(/stale/)
  })

  it('refuses a book with no pack, and reports a catalog that does not match the pack', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scp45-pack-'))
    tempDirs.push(dir)
    const books = new BookStore(dir)
    const slug = 'the-lighthouse-letters'
    await fs.cp(dirOf('choice'), books.file(slug), { recursive: true })
    await fs.rm(books.file(slug, 'vn'), { recursive: true, force: true })
    await expect(readVnPack(books, slug)).rejects.toThrow(/run build_vn_pack/)
  })

  it('reports the expected catalog key set of the template', async () => {
    const { pack, text } = await compile('choice')
    const keys = expectedCatalogKeys(pack)
    expect(keys.chapterTitles).toEqual(['1', '2', '3', '4'])
    expect(keys.choiceTexts).toEqual(['1:0', '1:1', '3:0'])
    expect(keys.endings).toEqual(['2', '4'])
    expect(keys.characterNames).toEqual(['mara', 'mara#1', 'kessler'])
    expect(keys.beats).toHaveLength(Object.keys(text.beats).length)
    expect(catalogProblems(pack, { ...text, beats: { ...text.beats, 'ch01.s01.b001': '' } }).join(' ')).toMatch(/beats.ch01.s01.b001: empty/)
    expect(catalogProblems(pack, { ...text, chapterTitles: { ...text.chapterTitles, '9': 'Extra' } }).join(' ')).toMatch(/chapterTitles: unknown 9/)
  })
})

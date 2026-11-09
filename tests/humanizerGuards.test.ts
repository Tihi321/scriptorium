import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { englishShare, foreignLines, fragmentShare, humanizeProblem, newNames } from '../src/engine/pipeline/humanizerHandlers'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, seedDir, waitFor } from './helpers'

const ORIGINAL = [
  'Mrs Delacroix was eighty-four years old, and she had been the widow of a judge for twenty years. She lived on the second floor, where the stairs were steep.',
  'She did not like visitors. Nobody came to see her any more, and she did not mind that much.',
  'In the evening the old woman sat by the window and watched the street, which was quiet and wet.'
].join(' ')

// the live failure: sentences broken into a string of verbless fragments
const FRAGMENTED = [
  'Eighty-four years old, widow of a judge, second floor, steep stairs. Not young. Not loud.',
  'No visitors. Nobody came. She did not mind that much, and she did not care.',
  'Evening, the window, the street. Quiet and wet. The old woman sat there, watching everything. Dust on the sill. A stopped clock. Cold tea. Rain, rain, rain. Grey light, grey hair, grey coat.'
].join(' ')

// the same story, livelier, in whole sentences
const LIVELIER = [
  'Mrs Delacroix was eighty-four, and for twenty years she had been the widow of a judge. She lived on the second floor, up the steep stairs.',
  'She disliked most visitors. Nobody came to see her any more, and she did not mind that much.',
  'In the evening the old woman sat by the window and watched the street, which was quiet and wet.'
].join(' ')

describe('the fragment guard', () => {
  it('counts verbless fragments in the narration only', () => {
    expect(fragmentShare(ORIGINAL)).toBeLessThan(0.2)
    expect(fragmentShare(FRAGMENTED)).toBeGreaterThan(0.5)
    expect(fragmentShare('"Not young. Not loud. Never." she said, and she laughed at him for a long time.')).toBe(0) // speech is left out
    expect(fragmentShare('SCENE: A barn, night\nMARA (tired): Not young.\nThe fox yawned and curled up in the hay.\nON SCREEN: Mara (tired)', true)).toBe(0)
    expect(fragmentShare('')).toBe(0)
  })

  it('refuses a version that broke sentences into fragments, and accepts one with the same share', () => {
    const problem = humanizeProblem(ORIGINAL, FRAGMENTED)
    expect(problem).toMatch(/^it broke sentences into fragments \(\d+% before, \d+% after\)$/)
    expect(humanizeProblem(ORIGINAL, LIVELIER)).toBeNull()
  })

  it('accepts the real science-blink ch05 rewrite (present tense and contractions are verbs)', async () => {
    const dir = path.join(__dirname, 'fixtures', 'humanizer')
    const read = async (name: string) => (await readFile(path.join(dir, name), 'utf8')).replace(/\r\n/g, '\n')
    expect(humanizeProblem(await read('ch05-before.md'), await read('ch05-after.md'), { nonfiction: true })).toBeNull()
  })
})

describe('the language guard', () => {
  const english = 'The fox walked along the river and the morning was cold.\nHe stopped at the bridge, because he heard a voice from the other bank, and he waited there for a long time without moving.'
  // the second paragraph is a line of French speech instead
  const mixed = 'The fox walked along the river and the morning was cold.\n"Bonjour, je suis très content de vous voir ici ce soir, et je ne suis pas pressé du tout, parce que la nuit est belle."'

  it('counts lines that are not English, and the English share', () => {
    expect(foreignLines(english)).toBe(0)
    expect(foreignLines('"Bonjour, je suis très content de vous voir ici ce soir," dit le renard à la rivière.')).toBe(1)
    expect(foreignLines('Hola, el zorro está en la casa y los niños no duermen todavía.')).toBe(1)
    expect(englishShare(english)).toBeGreaterThan(0.3)
    expect(englishShare('')).toBe(0)
  })

  it('refuses a version that put French lines into an English chapter, and keeps French that was already there', () => {
    expect(humanizeProblem(english, mixed)).toMatch(/^it changed the language of \d+ line\(s\)$/)
    const french = '"Bonjour, je suis très content de vous voir ici ce soir," dit le renard à la rivière.'
    const before = `The fox walked along the river and the morning was cold.\n${french}\nHe stopped at the bridge, because he heard a voice from the other bank.`
    const after = `Along the river the fox walked, and the morning was cold.\n${french}\nHe stopped at the bridge, because he heard a voice from the far bank.`
    expect(humanizeProblem(before, after)).toBeNull()
  })
})

describe('units and group nouns are not names', () => {
  it('"50 Hz" and "the hum at 50 Hz" are no new name, "Captain Rourke" still is', () => {
    expect(newNames('The signal hums at 50 Hz and the antenna sends 12 MW of power.', 'The signal hums.')).toEqual([])
    expect(newNames('She heard the hum at 50 Hz, a low sound that came from the station.', 'She heard a hum.')).toEqual([])
    expect(newNames('The lamp, the hum, and then Captain Rourke came in.', 'The lamp and the hum.')).toEqual(['Captain', 'Rourke'])
    // group nouns, plurals and singulars of known words are no new names
    expect(newNames('She read about the Greeks, the Stoics and the Romans.', 'She read about the Greek Fates.')).toEqual([])
    expect(newNames('He met a Greek there.', 'He met the Greeks.')).toEqual([])
    // a capitalised -ans/-ics word is a group noun only in context (the, a quantifier, an adjective, a joiner after a group noun): "Evans" is a name
    expect(newNames('The lamp hummed, and then Evans came in.', 'The lamp hummed and came in.')).toEqual(['Evans'])
    expect(newNames('Many Romans and the Christians feared it.', 'It was feared.')).toEqual([])
    // after a joiner (when the word before is a group noun) or an adjective; names stay caught
    expect(newNames('She read about the Greeks and Romans, and the Stoics and Epicureans.', 'She read.')).toEqual([])
    expect(newNames('The early Christians and ancient Romans feared it.', 'It was feared.')).toEqual([])
    expect(newNames('The lamp hummed, and Captain Evans and Hughes came in.', 'The lamp hummed and came in.')).toEqual(['Captain', 'Evans', 'Hughes'])
    const ch01 = 'Long ago the Greek Fates spun the thread, and every mortal waited to learn how long it would be before the cold wind came down.'
    expect(humanizeProblem(ch01, ch01.replace('Long ago the Greek Fates', 'We begin with the Greeks, whose Fates'))).toBeNull()
    const base = 'The antenna sends a signal. It hums at a low pitch, and the keeper waits for the dawn to come over the hills.'
    expect(humanizeProblem(base, base.replace('a low pitch', '50 Hz').replace('hums', 'hums, steady,'))).toMatch(/numbers changed/) // the number is still a number change, not a name
    const withUnit = 'The antenna sends a signal at 50 Hz. It hums, and the keeper waits for the dawn to come over the hills.'
    expect(humanizeProblem(withUnit, withUnit.replace('It hums', 'It hums on'))).toBeNull()
  })
})

describe('the seed prompt', () => {
  it('no longer tells the model to write one-word sentences, and asks for whole sentences and English', async () => {
    for (const f of ['humanize_chapter.md', 'humanize_chapter_vn.md', 'humanize_chapter_article.md']) {
      const text = await readFile(path.join(seedDir, 'prompts', 'humanizer', f), 'utf8')
      expect(text, f).not.toContain('Sometimes a sentence is one word')
      expect(text, f).toContain('keep whole sentences')
      expect(text, f).toContain('Write in English, as the original is.')
    }
  })
})

describe('group nouns: bounds and names', () => {
  it('a long run of joined group nouns is cheap', () => {
    const text = 'She read about the ' + Array.from({ length: 400 }, () => 'Stoics').join(', ') + ' and Epicureans.'
    const t0 = performance.now()
    newNames(text, 'She read.')
    expect(performance.now() - t0).toBeLessThan(100)
  })

  it('a name after a joiner or "of" is not a group noun', () => {
    expect(newNames('The lamp hummed. She saw the Stoics and Evans come in.', 'The lamp hummed. She saw come in.')).toEqual(['Evans'])
    expect(newNames('The lamp hummed. She saw the friend of Evans.', 'The lamp hummed. She saw the friend.')).toEqual(['Evans'])
    expect(newNames('She read about the Stoics of Epicureans and Christians.', 'She read.')).toEqual([])
  })

  it('real group nouns after a joiner or "of" pass, whatever their ending; short surnames still do not', () => {
    const phrases = [
      'the Catholics and Anglicans',
      'the Catholics and Lutherans',
      'the Greeks and Americans',
      'the Greeks and Africans',
      'the fate of Americans',
      'the fate of Puritans',
      'the Jews and Samaritans',
      'the Greeks, Romans and Etruscans',
      'the Franciscans and Dominicans',
      'the Stoics, Cynics, Epicureans, Sceptics, Platonists, Aristotelians, Pythagoreans, Sophists, Megarians, Eleatics and Atomists',
    ]
    for (const p of phrases) expect(newNames(`She read about ${p} today.`, 'She read.'), p).toEqual([])
  })

  it('an adjective matches in any case', () => {
    expect(newNames('Early Christians prayed here.', 'They prayed here.')).toEqual([])
  })
})

describe('the humanizer in a pipeline: a leak at the end of the answer', () => {
  type Env = Awaited<ReturnType<typeof makePipelineEnv>>
  let env: Env | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('cuts the task instructions a model repeated after the chapter, and goes on with the chapter', async () => {
    const tail = 'Write the whole chapter again, from its first line to its last. Reply with the text of the chapter only, as plain prose: no title, no heading, no notes, no explanation of what you changed.'
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler', humanizer: true, humanizeWith: (chapter) => `${chapter}\n\n${tail}` })
    const e = env
    const slug = (await waitFor(async () => (await readdir(path.join(e.dir, 'books')))[0] ?? null, 30000, 'a book'))!
    await waitFor(async () => parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8').catch(() => '')).data.stage === 'published', 90000, 'the book to be published')
    const ch = parseMd(await readFile(path.join(e.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8'))
    expect(ch.data.humanized).toBe(0)
    expect(ch.body).not.toContain('Write the whole chapter again')
    const job = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--humanize--ch01--r0.md`), 'utf8'))
    expect(job.body).toMatch(/chapter 1 humanized/)
    await e.engine.logs.flush()
    expect(await readFile(path.join(e.dir, 'books', slug, 'log.md'), 'utf8')).toContain('the answer ended with the task instructions: cut off')
  }, 120000)
})

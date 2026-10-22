import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatsForKind, variant } from '../src/engine/pipeline/handlers'
import { loadPrompt } from '../src/engine/pipeline/prompts'
import { defaultSeconds, musicCues, parseScreenplay, parseShotSpec, runtimeOf } from '../src/engine/publish/screenplay'
import { markdownToXhtml, scriptToXhtml } from '../src/engine/publish/xhtml'
import { writeMd } from '../src/engine/store/atomic'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { migrateScreenplay, SCREENPLAY_FORMAT_IDS } from '../src/engine/store/migrations'
import { parseTopics } from '../src/engine/store/topics'
import { emptyBrief } from '../src/shared/brief'
import { parseMd } from '../src/shared/md'
import { formatsSchema } from '../src/shared/schemas'
import type { FormatEntry } from '../src/shared/schemas'
import { makePipelineEnv, seedDir, waitFor } from './helpers'

const EXAMPLE = [
  'SCENE: The harbour wall, dusk',
  'Rain needles the grey water. The lighthouse beam sweeps over the boats.',
  'MUSIC: slow solo piano, melancholic, sparse',
  'SHOT (extreme wide, static, 6s): The pier at dusk, a small figure at its far end, the beam passing over her.',
  'NARRATOR: Every evening, Mara waited for the last boat.',
  'SHOT (medium, slow push-in, 4s): Mara grips the rusted rail, rain running off her hood.',
  'ON SCREEN: Mara (soaked yellow raincoat, worried)',
  'SFX: wind, rain on oilskin',
  "MARA (worried): He said he'd be back before the lamp was lit.",
  'SHOT (medium two-shot, static, 6s): Tomas skids to a stop beside her, out of breath, grinning.',
  'ON SCREEN: Mara (startled), Tomas (out of breath, grinning)',
  'TOMAS (grinning): Did you miss me?',
  "MARA (annoyed): You're *late*.",
  'MUSIC: stop'
].join('\n')

describe('parseScreenplay', () => {
  it('parses the example of docs/screenplay.md: scene, shots, cast, music and runtime', () => {
    const { scenes } = parseScreenplay(EXAMPLE, ['Mara', 'Tomas'])
    expect(scenes).toHaveLength(1)
    const s = scenes[0]!
    expect(s).toMatchObject({ id: 'ch01.s01', place: 'The harbour wall', time: 'dusk', background: 'Rain needles the grey water. The lighthouse beam sweeps over the boats.' })
    expect(s.shots.map((x) => x.id)).toEqual(['ch01.s01.sh01', 'ch01.s01.sh02', 'ch01.s01.sh03'])
    expect(s.shots[0]).toMatchObject({ framing: 'extreme wide', move: 'static', seconds: 6, continuous: false, cast: [], title: null, sfx: [] })
    expect(s.shots[0]!.lines).toEqual([{ speaker: 'Narrator', delivery: '', text: 'Every evening, Mara waited for the last boat.', kind: 'voice-over' }])
    expect(s.shots[1]).toMatchObject({ framing: 'medium', move: 'slow push-in', seconds: 4, action: 'Mara grips the rusted rail, rain running off her hood.', sfx: ['wind, rain on oilskin'] })
    expect(s.shots[1]!.cast).toEqual([{ name: 'Mara', look: 'soaked yellow raincoat, worried' }])
    expect(s.shots[1]!.lines).toEqual([{ speaker: 'Mara', delivery: 'worried', text: "He said he'd be back before the lamp was lit.", kind: 'dialogue' }])
    expect(s.shots[2]).toMatchObject({ framing: 'medium two-shot', seconds: 6 })
    expect(s.shots[2]!.cast.map((c) => c.name)).toEqual(['Mara', 'Tomas'])
    expect(s.shots[2]!.lines.map((l) => l.speaker)).toEqual(['Tomas', 'Mara'])
    expect(musicCues([{ scenes }])).toEqual([{ id: 'm1', description: 'slow solo piano, melancholic, sparse', from: 'ch01.s01.sh01', to: 'ch01.s01.sh03' }])
    expect(runtimeOf([{ scenes }])).toBe(16)
  })

  it('never reads a cue line as a speaker, and reads voice-over, off-screen and a delivery', () => {
    const text = ['SCENE: A cellar, night', 'SHOT (close-up, 4s): A lamp.', 'TITLE: One night', 'MARA (V.O.): I remember it.', 'TOMAS (O.S., shouting): Come out!', 'GUARD (V.O., tired): Quiet.', 'SFX: a door'].join('\n')
    const shots = parseScreenplay(text).scenes[0]!.shots
    expect(shots.map((x) => x.id)).toEqual(['ch01.s01.sh01', 'ch01.s01.sh02'])
    expect(shots[0]!.lines.map((l) => [l.speaker, l.kind, l.delivery])).toEqual([])
    expect(shots[1]).toMatchObject({ framing: 'title', seconds: 3, title: 'One night' })
    expect(shots[1]!.lines.map((l) => [l.speaker, l.kind, l.delivery])).toEqual([
      ['MARA', 'voice-over', ''],
      ['TOMAS', 'off-screen', 'shouting'],
      ['GUARD', 'voice-over', 'tired']
    ])
    expect(shots[1]!.sfx).toEqual(['a door'])
    const all = JSON.stringify(parseScreenplay(EXAMPLE))
    expect(all).not.toMatch(/"speaker":"(SHOT|MUSIC|SFX|TITLE)"/)
  })

  it('gives a shot without a length 4 seconds, or the next of 6, 8 and 10 that its lines need; a given length is kept within 4 to 10', () => {
    const lots = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
    const text = ['SCENE: Hall, day', 'SHOT (wide): A hall.', 'SHOT (wide): A man.', `MARA: ${lots(12)}.`, 'SHOT (wide): Two.', `MARA: ${lots(30)}.`, 'SHOT (wide, 2s): Short.', 'SHOT (wide, 30s): Long.'].join('\n')
    expect(parseScreenplay(text).scenes[0]!.shots.map((x) => x.seconds)).toEqual([4, 6, 10, 4, 10])
    expect(defaultSeconds([{ text: 'Hi.' }])).toBe(4)
    expect(parseShotSpec('wide, handheld, 7s, continuous')).toEqual({ framing: 'wide', move: 'handheld', seconds: 7, continuous: true })
    expect(parseShotSpec('')).toEqual({ framing: 'medium', move: 'static', seconds: null, continuous: false })
    expect(parseShotSpec('slow orbit, close-up')).toMatchObject({ framing: 'close-up', move: 'slow orbit' })
  })

  it('opens an implicit medium shot for a spoken line before any shot, and keeps the action before the first shot as the background', () => {
    const { scenes } = parseScreenplay('SCENE: A kitchen, morning\nSteam rises.\nMARA: Morning.\nShe pours tea.\nSHOT (close-up): Cups.')
    expect(scenes[0]!.background).toBe('Steam rises.')
    expect(scenes[0]!.shots[0]).toMatchObject({ id: 'ch01.s01.sh01', framing: 'medium', seconds: 4, action: 'She pours tea.', lines: [{ speaker: 'MARA', text: 'Morning.', kind: 'dialogue' }] })
    expect(scenes[0]!.shots[1]).toMatchObject({ framing: 'close-up', action: 'Cups.' })
  })

  it('uses the bible names, reads an unknown line as action, and keeps the visual novel cue lines out of the speakers', () => {
    const text = ['## The pier, noon', 'SHOT (wide): The pier.', 'MARA HARTLEY: Hello.', 'CG: a picture of the pier', 'AMBIENCE: gulls', 'END CG', 'Wind blows.'].join('\n')
    const shot = parseScreenplay(text, ['Mara Hartley']).scenes[0]!.shots[0]!
    expect(shot.lines.map((l) => l.speaker)).toEqual(['Mara Hartley'])
    expect(shot.action).toBe('The pier. CG: a picture of the pier AMBIENCE: gulls END CG Wind blows.')
  })

  it('carries ON SCREEN into the next shots until it changes, resets it at a scene, and ends music before a new cue', () => {
    const text = [
      'SCENE: A, day',
      'SHOT (wide): One.',
      'ON SCREEN: Mara (calm)',
      'MUSIC: soft strings',
      'SHOT (wide): Two.',
      'MUSIC: drums, fast',
      'SHOT (wide): Three.',
      'SCENE: B, night',
      'SHOT (wide): Four.',
      'MUSIC: stop'
    ].join('\n')
    const { scenes } = parseScreenplay(text)
    expect(scenes[0]!.shots.map((x) => x.cast.map((c) => c.name))).toEqual([['Mara'], ['Mara'], ['Mara']])
    expect(scenes[1]!.shots[0]!.cast).toEqual([])
    expect(musicCues([{ scenes }])).toEqual([
      { id: 'm1', description: 'soft strings', from: 'ch01.s01.sh01', to: 'ch01.s01.sh01' },
      { id: 'm2', description: 'drums, fast', from: 'ch01.s01.sh02', to: 'ch01.s02.sh01' }
    ])
  })
})

describe('the screenplay layout', () => {
  it('shows SHOT, MUSIC, SFX and TITLE as cue lines and the voice-over as a speaker; the visual novel cues are plain narration', () => {
    const html = scriptToXhtml('SCENE: A pier, dusk\nSHOT (wide, 6s): A pier.\nMUSIC: piano\nSFX: wind\nTITLE: Dusk\nNARRATOR: Every evening.\nCG: not a picture here', { screenplay: true })
    expect(html).toContain('<p class="vn-cue"><span class="vn-label">Shot (wide, 6s):</span> A pier.</p>')
    expect(html).toContain('<span class="vn-label">Music:</span> piano')
    expect(html).toContain('<span class="vn-label">Sound:</span> wind')
    expect(html).toContain('<span class="vn-label">Title:</span> Dusk')
    expect(html).toContain('<span class="vn-speaker">NARRATOR</span> Every evening.')
    expect(html).toContain('<p class="vn-narration">CG: not a picture here</p>')
    expect(html).not.toMatch(/vn-speaker">(SHOT|MUSIC|SFX|TITLE)/)
    // the same lines in a visual novel keep their meaning there
    expect(scriptToXhtml('SFX: a door\nCG: the pier')).toContain('Sound:')
    expect(markdownToXhtml('SHOT (wide): A pier.', { script: true, screenplay: true })).toContain('vn-cue')
  })
})

const tmp: string[] = []
afterEach(async () => {
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})
const tempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-sp-'))
  tmp.push(dir)
  return dir
}
const seedFormats = async (): Promise<FormatEntry[]> => formatsSchema.parse(parseMd(await readFile(path.join(seedDir, 'config', 'formats.md'), 'utf8')).data).formats

describe('the screenplay formats', () => {
  it('are in the seed with the flags the writers and the factory need', async () => {
    const formats = await seedFormats()
    for (const id of SCREENPLAY_FORMAT_IDS) {
      expect(formats.find((f) => f.id === id), id).toMatchObject({ enabled: true, script: true, screenplay: true, humanize: false, max_rounds: 1 })
    }
    expect(formats.find((f) => f.id === 'short-film')).toMatchObject({ kinds: ['video'], runtime: [60, 180], chapters: [1, 3] })
    expect(formats.find((f) => f.id === 'kids-cartoon')).toMatchObject({ kinds: ['juvenile-video'], juvenile: true, runtime: [45, 120] })
    expect(formats.filter((f) => f.screenplay).map((f) => f.id)).toEqual(SCREENPLAY_FORMAT_IDS)
  })

  it('are never picked for a story with no topic, only for their own topic kinds', async () => {
    const formats = await seedFormats()
    expect(formatsForKind(formats, null).some((f) => f.screenplay)).toBe(false)
    expect(formatsForKind(formats, 'video').map((f) => f.id)).toEqual(['short-film', 'cartoon'])
    expect(formatsForKind(formats, 'juvenile-video').map((f) => f.id)).toEqual(['kids-cartoon'])
    for (const kind of ['fiction', 'visual-novel', 'juvenile-visual-novel', 'article']) expect(formatsForKind(formats, kind).some((f) => f.screenplay), kind).toBe(false)
  })

  it('pick the _sp prompts, and a role without one uses its plain prompt and never the visual novel one', async () => {
    const formats = await seedFormats()
    const film = formats.find((f) => f.id === 'short-film')!
    expect(variant(film, 'draft_chapter')).toBe('draft_chapter_sp')
    expect(variant(formats.find((f) => f.id === 'visual-novel')!, 'draft_chapter')).toBe('draft_chapter_vn')
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    for (const [role, task] of [['architect', 'outline'], ['writer', 'draft_chapter'], ['writer', 'rewrite_chapter'], ['line-editor', 'review']] as const) {
      const p = await loadPrompt(dir, role, `${task}_sp`)
      expect(p.raw, `${role}/${task}_sp`).toContain(`task: ${task}`)
      expect(p.raw, `${role}/${task}_sp`).toMatch(/screenplay|short film/i)
    }
    const plain = await loadPrompt(dir, 'continuity-checker', 'review_sp')
    expect(plain.raw).toBe((await loadPrompt(dir, 'continuity-checker', 'review')).raw)
    // the pitch has no _sp prompt: the plain one, not the _vn one
    const pitch = await loadPrompt(dir, 'architect', 'pitch_sp')
    expect(pitch.raw).toBe((await loadPrompt(dir, 'architect', 'pitch')).raw)
  })

  it('have _sp prompts whose example cue lines are under 40 characters and that never ask for the visual novel cues', async () => {
    const draft = parseMd(await readFile(path.join(seedDir, 'prompts', 'writer', 'draft_chapter_sp.md'), 'utf8')).body
    const asks = draft.split('\n').filter((l) => /^(CG|INSERT|AMBIENCE):/.test(l))
    expect(asks).toEqual([])
    for (const l of draft.split('\n').filter((l) => /^(MUSIC|SFX|TITLE|NARRATOR):/.test(l))) expect(l.length, l).toBeLessThan(80)
  })
})

describe('migrateScreenplay', () => {
  /** A data folder from before the screenplay writer: the seed without its formats and its Videos section. */
  async function oldFolder(eol = '\n'): Promise<{ dir: string; formats: string; topics: string }> {
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    const formatsFile = path.join(dir, 'config', 'formats.md')
    let formats = await readFile(formatsFile, 'utf8')
    formats = formats.slice(0, formats.indexOf('  - id: short-film\n')) + formats.slice(formats.indexOf('---\n# Formats'))
    await writeFile(formatsFile, formats.replace(/\n/g, eol))
    const topicsFile = path.join(dir, 'topics.md')
    const topics = (await readFile(topicsFile, 'utf8')).slice(0, (await readFile(topicsFile, 'utf8')).indexOf('\n## Videos')).trimEnd() + '\n'
    await writeFile(topicsFile, topics.replace(/\n/g, eol))
    return { dir, formats: await readFile(formatsFile, 'utf8'), topics: await readFile(topicsFile, 'utf8') }
  }

  it('adds the formats and the Videos section to an old data folder, keeps the rest, and does it once', async () => {
    const { dir, formats: before, topics: topicsBefore } = await oldFolder()
    expect(formatsSchema.parse(parseMd(before).data).formats.some((f) => f.screenplay)).toBe(false)
    const first = await initDataFolder(dir, seedDir)
    expect(first.migrated).toHaveLength(2)
    expect(first.migrated[0]).toMatch(/formats\.md: added the screenplay formats \(short-film, cartoon, kids-cartoon\)/)
    expect(first.migrated[1]).toMatch(/topics\.md: added the Videos section/)
    const formatsAfter = await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')
    expect(formatsSchema.parse(parseMd(formatsAfter).data).formats.filter((f) => f.screenplay).map((f) => f.id)).toEqual(SCREENPLAY_FORMAT_IDS)
    expect(formatsAfter.endsWith(before.slice(before.indexOf('---\n# Formats')))).toBe(true)
    const topicsAfter = await readFile(path.join(dir, 'topics.md'), 'utf8')
    expect(topicsAfter.startsWith(topicsBefore.trimEnd())).toBe(true)
    const videos = parseTopics(topicsAfter).filter((r) => r.kind === 'video' || r.kind === 'juvenile-video')
    expect(videos.map((r) => r.id)).toEqual(['vid-short-film', 'vid-cartoon', 'vid-kids-cartoon'])
    expect(videos.every((r) => !r.active)).toBe(true)
    const second = await initDataFolder(dir, seedDir)
    expect(second.migrated).toEqual([])
    expect(await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')).toBe(formatsAfter)
    expect(await readFile(path.join(dir, 'topics.md'), 'utf8')).toBe(topicsAfter)
  })

  it('keeps CRLF line endings, and leaves a fresh folder and a folder with no files alone', async () => {
    const { dir } = await oldFolder('\r\n')
    expect((await migrateScreenplay(dir, seedDir)).changes).toHaveLength(2)
    for (const f of [path.join(dir, 'config', 'formats.md'), path.join(dir, 'topics.md')]) expect((await readFile(f, 'utf8')).replace(/\r\n/g, '')).not.toContain('\n')
    const fresh = await tempDir()
    expect((await initDataFolder(fresh, seedDir)).migrated).toEqual([])
    const empty = await tempDir()
    expect((await migrateScreenplay(empty, seedDir)).changes).toEqual([])
    expect((await migrateScreenplay(dir, undefined)).changes).toEqual([])
  })
})

describe('a screenplay through the pipeline (mock models)', () => {
  it('a topic-less story that fixes short-film starts as short-film and runs to published, with cue lines in the EPUB and the layout', async () => {
    const e = await makePipelineEnv({
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'short-film' ? { ...f, words: [150, 600], chapters: [2, 2] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    try {
      const prompts: string[] = []
      const shots = (words: number) => {
        const lines = ['SCENE: Hay Barn, night', 'Moonlight on straw.', 'MUSIC: soft strings']
        for (let i = 1; lines.join(' ').split(/\s+/).length < words; i++) lines.push(`SHOT (medium, static, 4s): The fox turns ${i}.`, 'ON SCREEN: Fox (soft orange)', 'FOX (sleepy): The moon hums to the little hay bed tonight.')
        return lines.join('\n')
      }
      e.mock.on({ task: 'draft_chapter' }, (req) => {
        const t = req.messages.filter((m) => m.role === 'user').pop()!.content
        prompts.push(t)
        return shots(Number(/chapter should be about (\d+) words/.exec(t)?.[1] ?? 100))
      })
      await e.engine.addStory({ ...emptyBrief(), title: 'The Humming Moon', premise: 'A fox and a humming moon.', format: 'short-film' })
      const slug = await waitFor(async () => {
        for (const s of await e.engine.books.slugs()) if ((await e.engine.books.read(s))?.data.stage === 'published') return s
        return null
      }, 150000, 'the published screenplay')
      const book = parseMd(await readFile(path.join(e.dir, 'books', slug, 'book.md'), 'utf8')).data
      expect(book).toMatchObject({ format: 'short-film', script: true, screenplay: true })
      expect(prompts[0]).toContain('a screenplay for a short film')
      expect(prompts[0]).toMatch(/run about \d+ seconds/)
      // the layout keeps the cue lines out of the speakers
      const html = markdownToXhtml((await e.engine.books.chapters(slug))[0]!.body, { script: true, screenplay: true })
      expect(html).toContain('<span class="vn-label">Shot (medium, static, 4s):</span>')
      expect(html).not.toMatch(/vn-speaker">(SHOT|MUSIC)/)
      const chapters = await e.engine.books.chapters(slug)
      const parsed = chapters.map((c) => parseScreenplay(c.body, ['Fox'], c.n))
      expect(parsed[0]!.scenes[0]!.shots.length).toBeGreaterThan(1)
      expect(musicCues(parsed)[0]).toMatchObject({ id: 'm1', description: 'soft strings' })
    } finally {
      await e.cleanup()
    }
  }, 200000)
})

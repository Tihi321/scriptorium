import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { splitChoicesBlock } from '../src/engine/pipeline/branches'
import { BookStore } from '../src/engine/pipeline/books'
import { chapterNotes, chaptersNamed, otherChapters, splitItems } from '../src/engine/pipeline/rewriteContext'
import { dimensionsFor } from '../src/engine/pipeline/scoring'
import { addPlacesToBible, canonicalScenes, placeDescriptions, placesBlock, scenePlaces } from '../src/engine/pipeline/scriptPlaces'
import { choicesHtml } from '../src/engine/publish/xhtml'
import { writeMd } from '../src/engine/store/atomic'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

describe('the editors\' notes that concern a chapter', () => {
  const notes = [
    '- Chapter 5: the coat changes colour.',
    '- Chapter 3: the ending is abrupt.',
    '- Chapters 2-4: too many adverbs.',
    '- The prose says "suddenly" a lot.'
  ].join('\n')
  const reviews = [
    { role: 'line-editor', verdict: 'revise', notes },
    { role: 'copy-editor', verdict: 'pass', notes: '- Chapter 3: a comma.' },
    { role: 'beta-reader', verdict: 'revise', notes: 'The middle drags. It is the same pace for chapters 6 and 7.' }
  ]

  it('finds the chapters an item names, ranges and lists included', () => {
    expect(chaptersNamed('Chapter 5: the coat')).toEqual([5])
    expect(chaptersNamed('chapters 2-4 and 7 drag')).toEqual([2, 3, 4, 7])
    expect(chaptersNamed('see ch. 3 to 5')).toEqual([3, 4, 5])
    expect(chaptersNamed('in chapters 2, 5 & 8')).toEqual([2, 5, 8])
    expect(chaptersNamed('the prose is flat')).toBeNull()
  })

  it('splits numbered or bulleted items, else paragraphs, and keeps the Problems items', () => {
    expect(splitItems('- A one\n  continued.\n- B two')).toEqual(['A one continued.', 'B two'])
    expect(splitItems('1. First.\n2. Second.')).toEqual(['First.', 'Second.'])
    expect(splitItems('One paragraph.\n\nAnother paragraph\nover two lines.')).toEqual(['One paragraph.', 'Another paragraph over two lines.'])
    expect(splitItems('Two slips.\n\n## Problems\n\n1. Chapter 3: the coat.\n2. Chapter 5: the lamp.')).toEqual(['Two slips.', 'Chapter 3: the coat.', 'Chapter 5: the lamp.'])
  })

  it('drops an item that names only other chapters, keeps a range that includes the chapter, and keeps the general ones', () => {
    const three = chapterNotes(reviews, 3)
    expect(three.text).toBe('- From the line editor: Chapter 3: the ending is abrupt. Chapters 2-4: too many adverbs. The prose says "suddenly" a lot.')
    expect(three.text).not.toContain('coat changes colour')
    expect(three.text).not.toContain('a comma') // a pass is not a note
    expect(three.text).not.toContain('beta reader') // its one paragraph names chapters 6 and 7 only
    expect(three.kept).toBe(3)
    expect(three.total).toBe(5)
  })

  it('keeps an item whole: a paragraph that names this chapter is kept, the items of the others are not', () => {
    const six = chapterNotes(reviews, 6)
    expect(six.text).toContain('- From the beta reader: The middle drags. It is the same pace for chapters 6 and 7.')
    expect(six.text).toContain('suddenly')
    expect(six.text).not.toContain('ending is abrupt')
    expect(six.kept).toBe(2)
    expect(six.total).toBe(5)
  })

  it('an (act k) block belongs to the chapters of that act', () => {
    const acts = [{ n: 1, chapters: [1, 2, 3] }, { n: 2, chapters: [4, 5, 6] }]
    const review = [{ role: 'developmental-editor', verdict: 'revise', notes: '(act 1) The opening is slow.\n\n(act 2) The pacing sags, and chapter 6 repeats chapter 5.' }]
    expect(chapterNotes(review, 2, acts).text).toBe('- From the developmental editor: The opening is slow.')
    expect(chapterNotes(review, 5, acts).text).toBe('- From the developmental editor: The pacing sags, and chapter 6 repeats chapter 5.') // names 6 and 5: this one is among them
    expect(chapterNotes(review, 4, acts).text).toBe('') // act 2, but the item names chapters 5 and 6 only
  })

  it('keeps at most 1,200 characters of general items for each reviewer', () => {
    const general = Array.from({ length: 30 }, (_, i) => `- General remark number ${i} about the style of the whole text, with enough words in it to take some room.`).join('\n')
    const out = chapterNotes([{ role: 'line-editor', verdict: 'revise', notes: general }], 3)
    expect(out.total).toBe(30)
    expect(out.kept).toBeLessThan(30)
    expect(out.text.length).toBeLessThan(1200 + 40)
  })
})

describe('the chapters around the one being rewritten', () => {
  const chapters = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, title: `Title ${i + 1}`, body: `BODY-${i + 1} `.repeat(40) }))
  const summaryOf = (k: number) => `SUM-${k}`

  it('gives the chapter before and after in full and the others as summaries', () => {
    const out = otherChapters({ chapters, n: 3, branches: null, summaryOf })
    expect(out.full).toEqual([2, 4])
    expect(out.summaries).toBe(3)
    expect(out.text).toContain('### Chapter 2: Title 2\n\nBODY-2')
    expect(out.text).toContain('### Chapter 4: Title 4\n\nBODY-4')
    expect(out.text).not.toContain('BODY-1')
    expect(out.text).not.toContain('BODY-5')
    expect(out.text).toContain('### Chapter 1: Title 1\nSUM-1')
    expect(out.text).toContain('### Chapter 6: Title 6\nSUM-6')
    expect(out.text.indexOf('Chapter 1:')).toBeLessThan(out.text.indexOf('Chapter 2:'))
  })

  it('a story with choices: the chapters that lead in and the ones the choices lead to, with where each goes next', () => {
    const branches = [
      { n: 1, title: 'Title 1', summary: 's', choices: [{ text: 'A', to: 2 }, { text: 'B', to: 3 }] },
      { n: 2, title: 'Title 2', summary: 's', choices: [{ text: 'C', to: 4 }] },
      { n: 3, title: 'Title 3', summary: 's', choices: [{ text: 'D', to: 4 }] },
      { n: 4, title: 'Title 4', summary: 's', ending: 'happy' },
      { n: 5, title: 'Title 5', summary: 's', ending: 'sad' },
      { n: 6, title: 'Title 6', summary: 's', ending: 'odd' }
    ]
    const out = otherChapters({ chapters, n: 4, branches, summaryOf })
    expect(out.full).toEqual([2, 3])
    expect(out.text).toContain('[Choices: "C" (to chapter 4)]')
    expect(out.text).not.toContain('BODY-1')
    const one = otherChapters({ chapters, n: 1, branches, summaryOf })
    expect(one.full).toEqual([2, 3]) // the chapters its choices lead to
  })

  it('cuts a chapter from the middle when the writer\'s window is small', () => {
    const big = chapters.map((c) => ({ ...c, body: `START-${c.n} ${'word '.repeat(4000)}END-${c.n}` }))
    const out = otherChapters({ chapters: big, n: 3, branches: null, summaryOf, windowTokens: 4000 })
    expect(out.text).toContain('START-2')
    expect(out.text).toContain('END-2')
    expect(out.text).toContain('[...]')
    expect(out.text.length).toBeLessThan(0.35 * 4000 * 4 + 2000)
  })
})

describe('reworded choices', () => {
  it('splits a CHOICES block off the end of a rewrite', () => {
    const split = splitChoicesBlock('The fox stops at the fork.\nShe has to decide.\n\nCHOICES:\n- Follow the light -> 2\n- "Climb the hill" → 3\n3. Turn back -> chapter 4')
    expect(split.body).toBe('The fox stops at the fork.\nShe has to decide.')
    expect(split.choices).toEqual([{ text: 'Follow the light', to: 2 }, { text: 'Climb the hill', to: 3 }, { text: 'Turn back', to: 4 }])
    expect(splitChoicesBlock('No block here.')).toEqual({ body: 'No block here.', choices: null })
    expect(splitChoicesBlock('Text.\n**CHOICES:**\nnothing readable')).toEqual({ body: 'Text.', choices: null })
  })

  it('setChoiceTexts rewrites the outline, keeps where the choices lead, and the EPUB link shows the new words', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'scrip-choices-'))
    dirs.push(dir)
    const books = new BookStore(dir)
    await books.create('b', { title: 'B', format: 'kids-choice-book', target_words: 3000 }, '')
    const chapters = [
      { n: 1, title: 'One', summary: 'First.', choices: [{ text: 'Old A', to: 2 }, { text: 'Old B', to: 3 }] },
      { n: 2, title: 'Two', summary: 'Second.', ending: 'happy' },
      { n: 3, title: 'Three', summary: 'Third.', ending: 'sad' }
    ]
    await writeMd(path.join(dir, 'books', 'b', 'outline.md'), { kind: 'outline', round: 0, chapters }, '\nold body\n')
    expect(await books.setChoiceTexts('b', 1, ['New A', 'New B'])).toBe(true)
    const outline = await books.outline('b')
    expect(outline!.chapters[0]!.choices).toEqual([{ text: 'New A', to: 2 }, { text: 'New B', to: 3 }])
    expect(outline!.body).toContain('Choices: "New A" (to chapter 2); "New B" (to chapter 3)')
    expect(choicesHtml(outline!.chapters[0]!)).toContain('<li><a href="chapter-02.xhtml">New A</a></li>')
    // the wrong count, or a chapter without choices: nothing changes
    expect(await books.setChoiceTexts('b', 1, ['Only one'])).toBe(false)
    expect(await books.setChoiceTexts('b', 2, ['X'])).toBe(false)
    expect((await books.outline('b'))!.chapters[0]!.choices![0]!.text).toBe('New A')
  })
})

describe('the places of a script', () => {
  const places = ['Observatory Grand Hall', 'Harbour Wall']

  it('writes a SCENE place as the bible\'s name, keeps the time, leaves an ambiguous place, and reports an unknown one', () => {
    const body = ['SCENE: the grand hall of the observatory, night', 'Dust.', 'SCENE: Harbour wall, dusk', 'SCENE: The cellar', 'SCENE: Observatory Grand Hall, noon', '---', 'SCENE: the cellar, midnight'].join('\n')
    const out = canonicalScenes(body, places)
    expect(out.body.split('\n')).toEqual(['SCENE: Observatory Grand Hall, night', 'Dust.', 'SCENE: Harbour Wall, dusk', 'SCENE: The cellar', 'SCENE: Observatory Grand Hall, noon', '---', 'SCENE: the cellar, midnight'])
    expect(out.renamed).toEqual([{ from: 'the grand hall of the observatory', to: 'Observatory Grand Hall' }, { from: 'Harbour wall', to: 'Harbour Wall' }])
    expect(out.unknown).toEqual(['The cellar']) // each place once
    expect(scenePlaces(body)).toEqual(['the grand hall of the observatory', 'Harbour wall', 'The cellar', 'Observatory Grand Hall', 'the cellar'])
    // a place that fits two bible places is left as it is and is not unknown
    const ambiguous = canonicalScenes('SCENE: The hall, day', ['Grand Hall', 'Great Hall'])
    expect(ambiguous.body).toBe('SCENE: The hall, day')
    expect(ambiguous.unknown).toEqual([])
    // a SCENE with no comma has no time
    expect(canonicalScenes('SCENE: harbour wall', places).body).toBe('SCENE: Harbour Wall')
  })

  it('adds an unknown place to the bible under Places (before Style), with the first narration line of its scene', () => {
    const bible = '# Story bible (light)\n\n## Setting\nA harbour.\n\n## Characters\n- **Mara**: A girl.\n\n## Places\n- **Harbour Wall**: A pier.\n\n## Style\nMoody.\n'
    const desc = placeDescriptions('SCENE: The cellar, midnight\nDamp stone and a single candle.\nMARA: Hello.', ['The cellar'])
    expect(desc.get('The cellar')).toBe('Damp stone and a single candle.')
    const out = addPlacesToBible(bible, [{ place: 'The cellar', text: desc.get('The cellar')! }], 3)
    expect(out).toContain('- **Harbour Wall**: A pier.\n- **The cellar**: Damp stone and a single candle. (first seen in chapter 3)\n\n## Style')
    // no Places heading: it is made before Style
    const none = addPlacesToBible('## Characters\n- **Mara**: A girl.\n\n## Style\nMoody.\n', [{ place: 'The cellar', text: '' }], 2)
    expect(none).toBe('## Characters\n- **Mara**: A girl.\n\n## Places\n- **The cellar**: (first seen in chapter 2)\n\n## Style\nMoody.\n')
    expect(placesBlock(places)).toContain('exactly as one of these bible places: Observatory Grand Hall; Harbour Wall.')
    expect(placesBlock([])).toBe('')
  })
})

type Env = Awaited<ReturnType<typeof makePipelineEnv>>
let env: Env | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const lastUser = (req: { messages: { role: string; content: string }[] }) => req.messages.filter((m) => m.role === 'user').pop()!.content
const prose = (n: number) => Array.from({ length: n }, (_, i) => ['The', 'little', 'fox', 'yawned', 'and', 'curled', 'up', 'in', 'the', 'warm', 'hay.'][i % 11]).join(' ')
const wanted = (req: { messages: { role: string; content: string }[] }) => Number(/(?:chapter should be about|Keep the chapter at about|Cut it to about) (\d+) words/.exec(lastUser(req))?.[1] ?? 200)

describe('a rewrite carries its chapter, the neighbours and its own notes (pipeline)', () => {
  it('chapter 3 of 6: chapters 2 and 4 in full, the others as summaries, only the notes that concern chapter 3', async () => {
    env = await makePipelineEnv({ activate: ['jfic-chapter-books-everyday-adventures'], format: 'chapter-book', revise: { 'line-editor': [0] }, reviewChapters: { 'line-editor': [3] } })
    const e = env
    const rewrites: string[] = []
    e.mock.on({ task: 'draft_chapter' }, (req) => `MARK-CH${/Now write chapter (\d+):/.exec(req.messages[1]?.content ?? '')?.[1]}-BODY ${prose(wanted(req))}`)
    e.mock.on({ task: 'rewrite_chapter' }, (req) => {
      rewrites.push(req.messages.map((m) => m.content).join('\n'))
      return `MARK-CH3-REWRITTEN ${prose(wanted(req))}`
    })
    e.mock.on({ task: 'review' }, (req) => {
      const role = req.meta!.role!
      const revise = role === 'line-editor' && /review round 0/.test(lastUser(req))
      return JSON.stringify({
        verdict: revise ? 'revise' : 'pass',
        scores: Object.fromEntries(dimensionsFor(role).map((d) => [d, revise ? 5 : 8])),
        notes: revise ? '- Chapter 3: the ending is abrupt, add a calmer last paragraph.\n- Chapter 5: the fox coat colour changes in the middle.\n- The prose says "suddenly" too often.' : `Looks good (${role}).`,
        chapters: revise ? [3] : [],
        problems: [],
        research_questions: []
      })
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the book to be published'))!
    expect(rewrites).toHaveLength(1)
    const prompt = rewrites[0]!
    expect(prompt).toContain('MARK-CH2-BODY')
    expect(prompt).toContain('MARK-CH4-BODY')
    for (const k of [1, 5, 6]) expect(prompt).not.toContain(`MARK-CH${k}-BODY`)
    expect(prompt).toContain('### Chapter 1: Part 1\nFox does thing number 1 and learns something kind.') // the others as outline summaries
    expect(prompt).toContain('the ending is abrupt')
    expect(prompt).toContain('suddenly')
    expect(prompt).not.toContain('coat colour')
    // the whole-book version of this prompt would hold all six chapters: this one holds three (the chapter and its two neighbours)
    const bodies = await Promise.all([1, 2, 3, 4, 5, 6].map(async (n) => (await readFile(path.join(e.dir, 'books', slug, 'chapters', `ch-0${n}.md`), 'utf8')).length))
    expect(prompt.length).toBeLessThan(0.6 * bodies.reduce((a, b) => a + b, 0))
  }, 180000)
})

describe('a story with choices: a rewrite may reword the choices, and the script places are the bible\'s (pipeline)', () => {
  it('a valid CHOICES block rewords the outline and the EPUB, a block that changes where a choice leads is ignored, both are cut from the text', async () => {
    env = await makePipelineEnv({
      activate: ['jvn-animal-friends'],
      format: 'kids-choice-visual-story',
      revise: { 'line-editor': [0] },
      reviewChapters: { 'line-editor': [1, 2] },
      beforeStart: async (dir) => {
        const file = path.join(dir, 'config', 'formats.md')
        const doc = parseMd(await readFile(file, 'utf8'))
        const formats = (doc.data.formats as { id: string }[]).map((f) => (f.id === 'kids-choice-visual-story' ? { ...f, words: [1200, 4000], chapters: [4, 4] } : f))
        await writeMd(file, { ...doc.data, formats }, doc.body)
      }
    })
    const e = env
    const drafts: string[] = []
    const rewrites: string[] = []
    const scene = (place: string, n: number) => `SCENE: ${place}, night\nON SCREEN: Fox (sleepy)\n${prose(n)}\nFOX (sleepy): I am so tired.`
    e.mock.on({ task: 'draft_chapter' }, (req) => {
      const n = Number(/Now write chapter (\d+):/.exec(req.messages[1]?.content ?? '')?.[1])
      drafts.push(req.messages.map((m) => m.content).join('\n'))
      return scene(n === 1 ? 'the hay barn' : n === 2 ? 'The old well' : 'Hay Barn', wanted(req))
    })
    e.mock.on({ task: 'rewrite_chapter' }, (req) => {
      const n = Number(/Rewrite chapter (\d+) of/.exec(lastUser(req))?.[1])
      rewrites.push(req.messages.map((m) => m.content).join('\n'))
      const text = scene(n === 1 ? 'the hay barn' : 'The old well', wanted(req))
      if (n === 1) return `${text}\n\nCHOICES:\n- Follow the glowing path -> 2\n- Climb the hay stack -> 3`
      if (n === 2) return `${text}\n\nCHOICES:\n- Go somewhere else entirely -> 3`
      return text
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the book to be published'))!
    const dir = (...p: string[]) => path.join(e.dir, 'books', slug, ...p)
    // the writer is told the bible's places, and the CHOICES rule is in the rewrite prompt
    expect(drafts[0]).toContain('## Places\nIn every SCENE: line name the place exactly as one of these bible places: Hay Barn.')
    expect(rewrites[0]).toContain('end your answer with a line `CHOICES:`')
    // chapter 1: the place is the bible's own name; chapter 2: a new place, added to the bible
    const ch1 = parseMd(await readFile(dir('chapters', 'ch-01.md'), 'utf8')).body
    expect(ch1).toContain('SCENE: Hay Barn, night')
    expect(ch1).not.toContain('CHOICES:')
    const ch2 = parseMd(await readFile(dir('chapters', 'ch-02.md'), 'utf8')).body
    expect(ch2).toContain('SCENE: The old well, night')
    expect(ch2).not.toContain('CHOICES:')
    expect(ch2).not.toContain('somewhere else')
    const bible = parseMd(await readFile(dir('bible', 'bible.md'), 'utf8')).body
    expect(bible).toMatch(/- \*\*The old well\*\*: .*\(first seen in chapter 2\)/)
    // the outline: chapter 1 reworded, chapter 2 untouched (its block led somewhere else)
    const outline = parseMd(await readFile(dir('outline.md'), 'utf8'))
    const chapters = outline.data.chapters as { choices?: { text: string; to: number }[] }[]
    expect(chapters[0]!.choices).toEqual([{ text: 'Follow the glowing path', to: 2 }, { text: 'Climb the hay stack', to: 3 }])
    expect(chapters[1]!.choices).toEqual([{ text: 'Go the way of part 4', to: 4 }])
    expect(outline.body).toContain('"Follow the glowing path" (to chapter 2)')
    // the EPUB shows the new words
    const zip = await JSZip.loadAsync(await readFile(dir('out', `${slug}.epub`)))
    expect(await zip.file('OEBPS/chapter-01.xhtml')!.async('string')).toContain('<li><a href="chapter-02.xhtml">Follow the glowing path</a></li>')
    expect(await zip.file('OEBPS/chapter-02.xhtml')!.async('string')).toContain('Go the way of part 4')
  }, 180000)
})

describe('the writer answers with the task instructions (pipeline)', () => {
  const template = async () => parseMd(await readFile(path.resolve(__dirname, '../seed/prompts/writer/draft_chapter.md'), 'utf8')).body

  it('a tail of instructions is cut off the chapter, and a leak in the middle is asked for again', async () => {
    const tpl = await template()
    const sentence = (tpl.match(/[A-Z][^.\n{}]{50,}\./g) ?? [])[0]!
    expect(sentence).toBeTruthy()
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const e = env
    let calls = 0
    e.mock.on({ task: 'draft_chapter' }, (req) => {
      calls++
      const body = prose(wanted(req))
      if (calls === 1) return `${body}\n\n${sentence}\n`
      return body
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    const ch = parseMd(await readFile(path.join(e.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8')).body
    expect(ch).not.toContain(sentence)
    await e.engine.logs.flush()
    expect(await readFile(path.join(e.dir, 'books', slug, 'log.md'), 'utf8')).toContain('the answer ended with the task instructions: cut off')
    expect(calls).toBe(1)
  }, 120000)

  it('a leak in the middle of the text fails the job, which runs again and gets a clean answer', async () => {
    const tpl = await template()
    const sentence = (tpl.match(/[A-Z][^.\n{}]{50,}\./g) ?? [])[0]!
    env = await makePipelineEnv({ activate: ['jfic-bedtime-and-dreams'], format: 'bedtime-toddler' })
    const e = env
    let calls = 0
    e.mock.on({ task: 'draft_chapter' }, (req) => {
      calls++
      const half = prose(Math.round(wanted(req) / 2))
      return calls === 1 ? `${half}\n\n${sentence}\n\n${half}` : prose(wanted(req))
    })
    const slug = (await waitFor(async () => (await e.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 90000, 'the book to be published'))!
    expect(calls).toBe(2)
    expect(parseMd(await readFile(path.join(e.dir, 'books', slug, 'chapters', 'ch-01.md'), 'utf8')).body).not.toContain(sentence)
    const job = parseMd(await readFile(path.join(e.dir, 'jobs', 'done', `${slug}--draft--ch01--r0.md`), 'utf8'))
    expect(job.data.attempts).toBe(1)
  }, 120000)
})

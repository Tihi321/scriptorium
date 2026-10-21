import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { normalizeReviewJson, notesProblem, problemText, reviewBody } from '../src/engine/pipeline/reviewNotes'
import { parseMd } from '../src/shared/md'
import { makePipelineEnv, waitFor } from './helpers'

describe('normalizeReviewJson', () => {
  it('the live shape of the Hour check: findings as objects in chapters become numbers and problem lines', () => {
    const out = normalizeReviewJson({
      verdict: 'revise',
      scores: { continuity: 5 },
      notes: 'Three concrete fixes below.',
      chapters: [
        { chapter: 11, issue: 'Dec calls Ines his sister', quote_new: 'my sister Ines', quote_established: 'Ines is his business partner' },
        { chapter: '12', problem: 'The lamp is lit twice' }
      ]
    }) as { chapters: number[]; problems: string[] }
    expect(out.chapters).toEqual([11, 12])
    expect(out.problems).toEqual([
      'Chapter 11: Dec calls Ines his sister Quote: "my sister Ines" Established: "Ines is his business partner"',
      'Chapter 12: The lamp is lit twice'
    ])
  })

  it('the shape of the Clockless God check: type, quote_chapter, quote_bible and fix', () => {
    const out = normalizeReviewJson({
      verdict: 'revise',
      chapters: [{ n: 11, type: 'name', quote_chapter: 'Ama', quote_bible: 'Amah', fix: 'Use Amah' }, { type: 'no chapter', fix: 'Add one' }]
    }) as { chapters: number[]; problems: string[] }
    expect(out.chapters).toEqual([11])
    expect(out.problems[0]).toBe('Chapter 11: name Quote: "Ama" Established: "Amah" Fix: Use Amah')
    expect(out.problems[1]).toBe('no chapter Fix: Add one')
  })

  it('keeps numbers, turns numeric strings into numbers, turns objects and strings in problems into lines, and leaves other input alone', () => {
    expect(normalizeReviewJson({ chapters: [3, '4', 3], problems: ['One.', { issue: 'Two', fix: 'do it', chapter: 2 }, '  '] })).toEqual({ chapters: [3, 4], problems: ['One.', 'Chapter 2: Two Fix: do it'] })
    expect(normalizeReviewJson({ verdict: 'pass', notes: 'Fine.' })).toEqual({ verdict: 'pass', notes: 'Fine.' })
    expect(normalizeReviewJson('text')).toBe('text')
    expect(problemText({ chapter: 5 })).toBe('')
  })
})

describe('notesProblem', () => {
  it('a revise that promises items and gives none is refused', () => {
    expect(notesProblem('revise', 'Three concrete fixes below.', [])).toMatch(/too short/)
    expect(notesProblem('revise', 'The check found a few problems in the later chapters, as follows', [])).toMatch(/promise a list/)
    expect(notesProblem('revise', 'The check found three fixes, described here in a paragraph of its own with no list at all.', [])).toMatch(/promise 3 items but give 0/)
  })

  it('notes with the promised list, or with problems, are fine', () => {
    expect(notesProblem('revise', 'Three fixes:\n- Fix the coat in chapter 2.\n- Fix the name in chapter 3.\n- Fix the date in chapter 4.', [])).toBeNull()
    expect(notesProblem('revise', 'Three concrete fixes below.', ['Chapter 2: the coat.', 'Chapter 3: the name.', 'Chapter 4: the date.'])).toBeNull()
    expect(notesProblem('revise', 'Two fixes below.', ['Chapter 2: the coat.'])).toMatch(/promise 2 items but give 1/)
  })

  it('cut-off notes are refused unless there are problems; a pass is never checked', () => {
    expect(notesProblem('revise', 'The chapter contradicts the bible: the fox is white here but was grey, and the lamp', [])).toMatch(/middle of a sentence/)
    expect(notesProblem('revise', 'The chapter contradicts the bible: the fox is white here but was grey, and the lamp', ['Chapter 2: the fox.'])).toBeNull()
    expect(notesProblem('revise', 'The fox has the wrong coat in chapter 2.', [])).toBeNull()
    expect(notesProblem('pass', 'Fine', [])).toBeNull()
  })
})

describe('reviewBody', () => {
  it('puts the problems after the notes as a numbered list', () => {
    expect(reviewBody('Two fixes.', [])).toBe('Two fixes.')
    expect(reviewBody(' Two fixes. ', ['A.', 'B.'])).toBe('Two fixes.\n\n## Problems\n\n1. A.\n2. B.')
  })
})

type Env = Awaited<ReturnType<typeof makePipelineEnv>>

describe('a long book whose continuity checker answers "revise" without notes', () => {
  let env: Env
  let slug = ''
  const calls: Record<number, number> = {}
  const followUps: Record<number, string[]> = {}
  afterAll(async () => {
    await env?.cleanup()
  })
  const PROBLEMS = ['Chapter 2: the fox has a white coat here. Quote: "white as snow" Established: "a grey coat" Fix: make it grey.', 'Chapter 2: the lamp is lit twice. Fix: keep one lighting.']

  it('asks again in the same job, writes the problems into the check file, and the rewrite gets them; a checker that never gives any is retried, then accepted', async () => {
    env = await makePipelineEnv({ activate: ['fic-fantasy-epic'], format: 'novel', smallNovel: true })
    const chapterOf = (req: { messages: { role: string; content: string }[] }) => Number(/Chapter (\d+):/.exec(req.messages.find((m) => m.role === 'user')!.content)?.[1] ?? 0)
    env.mock.on({ task: 'check_chapter' }, (req) => {
      const n = chapterOf(req)
      calls[n] = (calls[n] ?? 0) + 1
      const asked = req.messages.length > 2
      if (asked) (followUps[n] ??= []).push(req.messages[req.messages.length - 1]!.content)
      if (n === 2) {
        // the first reply promises two fixes below and has no list; the follow-up gives the whole answer
        if (!asked) return JSON.stringify({ verdict: 'revise', scores: { continuity: 5 }, notes: 'Two fixes below.', chapters: [], research_questions: [] })
        return JSON.stringify({ verdict: 'revise', scores: { continuity: 5 }, notes: 'Two continuity slips in chapter 2.', chapters: [2], problems: PROBLEMS, research_questions: [] })
      }
      if (n === 4) return JSON.stringify({ verdict: 'revise', scores: { continuity: 5 }, notes: 'Three fixes below.', chapters: [], research_questions: [] })
      return JSON.stringify({ verdict: 'pass', scores: { continuity: 9 }, notes: 'Consistent.', chapters: [], research_questions: [] })
    })
    slug = (await waitFor(async () => (await env.engine.snapshot()).books.find((b) => b.stage === 'published')?.slug ?? null, 120000, 'the novel to be published'))!

    // chapter 2: one follow-up in the same job, the problems in the check file
    expect(calls[2]).toBe(2)
    expect(followUps[2]![0]).toContain('Your verdict is revise, but the notes are too short to say what to change')
    const check = parseMd(await readFile(path.join(env.dir, 'books', slug, 'reviews', 'ch-02-check.md'), 'utf8'))
    expect(check.data).toMatchObject({ verdict: 'revise', n: 2 })
    expect(check.body).toContain('Two continuity slips in chapter 2.')
    expect(check.body).toContain('## Problems')
    expect(check.body).toContain(`1. ${PROBLEMS[0]}`)
    expect(check.body).toContain(`2. ${PROBLEMS[1]}`)
    // the rewrite triggered by the check has both problems in its prompt
    const fix = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--rewrite--ch02--chk.md`), 'utf8'))
    expect(fix.body).toContain(PROBLEMS[0])
    expect(fix.body).toContain(PROBLEMS[1])

    // chapter 4: never any problems. The first attempt asks twice and fails, the second (the last) keeps it with a warning
    expect(calls[4]).toBe(4)
    const done4 = parseMd(await readFile(path.join(env.dir, 'jobs', 'done', `${slug}--check--ch04--r0.md`), 'utf8'))
    expect(done4.data.attempts).toBe(1)
    await env.engine.logs.flush()
    const log = await readFile(path.join(env.dir, 'books', slug, 'log.md'), 'utf8')
    expect(log).toContain('warning: the check said revise without usable notes')
    expect(parseMd(await readFile(path.join(env.dir, 'books', slug, 'reviews', 'ch-04-check.md'), 'utf8')).body).toContain('Three fixes below.')
  }, 180000)
})

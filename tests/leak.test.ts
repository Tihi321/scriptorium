import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findLeaks, instructionLines, stripTrailingLeak } from '../src/engine/pipeline/leak'
import { parseMd } from '../src/shared/md'
import { makeEnv, seedDir, waitFor } from './helpers'

const template = async (rel: string) => parseMd(await readFile(path.join(seedDir, 'prompts', ...rel.split('/')), 'utf8')).body
const rewriteSection = async () => {
  const text = await template('_choices.md')
  const at = text.indexOf('## rewrite')
  return text.slice(at, text.indexOf('## review')).replace('## rewrite\n', '').trim()
}

const CHAPTER = ['SCENE: The observatory dome, night', 'Rain ticks on the copper roof.', 'ON SCREEN: Mara (tired)', 'MARA (tired): Nobody comes up here after nine.', 'The stairs creak below.'].join('\n')

describe('instructionLines', () => {
  it('keeps the fixed sentences of the template, not the ones with a variable, and the first paragraphs of appended sections', async () => {
    const lines = instructionLines(await template('writer/rewrite_chapter_vn.md'), [await rewriteSection()])
    expect(lines.length).toBeGreaterThan(5)
    expect(lines.length).toBeLessThanOrEqual(80)
    expect(lines.some((l) => l.startsWith('fix what the notes point out'))).toBe(true)
    expect(lines.some((l) => l.startsWith('keep it a visual novel script, one element per line'))).toBe(true)
    expect(lines.some((l) => l.includes('one reader reads only one path through it.'))).toBe(true)
    // nothing with a variable in it, nothing short
    expect(lines.every((l) => !l.includes('{{') && l.length >= 40)).toBe(true)
    expect(new Set(lines).size).toBe(lines.length)
  })
})

describe('findLeaks and stripTrailingLeak', () => {
  it('finds nothing in a chapter that quotes nothing', async () => {
    const lines = instructionLines(await template('writer/rewrite_chapter_vn.md'), [await rewriteSection()])
    expect(findLeaks(CHAPTER, lines)).toEqual([])
    expect(stripTrailingLeak(CHAPTER, lines)).toEqual({ text: CHAPTER, cut: false })
  })

  it('cuts the closing paragraphs of the template and the choices section that ended a live chapter', async () => {
    const body = await template('writer/rewrite_chapter_vn.md')
    const lines = instructionLines(body, [await rewriteSection()])
    const tail = body.slice(body.indexOf('Write the improved chapter.')).trim()
    const leaked = `${CHAPTER}\n\n${tail}\n\n${await rewriteSection()}\n`
    expect(findLeaks(leaked, lines).length).toBeGreaterThan(2)
    const cut = stripTrailingLeak(leaked, lines)!
    expect(cut.cut).toBe(true)
    expect(cut.text).toBe(CHAPTER)
  })

  it('also cuts a leak with a stray short line after it, and returns null for a leak in the middle', async () => {
    const body = await template('writer/rewrite_chapter_vn.md')
    const lines = instructionLines(body)
    const sentence = body.split('\n').find((l) => l.startsWith('Write the improved chapter.'))!
    expect(stripTrailingLeak(`${CHAPTER}\n${sentence}\nEnd.`, lines)).toEqual({ text: CHAPTER, cut: true })
    const middle = `${CHAPTER}\n${sentence}\nThe stairs creak again, louder this time, and Mara turns toward the door.`
    expect(stripTrailingLeak(middle, lines)).toBeNull()
  })
})

describe('the client queue refuses a leaky answer (through the scheduler)', () => {
  let env: Awaited<ReturnType<typeof makeEnv>> | undefined
  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  it('a chat with forbid lines makes a task that refuses an answer repeating them, then takes the clean one', async () => {
    env = await makeEnv({ providers: [{ id: 'client', kind: 'client', models: ['claude-code'] }], roles: { writer: ['client/claude-code'] }, agents: [{ role: 'writer', name: 'Ann' }] })
    const e = env
    const forbid = ['write only the script, with no title, heading or notes.']
    e.engine.scheduler.register('t', async (ctx) => ({ result: (await ctx.chat({ messages: [{ role: 'user', content: 'Write the chapter.' }], forbid })).text }))
    await e.engine.jobs.enqueue({ id: 'b1--t--u1--r0', task: 't', role: 'writer', book: 'b1', unit: 'u1', requested_by: 'engine' })
    const task = await waitFor(() => e.engine.clientQueue.lease({ role: 'writer' }), 8000, 'the client task')
    const refused = e.engine.clientQueue.submit(task.id, 'The fox slept.\n\nWrite only the script, with no title, heading or notes.') as { accepted: false; problems: string[] }
    expect(refused.accepted).toBe(false)
    expect(refused.problems[0]).toContain("the answer repeats the task's instructions")
    expect(e.engine.clientQueue.counts()).toEqual({ waiting: 0, leased: 1 })
    expect(e.engine.clientQueue.submit(task.id, 'The fox slept.')).toEqual({ accepted: true })
    await waitFor(async () => (await readdir(path.join(e.dir, 'jobs', 'done'))).includes('b1--t--u1--r0.md'), 8000, 'the job to finish')
  })
})

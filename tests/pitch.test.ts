import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countWords } from '../src/engine/pipeline/books'
import { makePipelineEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

let env: TestEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

/** A pitch of exactly `n` words. */
const pitchOf = (n: number) => Array.from({ length: n }, (_, i) => (i % 3 === 2 ? 'sleeps.' : i % 3 === 1 ? 'fox' : 'The')).join(' ')

/** Runs a book as far as its pitch; `answers` are the pitch replies in order (the last one repeats). Returns the saved pitch and the number of calls. */
async function pitchRun(answers: string[]): Promise<{ pitch: string; calls: string[] }> {
  const e = await makePipelineEnv({ format: 'bedtime-toddler', activate: [] })
  env = e
  const calls: string[] = []
  e.mock.on({ task: 'pitch' }, (req) => {
    calls.push(req.messages[req.messages.length - 1]!.content)
    return answers[Math.min(calls.length - 1, answers.length - 1)]!
  })
  await e.engine.handleCommand({ type: 'setTopicActive', id: 'jfic-bedtime-and-dreams', active: true })
  const slug = await waitFor(async () => (await e.engine.books.slugs())[0], 30000, 'a book')
  const file = path.join(e.dir, 'books', slug, 'pitch.md')
  const pitch = await waitFor(async () => (await e.engine.books.pitch(slug)) ?? null, 30000, 'the pitch')
  expect(await readFile(file, 'utf8')).toContain(pitch)
  return { pitch, calls }
}

describe('the pitch limit', () => {
  it('a pitch of 315 words gets one tighten request, and the shorter answer is kept', async () => {
    expect(countWords(pitchOf(315))).toBe(315)
    const { pitch, calls } = await pitchRun([pitchOf(315), pitchOf(250)])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('This pitch has 315 words')
    expect(countWords(pitch)).toBe(250)
  }, 60000)

  it('a pitch of 290 words is taken as it is', async () => {
    const { pitch, calls } = await pitchRun([pitchOf(290), pitchOf(250)])
    expect(calls).toHaveLength(1)
    expect(countWords(pitch)).toBe(290)
  }, 60000)

  it('asks only once: when the tightened pitch is no shorter, the first stays', async () => {
    const { pitch, calls } = await pitchRun([pitchOf(340), pitchOf(360)])
    expect(calls).toHaveLength(2)
    expect(countWords(pitch)).toBe(340)
  }, 60000)
})

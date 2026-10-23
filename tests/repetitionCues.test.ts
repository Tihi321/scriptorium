import { describe, expect, it } from 'vitest'
import { analyzeRepetition, withoutControlLines } from '../src/engine/memory/repetition'
import { ticReport } from '../src/engine/pipeline/humanizerHandlers'

const scene = (i: number) =>
  [
    'SCENE: The back room, night',
    'ON SCREEN: Mara (raincoat), Dino',
    'AMBIENCE: wind pushing at the shutters',
    'SFX: a heavy padlock snapping open',
    'CG: Mara in the raincoat by the window',
    'INSERT: a scrap of masking tape',
    'CLUE: winter_garden/c1: The rope was in the kitchen.',
    `MARA: Line number ${i} is all different from the others here, truly.`
  ].join('\n')

describe('SCP-36: the repetition counter skips a script\'s control lines', () => {
  const chapters = [1, 2].map((n) => ({ n, text: Array.from({ length: 6 }, (_, i) => scene(i + n * 10)).join('\n---\n') }))

  it('withoutControlLines drops SCENE, ON SCREEN, cue and puzzle lines and keeps the rest', () => {
    const out = withoutControlLines(scene(1))
    expect(out).toBe('MARA: Line number 1 is all different from the others here, truly.')
    expect(withoutControlLines('Plain prose.\r\nSFX: bell\r\nMore prose.')).toBe('Plain prose.\r\nMore prose.')
  })

  it('the counter finds no repeated phrase in cue lines that repeat on purpose', () => {
    const rep = analyzeRepetition(chapters)
    const texts = rep.phrases.map((p) => p.text).join(' | ')
    for (const bad of ['wind pushing at', 'the back room', 'raincoat', 'padlock snapping', 'masking tape', 'the rope was']) expect(texts, bad).not.toContain(bad)
    expect(ticReport(chapters, 2)).not.toMatch(/ambience|scene the|on screen/i)
  })

  it('real prose that repeats is still counted', () => {
    const prose = Array.from({ length: 8 }, () => 'The old keeper rubbed his tired eyes slowly.').join('\n')
    const rep = analyzeRepetition([{ n: 1, text: prose }])
    expect(rep.phrases.length).toBeGreaterThan(0)
  })

  it('a chapter of one cue line repeated 12 times has nothing to count', () => {
    const raw = analyzeRepetition([{ n: 1, text: Array.from({ length: 12 }, () => 'AMBIENCE: wind pushing at the shutters').join('\n') }])
    expect(raw.phrases).toEqual([])
  })
})

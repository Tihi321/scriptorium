import { describe, expect, it } from 'vitest'
import { parseLightBible, parseScript } from '../src/engine/publish/script'

const EXAMPLE = [
  'SCENE: The harbour wall, dusk',
  'Rain needles the grey water. The lighthouse beam sweeps over the boats.',
  'ON SCREEN: Mara (soaked raincoat, worried)',
  "MARA (worried): He said he'd be back before the lamp was lit.",
  'Footsteps on the wet stones. Someone is running.',
  'ON SCREEN: Mara (startled), Tomas (out of breath, grinning)',
  'TOMAS (grinning): Did you miss me?',
  'MARA (annoyed): You\'re *late*.',
  '---',
  'SCENE: The lighthouse kitchen, night',
  'A low room with a black iron stove and a single oil lamp. Wet coats drip by the door.',
  'ON SCREEN: Mara (drying her hair), Tomas (sitting by the stove)',
  'TOMAS: I found something on the rocks.'
].join('\n')

describe('parseScript', () => {
  it('parses the example of docs/visual-novel.md into scenes and beats', () => {
    const { scenes } = parseScript(EXAMPLE, ['Mara', 'Tomas'])
    expect(scenes).toHaveLength(2)
    expect(scenes[0]).toEqual({
      place: 'The harbour wall',
      time: 'dusk',
      background: 'Rain needles the grey water. The lighthouse beam sweeps over the boats.',
      beats: [
        { type: 'cast', cast: [{ name: 'Mara', look: 'soaked raincoat, worried' }] },
        { type: 'line', speaker: 'Mara', expression: 'worried', text: "He said he'd be back before the lamp was lit." },
        { type: 'narration', text: 'Footsteps on the wet stones. Someone is running.' },
        { type: 'cast', cast: [{ name: 'Mara', look: 'startled' }, { name: 'Tomas', look: 'out of breath, grinning' }] },
        { type: 'line', speaker: 'Tomas', expression: 'grinning', text: 'Did you miss me?' },
        { type: 'line', speaker: 'Mara', expression: 'annoyed', text: "You're *late*." },
        { type: 'break' }
      ]
    })
    expect(scenes[1]).toMatchObject({ place: 'The lighthouse kitchen', time: 'night', background: expect.stringContaining('black iron stove') })
    expect(scenes[1]!.beats.at(-1)).toEqual({ type: 'line', speaker: 'Tomas', expression: '', text: 'I found something on the rocks.' })
  })

  it('splits a SCENE at the last comma, and takes a line without a comma as the place', () => {
    const { scenes } = parseScript('SCENE: The cellar, under the old inn, midnight\nSCENE: A long road')
    expect(scenes[0]).toMatchObject({ place: 'The cellar, under the old inn', time: 'midnight' })
    expect(scenes[1]).toMatchObject({ place: 'A long road', time: '' })
  })

  it('opens a scene at a ## heading, and puts text before the first scene into one with no place', () => {
    const { scenes } = parseScript('Dark.\n## The attic, noon\nDust.\nON SCREEN: Mara')
    expect(scenes[0]).toMatchObject({ place: '', background: '', beats: [{ type: 'narration', text: 'Dark.' }] })
    expect(scenes[1]).toMatchObject({ place: 'The attic', time: 'noon', background: 'Dust.', beats: [{ type: 'cast', cast: [{ name: 'Mara', look: '' }] }] })
  })

  it('keeps the capitals of a speaker the bible does not have, and uses the bible name for one it has', () => {
    const { scenes } = parseScript('SCENE: Hall, day\nTHE STRANGER (cold): Who are you?\nDEC: Me.', ['Dec Hartley'])
    expect(scenes[0]!.beats).toEqual([
      { type: 'line', speaker: 'THE STRANGER', expression: 'cold', text: 'Who are you?' },
      { type: 'line', speaker: 'Dec Hartley', expression: '', text: 'Me.' }
    ])
  })
})

describe('parseLightBible', () => {
  it('reads characters with looks and voice, places and the style', () => {
    const bible = parseLightBible(
      ['## Characters', '- **Mara**: Seventeen, small and wiry. Voice: short sentences, dry jokes', '- **Tomas**: Tall and loud.', '', '## Places', '- **The harbour wall**: A long stone pier at dusk.', '', '## Style', 'Moody, rain-soaked.', 'Warm interiors.', ''].join('\n')
    )
    expect(bible.characters).toEqual([
      { name: 'Mara', looks: 'Seventeen, small and wiry.', voice: 'short sentences, dry jokes' },
      { name: 'Tomas', looks: 'Tall and loud.', voice: '' }
    ])
    expect(bible.places).toEqual([{ name: 'The harbour wall', looks: 'A long stone pier at dusk.' }])
    expect(bible.style).toBe('Moody, rain-soaked.\nWarm interiors.')
  })

  it('gives empty lists for a text without a bible', () => {
    expect(parseLightBible('')).toEqual({ characters: [], places: [], style: '' })
  })
})

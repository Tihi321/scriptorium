import { describe, expect, it } from 'vitest'
import { detectTime, parseLightBible, parseScript, placeAndTime, sceneHead } from '../src/engine/publish/script'

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

describe('parseScript: picture and sound lines', () => {
  const CUES = [
    'SCENE: The harbour wall, dusk',
    'AMBIENCE: waves on stone, a far foghorn',
    'Rain needles the grey water.',
    'ON SCREEN: Mara (worried)',
    'SFX: a door bangs open',
    'MARA (worried): He is late.',
    'CG: Mara at the end of the pier',
    'INSERT: a torn page with a map',
    'SOUND: a single gunshot',
    'MARA: Who fired that?',
    'END CG',
    '**CG:** the lamp, lit at last',
    'CG: none',
    'AMBIENCE: none',
    'CG:',
    'ZVUK: vrata',
    'SLIKA: svjetionik'
  ].join('\n')

  it('reads every cue form as a cue beat, never as a speaker, and keeps the empty ones out', () => {
    const { scenes } = parseScript(CUES, ['Mara'])
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.background).toBe('Rain needles the grey water.')
    expect(scenes[0]!.beats).toEqual([
      { type: 'cue', cue: 'ambience', text: 'waves on stone, a far foghorn' },
      { type: 'cast', cast: [{ name: 'Mara', look: 'worried' }] },
      { type: 'cue', cue: 'sfx', text: 'a door bangs open' },
      { type: 'line', speaker: 'Mara', expression: 'worried', text: 'He is late.' },
      { type: 'cue', cue: 'cg', text: 'Mara at the end of the pier' },
      { type: 'cue', cue: 'insert', text: 'a torn page with a map' },
      { type: 'cue', cue: 'sfx', text: 'a single gunshot' },
      { type: 'line', speaker: 'Mara', expression: '', text: 'Who fired that?' },
      { type: 'cue', cue: 'cg', text: null },
      { type: 'cue', cue: 'cg', text: 'the lamp, lit at last' },
      { type: 'cue', cue: 'cg', text: null },
      { type: 'cue', cue: 'ambience', text: null },
      { type: 'cue', cue: 'sfx', text: 'vrata' },
      { type: 'cue', cue: 'cg', text: 'svjetionik' }
    ])
    expect(scenes[0]!.beats.some((b) => b.type === 'line' && /^(CG|SFX|INSERT|AMBIENCE|SOUND)$/.test(b.speaker))).toBe(false)
  })

  it('a cue right after SCENE does not end the background', () => {
    const { scenes } = parseScript('SCENE: The barn, night\nAMBIENCE: crickets\nA red barn.\nStraw on the floor.\nMARA: Hello.')
    expect(scenes[0]).toMatchObject({ place: 'The barn', background: 'A red barn. Straw on the floor.' })
    expect(scenes[0]!.beats[0]).toEqual({ type: 'cue', cue: 'ambience', text: 'crickets' })
    expect(scenes[0]!.beats).toHaveLength(2)
  })

  it('an alias as a speaker or on screen gives the bible name and the alias', () => {
    const chars = [{ name: 'Kessler', aliases: ['the bald man', 'Brother Kessler'] }, { name: 'Mara', aliases: [] }]
    const { scenes } = parseScript('SCENE: Hall, day\nON SCREEN: The bald man (grim), Mara (small)\nTHE BALD MAN: Sit.\nBROTHER KESSLER (soft): Please.\nKESSLER: Enough.\nMARA: No.', ['Kessler', 'Mara'], chars)
    expect(scenes[0]!.beats).toEqual([
      { type: 'cast', cast: [{ name: 'Kessler', look: 'grim', alias: 'the bald man' }, { name: 'Mara', look: 'small' }] },
      { type: 'line', speaker: 'Kessler', expression: '', text: 'Sit.', alias: 'the bald man' },
      { type: 'line', speaker: 'Kessler', expression: 'soft', text: 'Please.', alias: 'Brother Kessler' },
      { type: 'line', speaker: 'Kessler', expression: '', text: 'Enough.' },
      { type: 'line', speaker: 'Mara', expression: '', text: 'No.' }
    ])
  })
})

describe('parseLightBible', () => {
  it('reads characters with looks and voice, places and the style', () => {
    const bible = parseLightBible(
      ['## Characters', '- **Mara**: Seventeen, small and wiry. Voice: short sentences, dry jokes', '- **Tomas**: Tall and loud.', '', '## Places', '- **The harbour wall**: A long stone pier at dusk.', '', '## Style', 'Moody, rain-soaked.', 'Warm interiors.', ''].join('\n')
    )
    expect(bible.characters).toEqual([
      { name: 'Mara', looks: 'Seventeen, small and wiry.', voice: 'short sentences, dry jokes', aliases: [] },
      { name: 'Tomas', looks: 'Tall and loud.', voice: '', aliases: [] }
    ])
    expect(bible.places).toEqual([{ name: 'The harbour wall', looks: 'A long stone pier at dusk.' }])
    expect(bible.style).toBe('Moody, rain-soaked.\nWarm interiors.')
  })

  it('reads Aliases: before Voice:, keeps them out of the looks, and stops at the first full stop', () => {
    const bible = parseLightBible(
      ['## Characters', '- **Kessler**: Bald, broad, a grey coat. Aliases: the bald man, "Brother Kessler"; Kess ili Dr Vey. Voice: slow, low', '- **Mara**: Small. Aliases: the girl, the girl. Voice: dry', '- **Tomas**: Tall. Aliases: Tom Voice: loud', ''].join('\n')
    )
    expect(bible.characters[0]).toEqual({ name: 'Kessler', looks: 'Bald, broad, a grey coat.', voice: 'slow, low', aliases: ['the bald man', 'Brother Kessler', 'Kess', 'Dr Vey'] })
    expect(bible.characters[1]).toMatchObject({ looks: 'Small.', voice: 'dry', aliases: ['the girl'] })
    expect(bible.characters[2]).toMatchObject({ looks: 'Tall.', voice: 'loud', aliases: ['Tom'] })
  })

  it('gives empty lists for a text without a bible', () => {
    expect(parseLightBible('')).toEqual({ characters: [], places: [], style: '' })
  })
})

describe('SCENE parsing (VN Studio’s parseSceneLine rule)', () => {
  it('splits at the first full stop: place, time and the description after it', () => {
    expect(sceneHead('A path through Dragon Land, morning. The sky is green. Bubbles pop.')).toEqual({
      place: 'A path through Dragon Land',
      time: 'morning',
      rest: 'The sky is green. Bubbles pop.'
    })
    const { scenes } = parseScript('SCENE: The Golden Cave, afternoon. The walls sparkle like gold.\nMARA: Wow.')
    expect(scenes[0]).toMatchObject({ place: 'The Golden Cave', time: 'afternoon', background: 'The walls sparkle like gold.' })
  })

  it('reads a place and a time, a place only, and keeps a non-time tail after the comma in the place', () => {
    expect(sceneHead('The harbour wall, dusk')).toEqual({ place: 'The harbour wall', time: 'dusk', rest: '' })
    expect(sceneHead('A long road')).toEqual({ place: 'A long road', time: '', rest: '' })
    // four words, but not a time: the whole head is the place
    expect(sceneHead('Dragon Land, near a bubble-gum volcano. The sky is green.')).toEqual({
      place: 'Dragon Land, near a bubble-gum volcano',
      time: '',
      rest: 'The sky is green.'
    })
    // a long tail is not a time, even with a time word in it: the whole head is the place
    expect(sceneHead('The cellar, under the old inn, beside the river')).toMatchObject({ place: 'The cellar, under the old inn, beside the river', time: '' })
    expect(sceneHead('The cellar, under the old inn by the river, long after the midnight bell')).toMatchObject({ place: 'The cellar, under the old inn by the river, long after the midnight bell', time: '' })
  })

  it('keeps the time as written and accepts Croatian time words', () => {
    expect(sceneHead('Grassy hill with standing stones, Dragon Land, midday')).toMatchObject({ place: 'Grassy hill with standing stones, Dragon Land', time: 'midday' })
    expect(sceneHead('The kitchen, late afternoon')).toMatchObject({ place: 'The kitchen', time: 'late afternoon' })
    expect(sceneHead('Šuma, ujutro')).toMatchObject({ place: 'Šuma', time: 'ujutro' })
    expect(sceneHead('Kuća, navečer')).toMatchObject({ place: 'Kuća', time: 'navečer' })
    expect(detectTime('late afternoon')).toBe('afternoon')
    expect(detectTime('navečer')).toBe('evening')
    expect(detectTime('near a bubble-gum volcano')).toBeNull()
  })

  it('leaves a ## heading on the plain last-comma rule', () => {
    expect(placeAndTime('The attic, noon')).toEqual({ place: 'The attic', time: 'noon' })
    const { scenes } = parseScript('## The attic, noon\nDust and a low beam.\nMARA: Hm.')
    expect(scenes[0]).toMatchObject({ place: 'The attic', time: 'noon', background: 'Dust and a low beam.' })
    expect(scenes[0]!.beats).toEqual([{ type: 'line', speaker: 'MARA', expression: '', text: 'Hm.' }])
  })
})

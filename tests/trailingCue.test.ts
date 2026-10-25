import { describe, expect, it } from 'vitest'
import { moveTrailingCues, settleScenePlaces } from '../src/engine/pipeline/scriptPlaces'
import { parseScript } from '../src/engine/publish/script'

/** The cue beats that are the last playable beat of their scene (a `break` beat after them is skipped), as VN Studio reads them. */
const trailingCues = (body: string) =>
  parseScript(body).scenes.filter((s) => {
    const beats = s.beats.filter((b) => b.type !== 'break')
    return beats.length > 1 && beats[beats.length - 1]!.type === 'cue' && (beats[beats.length - 1] as { text: string | null }).text !== null
  }).length

describe('SCP-35: a cue that is the last line of a scene is moved before its last beat', () => {
  const hub = `SCENE: Service room, night
MARA (tired): The padlock.
SFX: a heavy padlock snapping open
---
SCENE: Ferry deck, Monday, dusk
MARA: Home.`

  it('the hub\'s case: an SFX right before --- goes before the scene\'s last line', () => {
    expect(trailingCues(hub)).toBe(1)
    const out = moveTrailingCues(hub)
    expect(out.moved).toEqual(['SFX: a heavy padlock snapping open'])
    expect(out.body).toBe(`SCENE: Service room, night
SFX: a heavy padlock snapping open
MARA (tired): The padlock.
---
SCENE: Ferry deck, Monday, dusk
MARA: Home.`)
    expect(trailingCues(out.body)).toBe(0)
  })

  it('a cue at the end of the chapter, several cues, and blank lines are handled; the order of the cues is kept', () => {
    const body = 'SCENE: Hall, day\nThe door opens.\nMARA: Hello.\n\nCG: a lamp\nSFX: a bell\n\n'
    const out = moveTrailingCues(body)
    expect(out.moved).toEqual(['CG: a lamp', 'SFX: a bell'])
    expect(out.body).toBe('SCENE: Hall, day\nThe door opens.\nCG: a lamp\nSFX: a bell\nMARA: Hello.\n\n\n')
  })

  it('a cue before the next SCENE line counts as the end of its scene', () => {
    const out = moveTrailingCues('SCENE: A, day\nMARA: One.\nAMBIENCE: wind\nSCENE: B, day\nMARA: Two.')
    expect(out.body).toBe('SCENE: A, day\nAMBIENCE: wind\nMARA: One.\nSCENE: B, day\nMARA: Two.')
  })

  it('leaves alone: a cue in the middle, END CG and none cues at the end, a scene of cues only', () => {
    for (const body of [
      'SCENE: A, day\nSFX: a bell\nMARA: One.',
      'SCENE: A, day\nCG: a lamp\nMARA: One.\nEND CG',
      'SCENE: A, day\nMARA: One.\nAMBIENCE: none',
      'SCENE: A, day\nSFX: a bell\n---\nSCENE: B, day\nMARA: Two.'
    ]) {
      const out = moveTrailingCues(body)
      expect(out.moved, body).toEqual([])
      expect(out.body, body).toBe(body)
    }
  })

  it('a script with no trailing cue comes back unchanged', () => {
    const body = 'SCENE: A, day\nMARA: One.\n---\nSCENE: B, night\nMARA: Two.\n'
    expect(moveTrailingCues(body)).toEqual({ body, moved: [] })
  })
})

describe('SCP-35: settleScenePlaces moves the cue for a visual novel, not for a screenplay', () => {
  const stub = { books: { bible: async () => '' } } as unknown as Parameters<typeof settleScenePlaces>[0]
  const body = 'SCENE: A, day\nMARA: One.\nSFX: a bell\n---\nSCENE: B, day\nMARA: Two.'
  it('moves it and logs it with cues on, leaves the text alone with cues off', async () => {
    const logs: string[] = []
    expect(await settleScenePlaces(stub, 'b', 1, body, (m) => logs.push(m), { cues: true })).toBe('SCENE: A, day\nSFX: a bell\nMARA: One.\n---\nSCENE: B, day\nMARA: Two.')
    expect(logs.join(' ')).toContain('moved before its last beat')
    expect(await settleScenePlaces(stub, 'b', 1, body, () => undefined, { cues: false })).toBe(body)
    expect(await settleScenePlaces(stub, 'b', 1, body, () => undefined)).toBe(body)
  })

  it('renames the place without truncating a comma-rich picture sentence (SCP-46)', async () => {
    const withPlaces = { books: { bible: async () => '## Places\n- **Harbour Wall**: A long stone pier.\n' } } as unknown as Parameters<typeof settleScenePlaces>[0]
    const body = 'SCENE: harbour wall, dusk. Lana sits on the wet stones, her dress yellow, Mama beside her, and the gulls call.'
    const out = await settleScenePlaces(withPlaces, 'b', 1, body, () => undefined)
    expect(out).toBe('SCENE: Harbour Wall, dusk. Lana sits on the wet stones, her dress yellow, Mama beside her, and the gulls call.')
  })
})

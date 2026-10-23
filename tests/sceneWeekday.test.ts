import { describe, expect, it } from 'vitest'
import { canonicalScenes, scenePlaces } from '../src/engine/pipeline/scriptPlaces'

describe('SCP-34: the SCENE place fixer keeps the weekday', () => {
  const places = ['Ferry deck', 'The riva', "Ante's kitchen"]

  it('a weekday before the time stays in the line when the place is renamed to the bible\'s name', () => {
    const out = canonicalScenes('SCENE: ferry deck, Monday, late afternoon\nSCENE: The riva, Monday, dusk\nSCENE: Ante\'s kitchen, Tuesday, morning', places)
    expect(out.body).toBe("SCENE: Ferry deck, Monday, late afternoon\nSCENE: The riva, Monday, dusk\nSCENE: Ante's kitchen, Tuesday, morning")
    expect(out.unknown).toEqual([])
  })

  it('a line that already names the bible place is untouched', () => {
    const body = 'SCENE: Ferry deck, Monday, late afternoon'
    const out = canonicalScenes(body, places)
    expect(out.body).toBe(body)
    expect(out.renamed).toEqual([])
  })

  it('the hub\'s case: "Ferry deck, Monday" is the place "Ferry deck" and the weekday is time, not a new place', () => {
    expect(scenePlaces('SCENE: Ferry deck, Monday, late afternoon')).toEqual(['Ferry deck'])
    const out = canonicalScenes('SCENE: The jetty, Friday, dawn', places)
    expect(out.unknown).toEqual(['The jetty'])
    expect(out.body).toBe('SCENE: The jetty, Friday, dawn')
  })

  it('a place with a comma that is not a weekday, and a time with a weekday at the end, work as before', () => {
    expect(scenePlaces('SCENE: Ferry deck, a quarter to five on Friday')).toEqual(['Ferry deck'])
    expect(canonicalScenes('SCENE: ferry deck, a quarter to five on Friday', places).body).toBe('SCENE: Ferry deck, a quarter to five on Friday')
  })
})

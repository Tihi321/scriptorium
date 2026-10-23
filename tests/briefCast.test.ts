import { describe, expect, it } from 'vitest'
import { briefShortName, mergeBriefCast } from '../src/engine/pipeline/briefCast'
import type { BriefCharacter } from '../src/shared/brief'

/** The brief of the hub's `the-winter-garden-clock`: full names, the short name only in the description ("Called Dec."). */
const BRIEF: BriefCharacter[] = [
  { name: 'Declan Hartley', role: 'co-lead', description: 'Called Dec. 34, from Galway. Locksmith turned escape-room designer.' },
  { name: 'Inès Varga', role: 'co-lead', description: '31, born in Lyon. Paintings restorer.' },
  { name: 'Commissaire Albert Pichon', role: 'police foil', description: 'Paris police commissaire, late fifties.' },
  { name: 'Gaspard Moreau', role: 'victim', description: '70, clock collector and host of the sale.' },
  { name: 'Madame Vérac', role: 'auctioneer', description: 'Runs the sale.' }
]
const o = (name: string, aliases: string[] = []) => ({ name, description: `${name} description`, voice: 'v', aliases })

describe('SCP-33: brief characters are not added twice', () => {
  it('reads the brief\'s short name from "Called Dec."', () => {
    expect(briefShortName(BRIEF[0]!)).toBe('Dec')
    expect(briefShortName(BRIEF[1]!)).toBeNull()
  })

  it('merges the outline\'s short names (Dec, Inès, Pichon, Moreau) into the brief\'s full names, one entry each, the short name as an alias', () => {
    const outline = [o('Dec'), o('Inès'), o('Pichon'), o('Moreau', ['the host']), o('Madame Vérac')]
    const { characters, added, matched } = mergeBriefCast(outline, BRIEF)
    expect(added).toEqual([])
    expect(characters.map((c) => c.name)).toEqual(['Declan Hartley', 'Inès Varga', 'Commissaire Albert Pichon', 'Gaspard Moreau', 'Madame Vérac'])
    expect(characters.map((c) => c.aliases)).toEqual([['Dec'], ['Inès'], ['Pichon'], ['Moreau', 'the host'], []])
    // the outline's own description and voice are kept
    expect(characters[0]).toMatchObject({ description: 'Dec description', voice: 'v' })
    expect(matched.map((m) => `${m.outline}>${m.brief}`)).toEqual(['Dec>Declan Hartley', 'Inès>Inès Varga', 'Pichon>Commissaire Albert Pichon', 'Moreau>Gaspard Moreau'])
  })

  it('matches by alias and by first name, ignoring case and accents (a same-name entry stays as the architect wrote it)', () => {
    const { characters, added } = mergeBriefCast([o('The Auctioneer', ['vérac']), o('albert'), o('INES VARGA')], BRIEF)
    expect(characters.map((c) => c.name)).toEqual(['Madame Vérac', 'Commissaire Albert Pichon', 'INES VARGA'])
    expect(added.map((c) => c.name)).toEqual(['Declan Hartley', 'Gaspard Moreau'])
  })

  it('adds only the brief characters the outline really leaves out', () => {
    const { characters, added } = mergeBriefCast([o('Dec'), o('Nobody Else')], BRIEF)
    expect(characters.map((c) => c.name)).toEqual(['Declan Hartley', 'Nobody Else'])
    expect(added.map((c) => c.name)).toEqual(['Inès Varga', 'Commissaire Albert Pichon', 'Gaspard Moreau', 'Madame Vérac'])
  })

  it('an outline character that already has the brief\'s name is untouched, and a shorter one beside it is not merged into a second entry', () => {
    const { characters, added } = mergeBriefCast([o('Declan Hartley'), o('Dec')], BRIEF)
    expect(characters.map((c) => c.name)).toEqual(['Declan Hartley', 'Dec'])
    expect(added.map((c) => c.name)).not.toContain('Declan Hartley')
  })

  it('a label that fits two brief characters matches neither', () => {
    const twins: BriefCharacter[] = [
      { name: 'Anna Brown', role: '', description: '' },
      { name: 'Tom Brown', role: '', description: '' }
    ]
    const { characters, added } = mergeBriefCast([o('Brown')], twins)
    expect(characters.map((c) => c.name)).toEqual(['Brown'])
    expect(added.map((c) => c.name)).toEqual(['Anna Brown', 'Tom Brown'])
  })
})

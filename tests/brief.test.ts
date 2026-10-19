import { describe, expect, it } from 'vitest'
import { briefLabel, briefOf, briefPromptText, emptyBrief, isEmptyBrief, parseBrief, renderBrief } from '../src/shared/brief'
import type { StoryBrief } from '../src/shared/brief'

const full: StoryBrief = {
  title: 'The Lighthouse Keeper',
  premise: 'A girl keeps a lighthouse after her father is lost at sea.',
  plot: 'She finds a map.\n\nShe follows it.',
  characters: [
    { name: 'Mara Quill', role: "lighthouse keeper's daughter, the hero", description: 'Tall, freckled, ink on her fingers.\nSpeaks in short sentences.' },
    { name: 'Old Bram', role: '', description: 'A retired fisherman.' },
    { name: 'Gull', role: 'comic relief', description: '' }
  ],
  setting: 'A rocky coast, 1890s.',
  style: 'Warm, a little salty.',
  sections: [
    { heading: 'Themes', text: 'Loss and courage.' },
    { heading: 'Must not happen', text: '- no ghosts\n- no pirates' }
  ]
}

describe('story brief', () => {
  it('renders and parses back to the same brief (the title lives in the frontmatter)', () => {
    const body = renderBrief(full)
    expect(body).toContain('## Premise')
    expect(body).toContain('### Mara Quill\nRole: lighthouse keeper\'s daughter, the hero\nTall, freckled')
    const back = parseBrief(body)
    expect(back).toEqual({ ...full, title: '' })
    expect(renderBrief(back)).toBe(body)
  })

  it('reads the Role line of a character, and a character without one', () => {
    const b = parseBrief('## Characters\n\n### Ann\nrole: the baker\nLikes bread.\n\n### Bo\nJust a description.\n')
    expect(b.characters).toEqual([
      { name: 'Ann', role: 'the baker', description: 'Likes bread.' },
      { name: 'Bo', role: '', description: 'Just a description.' }
    ])
  })

  it('treats a plain old idea (no headings) as the premise', () => {
    const b = parseBrief('A book about a clockwork heron.\nIt learns to fly.')
    expect(b).toEqual({ ...emptyBrief(), premise: 'A book about a clockwork heron.\nIt learns to fly.' })
    expect(parseBrief('')).toEqual(emptyBrief())
  })

  it('passes any other heading on as a section, in order, and knows the headings in any case', () => {
    const b = parseBrief('## premise\nP\n\n## Themes\nT1\n\n## SETTING\nS\n\n## Last words\nL')
    expect(b.premise).toBe('P')
    expect(b.setting).toBe('S')
    expect(b.sections).toEqual([
      { heading: 'Themes', text: 'T1' },
      { heading: 'Last words', text: 'L' }
    ])
  })

  it('keeps ### headings inside a section and ignores headings in code fences', () => {
    const b = parseBrief('## Plot\n\n### Act one\nStart.\n\n```\n## not a heading\n```\n')
    expect(b.plot).toContain('### Act one')
    expect(b.plot).toContain('## not a heading')
    expect(b.sections).toEqual([])
  })

  it('has no length limit', () => {
    const long = 'word '.repeat(50_000).trim()
    const b = parseBrief(renderBrief({ ...emptyBrief(), premise: long, characters: [{ name: 'X', role: 'r', description: long }] }))
    expect(b.premise).toBe(long)
    expect(b.characters[0]!.description).toBe(long)
  })

  it('makes a label from the first line of the premise, and cuts only the label', () => {
    expect(briefLabel({ premise: 'Short idea\nmore', plot: '' })).toBe('Short idea')
    expect(briefLabel({ premise: '', plot: 'From the plot' })).toBe('From the plot')
    const label = briefLabel({ premise: 'x'.repeat(100), plot: '' })
    expect(label).toHaveLength(70)
    expect(label.endsWith('...')).toBe(true)
  })

  it('renders prompt text with the title and every section', () => {
    const text = briefPromptText(full)
    expect(text.startsWith('Title: The Lighthouse Keeper')).toBe(true)
    for (const s of ['Premise', 'Plot', 'Mara Quill', 'Old Bram', 'Setting', 'Style', 'Themes', 'Must not happen']) expect(text).toContain(s)
    expect(briefPromptText({ ...full, title: '' })).not.toContain('Title:')
  })

  it('reads an idea file: the title only counts when it is fixed, format, topic and genre come from the frontmatter', () => {
    const body = renderBrief(full)
    const loose = briefOf({ title: 'Label', format: 'novel', topic: 't1', genre: 'Sea' }, body)
    expect(loose).toMatchObject({ title: '', format: 'novel', topic: 't1', genre: 'Sea' })
    expect(briefOf({ title: 'Mine', title_fixed: true }, body).title).toBe('Mine')
    expect(briefOf({ format: null, topic: '' }, body).format).toBeUndefined()
  })

  it('knows an empty brief', () => {
    expect(isEmptyBrief(emptyBrief())).toBe(true)
    expect(isEmptyBrief({ ...emptyBrief(), title: 'T' })).toBe(false)
    expect(isEmptyBrief({ ...emptyBrief(), sections: [{ heading: 'A', text: 'b' }] })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { cleanAliases, cleanCastAliases, scriptBibleLine } from '../src/engine/pipeline/scriptBible'
import { cueOf, scriptToXhtml } from '../src/engine/publish/xhtml'

describe('cueOf', () => {
  it('reads the picture and sound lines VN Studio reads, Croatian keywords and bold marks too', () => {
    expect(cueOf('CG: Mara on the pier')).toEqual({ cue: 'cg', text: 'Mara on the pier' })
    expect(cueOf('**CG:** Mara on the pier')).toEqual({ cue: 'cg', text: 'Mara on the pier' })
    expect(cueOf('slika: svjetionik')).toEqual({ cue: 'cg', text: 'svjetionik' })
    expect(cueOf('INSERT: a torn page')).toEqual({ cue: 'insert', text: 'a torn page' })
    expect(cueOf('SFX: a door')).toEqual({ cue: 'sfx', text: 'a door' })
    expect(cueOf('SOUND: a shot')).toEqual({ cue: 'sfx', text: 'a shot' })
    expect(cueOf('ZVUK: vrata')).toEqual({ cue: 'sfx', text: 'vrata' })
    expect(cueOf('AMBIENCE: rain')).toEqual({ cue: 'ambience', text: 'rain' })
    expect(cueOf('ATMOSFERA: kiša')).toEqual({ cue: 'ambience', text: 'kiša' })
  })

  it('says null for the lines that stop a picture or a sound, and an empty text for a cue with nothing in it', () => {
    for (const line of ['CG: none', 'CG: ništa', 'CG: nista', 'INSERT: none', 'AMBIENCE: none', 'END CG', 'end cg', '**END CG**', 'KRAJ SLIKE']) expect(cueOf(line)?.text, line).toBeNull()
    expect(cueOf('CG:')).toEqual({ cue: 'cg', text: '' })
    expect(cueOf('SFX: none')).toEqual({ cue: 'sfx', text: 'none' })
  })

  it('is null for anything else, speakers included', () => {
    for (const line of ['MARA: Hello.', 'SCENE: The barn, night', 'ON SCREEN: Mara (worried)', 'The CG is on the wall.', 'CGI: nope']) {
      expect(cueOf(line), line).toBeNull()
    }
  })
})

describe('scriptToXhtml', () => {
  const SCRIPT = ['SCENE: The harbour, dusk', 'AMBIENCE: waves on stone', 'Rain falls.', 'CG: Mara on the pier', 'SFX: a bell', 'INSERT: a torn page', 'MARA: Hello.', 'END CG', 'CG: none', 'AMBIENCE: none', 'AMBIENCE:'].join('\n')

  it('shows a cue as a small note and not as a speaker', () => {
    const html = scriptToXhtml(SCRIPT)
    expect(html).toContain('<p class="vn-cue"><span class="vn-label">Ambience:</span> waves on stone</p>')
    expect(html).toContain('<p class="vn-cue"><span class="vn-label">Picture:</span> Mara on the pier</p>')
    expect(html).toContain('<p class="vn-cue"><span class="vn-label">Sound:</span> a bell</p>')
    expect(html).toContain('<p class="vn-cue"><span class="vn-label">Close-up:</span> a torn page</p>')
    expect(html).not.toMatch(/vn-speaker">(CG|SFX|INSERT|AMBIENCE)/)
    expect(html).toContain('<span class="vn-speaker">MARA</span> Hello.')
  })

  it('writes nothing for END CG, CG: none, AMBIENCE: none and an empty cue', () => {
    const html = scriptToXhtml(SCRIPT)
    expect(html.match(/class="vn-cue"/g)).toHaveLength(4)
    expect(html).not.toMatch(/END CG|none/i)
    expect(html).not.toContain('class="vn-narration">AMBIENCE')
  })
})

describe('cleanAliases', () => {
  it('drops full stops, the own name, other characters and repeats, long ones, and keeps at most five', () => {
    expect(cleanAliases('Kessler', ['Dr. Vey', 'kessler', 'The Kessler', 'Mara', 'the bald man', 'The Bald Man', 'a, b;c', ' ', 'x'.repeat(41)], ['Mara', 'Tomas'])).toEqual(['Dr Vey', 'the bald man', 'a b c'])
    expect(cleanAliases('Kessler', ['one', 'two', 'three', 'four', 'five', 'six', 'seven'])).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(cleanAliases('Kessler', undefined)).toEqual([])
  })

  it('a name or alias one character has is never another one\'s alias', () => {
    const out = cleanCastAliases([
      { name: 'Kessler', aliases: ['the bald man', 'Mara'] },
      { name: 'Mara', aliases: ['the bald man', 'the girl', 'Kessler'] }
    ])
    expect(out.map((c) => c.aliases)).toEqual([['the bald man'], ['the girl']])
  })
})

describe('scriptBibleLine', () => {
  it('writes the Aliases sentence before the voice, after a full stop', () => {
    expect(scriptBibleLine({ name: 'Kessler', description: 'Bald, broad', voice: 'slow', aliases: ['the bald man', 'Brother Kessler'] })).toBe('- **Kessler**: Bald, broad. Aliases: the bald man, Brother Kessler. Voice: slow')
    expect(scriptBibleLine({ name: 'Kessler', description: 'Bald.\nBroad.', aliases: ['the bald man'] })).toBe('- **Kessler**: Bald. Broad. Aliases: the bald man.')
  })

  it('changes nothing without aliases, and adds no second sentence', () => {
    expect(scriptBibleLine({ name: 'Mara', description: 'Small.', voice: 'dry', aliases: [] })).toBe('- **Mara**: Small. Voice: dry')
    expect(scriptBibleLine({ name: 'Mara', description: 'Small.' })).toBe('- **Mara**: Small.')
    expect(scriptBibleLine({ name: 'Mara', description: 'Small. Aliases: Mar.', voice: 'dry', aliases: ['the girl'] })).toBe('- **Mara**: Small. Aliases: Mar. Voice: dry')
  })
})

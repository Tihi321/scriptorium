import { useMemo, useState } from 'react'
import { emptyBrief, isEmptyBrief } from '../../shared/brief'
import type { StoryBrief } from '../../shared/brief'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'

/** What the form sends: empty characters and sections left out, empty format, topic and genre not set. */
function cleaned(b: StoryBrief): StoryBrief {
  return {
    ...b,
    title: b.title.trim(),
    characters: b.characters.filter((c) => c.name.trim()),
    sections: b.sections.filter((s) => s.heading.trim()),
    format: b.format || undefined,
    topic: b.topic || undefined,
    genre: b.genre?.trim() || undefined
  }
}

/**
 * The idea bucket: a one-line idea, or a described story (title, premise, plot, characters, setting, style and any section you add).
 * Stories nobody started a book from are listed below and can be edited.
 */
export function StoryForm() {
  const topics = useOffice((s) => s.topics)
  const formats = useOffice((s) => s.formats)
  const ideas = useOffice((s) => s.ideas)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState<StoryBrief>(emptyBrief)
  // the slug of the waiting story being edited, or null for a new one
  const [editing, setEditing] = useState<string | null>(null)
  const waiting = useMemo(() => ideas.filter((i) => i.status === 'open' && i.source === 'user'), [ideas])
  const sections = useMemo(() => [...new Set(topics.map((t) => t.section))], [topics])

  const flash = () => {
    setSent(true)
    setTimeout(() => setSent(false), 2500)
  }
  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendCommand({ type: 'addIdea', text: t })
    setText('')
    flash()
  }
  const set = (patch: Partial<StoryBrief>) => setBrief((b) => ({ ...b, ...patch }))
  const reset = () => {
    setBrief(emptyBrief())
    setEditing(null)
  }
  const save = () => {
    const b = cleaned(brief)
    if (isEmptyBrief(b)) return
    sendCommand(editing ? { type: 'updateStory', idea: editing, brief: b } : { type: 'addStory', brief: b })
    reset()
    setOpen(false)
    flash()
  }
  const load = (slug: string) => {
    const i = ideas.find((x) => x.slug === slug)
    if (!i) return
    setBrief(i.brief)
    setEditing(slug)
    setOpen(true)
  }
  const setCharacter = (n: number, patch: Partial<StoryBrief['characters'][number]>) => set({ characters: brief.characters.map((c, i) => (i === n ? { ...c, ...patch } : c)) })
  const setSection = (n: number, patch: Partial<StoryBrief['sections'][number]>) => set({ sections: brief.sections.map((s, i) => (i === n ? { ...s, ...patch } : s)) })
  const full = { width: '100%', boxSizing: 'border-box' } as const

  return (
    <div className="card" data-testid="add-idea">
      <h3>Idea bucket</h3>
      <div className="row">
        <input
          style={{ flex: 1, minWidth: 0 }}
          value={text}
          placeholder="A book you would like"
          data-testid="idea-text"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="primary" disabled={!text.trim()} onClick={submit} data-testid="idea-add">
          Add
        </button>
      </div>
      <span className="dim">{sent ? 'Added to the bucket.' : 'Your ideas are picked before generated ones.'}</span>
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={() => setOpen(!open)} data-testid="story-describe">
          {open ? 'Hide the story form' : 'Describe a story'}
        </button>
      </div>
      {open && (
        <div className="stack story-form" style={{ marginTop: 6 }} data-testid="story-form">
          <span className="dim">{editing ? `Editing "${ideas.find((i) => i.slug === editing)?.title ?? editing}"` : 'The editors keep your title, characters, plot and setting.'}</span>
          <input style={full} value={brief.title} placeholder="Title (empty: the editor chooses)" data-testid="story-title" onChange={(e) => set({ title: e.target.value })} />
          <div className="row">
            <select style={{ flex: 1, minWidth: 0 }} value={brief.format ?? ''} data-testid="story-format" onChange={(e) => set({ format: e.target.value || undefined })}>
              <option value="">Editor chooses</option>
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select style={{ flex: 1, minWidth: 0 }} value={brief.topic ?? ''} data-testid="story-topic" onChange={(e) => set({ topic: e.target.value || undefined })}>
              <option value="">No topic</option>
              {sections.map((s) => (
                <optgroup key={s} label={s}>
                  {topics
                    .filter((t) => t.section === s)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <input style={full} value={brief.genre ?? ''} placeholder="Genre" data-testid="story-genre" onChange={(e) => set({ genre: e.target.value })} />
          <textarea style={full} rows={3} value={brief.premise} placeholder="Premise: what the story is about" data-testid="story-premise" onChange={(e) => set({ premise: e.target.value })} />
          <textarea style={full} rows={3} value={brief.plot} placeholder="Plot: what happens" data-testid="story-plot" onChange={(e) => set({ plot: e.target.value })} />
          {brief.characters.map((c, n) => (
            <div key={n} className="stack" data-testid="story-character">
              <div className="row">
                <input style={{ flex: 1, minWidth: 0 }} value={c.name} placeholder="Name" data-testid="story-char-name" onChange={(e) => setCharacter(n, { name: e.target.value })} />
                <input style={{ flex: 1, minWidth: 0 }} value={c.role} placeholder="Role" data-testid="story-char-role" onChange={(e) => setCharacter(n, { role: e.target.value })} />
                <button className="small" title="Remove this character" data-testid="story-char-remove" onClick={() => set({ characters: brief.characters.filter((_, i) => i !== n) })}>
                  Remove
                </button>
              </div>
              <textarea style={full} rows={2} value={c.description} placeholder="Description: looks, voice, history" data-testid="story-char-desc" onChange={(e) => setCharacter(n, { description: e.target.value })} />
            </div>
          ))}
          <div className="row">
            <button onClick={() => set({ characters: [...brief.characters, { name: '', role: '', description: '' }] })} data-testid="story-add-character">
              + Add character
            </button>
          </div>
          <textarea style={full} rows={2} value={brief.setting} placeholder="Setting: where and when" data-testid="story-setting" onChange={(e) => set({ setting: e.target.value })} />
          <textarea style={full} rows={2} value={brief.style} placeholder="Style: voice, tone, how it should read" data-testid="story-style" onChange={(e) => set({ style: e.target.value })} />
          {brief.sections.map((s, n) => (
            <div key={n} className="stack" data-testid="story-section">
              <div className="row">
                <input style={{ flex: 1, minWidth: 0 }} value={s.heading} placeholder="Heading" data-testid="story-section-heading" onChange={(e) => setSection(n, { heading: e.target.value })} />
                <button className="small" title="Remove this section" data-testid="story-section-remove" onClick={() => set({ sections: brief.sections.filter((_, i) => i !== n) })}>
                  Remove
                </button>
              </div>
              <textarea style={full} rows={2} value={s.text} placeholder="Text" data-testid="story-section-text" onChange={(e) => setSection(n, { text: e.target.value })} />
            </div>
          ))}
          <div className="row">
            <button onClick={() => set({ sections: [...brief.sections, { heading: '', text: '' }] })} data-testid="story-add-section">
              + Add section
            </button>
          </div>
          <div className="row">
            <button className="primary" disabled={isEmptyBrief(cleaned(brief))} onClick={save} data-testid="story-save">
              {editing ? 'Save changes' : 'Save story'}
            </button>
            {(editing || !isEmptyBrief(brief)) && (
              <button onClick={reset} data-testid="story-clear">
                {editing ? 'New story' : 'Clear'}
              </button>
            )}
          </div>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="stack" style={{ marginTop: 8 }} data-testid="waiting-stories">
          <span className="dim">Waiting stories</span>
          {waiting.map((i) => (
            <button key={i.slug} style={{ textAlign: 'left' }} className={editing === i.slug ? 'on' : ''} title="Click to edit" data-testid="waiting-story" onClick={() => load(i.slug)}>
              {i.title}
              {i.characters > 0 && <span className="dim"> ({i.characters} character{i.characters === 1 ? '' : 's'})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

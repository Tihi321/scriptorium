import { describe, expect, it } from 'vitest'
import { ideaBlock, ideaBlocks } from '../src/engine/pipeline/ideaBlock'
import { pickNext } from '../src/engine/pipeline/handlers'
import { ideaSummaries } from '../src/engine/summary'
import type { IdeaFile } from '../src/engine/store/ideas'
import type { TopicRow } from '../src/engine/store/topics'
import type { FormatEntry } from '../src/shared/schemas'

const idea = (slug: string, topic: string | null, source = 'generated'): IdeaFile =>
  ({ slug, file: `${slug}.md`, title: slug, body: 'A story.', createdMs: 1, data: { kind: 'idea', topic, status: 'open', source, format: null, book: null } }) as unknown as IdeaFile
const topic = (id: string, over: Partial<TopicRow> = {}): TopicRow => ({ id, topic: id, kind: 'fiction', active: true, target: 2, done: 0, inProgress: 0, section: 's', line: 1, ...over })
const format = { id: 'f', name: 'F', enabled: true, kinds: ['fiction'], words: [100, 200], chapters: [1, 1] } as unknown as FormatEntry

describe('SCP-74: a generated idea that cannot start says why', () => {
  it('names the reason and the fix for a topic that is off, full or missing, and agrees with pickNext', () => {
    const topics = [topic('on'), topic('off', { active: false }), topic('full', { target: 2, done: 1, inProgress: 1 }), topic('free', { target: 0, done: 5 })]
    const ideas = ['on', 'off', 'full', 'free', 'gone'].map((t) => idea(`i-${t}`, t))
    const blocks = ideaBlocks(ideas, topics)
    expect([...blocks.keys()]).toEqual(['i-off', 'i-full', 'i-gone'])
    expect(blocks.get('i-off')).toMatchObject({ reason: expect.stringContaining('not active'), fix: expect.stringContaining('mark it as yours') })
    expect(blocks.get('i-full')!.reason).toMatch(/target met \(2 of 2\)/)
    expect(blocks.get('i-gone')!.reason).toMatch(/not in topics\.md/)
    // owner stories and used ideas never warn
    expect(ideaBlock(idea('mine', 'off', 'user'), topics)).toBeNull()
    // every blocked idea is one pickNext will not start, every other one it can
    for (const i of ideas) expect(pickNext([i], topics, [format], [], undefined, undefined, new Set(), false) === null).toBe(blocks.has(i.slug))
    // the UI list carries the blocked ones with their warning
    expect(ideaSummaries(ideas, 10, blocks).filter((s) => s.blocked).map((s) => s.slug)).toEqual(['i-off', 'i-full', 'i-gone'])
  })
})

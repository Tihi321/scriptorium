import type { IdeaFile } from '../store/ideas'
import type { TopicRow } from '../store/topics'

/** A topic that still wants books: its target is 0 (no limit) or not yet met by books done and in progress. */
export const hasRoom = (t: TopicRow) => t.target === 0 || t.done + t.inProgress < t.target

export interface IdeaBlock {
  reason: string
  fix: string
}

/**
 * Why an open generated idea cannot start (SCP-74), or null. `pickNext` starts a generated idea only while its topic exists, is active and has room
 * (your own stories start regardless), so one whose topic is off or full waits without a word. Read-only: it does not change what starts.
 */
export function ideaBlock(idea: IdeaFile, topics: TopicRow[]): IdeaBlock | null {
  if (idea.data.status !== 'open' || idea.data.source !== 'generated') return null
  const id = idea.data.topic
  const topic = id ? topics.find((t) => t.id === id) : undefined
  const mine = 'mark it as yours (source: user)'
  if (!topic) return { reason: id ? `its topic "${id}" is not in topics.md` : 'it has no topic', fix: `${mine}, or give it a topic that is active` }
  if (!topic.active) return { reason: `its topic "${topic.topic}" is not active`, fix: `${mine}, or activate the topic` }
  if (!hasRoom(topic)) return { reason: `its topic "${topic.topic}" has its target met (${topic.done + topic.inProgress} of ${topic.target})`, fix: `${mine}, or raise the topic target` }
  return null
}

/** The blocked open generated ideas by slug. */
export function ideaBlocks(ideas: IdeaFile[], topics: TopicRow[]): Map<string, IdeaBlock> {
  const out = new Map<string, IdeaBlock>()
  for (const i of ideas) {
    const b = ideaBlock(i, topics)
    if (b) out.set(i.slug, b)
  }
  return out
}

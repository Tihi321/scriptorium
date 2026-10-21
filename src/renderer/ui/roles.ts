import type { ModelSummary } from '../../shared/protocol'

/** The roles in `seed/config/roles.md`, used by the hire dialog. */
export const KNOWN_ROLES = [
  'editor-in-chief',
  'idea-generator',
  'architect',
  'writer',
  'publisher',
  'developmental-editor',
  'line-editor',
  'copy-editor',
  'beta-reader',
  'child-safety-reviewer',
  'read-aloud-reviewer',
  'continuity-checker',
  'originality-checker',
  'fact-checker',
  'researcher',
  'archivist',
  'humanizer'
]

/** The refs the pickers offer: every enabled model shown in the Models dialog, plus the one in use. */
export function modelOptions(known: ModelSummary[], current: string | null | undefined): string[] {
  const set = new Set<string>(known.filter((m) => m.enabled && m.shown !== false).map((m) => m.ref))
  if (current) set.add(current)
  return [...set]
}

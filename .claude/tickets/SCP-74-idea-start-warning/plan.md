---
status: done-uncommitted
branch: SCP-74_idea-start-warning
updated: 2026-11-26
---

# SCP-74: idea start warning

Request, word for word: "warinig for generated idea".

Reading: `pickNext` starts an open generated idea only when its topic exists, is active and has room (`hasRoom`); otherwise it waits with no message, and a run was lost to it. Say so, read-only.

## Design

- `src/engine/pipeline/ideaBlock.ts`: `ideaBlock(idea, topics)` returns `{reason, fix}` or null (open + generated only; topic missing, inactive, or target met). `hasRoom` moved here (re-exported from `handlers.ts`) so `summary.ts` can use it without a cycle. `ideaBlocks` maps slugs to blocks.
- `factory_status.blockedIdeas [{slug, reason, fix}]`; `list_stories` rows get `blocked`.
- UI: `IdeaSummary.blocked`; `ideaSummaries(ideas, used, blocks)` includes blocked open generated ideas (the list otherwise has only owner stories); `StoryForm` lists them under "Generated ideas that cannot start". `emitTopics` re-emits ideas (a topic switch changes the blocks).
- Fix text: "mark it as yours (source: user)" or activate the topic / raise its target. Not changed: what `pickNext` starts.

## Files

`src/engine/pipeline/ideaBlock.ts` (new), `handlers.ts`, `summary.ts`, `engine.ts`, `mcp/tools.ts`, `shared/protocol.ts`, `renderer/ui/StoryForm.tsx`, `tests/ideaBlock.test.ts`, `tests/mcp.test.ts`, `docs/mcp.md`, `docs/design.md`, `ROADMAP.md`.

## Verification

`yarn typecheck`, `yarn lint`, `yarn test`. Not done: the UI list seen running.

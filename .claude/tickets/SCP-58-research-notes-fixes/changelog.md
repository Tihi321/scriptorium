# Changelog SCP-58

## 2026-11-09 SCP-58: research notes fixes (REQ-0006 A3)

Outcome: built on branch `SCP-58_research-notes-fixes` (from master 86d3c47). Not pushed.

- src/engine/research/notes.ts: `formatNote` returns '' for a note with no facts and no source excerpts (a fallback note); new `neutralisePageText`, used by `pageExcerpts`: a line starting with `#` or a code fence gets a backslash.
- src/engine/pipeline/nfcontext.ts, src/engine/research/context.ts, src/engine/pipeline/researchHandlers.ts: empty note text is left out of the writer's notes (the sources keep the URL).
- src/engine/pipeline/nonfiction.ts: `factCheckNotes` adds no excerpt block when `excerptLimit` is below the room the label and markers need, so it never exceeds `excerptLimit`.
- tests/researchFigures.test.ts: one assertion on the fallback test, two tests (excerptLimit 100; neutralised page text). All three fail on the old code.
- ROADMAP.md: `candidateFacts` deferred. docs/design.md: Decisions row and History line (`findExact` and a fallback note: answered by design).

Results: `yarn vitest run` 58 files, 735 tests pass; recovery config 1 test pass; `yarn typecheck` clean; `yarn lint` clean. No seed file changed.

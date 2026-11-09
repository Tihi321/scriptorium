# Changelog SCP-58

## 2026-11-09 SCP-58: research notes fixes (REQ-0006 A3)

Outcome: built on branch `SCP-58_research-notes-fixes` (from master 86d3c47). Not pushed.

- src/engine/research/notes.ts: `formatNote` returns '' for a note with no facts and no source excerpts (a fallback note); new `neutralisePageText`, used by `pageExcerpts`: a line starting with `#` or a code fence gets a backslash.
- src/engine/pipeline/nfcontext.ts, src/engine/research/context.ts, src/engine/pipeline/researchHandlers.ts: empty note text is left out of the writer's notes (the sources keep the URL).
- src/engine/pipeline/nonfiction.ts: `factCheckNotes` adds no excerpt block when `excerptLimit` is below the room the label and markers need, so it never exceeds `excerptLimit`.
- tests/researchFigures.test.ts: one assertion on the fallback test, two tests (excerptLimit 100; neutralised page text). All three fail on the old code.
- ROADMAP.md: `candidateFacts` deferred. docs/design.md: Decisions row and History line (`findExact` and a fallback note: answered by design).

Results: `yarn vitest run` 58 files, 735 tests pass; recovery config 1 test pass; `yarn typecheck` clean; `yarn lint` clean. No seed file changed.

## 2026-11-09 SCP-58 polish round 1 (REQ-0006 checker)

- src/engine/research/context.ts: `researchNotesFor` and `researchNotesForQuestions` return fallback notes again, as master did (so factbase_update marks them merged, fact_check and syncSources get their URL, the list is refilled). New `withText(items)`; `researchBlock` drops items without text and returns '' when none is left.
- Where text is rendered, empty text is dropped: handlers.ts (draft context, outline research, story-so-far), researchHandlers.ts (`check_notes`, `research_fix` markers), nfcontext.ts (`numberedNotes`, and the writer section).
- src/engine/pipeline/nfcontext.ts: the "newest 6" fresh notes count only notes with text; the "Research notes for this chapter" section is left out when no note has text (checked on the notes with text, not `notes.length`); `nonfictionContext` still returns every note in `notes`.
- src/engine/pipeline/nonfiction.ts: `factCheckNotes` no longer starts with a blank line when only page excerpts exist; fact_check says "no research notes at all" only when there are none, else that the notes have no text to show and the excerpts did not fit.
- tests/researchFigures.test.ts: the fallback-note test now also covers the seam (chapterNotes still returns it, researchBlock is empty, `nonfictionContext` has no empty notes section but lists the URL and returns the note, the fact checker text starts with the excerpt block). Fails on the previous branch code.

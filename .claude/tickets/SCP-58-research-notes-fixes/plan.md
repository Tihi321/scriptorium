---
status: in-progress
request: REQ-0006
repos: [scriptorium]
branch: SCP-58_research-notes-fixes
updated: 2026-11-09
---

# SCP-58: research notes fixes

Extracted from `.claude/tickets/REQ-0006-destiny-hr-translation/plan.md`, task A3. Input: `.claude/tickets/SCP-56-req0004-fixes/discoveries.md` items 5, 7, 8. Branch from master 86d3c47.

## Output

- A fallback note gives no empty `### question` entry to the writer (its URL stays in the sources).
- `factCheckNotes` never exceeds `excerptLimit` (clamp, test with 100).
- Stored page text cannot break out of its section (lines starting with `#` and code fences neutralised inside the page-excerpts block; the fact-checker prompt keeps calling it data).
- Tests in existing files.
- Docs: ROADMAP line for `candidateFacts` (deferred, item 4); `docs/design.md` note that `findExact` treats a fallback note as answered by design (item 6, dropped).

## Files

`src/engine/research/notes.ts`, `src/engine/research/context.ts`, `src/engine/pipeline/researchHandlers.ts`, `src/engine/pipeline/nfcontext.ts`, `src/engine/pipeline/nonfiction.ts`, `tests/researchFigures.test.ts`, `ROADMAP.md`, `docs/design.md`. No seed prompt changed, so no `yarn seed:hashes`.

# SCP-18: mystery with puzzles (Scriptorium side)

Scriptorium's part of hub ticket HUB-10 (phase 4; plan `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`, sections "Scriptorium (SCP-18_mystery-puzzles)" and "The script lines"; the core shape is in `puzzle-core.md` next to it). Branch: `SCP-16-18_hub-roadmap` (shared with SCP-16 and SCP-17; the hub plan's `SCP-18_mystery-puzzles` is not used). Written 2026-10-22.

## Goal

A "mystery with puzzles" visual novel format. VN Studio makes the puzzle core, the hub hands it to Scriptorium in the story brief, Scriptorium keeps it as `bible/puzzles.md`, the outline places the puzzles and the writers plant the clues and write `CLUE:`, `EVIDENCE:`, `PUZZLE:` and `TESTIMONY:` lines that VN Studio (VNO-15) imports. No solver in Scriptorium.

## Decisions

- Q6 (accepted): the core comes from VN Studio through the story brief; Scriptorium keeps it as `bible/puzzles.md`.
- The format is `mystery-puzzle-visual-novel` (`script: true`, `puzzles: true`, `kinds: []`): no topic picks it, only a story that fixes it. `humanize: false`.
- The four lines and `END TESTIMONY` do not collide with SCP-16's picture and sound cues (`CG`, `INSERT`, `SFX`, `AMBIENCE`, `END CG`) or SCP-17's screenplay lines (`SHOT`, `MUSIC`, `SFX`, `TITLE`). They are checked after the cues and before `LINE`; a screenplay does not read them.
- A line is one beat in `get_script`; a testimony is one beat that holds its statements.
- The engine checks only that the clues are planted in time (continuity review). The meaning of the prose is VN Studio's read-back check.
- The contract was written first and committed (`docs/visual-novel.md` "Puzzles") so VNO-15 could be built from it.

## Steps

- [x] Docs first: grammar rows, regexes, the four lines, `bible/puzzles.md`, the `get_script` beats (commit 3aa8e7d).
- [x] `src/shared/puzzles.ts` (entry schema), `StoryBrief.puzzles`, idea frontmatter, `add_story {puzzles}`.
- [x] Regexes and `puzzleLineOf` in `publish/xhtml.ts`; `parseScript` beats (`clue`, `evidence`, `puzzle`, `testimony`); layout (clue and evidence notes, puzzle box with its clues, testimony headings); CSS; `puzzles` view through `books.ts`, the EPUB and the reader.
- [x] Format flag `puzzles` (schema), seed format, formats.md text, `migratePuzzles` (shared `appendSeedFormats`), `formatsForKind` and `start_book` rules.
- [x] `pipeline/puzzles.ts`: `puzzlesOf`, `placePuzzles`, `clueChapters`, `writePuzzles`, `puzzleViews`, `puzzleProblems`, the prompt sections and notes.
- [x] Handlers: outline (section and `chapters[].puzzles`, `bible/puzzles.md`), draft and rewrite sections, tighten text, reviewer note, the continuity check, humanizer guard and note.
- [x] `get_script`: puzzle beats and `puzzles`; `add_story` description.
- [x] Docs: `docs/visual-novel.md` (corrected), `docs/mcp.md`, `docs/design.md`, `ROADMAP.md`.
- [x] Tests: `tests/puzzles.test.ts` (lines, beats, layout, guard, helpers, check, brief, format and migration, two mock-model pipeline runs), `tests/mcp.test.ts`.
- [x] `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:recovery`.
- [ ] Not in this ticket: VNO-15 (the importer), the hub skill path, a live book written by a real model (HUB-10 phase 5).

## Deviations

- Branch `SCP-16-18_hub-roadmap`.
- No new prompt files: the puzzle instructions are engine-side sections (`pipeline/puzzles.ts`) appended to the VN prompts for a puzzle book, so data folders get them without prompt migration, and no `yarn seed:hashes` change was needed.
- The planting check runs in the continuity review, not as a separate job.

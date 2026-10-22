# SCP-18 changelog

## 2026-10-22: SCP-18, mystery with puzzles

Scriptorium can write a visual novel with logic puzzles from puzzle cores that VN Studio makes (HUB-10 phase 4, Scriptorium side). Plan: `plan.md` here. Branch `SCP-16-18_hub-roadmap` (shared with SCP-16 and SCP-17). Not pushed, no PR. Contract for VN Studio's importer (VNO-15): `docs/visual-novel.md` "Puzzles".

### Commits

| Commit | What |
|---|---|
| 3aa8e7d | The contract first: grammar rows, regexes, `bible/puzzles.md` and the `get_script` beats |
| 7ee2aaa | The format, the lines, the brief and `bible/puzzles.md`, the prompts and the check, `get_script`, tests |
| the commit after it | Docs corrections, roadmap, plan and changelog |

### The final line formats

```text
CLUE: <puzzle>/<clue>: <prose>
EVIDENCE: <key>: <prose>
PUZZLE: <key>            or   PUZZLE: <key> (<kind>)
TESTIMONY: <witness>
NAME (expression): statement 1
NAME: statement 2
END TESTIMONY
```

Ids are `A-Za-z0-9_-`. Croatian keywords `TRAG`, `DOKAZ`, `ZAGONETKA`, `SVJEDOČENJE`, `KRAJ SVJEDOČENJA`. Regexes (`publish/xhtml.ts`): `CLUE_RE`, `EVIDENCE_RE`, `PUZZLE_RE`, `TESTIMONY_RE`, `END_TESTIMONY_RE`, read by `puzzleLineOf`; checked after `SCENE` and the SCP-16 cue lines, before `ON SCREEN` and the speaker line. A testimony holds the speaker lines after `TESTIMONY:` until `END TESTIMONY` or any line that is not a speaker line.

### What `get_script` returns for them

One beat per line; a testimony is one beat:

```json
{ "type": "clue", "puzzle": "dinner", "clue": "c2", "text": "..." }
{ "type": "evidence", "key": "pocket_watch", "text": "..." }
{ "type": "puzzle", "puzzle": "dinner", "kind": "murdle" }          // kind null when the line has none
{ "type": "testimony", "witness": "Miss Cole", "statements": [{ "n": 1, "speaker": "Miss Cole", "expression": "calm", "text": "...", "alias": "the cook" }] }
```

Plus a top-level `puzzles`: the entries of `bible/puzzles.md` (`key`, `kind`, `title?`, `chapter`, `core`, `names`, `text`, `clueAt`, `testimony?`), empty for other books. These lines do not end a scene's `background` (a testimony does).

### What changed

- **Brief and bible:** `StoryBrief.puzzles` and the idea frontmatter `puzzles` (`src/shared/puzzles.ts`), `add_story {puzzles}` (VN Studio's `names` and `text` as returned by `vno_puzzle_generate`, `core` whole). The outline writes `bible/puzzles.md` with `chapter` and `clueAt`.
- **Format:** `mystery-puzzle-visual-novel` (`puzzles: true`, `script: true`, `kinds: []`, `humanize: false`, 3 to 8 chapters, 6,000 to 20,000 words); a story that fixes it gets it, no topic does; `migratePuzzles` adds it to older data folders.
- **Writing:** the architect is told the puzzles and may answer `chapters[].puzzles`; the engine places the rest (later chapters, never chapter 1 of several). The writers get the rules, the clues to plant in each chapter with their canonical sentences, the `PUZZLE:` line where it belongs, the truth in words, the testimony and its evidence. The tighten request keeps the puzzle lines. Every reviewer is told these lines are code-made.
- **Check:** `puzzleProblems` in the continuity review: one `PUZZLE:` line per puzzle, every core clue planted before it (one problem per chapter that should have planted), no unknown clue or puzzle, a testimony's evidence planted. A problem forces `revise` and names the chapters.
- **Humanizer:** off for the format; the guard refuses a version in which a puzzle line changed in any word, and the prompt says so.
- **Layout:** clue and evidence as notes, `PUZZLE:` as a box with the canonical clue list, testimony headings (EPUB and reader).

### Tests

New `tests/puzzles.test.ts` (15 tests: the lines and their non-collision with the cue and screenplay lines, the beats, the layout, the humanizer guard, the helpers and the check, the prompt sections and the 40-character example rule, the brief, the format and its migration, two mock-model pipeline runs: clues planted and the puzzle placed and published; clues missing and the continuity review says revise). Extended: `mcp.test.ts` (`add_story {puzzles}`, `get_script` beats and `puzzles`), `humanizer.test.ts`, `screenplay.test.ts` (the old-folder fixture keeps the puzzle format).

### Verification

Run in `C:\projects\Personal\scriptorium-wt` (fnm Node):

| Check | Result |
|---|---|
| `yarn vitest run` | 41 files, 571 tests passed (SCP-17 ended at 40 files, 555) |
| `yarn test:recovery` | 1 test passed |
| `yarn typecheck`, `yarn lint` | clean |
| `yarn seed:hashes` | run; no prompt or template changed, no diff |

### Not run

- `yarn test:ui`, `yarn test:electron`, `yarn build` (no UI or shell change).
- The engine was never started; `~/Scriptorium` was not touched. No real model has written a puzzle book: whether the clue prose keeps the clue's meaning, whether the puzzle line lands well, and how often the planting check sends a chapter back is open until the live run (HUB-10 phase 5).
- VN Studio's side (VNO-15, the read-back check at import) is not in this repo.

### Deviations

- Branch `SCP-16-18_hub-roadmap`.
- No new prompt files: the puzzle instructions are engine-side sections appended to the VN prompts (nothing to migrate, no seed-hash change).
- The planting check lives in the continuity review (forces `revise`), not in a job of its own.
- `update_story` does not take `puzzles` (an update keeps the story's old ones).

### Follow-ups

- VNO-15 imports the lines; the hub skill's puzzle path (choose puzzles, `vno_puzzle_generate`, `add_story {puzzles}`, import, read-back check, rewrite notes back).
- A choice variant of the format; `knights` and `testimony` puzzle kinds depend on VNO-14.
- After the first live book: tune the clue and testimony wording rules.

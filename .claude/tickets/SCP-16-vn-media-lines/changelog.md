# SCP-16 changelog

## 2026-10-22: SCP-16, VN media lines and bible aliases

Scriptorium's visual novel scripts now carry the lines VN Studio (VNO-08) reads (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`, `END CG`), each character's bible entry gets an `Aliases:` sentence, and `ON SCREEN:` names only characters. Hub ticket HUB-06; plan: `plan.md` in this folder (the hub's plan is `creative-hub\.claude\tickets\HUB-06-scriptorium-vn-media-lines\plan.md`). Branch `SCP-16-18_hub-roadmap` (shared with SCP-17 and SCP-18; the hub plan's branch name `SCP-16_vn-media-lines` was not used). Not pushed, no PR.

### Commits

| Commit | What |
|---|---|
| 28fab42 | SCP-16: cue grammar, aliases, prompts, guards and their tests |
| the commit after it | SCP-16: docs, roadmap, plan and changelog |

### What changed

**One cue grammar (`src/engine/publish/xhtml.ts`)**
- `CUE` and `END_CG` are VN Studio's `CUE_RE` and `END_CG_RE` copied verbatim (Croatian keywords too). `cueOf(line)` returns `{ cue: 'cg' | 'insert' | 'sfx' | 'ambience', text }`: `text` is `null` for `CG: none` / `INSERT: none` / `AMBIENCE: none` (also `ništa`, `nista`) and `END CG`, and `''` for a cue with nothing after the colon (callers skip it).
- `scriptToXhtml` checks it after `SCENE` and before `ON SCREEN` and the speaker lines. A cue is `<p class="vn-cue"><span class="vn-label">Picture:|Close-up:|Sound:|Ambience:</span> ...</p>`; stop lines and empty cues write nothing. CSS `p.vn-cue` in `epub.ts` (`BOOK_CSS`, which the reader uses too).

**`get_script` (`src/engine/publish/script.ts`, `mcp/tools.ts`)**
- New beat `{ type: 'cue', cue, text }`. A cue is never a speaker and does not end a scene's `background`.
- `parseLightBible`: `characters[].aliases`; `looks` ends at ` Aliases: ` or ` Voice: `.
- `parseScript(body, bibleNames, characters)`: a speaker or cast name that equals an alias gives the bible name and `alias` (the alias as the bible writes it) on the line or cast entry. The old two-argument call works as before.
- The tool description names all of this.

**Aliases in the bible**
- Outline schema (`handlers.ts`): `characters[].aliases: string[]` (default `[]`); `aliases?` on the three `OutlineCharacter` types.
- New `src/engine/pipeline/scriptBible.ts`: `cleanAliases` (no full stops, not the own name, not another character's name or alias, no repeats, at most 5, each at most 40 characters), `cleanCastAliases` (across the cast, the first to claim an alias keeps it) and `scriptBibleLine` (`- **Name**: <description>[ Aliases: a, b.][ Voice: ...]`, the sentence before `Voice:`, no second sentence when the description has one, the description on one line).
- `series.ts`: `aliasesOf` (VN Studio's list rule: up to the first full stop, split at `,` `;` `or` `ili`, cut at `Voice:`), `lightBibleEntries` fills `BibleEntry.aliases`, so a light-bible source carries its aliases into an adaptation. `withSourceBible` merges them after the architect's and takes the source's `Aliases:` sentence out of the copied description.

**Prompts and engine notes**
- `outline_vn.md` asks for `"aliases"`; `draft_chapter_vn.md` has the picture and sound lines with the limits, and the `ON SCREEN:` and alias-speaker rules; `rewrite_chapter_vn.md` keeps them; `humanize_chapter_vn.md` keeps them word for word and in place; `review_vn.md` checks their form only. Every example cue line is under 40 characters (leak guard).
- `adapt.ts` intros: the outline mentions aliases, the draft asks for CG and INSERT lines, the rewrite keeps the cue lines.
- `tighten` for a script keeps `CG`, `INSERT`, `SFX` and `AMBIENCE` lines.
- `SCRIPT_CUES_NOTE` (`scriptPlaces.ts`) is added to the prompt of every reviewer of a script book.
- `yarn seed:hashes`: `seedHistory.ts` has the five new prompt hashes, the old ones stay listed, so `migrateSeedPrompts` upgrades a data folder whose VN prompts were never edited.

**Humanizer guard (`humanizerHandlers.ts`)**
- `scriptStructure` also returns `cues` (kinds in order, `:none` for a stop line); cue lines are no longer counted as speakers. `humanizeProblem` refuses a script whose `cues` changed ("the script lines changed ..."). `fragmentShare(text, true)` leaves cue lines out of the narration count.

**Docs**: `docs/visual-novel.md` (grammar table, regexes, bible example with `Aliases:`, chapter example, reading it as a player, what is guaranteed, JSON shape, In Scriptorium), `docs/mcp.md` (`get_script`), `docs/design.md` (Decisions row "VN media lines (SCP-16)" and a History line), `ROADMAP.md`.

### Tests

New: `tests/xhtml.test.ts` (`cueOf`, `scriptToXhtml`, `cleanAliases`, `cleanCastAliases`, `scriptBibleLine`). Extended: `script.test.ts` (cue forms, background, aliases, alias speakers), `humanizer.test.ts` (cues in `scriptStructure`, drop, add, change and reorder refused, reworded text accepted), `series.test.ts` (`aliasesOf`, `lightBibleEntries`), `rewrites.test.ts` (place description skips cues), `adapt.test.ts` (source aliases, the full adaptation pipeline writes `Aliases:` before `Voice:` and every prompt has its new text, reviewers get the cue note), `lengths.test.ts` (the VN tighten request names the cue lines), `leak.test.ts` (the example cue lines are not a leak).

### Verification

Run in `C:\projects\Personal\scriptorium-wt` (fnm Node):

| Check | Before (Phase 0) | After |
|---|---|---|
| `yarn vitest run` | 38 files, 523 tests | 39 files, 540 tests, all passed |
| `yarn test:recovery` | 1 test | 1 test passed |
| `yarn typecheck` | clean | clean |
| `yarn lint` | clean | clean |
| `yarn seed:hashes` | n/a | run after the last prompt edit; a second run changes no content |

Two timing-sensitive tests failed once each in a full run and passed alone and on the next full runs: `tests/lengths.test.ts` "a note rewrite far over its share..." (also in the Phase 0 baseline, before any change) and `tests/pipeline.test.ts` "your ideas are picked before generated ones". Neither touches this work.

### Not run

- `yarn test:ui`, `yarn test:electron` (no UI change).
- The engine was never started, `~/Scriptorium` was not touched, no `yarn build`.
- No live model has written a script with the new prompts: how often the models write cue lines, whether any lands at the end of a scene, and whether the humanizer refuses cue changes in real runs are open. That is the hub's step H2 (adapt a short book, import into VN Studio, build, lint, the user plays it). Until then SCP-16 is done in code only.
- A prose book's review prompt having no cue note is not tested (the gate is `fmt.script`).

### Deviations from the plan

- Branch `SCP-16-18_hub-roadmap` instead of `SCP-16_vn-media-lines`; nothing pushed.
- The humanizer cue guard is tested on `humanizeProblem` and `scriptStructure`, not through a pipeline run with a cue line in the mocked chapter.
- The light bible line of a script collapses a multi-line description to one line (a bullet is read one line at a time; before, the text after a line break was lost, and so would the `Aliases:` sentence).
- `ROADMAP.md` is tracked on this branch (merged with SCP-15 and SCP-19), so the row was edited in place.

### Follow-ups

- Hub step H2 (live run) and H3 (hub docs).
- VN Studio VNO-16: set `characters` on an imported CG from the names and aliases in the cue text (proposed in the hub plan).
- An engine-side fix for a cue at the end of a scene (move it before the scene's last beat) if the live run shows it often.

# SCP-45 changelog — VN pack v2

## 2026-10-25 — Scriptorium writes the language-independent VN pack

Branch `SCP-45_vn-pack` (from `master`), uncommitted. Cross-repo plan/contract: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\`.

### What changed

- **New `src/engine/publish/vnPack.ts`**: compiles a published VN book folder into `vn/pack.json` (template: format/version/packHash/book/characters/places/chapters/scenes/beats/puzzles) and `vn/text/<sourceLang>.json` (catalog: title, blurb, chapterTitles, sceneTitles, choiceTexts, endings, characterNames, beats, puzzles). Reuses `parseScript`, `parseLightBible`, `moveTrailingCues`, `checkBranches`, `puzzleProblems`; IDs `ch01.s01`/`ch01.s01.b001`; cues attach to the next beat; CLUE/EVIDENCE/TESTIMONY/PUZZLE mapped; unknown speakers get synthetic `speaker_N` (real speaker lines only), unknown places keep `placeKey: null`, ON SCREEN props are dropped with a warning. Canonical `packHash`; `sourceHash` over outline/bible/puzzles/cover-brief/chapters (not `book.md`); atomic writes; `readVnPack`.
- **New `src/engine/publish/vnKey.ts` + `translit.ts`**: VN Studio’s `slugKey` and transliteration, with the contract’s test vectors and collision suffix.
- **Publish hook** in `src/engine/pipeline/handlers.ts` for every `script: true` book (screenplays excluded); `vn_version: 2` in `book.md`; pack failures log a warning and do not fail the book.
- **MCP** `build_vn_pack {book}` and `get_vn_pack {book}` in `src/engine/mcp/tools.ts`; `get_script` unchanged.
- **Parser** `src/engine/publish/script.ts` / `xhtml.ts`: `N:`/`NARRATION:`/`NARRATOR:` as narration; `C<n>`/bible-key/alias-key speaker tokens; `SCENE:` parsed like VN Studio (first period separates the description; the last comma is a time only when it is 1–4 known time words); stage directions (e.g. `SMASH CUT TO:`) are narration, not speakers; clue/puzzle keywords never speakers. `books.ts`/`epub.ts`/`reader.ts` pass bible names so the reader/EPUB render tokens as names.
- **Docs** `docs/visual-novel.md` (“The VN pack (v2)”, grammar/JSON) and `docs/mcp.md`.
- **Tests** `tests/vnPack.test.ts` (31) and `tests/fixtures/vn-pack/{soother,choice,mystery-puzzle}`; new SCENE/parser cases in `tests/script.test.ts`; MCP coverage.

### Verification

- `vitest run` → 53 files / 679 tests passed; `vitest run --config vitest.recovery.config.ts` → 1/1.
- `tsc --noEmit` node + web; `eslint .` — clean.
- Canonical fixtures compile with 0 warnings; real books checked read-only: the soother (7 ch/15 scenes/430 beats, 9 characters with 4 synthetic speakers, 7 bible places, 17 warnings), the-winter-garden-clock (2 puzzles), the-lighthouse-that-kept-lists-vn.

### Deviations

- Cue counts remain prompt-only (unchanged); pack compilation warns on moved/dropped trailing cues.
- Unknown places are `placeKey: null` rather than synthetic places, matching VN Studio’s legacy importer; unknown speakers still get synthetic characters because they speak.
- The live soother’s current `SCENE` text differs from its old VN project for two scenes; the live pack was hand-patched for those keys in the HUB-16 run (not in the compiler).

### Follow-ups

- A place matcher that handles a changed SCENE phrase (e.g. “A path through Dragon Land” vs bible “Dragon Path”) without a live patch.
- Commit/PR on the ticket branch after the user’s play.

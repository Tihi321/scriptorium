# SCP-46 — Children's picture-book format (Scriptorium half of HUB-17)

Branch: `SCP-46_picture-books` (already checked out; **no commit, no push, no branch change**).
Authoritative plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-17-picture-books\plan.md` (D9, D10, Scriptorium work list).

## Scope

A children's picture book is a script format with **one page per scene**: a `SCENE:` line whose second sentence
describes the picture, one `ON SCREEN:` line naming who is in the picture, then 1–3 short narration sentences (the
words under the picture). No speaker lines, no `CG:`/`INSERT:`/`SFX:`/`AMBIENCE:` cues, no `---`. The format is
only used when a story fixes it. The VN pack (v2) is unchanged: pages are scenes.

## What changed

| Area | Files |
| --- | --- |
| Format flag + doc comment (`picture_book: z.boolean().default(false)`) | `src/shared/schemas.ts` |
| Seed format `kids-picture-book` (script, picture_book, kind `juvenile-visual-novel`, 3–6, 150–900 words, 1 chapter, read aloud, no research) + page-wise guidance + formats.md flag docs | `seed/config/formats.md` |
| `_pb` before `_vn` in `variant`; page note for reviewers; pb never in `formatsForKind`; start_book override when a story fixes the format | `src/engine/pipeline/handlers.ts` |
| `PICTURE_BOOK_NOTE` (reviewers) | `src/engine/pipeline/scriptPlaces.ts` |
| `_pb` fallback in `loadPrompt` (a role/task without a `_pb` prompt uses its plain one, never `_vn`) — needed like `_sp` | `src/engine/pipeline/prompts.ts` |
| pb is not a visual-novel adaptation target (`adaptTargetWords` returns null) and `adapt_book` refuses a picture-book format explicitly (`Engine.adaptBook`) | `src/engine/pipeline/adapt.ts`, `src/engine/engine.ts` |
| Live-run fix: `castOf` splits `ON SCREEN` people on semicolons as well as commas; `canonicalScenes` keeps the whole comma-rich picture sentence after the first full stop | `src/engine/publish/script.ts`, `src/engine/pipeline/scriptPlaces.ts` |
| Five `_pb` prompts | `seed/prompts/architect/outline_pb.md`, `writer/draft_chapter_pb.md`, `writer/rewrite_chapter_pb.md`, `line-editor/review_pb.md`, `humanizer/humanize_chapter_pb.md` |
| Migration appending the seed entry, registered at start | `src/engine/store/migrations.ts` (`migratePictureBooks`), `src/engine/store/dataFolder.ts` |
| Regenerated seed history (new prompts) | `src/engine/store/seedHistory.ts` |
| Docs | `docs/visual-novel.md` ("Picture books"), `docs/mcp.md` (`add_story` format, `adapt_book` refusal), `seed/config/formats.md` flag docs |
| Tests | `tests/pictureBook.test.ts` (new), `tests/vnPack.test.ts` (fixture + page assertions), `tests/mcp.test.ts` (get_script/get_vn_pack read-back), `tests/script.test.ts` (castOf), `tests/rewrites.test.ts` + `tests/trailingCue.test.ts` (comma-rich SCENE), `tests/sceneWeekday.test.ts` (unchanged, still green) |
| Fixture | `tests/fixtures/vn-pack/picture-book/` (`book.md`, `outline.md`, `bible/bible.md`, `cover-brief.md`, `chapters/ch-01.md` = 14 pages, committed `vn/pack.json` + `vn/text/en.json`) |
| Fixture line endings | `.gitattributes` rule `tests/fixtures/** text eol=lf` (see deviations) |

## Verification (final state)

All from `C:\projects\Personal\scriptorium` with `fnm exec --using=24 cmd /c "..."`:

- `yarn test` — **PASS**: vitest run **54 files / 702 tests passed**; then `test:recovery` **1 file / 1 test passed** (703 total). No failures.
- `yarn typecheck` — **PASS**
- `yarn lint` — **PASS**
- `yarn build` — **PASS** (engine + preload + renderer bundles; re-run after the live-run fix)

The picture-book tests: 13 tests in `tests/pictureBook.test.ts` (flag/seed, `formatsForKind` exclusion, `_pb` selection
and prompt content, `_pb` fallback, adaptation length + `adapt_book` refusal, migration LF+CRLF+idempotence, fixture
write/read, factory start override) plus 2 page-specific tests in `tests/vnPack.test.ts`, 1 MCP read-back test in
`tests/mcp.test.ts`, 2 `castOf` tests in `tests/script.test.ts`, and the comma-rich SCENE tests in `tests/rewrites.test.ts`
and `tests/trailingCue.test.ts`.

One intermediate full run hit the existing `books.slugs()`-before-`book.md` race in `tests/adapt.test.ts`
(ENOENT on `book.md`); it passed on the rerun, and the new factory test was made robust against the same race by waiting
for `book.md`, not just the slug.

## Live-run bug fix (after the first picture book)

A live run wrote `ON SCREEN: Lana (yellow dress); Mama (apron, bun).`: `castOf` split only on commas, so every page in
`vn/pack.json` had cast `[lana]` and VN Studio planned one sheet. The writer had also avoided commas in the SCENE
picture sentence because `settleScenePlaces` truncated it.

- `castOf` (`src/engine/publish/script.ts`): splits entries on top-level commas **and semicolons** (brackets still
  protect inner punctuation), trims and drops empties. Tests: `Lana (yellow dress); Mama (apron, bun)` gives two people,
  `A; B; C` gives three, comma behaviour is unchanged, mixed separators and empty entries work, and a semicolon
  `ON SCREEN` line parses into every person through `parseScript`.
- `canonicalScenes`/`scenePlaces` (`src/engine/pipeline/scriptPlaces.ts`): a SCENE line is split at its first full stop
  first; only the head is read for place and time, and a rename rebuilds `SCENE: <bible place>, <time>. <rest>` keeping
  the whole comma-rich picture sentence. Tests in `tests/rewrites.test.ts` (canonicalScenes + scenePlaces) and
  `tests/trailingCue.test.ts` (through `settleScenePlaces`).
- The `kids-picture-book` guidance and both `_pb` writer prompts now say the people on `ON SCREEN:` are separated by
  commas (a semicolon is fine too). `yarn seed:hashes` was regenerated for the prompt edits.

## Deviations and notes

1. **`loadPrompt` fallback for `_pb`** was not in the assignment's file list but is required: `variant` returns
   `<task>_pb` for every task (pitch, publish, review of roles without a `_pb` prompt, …). Without the fallback those
   tasks would throw "prompt template missing". This mirrors the existing `_nf`/`_vn`/`_sp` fallback exactly
   (`_pb`/`_sp` fall back to the plain prompt, never to `_vn`). Covered by a test.
2. **"Exclude picture_book from adaptation"** is closed as the Lead asked (follow-up after the first report):
   - `adaptTargetWords` (the line that was `fmt.script && !fmt.screenplay`) returns null for `picture_book`, so pb is
     never treated as a visual-novel adaptation target; its books keep the format's own word target.
   - `Engine.adaptBook` now refuses any `picture_book` format after the `script` check with a clear error:
     `"kids-picture-book" is a picture-book format: adapt_book turns a published book into a visual novel script or a
     screenplay, not a picture book. Write a picture book from a story that fixes the format: add_story {format: ...}`.
     The enabled-ids list in the non-script error also leaves pb out. The renderer's Script writer already never
     offered it.
   - Tested in `tests/pictureBook.test.ts`: the refusal happens before any story is made, and a normal `visual-novel`
     adaptation still creates its story.
3. **`.gitattributes` + fixture line-ending normalization** (necessary, baseline failure; **Lead approved keeping it**
   for the changelog): the canonical vn-pack tests compare `renderPack()`/`renderCatalog()` (LF) byte-for-byte with the
   committed fixture JSON, and the repo has `core.autocrlf=true`, so a Windows checkout turns those `.json` files into
   CRLF and the three existing fixture tests failed **before any SCP-46 change**. Added
   `tests/fixtures/** text eol=lf` and normalized the six existing fixture JSON working files to LF. Their content is
   unchanged (`git diff` is empty for them; only the index stat was refreshed with `git add`, not committed). This also
   keeps the new picture-book fixture's committed pack stable.
4. **Seed history and `git ls-files`**: `scripts/seed-hashes.mjs` reads tracked files only. The five new prompts were
   put in the index with `git add -N` (intent-to-add; nothing committed) before `yarn seed:hashes`, so
   `src/engine/store/seedHistory.ts` now carries their hashes. The Lead should keep those five files tracked when
   staging the final change.
5. **Fixture generated with** `.claude/temp/scp46/gen-fixture.ts` (scratch, disposable):
   `node_modules/.bin/tsx .claude/temp/scp46/gen-fixture.ts` regenerates the committed pack/catalog from the fixture
   book folder. The fixture compiles with no warnings: 14 scenes (one page each), one cast beat + 1–3 narration beats
   per page, no `image`/`sfx`/`ambience` descriptors, captions only in `vn/text/en.json`.
6. **Not run / out of scope**: no live model/factory run (mock pipeline test and fixture compile only), no UI/browser
   check, no commit/push, no changes outside `C:\projects\Personal\scriptorium`. The real picture-book production is
   HUB-17's later live step.

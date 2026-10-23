# SCP-20 to SCP-25 changelog

## 2026-10-23 (latest): SCP-34 to SCP-37, found in the hub's VN adaptation

Same branch `SCP-20-25_fixes`. Committed, not pushed. Evidence: `creative-hub/runs/the-lighthouse-that-kept-lists-vn.md` "Found" and the book's `log.md`.

- **SCP-34** (b7bde0f): `placeOf` (`scriptPlaces.ts`) treats a weekday before the last comma as part of the time, so `SCENE: Ferry deck, Monday, late afternoon` keeps "Monday" when its place is renamed to the bible's name.
- **SCP-35** (d4db9b9): `moveTrailingCues` moves a CG, INSERT, SFX or AMBIENCE line that ends its scene to just before the scene's last beat; `settleScenePlaces` runs it (visual novels only) after a draft, a rewrite and a humanizer pass and logs it. `get_script` has no last-beat check, so nothing changed there.
- **SCP-36** (85a61a2): `analyzeRepetition` drops SCENE, ON SCREEN, cue and puzzle lines before counting (`withoutControlLines`).
- **SCP-37** (cc4a1db): `adaptTargetWords`: a visual novel adaptation's `target_words` is the source's words times 1.7 within the format's range (`target_from_source_words` in `book.md`). The old adapt test's expected target (the format's middle) changed.
- Docs: `ROADMAP.md`, `docs/design.md`, `docs/visual-novel.md` "Adapting a book", this ticket's `plan.md`.

Verification (after the last code commit): full `yarn test` three runs in a row, each 51 files, 629 tests plus the recovery test (1), all passed; `yarn typecheck` and `yarn lint` clean. No test race appeared in these nine runs of the new code (the earlier ones were fixed in the SCP-30 to SCP-33 round). No seed prompt changed. Not run: a real model run, `yarn test:electron`, a new run of the hub book.

## 2026-10-23 (earlier): SCP-30 to SCP-33, found in the hub's puzzle production

Same branch `SCP-20-25_fixes`. Committed, not pushed. Evidence: `creative-hub/runs/the-winter-garden-clock.md` "Found" and the book's `log.md`, `bible/puzzles.md`.

- **SCP-30** (3c4e31c): `clueChapters` (`src/engine/pipeline/puzzles.ts`) plants all ids of a puzzle whose core has no `clues` array (knights: `intro`, `t1`..) in the puzzle's own chapter instead of spreading them over chapters 1 to the puzzle chapter; the outline prompt says the speakers appear there or earlier. Deviation from the plan: the puzzle chapter, not "the chapter where the speaker first appears" (the engine does not know that).
- **SCP-31** (8a46555): `solutionWords` says who is a knight and who a knave (from `core.solution`; a knave lies in every line). The puzzle chapter's prompt adds "do not state it or hint at it before the PUZZLE line"; every chapter after a solved puzzle, of any kind, is told the answer as settled fact.
- **SCP-32** (8a01ed0): `PUZZLE_REVIEW_NOTE` says the CLUE lines are fixed and that either/or clues are the deduction. Because the note did not stop it, `dropClueChangeProblems` also drops, in the continuity review (`handlers.ts`), problems that name a clue and ask to change it or call it a contradiction (logged); a revise that rested only on those becomes a pass.
- **SCP-33** (aa50cd1): `mergeBriefCast` (`src/engine/pipeline/briefCast.ts`, new) merges outline characters into brief characters by full name, surname, first name, alias or the brief's short name ("Called Dec."); ambiguous labels match neither; one entry named as the brief names it with the outline's names as aliases. The light bible of a non-script short story shows aliases as "also called".
- **Test races** (85672bf, 76e9223, and one more `tests:` commit for `features` rebuild-reader, which removed `out/reader` while the engine was publishing a second book): `lengths` and `puzzles` read the atomic write's `.tmp` file; `scheduler` (fire now) took `agents.list()[0]`, which can still be the fired agent (`AgentStore.remove` deletes the file before the map entry; failed 1 in 25 alone, 0 in 40 after); `features` (setModel null) read a snapshot while the writer's job still showed its model; `pipeline` and `blockers` read files that a rename was replacing or a job that left `queued/`.
- Docs: `ROADMAP.md`, `docs/design.md`, `docs/visual-novel.md` "Puzzles", this ticket's `plan.md`.

Verification (after the last code commit): full `yarn test` three runs in a row, each 48 files, 613 tests plus the recovery test (1), all passed; `yarn typecheck` and `yarn lint` clean. Earlier runs of the same code showed six flaky tests (the races above); each was found and fixed, none was in the new code. No seed prompt changed (`yarn seed:hashes` leaves `seedHistory.ts` as is). Not run: a real model run, `yarn test:electron`, a new run of the hub book.

## 2026-10-23 (before): SCP-29, and three test races

Same branch `SCP-20-25_fixes`. Committed, not pushed.

- **SCP-29** (ff0df6e, 20b6e7a, 21d24e0): a screenplay format's length is its runtime. The length gate (`src/engine/pipeline/advance.ts`) compares shot seconds (`parseScreenplay`/`runtimeOf` in `pipeline.ts`) against the runtime range with the same 15 % band; a film inside its range gets no length rewrite whatever its words, and the request reads "about N seconds", add or cut shots. The tighten step (`handlers.ts` `tightenRuntime`) cuts a chapter over 120 % of its share of the runtime, in seconds. Seed prompts `writer/draft_chapter_sp.md` and `rewrite_chapter_sp.md` name seconds only (`yarn seed:hashes`, old hashes in `seedHistory.ts`, so untouched prompts upgrade). Docs: `docs/screenplay.md`, `docs/design.md`. Tests in `tests/lengths.test.ts`; the screenplay pipeline test's mock writer now writes shots by seconds. Not tested at pipeline level: the tighten request itself (the mock writer writes prose).
- **Test races** (three `SCP-27: ...` commits): `tests/startFailures.test.ts` read `brief.md` before `start_book` wrote it; `tests/pipeline.test.ts` ("your ideas are picked before generated ones") checked `status: used` before the engine set it; `tests/recovery.test.ts` saw a job in both `done/` and `running/` (the engine's crash-safe order, unchanged). Each test now waits for the state it checks. The engine has no matching race.

Verification: full `yarn test` three runs in a row, 598/598 plus recovery 1/1 each; `yarn typecheck`, `yarn lint` clean. Seen once and not reproduced: `tests/blockers.test.ts` (embeddings server) failed in one full run.

## 2026-10-23 (later): SCP-26 to SCP-28, found when every book start was blocked in the hub's productions

Same branch `SCP-20-25_fixes`. Committed, not pushed.

| Ticket | Commit | Files | What changed |
|---|---|---|---|
| SCP-26 | 873c730 | `src/engine/models/router.ts`, `src/engine/engine.ts`, `tests/models.test.ts` | A model answering "retired" / "No endpoints found" / model-not-found (404 or in-stream) is marked retired for the engine run: later calls skip it while another model is left, and the engine logs it once with the provider's text (`engine.warning`). The 404 was already not retried; the gap was asking the dead model first on every later call. |
| SCP-27 | b014e1f | `src/engine/pipeline/pipeline.ts`, `src/engine/pipeline/handlers.ts`, `tests/startFailures.test.ts` (new) | Failed `eic--start--` jobs are counted per story; a story with 3 is skipped by `pickNext` (warning names it) and the others still start. Editing the story (newer mtime) or removing its failed jobs makes it eligible again. Starts with no story keep a shared count. |
| SCP-28 | 490cbf9 | `src/engine/pipeline/handlers.ts`, `tests/adapt.test.ts` | An adaptation's `start_book` makes no model call: format fixed by `adapt_book`, title and genre from the source, the middle of the format's length range. Also fixed: `start_book` read the source of a book instead of the story's `source_book`, so `source` was always null there. |
| docs | 2333917 | `ROADMAP.md`, `docs/design.md`, `plan.md` | Done lines and plan results. |

Verification: `yarn test` (46 files, 594 tests, plus the recovery test), `yarn typecheck`, `yarn lint`: pass. Not run: a real model, `yarn test:electron`. The live block was cleared by hand in the user's config (fallback `deepseek/deepseek-flash`, failed start jobs moved to the hub's `.claude/temp/scp-failed-starts/`); these fixes are not yet in the running app.

## 2026-10-23: the six findings of the hub's HUB-04 live check fixed

Branch `SCP-20-25_fixes` (from master 5801f09), one commit per ticket. Committed, not pushed.

| Ticket | Commit | Files | What changed |
|---|---|---|---|
| SCP-20 | 270563f | `src/engine/pipeline/handlers.ts`, `tests/story.test.ts` | A book whose brief has `title_fixed` keeps its own title at publish; the publisher's prompt says the title is fixed, and a different suggestion goes to the job log. |
| SCP-21 | 570044e | `src/shared/schemas.ts`, `src/engine/pipeline/calendar.ts`, `src/engine/pipeline/handlers.ts`, `tests/calendar.test.ts` | The outline job writes `story_year: null` when the architect gives no valid year, and a null year is never guessed from the texts. A year guessed for an older book (no key) is worded as a guess in the calendar block. |
| SCP-22 | a1f8d39 | `src/engine/logs/logs.ts`, `src/engine/queue/scheduler.ts`, `src/engine/engine.ts`, `tests/logs.test.ts` (new) | Each job writes through a `LogSession`: one call at a time streams into a log file, the others hold their text until their turn, and `LogWriter.close()` flushes what is left. Calls no longer interleave in `log.md` or the agent logs. |
| SCP-23 | c260e73 | `src/engine/pipeline/handlers.ts`, `tests/pitch.test.ts` (new) | A pitch over 300 words by more than 3 % gets one tighten call; the shorter answer is kept if it is non-empty and shorter. |
| SCP-24 | d9446b9 | `src/shared/schemas.ts`, `src/engine/pipeline/advance.ts`, `src/engine/pipeline/pipeline.ts`, `seed/config/formats.md`, `tests/noResearch.test.ts` (new) | New format flag `research: false` (set on `bedtime-toddler` and `bedtime-story`; any `bedtime-*` without the line counts as false, so existing data folders need no migration). Such a book gets no `research_plan` job and no `research_prep`. |
| SCP-25 | 4ce4eef | `src/main/secondInstance.ts` (new), `src/main/index.ts`, `tests/secondInstance.test.ts` (new) | A second instance writes why it quits to stderr and `logs/app.log`: the data folder, the engine pid from `index/engine.lock` when known, and that the running one must have MCP on when this start asked for it. |
| docs | 6e3e1d3 | `ROADMAP.md`, `docs/design.md`, this ticket's `plan.md` | The findings section is done; SCP-16 to SCP-18 marked merged (PR #10). |

## Deviations

- SCP-21: the plan missed that the outline never recorded `null`, so "no year" and "older book" looked the same; the outline job now writes it.
- SCP-23: the threshold is 3 %, not about 5 %: the plan's own example (315 words) sits at 5 % and would not trigger.
- SCP-24: a new `research: false` flag instead of `read_aloud` (that one is also on `chapter-book`, which may need facts).
- SCP-25: the pid named is the engine child's (from `engine.lock`), labelled "engine pid".

## Verification

- Run: `yarn test` (45 files, 587 tests, plus the recovery test), `yarn typecheck` and `yarn lint`, all clean, after the last code commit. The SCP-24 tests fail with the fix disabled.
- No seed prompt changed (no `yarn seed:hashes` diff).
- Not run: a real model run, `yarn test:electron`, an actual second Electron start (SCP-25's quit path; only the message builder is tested).

## Follow-ups

- SCP-22 trade-off: a call's text reaches the log only after the earlier call on that file ends.
- SCP-21: the weekday-slip correction in `longHandlers.ts` can still use a guessed year on older books.

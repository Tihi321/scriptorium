# SCP-20 to SCP-25 changelog

## 2026-10-23 (latest): SCP-29, and three test races

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

# SCP-20 to SCP-25 changelog

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

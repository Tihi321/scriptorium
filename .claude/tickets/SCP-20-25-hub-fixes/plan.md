# SCP-20 to SCP-25: fixes for the findings of the hub's HUB-04 live check

Source: `ROADMAP.md` "Open: findings of the hub's HUB-04 live check (2026-10-22)". The causes there were read from the code, not reproduced; confirm each before fixing.

- **Branch:** `SCP-20-25_fixes`, cut from `origin/master` 5801f09, in the worktree `C:\projects\Personal\scriptorium-wt` (the main checkout stays on master for the hub's live checks; do not touch it).
- **User's instruction (2026-10-23):** all six on this one branch, **one commit per ticket** (`SCP-NN: <what>`), code and its test together. A last commit updates `ROADMAP.md` and the ticket docs.
- Do not start Scriptorium itself (it resumes the user's book factory). Tests only.

## Tickets

- [x] **SCP-20: keep a fixed title at publish.** The `publish` job (`handlers.ts`) sets `title` from the publisher's answer and ignores `title_fixed` in the book's `brief.md`. Fix: when the brief says `title_fixed: true`, keep the book's title (and tell the publisher in its prompt that the title is fixed, if the prompt has a place for it). Test: fixed title + a publisher that answers another title → title unchanged; without `title_fixed` the publisher's title still wins.
  - Result: Done `270563f`. `publish` handler: `d.books.brief(slug).title` is non-empty only for `title_fixed`; the book keeps `book.title` (not the brief's, so a later `rename_book` survives), the publisher is told through an appended line (no seed prompt change, so no prompt migration), the log notes a different suggestion. Tests: `tests/story.test.ts` (fixed title + publisher answering another; no fixed title: publisher wins).
- [x] **SCP-21: no guessed story year when the outline says none.** `calendar.ts` `storyYear` falls back to the year the texts name most often when `story_year` is not a number, and `calendarSection` states it as fact ("from the book's own files"). Fix: an explicit `story_year: null` in the outline means no fixed year: do not guess (the section says the year is not stated, or is omitted). When the year is only guessed (outline has no `story_year` key at all, older books), word it as a guess, not a fact. Test: null `story_year` + "1989" in the text → no 1989 in the section.
  - Result: Done `570044e`. Cause confirmed, plus one the plan did not name: the outline handler never wrote `null` to `book.md`, so null and 'older book' looked the same. Now `story_year: null` is written when the architect gives no valid year (schema `nullable().optional()`), `storyYear` returns null for it, and `calendarSection(year, text, guessed)` words a year from the texts as a guess (`storyYearInfo`). Tests: `tests/calendar.test.ts` (null + 1989 in text, guessed wording, end-to-end prompts have no 'set in 1989').
- [x] **SCP-22: `log.md` without interleaved calls.** `logs/logs.ts` `LogWriter.append` buffers per file and flushes every 250 ms; parallel agents' streamed chunks for the same book mix. Fix: keep each call's text together (buffer per call/agent and write the whole call, or whole lines prefixed with the agent id, as a block). Test: two parallel appends with interleaved chunks → each call's text is contiguous in the file.
  - Result: Done `a1f8d39`. `LogWriter.session(agent, book)` per job (`LogSession`): one session at a time streams into a file, others keep their text until their turn; `close()` at engine stop writes the rest. Scheduler: `rj.log`, ended in the run's `.finally`. Cost noted in ROADMAP (a waiting call's log text appears when the earlier one ends). Tests: `tests/logs.test.ts` (3 interleaved calls contiguous; waiting call that ends first; close).
- [x] **SCP-23: enforce the pitch limit.** `prompts/architect/pitch.md` asks for under 300 words; the `pitch` job does not count. Fix: count words; over the limit by more than ~5 %, one tighten/re-ask (like the chapter tighten), then accept whatever comes back. Test: a 315-word pitch triggers one tighten; a 290-word one does not.
  - Result: Done `c260e73`. `tightenPitch` in the pitch handler. Deviation: threshold is 3 percent (above 309 words), not 5, because the plan's own example (315 words must trigger) sits at exactly 5 percent. The prompt text is unchanged (no seed prompt migration). Tests: `tests/pitch.test.ts` (315 -> 2 calls, 290 -> 1 call, no shorter answer -> first kept).
- [x] **SCP-24: no research for formats that need no facts.** `advance.ts` always plans research for a non-adaptation (`research_plan`), and `research_prep` runs per chapter for formats/genres in `research_prep_genres`. Fix: skip both for juvenile read-aloud formats (the `bedtime-*` formats; check the format list for a flag that fits, or add one such as `research: false` on the format). Test: a bedtime book makes no `research_plan` and no `research_prep` job; a novel still does.
  - Result: Done `d9446b9`. Deviation: `read_aloud` is also on `chapter-book`, so it does not fit; added the format flag `research: false` (schema optional boolean; seed has it on both bedtime formats; `needsResearch(format)` falls back to 'not a `bedtime-*` id' so existing data folders need no migration). Used in `advance` (no `research_plan`) and `pipeline.ts` (`prepEnabled`). Tests: `tests/noResearch.test.ts` (pure, advance, and an end-to-end bedtime book with `research_prep_genres: [bedtime]`: no `research_plan`/`research_prep` call).
- [x] **SCP-25: say why a second instance quits.** `src/main/index.ts` `if (!app.requestSingleInstanceLock()) app.quit()` quits silently. Fix: before quitting, write to stderr and the log: "another Scriptorium is running (data folder X); this start was not needed", and when this start asked for MCP (`--mcp`/headless), say that the running instance must have MCP on. If the pid is cheaply known (the engine lock `index/engine.lock` holds one), include it. Test if a unit seam exists (a small pure function that builds the message); otherwise note it as manually unverified.
  - Result: Done `4ce4eef`. `src/main/secondInstance.ts` (pure message builder, data folder, `--mcp`/`--headless` check, pid from `index/engine.lock`) called before `app.quit()`; writes stderr and `logs/app.log`. Note: the pid in the lock is the running app's engine child, not the Electron process, and is labelled so. Tests: `tests/secondInstance.test.ts` (message, args, lock). Not run: an actual second Electron start.

## Verification

- `yarn test` (vitest + recovery), `yarn typecheck`, `yarn lint` in the worktree after each ticket or at least at the end; all must pass. `yarn seed:hashes` if a seed prompt changed (SCP-20 / SCP-23 prompt edits need a prompt upgrade migration like earlier tickets; follow how SCP-16 to SCP-18 did it).
- Not run here: a real model run, `yarn test:electron`.

## Evidence (2026-10-23)

- `yarn test`: 45 files, 587 tests passed, plus the recovery test (1). `yarn typecheck` and `yarn lint`: clean.
- Not run: a real model, `yarn test:electron`, a second packaged instance.

## Done when

Six ticket commits plus one docs commit on `SCP-20-25_fixes`; the checklist above ticked with the test evidence; `ROADMAP.md` moves SCP-20 to SCP-25 to done (merged-state lines corrected: SCP-16 to SCP-18 are merged, PR #10).

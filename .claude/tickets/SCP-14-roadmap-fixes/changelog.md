# SCP-14 changelog

## 2026-10-22: SCP-14, the hub roadmap fixes for Scriptorium

Branch `SCP-14_roadmap-fixes`, from master 794fd23. Plan: `plan.md` in this folder. The per-phase notes there have the details and file lists.

### Commits

| Phase | Commit | What |
|---|---|---|
| A | f697f2e | Config, seed upgrades and migrations |
| B | 085f492 | MCP surface (`wait_for_book`, `get_script`, paths, reopen published) |
| C | 03d6610 | Blocked providers, embeddings down, exclusive pins, start models, leak guard |
| D | fdcabb5 | Reviews keep their problems, story calendar, archivist aliases |
| F | c3df044 | Humanizer guards, research figures, short slugs, news only when current |
| E | 57137cf | Rewrite context, word targets, choice wording, script places, leak guard |
| (G) | ef8784e | Stabilize the test suite (two scheduler races fixed) |

### What changed, by roadmap item

- **X1 (`src/engine/mcp/tools.ts`):** `get_client_task` sends the prompt once. `messages` is present only for a real conversation.
- **X2:** the seed client model has `context: 200000`.
- **X3:** `migrateClientProvider` (`store/migrations.ts`) adds the client provider to an old `providers.md`, switched off as in the seed, or adds the missing context.
- **X4:** reload test in `tests/reload.test.ts`. No code change.
- **S15:** `scripts/seed-hashes.mjs` writes `store/seedHistory.ts`, and `migrateSeedPrompts` upgrades seed prompts the user never edited. A test fails if a seed prompt is changed without running `yarn seed:hashes`.
- **S16:** the humanizer seed chain is `[deepseek/deepseek-flash, paid]`. A folder with no humanizer role gets it too.
- **S1:** `wait_for_book`.
- **S2:** absolute paths in `get_book.paths`, `factory_status.dataDir`, `list_books.folder` and `list_articles.pagePath`.
- **S3:** `get_script` (`publish/script.ts`).
- **S11:** `set_book_model` works at any stage.
- **S12:** `reopen_book` also takes published books. Without `chapters`, it uses the chapters the last reviews named, and refuses when there are none.
- **S17:** `refresh_factbase`.
- **S5:** `start_book` carries the idea, so the story's `role_models` apply from the start.
- **S6:** a model on a provider that is down or used up for the day is skipped. When every model of a role is unusable, the job waits with the reasons and no attempt is counted. `factory_status` has `blocked`, `providers` and `embeddings`.
- **S7:**
  - A refused embeddings server is reported as `ServerDownError`, with `MemoryService.ready()` checking for it.
  - The search is skipped, and `index_chapter` waits and is requeued.
- **S13:** exclusive pins (`assign_agent {exclusive}`, `pin_exclusive`, UI checkbox `agent-book-exclusive`).
- **S8 and S9 (`pipeline/reviewNotes.ts`):**
  - Reviewers return `problems`, and the review file holds the notes plus a `## Problems` list.
  - A `revise` with no usable notes gets a follow-up question, then a retry.
  - The cause found in the live jobs: DeepSeek put the items inside `chapters[]`, and the repair round dropped them.
- **S26 (`pipeline/calendar.ts`):** `story_year` in the outline. Review, check, rewrite and memory prompts get the story's calendar.
- **S27:**
  - Archivist aliases via `Bible.resolveEntry`, so a character is not filed twice.
  - Weekday slips are corrected in the summaries and the timeline.
- **S14:**
  - The humanizer has a fragment guard (sentences of three words or fewer), a language guard and a unit allow-list ("Hz").
  - It cuts leaked prompt text, and its prompt is updated.
- **S18:** the researcher asks a follow-up for figures, and the notes carry verbatim `## Source excerpts`. Up to 16 facts.
- **S19:** short slugs cut at word boundaries for new stories and books (`shared/slug.ts`).
- **S20:** research questions use news mode only when the angle is current (`isNewsQuestion`).
- **S28 (`pipeline/rewriteContext.ts`):** the rewrite prompt carries the chapter, its neighbours in full, summaries for the rest, and only the notes about this chapter.
- **S10:** the word target is per chapter (`perChapterTarget`). The old target divided the book's total by the chapters written so far.
- **S24 and S25:**
  - A chapter more than 1.2× its share gets a retry that tightens it.
  - Short books are gated at ±20% of the target. Long books are gated over the format ceiling or over 1.15× the target.
  - `length_over` is set at publish.
- **S23:** `CHOICES:` in a rewrite can reword the choices (`BookStore.setChoiceTexts`).
- **S21 (`pipeline/scriptPlaces.ts`):** script `SCENE:` places use the bible's names, and new places are added to the bible.
- **S22 (`pipeline/leak.ts`):** leaked prompt instructions are cut off the end of an answer. A leak in the middle fails the job, which then runs again. Covers draft, rewrite, humanizer and the client queue.
- **S4:** checked only (the-clockless-god ran fully over MCP).
- **Docs:** each phase has its `docs/design.md` Decisions rows and History line. Also updated: `docs/mcp.md`, `docs/visual-novel.md`, the `seed/config` bodies and CLAUDE.md (`yarn seed:hashes`).

### Test suite fixes (ef8784e)

- `JobStore.requeue` wrote `attempts` and `not_before` after moving the job, so a scheduler tick could claim it in between. The retry then ran at once and was not counted. The patch is now written before the move.
- A tick claiming a job while `stop()` ran launched it afterwards and hung the shutdown. It now releases the slot and requeues the job.
- Test races fixed:
  - shared engines starting a second book
  - `.tmp-` files matched by a wait
  - a claimed job file being read
  - timing slack in the humanizer ordering checks
- `vitest.config.ts`: `waitFor` raised to 20 s, timeouts to 30 s, `maxWorkers: 8`.

### Deviations

- `story_year` is asked for only in `outline.md` and `outline_vn.md`.
- `review_outline`, `act_review` and `thread_check` get `problems` and the calendar, but not the follow-up question.
- The humanizer renames places but never adds them to the bible.
- The tighten retry skips a rewrite made from owner notes.
- `last_resort_model` is not built (plan decision 3).
- `length_over` has no test of its own.
- Several existing tests were adjusted to the new behaviour. The plan's phase notes list them.

### Verification

- **`yarn test`:**
  - 39 files, 501 tests (baseline 390).
  - The implementer had 5 green runs in a row after the fix, and the orchestrator had 2 more.
  - Master itself flaked 1 run in 3.
- **`yarn test:ui`:** 5 Playwright specs pass, including the exclusive-pin checkbox.
- **Other checks:** `yarn typecheck` and `yarn lint` are clean. `yarn seed:hashes` leaves no diff.
- **Not run:**
  - Any engine start against `~/Scriptorium`, so the migrations have not run on the real folder.
  - The live `wait_for_book` and `get_script` calls.
  - `yarn test:electron`.
- **Residual risk:** the recovery test "kill the engine mid-job" was not isolated. It is the most likely one to flake.

### Follow-ups

- **Live check, with the user's go-ahead (restarting Scriptorium resumes the factory):**
  - The migrations log the client provider and the humanizer prompt upgrades.
  - `factory_status` shows `dataDir`, `embeddings` and `blocked`.
  - `wait_for_book` on a small story.
  - `get_script` on `the-clockless-god-3`.
- **Hub:** `scripts/wait-book.ps1` can give way to `wait_for_book`.
- **From VNO-08:** teach the VN script prompts the new lines (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`) and an `Aliases:` sentence in the bible.

Pushed to `origin/SCP-14_roadmap-fixes`, not merged.

# Checkpoint: Phase 6 follow-up fixes and Phase 7 (researcher)

Written when the work was handed to a fresh agent. Project `C:\projects\Personal\scriptorium`, branch `SCP-02_mvp-text-only`, no commits made.

## 1. Status

Part 1 (Phase 6 follow-up fixes), all with mock tests in `tests/followup.test.ts`:
1. Flaky test: DONE. Causes found and fixed (see section 2). 14 full `npx vitest run` runs green in a row (172 tests) before the last few edits; one more 10-run loop is still needed on the final code.
2. Targeted rewrites: DONE (`chaptersToRewrite`, `pickWorst` in `advance.ts`; review prompts ask to name chapters).
3. Expand retry for long-format chapters under 80%: DONE (long formats only; short books keep the length gate).
4. Bible duplicate names: DONE (`entryKey`, `resolveEntryFile` in `bible.ts`, unit test).
5. Open threads: DONE (memory_update prompt has an explicit close step; end-of-book check uses the bible's open threads, closes resolved ones, writes `reports/open-threads.md`, publisher prompt and `book.md` `open_threads`).
6. Flat stretches: DONE (flat chapters added to the rewrite set, "Raise tension" note).

Part 2 (Phase 7):
- Search providers (Tavily, Wikipedia, 4 stubs, `search_order`, `price_per_request` spend rows): DONE.
- Researcher job (notes first, search, fetch, notes with source URL and date, index, untrusted-data wrapping, per-book limit, unverified fallback): DONE.
- Asking: architect plan step, writer prep step (format flag or `research_prep_genres`), `[RESEARCH: ...]` markers plus fix-up job, reviewer `research_questions`, `askResearcher` command: DONE. The `ask_researcher` tool: NOT built (model clients have no tool calling; deviation).
- Notes in writer context (own section at order 3.5, short-book path, rewrite and outline prompts): DONE.
- Handover event per request (label = the question): DONE.
- Mock e2e gate (`tests/research.test.ts`, 34 tests): DONE and passing.
- Real run (Wikipedia only): PARTLY DONE, not finished. See section 4.
- Phase 7 is NOT ticked in the plan (real run gate not met).

## 2. Files created or changed

New:
- `src/engine/research/web.ts`: HTML to text, URL safety, page fetch, Tavily, Wikipedia (keyword search terms, 429 retry, spacing, excerpts), stubs, `makeSearchProvider`.
- `src/engine/research/notes.ts`: `ResearchStore` (note files), question keys, job ids.
- `src/engine/research/markers.ts`: `[RESEARCH: ...]` find, span, replace, strip.
- `src/engine/research/service.ts`: `SearchService` (order, fallback, spend) and `ResearchService.ask` (limit, idempotent ids, no-researcher check).
- `src/engine/research/context.ts`: notes for a chapter (hybrid search with keyword fallback), prompt block.
- `src/engine/pipeline/researchHandlers.ts`: handlers `research`, `research_plan`, `research_prep`, `research_fix`; second-chance search with model-suggested queries.
- Seed prompts: `seed/prompts/researcher/{check_notes,write_notes,from_knowledge,search_queries}.md`, `seed/prompts/architect/research_plan.md`, `seed/prompts/writer/{research_prep,research_fix}.md`.
- Tests: `tests/followup.test.ts`, `tests/research.test.ts`.

Changed:
- `src/engine/pipeline/advance.ts`: targeted rewrite functions, research plan/prep/marker/review waits, new BookState fields.
- `src/engine/pipeline/pipeline.ts`: loads new state, `countBooksInProgress` race fix in `startBooks`, research jobs excluded from book failure, registers research handlers.
- `src/engine/pipeline/handlers.ts`: start_book guard, expand retry, markers asked after draft, research in outline/rewrite/draft context, review `research_questions`, publish open threads, tension note, `askFromReview`.
- `src/engine/pipeline/longHandlers.ts`: thread check (resolved ids, report), chapter check research questions.
- `src/engine/pipeline/books.ts`: `countBooksInProgress`.
- `src/engine/memory/bible.ts`: `entryKey`, name matching, thread id normalisation, `closeThreads`.
- `src/engine/memory/context.ts`, `memory/index.ts`: research section; `books` filter; per-book `research/` indexing.
- `src/engine/engine.ts`: SearchService/ResearchService wiring, `askResearcher` command, `search` test option.
- `src/engine/queue/scheduler.ts`: `label` as task label, tick errors caught. `queue/jobs.ts`, `store/atomic.ts`: `renameRetry` on claim/requeue (Windows EPERM).
- `src/engine/models/registry.ts`, `src/shared/schemas.ts`: search provider fields, `search_order`, `research_prep`, `research_prep_genres`, job `label`.
- Seed: `config/providers.md` (search entries), `config/formats.md`, `config/factory.md`, prompts (review chapters/research_questions, check_chapter, thread_check, publish, memory_update, draft/rewrite/outline).
- Tests changed for flakiness or new fields: `tests/helpers.ts` (many mock options), `tests/pipeline.test.ts`, `tests/novel.test.ts`, `tests/models.test.ts` (credential delete poll), `tests/renderer/app.electron.spec.ts` (Ask researcher step).
- Docs: `docs/design.md` (Decisions row, Research section, History), `README.md` status, `protocol-notes.md` (Phase 7 section).

## 3. Verified and unverified

Verified (run in this session):
- `npm run typecheck`, `npm run lint`, `npm run build`: passed (before the last source edits; lint and tsc were re-run clean after the edits).
- `npx vitest run`: 172 tests green 14 times in a row; the new tests (research 34, followup 13) pass.
- `npx playwright test` 2/2 and `npm run test:electron` 1/1 passed (before the last edits; the Electron spec now also checks the Ask researcher box).
- Wikipedia provider checked live against en.wikipedia.org (search plus article text).
Unverified:
- Tavily against the real service (no key). DeepSeek not used.
- Final full-suite loop, build, Playwright and Electron after the last edits (second-chance search, page ranking, helpers).
- The real run (below).

## 4. Half-finished or failing

- Real run script: `.claude/temp/run-p7-real.ts` (data `.claude/temp/p7-real/`, log `.claude/temp/p7-real-run.log`). Attempt 4 was running and was stopped at about 6 minutes: the architect asked questions, the researcher read Wikipedia pages and had just made its second-chance search. The earlier attempts' logs are `p7-real-run-attempt{1,2,3}.log`. Findings so far: Wikipedia often cannot answer specific questions (duration of a voyage), so the model returns no facts and the note becomes unverified; fixes made along the way: keyword search terms, rate-limit spacing, bigger max_tokens, page ranking, model-suggested second search. No real run has yet produced a note with Wikipedia sources or a published book.
- No known failing tests. Background processes: the real run was stopped.
- Plan file: Phase 6 follow-up list and Phase 7 evidence not yet written; Phase 7 not ticked.

## 5. Next steps

1. Run `npm run typecheck`, `npm run lint`, `npx vitest run` ten times in a row, `npm run build`, `npx playwright test`, `npm run test:electron`.
2. Re-run the real run: `npx tsx .claude/temp/run-p7-real.ts .claude/temp/p7-real 65 > .claude/temp/p7-real-run.log 2>&1` in the background after `rm -rf .claude/temp/p7-real` (LM Studio models loaded with 32768; ~45-60 min). If the architect's questions are too specific for Wikipedia, consider a broader idea or shorter questions; success needs at least one note with Wikipedia sources used in a later chapter's context (job file `jobs/done/<slug>--draft--ch0N--r0.md`) and the book published or a clear end state. Record title, notes with sources, time, paths.
3. Update the plan: tick Phase 7, add the indented "Phase 6 follow-up fixes" list under Phase 6 with the evidence above (flaky causes: start_book race with three books open, EPERM on job claim rename, EBUSY on index unlink in a test, topics `inProgress` race in a test, Windows credential delete lag), and the deviations: no `ask_researcher` tool (markers only); expand retry for long formats only; research failures never fail a book; per-chapter scores exist only for long books so short books still rewrite everything on an unnamed revise; Wikipedia is weak for specific facts.

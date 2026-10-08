# Checkpoint: Phase 8 (stopped mid-way, resume tomorrow)

Plan.md was NOT updated: no Phase 8 item is ticked.

## 1. Status per item
- Topics seed coverage: done (12 rows added: 3 fiction, 2 juvenile fiction, 3 juvenile non-fiction, 1 history, new section "Law & Politics" with 3; 448 rows, names unique; intro text updated).
- Topics UI: done (`ui/Topics.tsx`, `groupTopics` in `store/shelves.ts`: tick box, sections emptiest first, done/target and in-progress, filter box, "on" only toggle).
- Non-fiction variant (engine): done and mock-tested (formats, research per chapter, fact base, `factbase_update`, `fact_check`, `[n]` citations, References chapter in EPUB and reader, must_pass, prompts, fact-checker agent text).
- Mock tests: done (`tests/nonfiction.test.ts`, 9 tests: e2e publish with references, fact-check fail then rewrite then pass, uncited book rejected, pure advance, seed files).
- Topics UI test: done (demo Playwright spec extended; store test for `groupTopics`).
- Real gate: NOT done. Run was killed by me (about 12 min in, chapter 2 research prep, no failure seen). Data left in `.claude/temp/p8-real/`, log `.claude/temp/p8-real-run.log`. Script `.claude/temp/run-p8-real.ts` (topic `his-books-and-printing`, format `nonfiction-short` overridden to 3200-4800 words, 4-5 chapters, max_rounds 1). The first real attempt did not fail; it was interrupted, so it does not count as an attempt. Delete `.claude/temp/p8-real` before the rerun.
- Docs: design.md Decisions row "Non-fiction (built)" and Topics UI line done; History line NOT added; README status NOT updated; protocol-notes.md Phase 8 section done.

## 2. Files
New: `src/engine/memory/factbase.ts` (fact base, sources numbering, references); `src/engine/pipeline/nfcontext.ts` (non-fiction context builder, numbered notes); `src/engine/pipeline/nonfiction.ts` (`factbase_update`, `fact_check` handlers); `src/renderer/ui/Topics.tsx`; `tests/nonfiction.test.ts`; seed prompts `*_nf.md` (architect pitch/outline/research_plan, writer draft/rewrite/research_prep, dev-editor/line/copy/beta/originality review, publisher publish), `archivist/factbase_update.md`, `fact-checker/fact_check.md`.
Changed: `src/shared/schemas.ts` (format `nonfiction`, factory `research_limit_nonfiction`); `src/engine/research/notes.ts` (NoteFile.sources); `research/service.ts` (nf limit); `pipeline/{advance,pipeline,handlers,researchHandlers,prompts,books}.ts`; `memory/context.ts` (pack titles param); `seed/config/{formats,quality,factory}.md`; `seed/topics.md`; seed agents archivist and fact-checker text; `idea-generator/generate_ideas.md`; `src/renderer/ui/Library.tsx`, `store/shelves.ts`, `styles.css`, `demo/library.ts` (3 demo topics); `tests/helpers.ts` (citations, factClaims, nf mocks); `tests/renderer/{office.spec,store.test,app.electron.spec}.ts`; `docs/design.md`; `protocol-notes.md`.

## 3. Verified
- `npm run typecheck`, `npm run lint`: clean (last run before the final doc edits; no code changed since).
- `npx vitest run`: 186 tests green in 2 of 3 runs while the real run loaded the machine; 1 run had one timing failure (`scheduler.test.ts` "a failing handler is retried...", 5 s) under load. Not yet the required 5 clean runs.
- `npm run build`: ok. `npx playwright test`: 2 passed. `npm run test:electron`: 1 passed.
- Not verified: 5x vitest on an idle machine, the real non-fiction run, the real-model behaviour of fact-checker and citations.

## 4. Broken or half-finished
Nothing broken or half-written. Possible flake to recheck: `scheduler.test.ts` under load.

## 5. Next steps
1. Idle machine: `npx vitest run` 5 times in a row; rerun typecheck, lint, build, playwright, test:electron.
2. Delete `.claude/temp/p8-real`; check `lms ps` (32768 context); run `npx tsx .claude/temp/run-p8-real.ts .claude/temp/p8-real 95 > .claude/temp/p8-real-run.log` (about 40-60 min). If two real attempts fail, stop and report with log excerpts.
3. Record title, score, time, words, fact-check verdicts (`reviews/book-fact-checker-r*.md`), references (`out/reader/chapter-NN.xhtml`), paths.
4. Tick Phase 8 in plan.md with evidence and deviations (task `fact_check` instead of `review`; non-fiction formats are short books only; fiction reviewers unchanged; test row cap kept at 450).
5. Add design.md History line, update README status.

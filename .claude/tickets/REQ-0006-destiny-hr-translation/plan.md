---
status: done
request: REQ-0006
repos: [scriptorium, book-translator]
branch: [BTT-27_pre-run-fixes, BTT-28_post-run-fixes, SCP-57_humanizer-group-nouns, SCP-58_research-notes-fixes]
updated: 2026-11-10
---

# REQ-0006: translate the Destiny Decides books to Croatian, merge the open fixes

## Scope

1. Translate both books of the series `destiny-decides` (Scriptorium data folder `C:/Users/Infplane/Scriptorium`) into Croatian with Book Translator, at $0:
   - Book 1: "What Fate Decides: Luck, Will and the Life You Get", source `books/what-fate-decides-luck-will-and-the-life/out/what-fate-decides-luck-will-and-the-life.epub` (8 blinks + References = 9 chapter files).
   - Book 2: "The Tide Table", source `books/the-tide-table/out/the-tide-table.epub` (5 chapter files).
2. Set up both projects the way "The One-Way Street" was (`clientOnly: true`, Claude Code answers glossary, translator, proofreader and fix tasks), plus the BTT-26 independent reviewer: QA on `acp/antigravity/gemini-3.8-flash`.
3. Fix the open findings from SCP-56 and BTT-26 as triaged below. The ones that matter for the run land before it.
4. Merge every ticket branch to its repo's `master` after a checker PASS. Never push.

Facts checked while planning (2026-11-09):
- Book 1's EPUB was built after the hand edit of `chapters/ch-01.md` (12:54:27 vs 12:54:16), so it carries the edit.
- Neither book has a cover PNG in `out/` (only `cover.html`); the EPUBs have a text cover page. The export uses `cover: 'title'` (a translated title page), so the translation does not wait for the PNG.
- The One-Way Street hr EPUB has a Croatian `dc:title` and `xml:lang="hr"`, but its `dc:description` and `dc:subject` stayed English: `src/engine/formats/epub.ts` only extracts `dc:title` (block `m.1`).
- `C:/Users/Infplane/BookTranslator/config/providers.md` still has `acp` at `http://127.0.0.1:7461/v1`. The BTT-26 migration (`src/engine/store/migrate.ts:339`) rewrites it to 8787 at the first engine start from current master.
- `C:/Users/Infplane/BookTranslator/engine.lock` holds pid 9544 (stale from REQ-0004). `C:/Users/Infplane/Scriptorium/index/engine.lock` holds pid 16920.
- Book Translator has no shared or cross-project glossary. `update_glossary` replaces a project's whole list; the glossary builder keeps rows that already exist and only adds new ones (`runner.ts:171`).

## Out of scope

- No paid model calls, no API keys, no changes to `config/defaults.json` or budget settings.
- No new shared-glossary feature in Book Translator. Series consistency is done by copying rows (task B2).
- No re-run or edit of the English books, covers or Scriptorium pipeline output.
- No copying of the hr EPUBs into the Scriptorium book folders (they stay in each project's `output/`).
- Scriptorium SCP-56 "defer" and "drop" items below.
- Pushing any branch, opening PRs.

## Order of work

- **Phase A: pre-run fixes.** BTT-27 in book-translator (must merge before Phase B). SCP-57 and SCP-58 in scriptorium can run in parallel with Phase A and B: they touch another repo and need no engine.
- **Phase B: translation.** B0 preflight, B1 book 1, B2 book 2 (B2 starts after B1's glossary is final, so it can copy the series rows). One Book Translator engine for both. Stop it after B2.
- **Phase C: post-run fixes.** BTT-28: the two UI items plus any bug the run logged in `REQ-0006-destiny-hr-translation/discoveries.md`. If the run found nothing new and the user defers the UI items, BTT-28 is dropped.
- **Phase D: merge and close.** Merge each branch after its checker PASS, write `run-report.md`, set this plan to `status: done`.

Every ticket: own folder in its repo's `.claude/tickets/<id>/` (plan.md, changelog.md, discoveries.md), branch from current `master`, run with the `implement` skill, tests through `test-discipline` (fewest tests that prove it).

## Files and modules to touch

book-translator (BTT-27):
- `src/engine/pipeline/runner.ts` (refused proofreader -> flag the chunk; `prepareChunks` model resolution ~207)
- `src/engine/service.ts` (~228, ~241: estimate resolves `exact: true` when `clientOnly`)
- `src/engine/cli.ts` (~216: `engine status` shows reasons for flagged chunks too)
- `src/engine/models/registry.ts` (refuse a providers.md alias whose name starts with `client/`)
- `src/engine/formats/epub.ts` (if Q2 = yes: `dc:description` as a translatable block, written back on export)
- `README.md` (~142: refused proofreader is flagged like QA)
- `tests/pipeline.test.ts` (~363: assertion on the repaired output), `tests/clientOnly.test.ts` (one test: another `client/x` reviewer is allowed at call time)

book-translator (BTT-28): `src/renderer/store/store.ts` (~179 per-chunk score update, ~198 reset chunk `qaScore` on retry or refusal), plus files named by run findings.

scriptorium (SCP-57): `src/engine/pipeline/humanizerHandlers.ts` (~122-141 and the group-noun rules), its existing test file.
scriptorium (SCP-58): `src/engine/pipeline/researchHandlers.ts`, `src/engine/pipeline/nonfiction.ts` (`factCheckNotes`, ~82-95), `src/engine/research/notes.ts` (page excerpts, ~150-210), their existing tests. Run `yarn seed:hashes` only if a seed prompt changes.

Data (Phase B, no code): `C:/Users/Infplane/BookTranslator/projects/<new ids>/`, `config/providers.md` (only the automatic acp migration).

## Tasks for workers

### A1. BTT-27_pre-run-fixes (book-translator)
- Input: BTT-26 `discoveries.md`, the triage table below, master `d4129fa`.
- Output: branch merged to master; changelog; tests green (`yarn vitest run` or the repo's `npm test`), typecheck and lint clean.
- Done when: a refused proofreader leaves the chunk `flagged` with reason `proofreader <ref> refused: ...` (test); estimate and prepareChunks on a client-only project report exactly the project's models (test); `engine status` lists flagged reasons; an alias `client/...` in providers.md is refused with a warning; the repair test fails if repair is removed; one allowed-client-reviewer test; README line fixed; if Q2 = yes, an EPUB round trip translates `dc:description` (test).
- Contract: Phase B starts only after this merge and an engine rebuild from master.

### A2. SCP-57_humanizer-group-nouns (scriptorium)
- Input: SCP-56 `discoveries.md` items 1-3.
- Output: chain scan bounded (or cached) so 400 joined items take under 100 ms; a capitalised name after a joiner or "of" is not accepted ("the Stoics and Evans", "the friend of Evans" refused); `GROUP_ADJECTIVES` matches case-insensitively ("Early Christians" accepted). One test per rule, extend the existing file.
- Contract: independent of Phase B.

### A3. SCP-58_research-notes-fixes (scriptorium)
- Input: SCP-56 `discoveries.md` items 5, 7, 8.
- Output: a fallback note gives no empty `### question` entry to the writer (its URL stays in the sources); `factCheckNotes` never exceeds `excerptLimit` (clamp, test with 100); stored page text cannot break out of its section (neutralise lines starting with `#` and code fences inside the page-excerpts block; the fact-checker prompt keeps calling it data). Tests in existing files.
- Contract: independent of Phase B.

### B0. Preflight (one worker, PowerShell)
1. `fnm env --use-on-cd | Out-String | Invoke-Expression`.
2. No Book Translator running: `Get-Process -Id 9544` fails, no `Book Translator` process. Then delete the stale `C:/Users/Infplane/BookTranslator/engine.lock`. If a process holds it, stop and ask.
3. ACP proxy up on 8787, started with `PROXY_IGNORE_SAMPLING=1` and a `PROXY_TIMEOUT_MS` of at least 300000. `curl http://127.0.0.1:8787/v1/models` lists `antigravity/gemini-3.8-flash`. If not, start it from `C:/projects/Personal/api-acp-proxy` per its README, or ask the user.
4. From `C:/projects/Personal/book-translator` on master (after A1): `yarn headless --data C:/Users/Infplane/BookTranslator` in the background. Check `providers.md` now says `8787` and `seed-state.json` lists `acp-port-8787-v1`.
5. Connect over MCP; `release_client_task {}` to free old leases; `list_projects` works.
- Output: engine pid, MCP URL, ACP model list, written to `REQ-0006-destiny-hr-translation/run-log.md`.

### B1. Translate book 1 (Claude Code via client tasks)
- `create_project`: sourcePath = book 1 EPUB, sourceLanguage `en`, targetLanguage Croatian (`hr`), `clientOnly: true`, `reviewer: { models: ["acp/antigravity/gemini-3.8-flash"], proofread: false }`, `pauseAfterGlossary: true`, glossary, proofreader and QA enabled, `maxChunkTokens` 1500.
- `get_project`: `clientOnly: true`, glossary/translator/proofreader on `client/claude-code`, qa on the reviewer, QA marked independent. Estimate shows $0.
- `start_translation`; answer glossary tasks; at the pause review `glossary.md` and write `set_brief`: popular philosophy, clear neutral standard Croatian, author voice, generic "you" as informal `ti`, consistent with The One-Way Street. Fix the core concept rows: fate, destiny, luck, chance, will, free will, moral luck, amor fati, survivorship bias, the Fates (Moirai), names (Epictetus, Boethius, Calvin, Laplace, Nietzsche, Nagel, Williams) in established Croatian forms. Keep "fate" and "destiny" distinct if the book distinguishes them. Book title: translated, recorded as a glossary row.
- References chapter: keep each entry's title, URL and date as in the source; translate only the intro sentence and "Retrieved" (Preuzeto). Say so in the brief.
- `start_translation` again; loop `wait_for_progress` / `get_client_task` / `submit_client_task` for role translator, proofreader, fix. QA runs on Gemini by itself.
- Triage every flagged chunk: `get_chunk`, then `edit_chunk` or accept the flag; one line each in `triage.md` (chunk, reason, action).
- `export_project { cover: "title" }`.
- Contract to B2: final `glossary.md` of book 1 and its brief.

### B2. Translate book 2
- Same settings as B1. After `create_project` and before `start_translation`: if Q1 = yes, `update_glossary` with book 1's concept rows (fate, destiny, luck, chance, will) and no other rows; the builder then adds the story's own names and terms.
- Brief: literary fiction, past tense, third person (check the source), Croatian dialogue punctuation (dashes or „ “, one style), names and the town Kelby kept, period 1974-2024, tide terms (plima, oseka, tablica plime i oseke).
- Same loop, triage and export as B1.

### B checks (worker runs them, results in `run-report.md`)
For each output EPUB (`projects/<id>/output/*.hr.epub`):
- OPF: `dc:title` is Croatian, `dc:language` is `hr`, package `xml:lang="hr"`; `dc:description` Croatian if Q2 = yes.
- Chapter file count equals the source: 9 for book 1, 5 for book 2; every chapter heading translated (except names).
- `get_project`: all chunks done, `spend.costUsd` 0, QA score present on every chunk with model `acp/antigravity/gemini-3.8-flash`, project score recorded. A chunk with no score is listed with the reason (for example ACP down).
- No flagged chunk without a line in `triage.md`.
- Spot read: first and last chapter of each book, one paragraph each pasted in `run-report.md`.
- Then stop the engine; `engine.lock` gone or noted. Leave the ACP proxy as it was found.

### C1. BTT-28_post-run-fixes (book-translator)
- Input: BTT-26 items 1-2 and every bug in `REQ-0006-destiny-hr-translation/discoveries.md`.
- Output: statline score updates on each `chunk.state` event; a retried or refused chunk's tile score resets; fixes for run bugs, each with one test where one fits.

### D1. Merge and close
- For each ticket: director-checker PASS against its plan, `git merge --no-ff` to master, no push. Commit messages with Bash heredoc.
- `run-report.md`: project ids, output paths, QA scores, flagged triage, Croatian titles. This plan `status: done`.

## Fix triage

| Finding | Decision | Ticket | Reason |
| --- | --- | --- | --- |
| BTT: refused proofreader fails the chunk; README wrong | Fix now | BTT-27 | A failed chunk loses work; the run must flag, not fail. |
| BTT: estimate/prepareChunks resolve non-exact | Fix now | BTT-27 | The estimate must show the client-only models the run will use. |
| BTT: `engine status` shows no reasons for flagged chunks | Fix now | BTT-27 | Needed to triage flags in the run. |
| BTT: `client/` alias can bypass `isClientRef` | Fix now | BTT-27 | It is a hole in the $0 guard. |
| BTT: pipeline repair assertion cannot fail | Fix now | BTT-27 | Gemini JSON goes through repair; the test should guard it. |
| BTT: no allowed-client-reviewer test | Fix now | BTT-27 | One test next to the guard change. |
| BTT (new): `dc:description` and `dc:subject` stay English | Fix now if Q2 = yes | BTT-27 | The hr EPUB shows an English blurb. Subjects stay as-is (library keywords). |
| BTT: statline QA score not per chunk | Fix after run | BTT-28 | UI only; the run is headless. |
| BTT: stale tile qaScore after retry | Fix after run | BTT-28 | UI only. |
| SCP: humanizer chain scan O(k²n) | Fix now | SCP-57 | 13 s on a stuck model blocks the engine; cheap bound. |
| SCP: names pass via joiner and "of" rules | Fix now | SCP-57 | It lets an invented name through the check. |
| SCP: `GROUP_ADJECTIVES` case-sensitive | Fix now | SCP-57 | One line in the same file; a false refusal costs a humanizer round. |
| SCP: fallback note gives writer an empty entry | Fix now | SCP-58 | Noise in the writer prompt. |
| SCP: `factCheckNotes` overshoots small `excerptLimit` | Fix now | SCP-58 | Trivial clamp. |
| SCP: stored page excerpts not escaped | Fix now | SCP-58 | Page text could break out of its section in the fact-checker prompt. |
| SCP: `candidateFacts` matches source-excerpt lines | Defer | - | Pre-existing, no harm seen; needs a design decision. Add to ROADMAP. |
| SCP: `findExact` treats a fallback note as answered | Drop | - | By design (SCP-56): a fallback note is sourced; re-asking re-reads the same pages. Note it in `docs/design.md`. |

## Acceptance criteria

1. BTT-27, SCP-57, SCP-58 (and BTT-28 if kept) merged to master with checker PASS; each repo's full test suite, typecheck and lint pass on master after the merges. Check: test output in each ticket's changelog.
2. Two Croatian EPUBs exist in `C:/Users/Infplane/BookTranslator/projects/<id>/output/`. Check: B checks above, all pass.
3. Spend is $0: both projects `spend.costUsd` 0, `clientOnly: true`, no `deepseek` call in either `log.md`. Check: `grep -i deepseek log.md` is empty.
4. QA was independent: every chunk's `qa.model` is the Gemini reviewer; project score in `run-report.md`.
5. Every flagged chunk has a triage line. Check: count of flagged chunks in `get_project` equals lines in `triage.md` for that project.
6. If Q1 = yes: book 2's glossary uses the same Croatian targets as book 1 for the shared concept rows. Check: diff the rows.
7. No engine left running; no stale Book Translator `engine.lock`. Check: `Get-Process` and the file.

## Risks

- ACP proxy or Antigravity login down: QA falls back to deterministic checks with no score, never to a paid model. Mitigation: B0 checks the proxy; if chunks lose scores mid-run, pause, fix the proxy, and list unscored chunks in the report.
- Gemini Flash may flag correct Croatian (case endings, word order). Triage, do not auto-edit.
- The README notes driving Antigravity through the proxy may break its terms of use; this was already used in REQ-0005.
- Scriptorium's `index/engine.lock` (pid 16920) is irrelevant to this run; do not start Scriptorium.

## Open questions for the user

- **Q1. Shared series glossary.** Book Translator has no shared glossary. Copy book 1's core concept rows (fate, destiny, luck, chance, will) into book 2 before its run? Recommended: yes, those rows only.
- **Q2. Translate the EPUB description (blurb).** The hr EPUB keeps the English `dc:description` today. Add it to BTT-27 before the run? Recommended: yes.
- **Q3. Proofreader.** Keep Claude Code as proofreader (`proofread: false`, recommended) or let Gemini proofread too (`proofread: true`)?
- **Q4. Low items.** Fix the SCP low items now as triaged (case-insensitive adjectives, excerpt clamp), defer `candidateFacts`, drop `findExact`? Recommended: as in the table.

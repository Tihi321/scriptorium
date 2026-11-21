# REQ-0006 run log (Phase B)

## B0 preflight (2026-11-09, ~23:45)

- Book Translator repo `C:/projects/Personal/book-translator` on master `be5ecb9` (Merge BTT-27_pre-run-fixes); `yarn headless` rebuilt the engine (`yarn build:engine`) before start.
- Stale lock: `C:/Users/Infplane/BookTranslator/engine.lock` held pid 9544; `Get-Process -Id 9544` failed and no Book Translator process ran (the other node processes were `out/engine/index.js --mcp-only` of other apps). Lock deleted.
- ACP proxy: already running (packaged `ACP Proxy.exe`, pid 22032, up since 12:05, not started by me). `/healthz` ok; settings `server.timeoutMs` 300000. `PROXY_IGNORE_SAMPLING` no longer exists in the proxy (README: sampling params are always dropped; response header `x-acp-proxy-ignored-params: temperature` confirmed). `GET /v1/models` lists `antigravity/gemini-3.8-flash`; a test chat to it answered "ok" (Antigravity logged in).
- Engine: `yarn headless --data C:/Users/Infplane/BookTranslator`, pid 43564 (from engine.lock), MCP `http://127.0.0.1:47811/mcp`. Log line: `config/providers.md: added acp-port-8787-v1 from the seed`.
- `providers.md`: acp `base_url: http://127.0.0.1:8787/v1`; exactly one provider with id `client`, kind `client`. `seed-state.json` migrations: `strata-loaded-v1`, `acp-port-8787-v1`. Engine log has no `provider "client" skipped` warning.
- MCP: `list_projects` works; `release_client_task` per role released 0 (an empty call is refused, see discoveries).

## B1 book 1 (2026-11-09 23:46 - 23:59)

- Project `what-fate-decides-luck-will-and-the-life-hr-54a317`, clientOnly true, reviewer `acp/antigravity/gemini-3.8-flash` proofread false, glossary/proofreader/qa on, maxChunkTokens 1500, pauseAfterGlossary true (set with update_project_settings).
- Glossary: 96 rows (2 passes), brief set with set_brief (References rule: titles/URLs/dates as source, "Retrieved" -> "Preuzeto").
- 13 chunks, all done; flagged 1 during the run, triaged (edit_chunk), see triage.md. QA score 9.8, 13/13 scored by Gemini, independent true. spend.costUsd 0. No "deepseek" in log.md.
- Exported with cover title: `C:/Users/Infplane/BookTranslator/projects/what-fate-decides-luck-will-and-the-life-hr-54a317/output/what-fate-decides-luck-will-and-the-life.hr.epub`. OPF: dc:title "Što odlučuje sudbina: sreća, volja i život koji dobiješ", dc:language hr, package xml:lang="hr", dc:description Croatian (BTT-27 works), 9 chapter files (= source), all headings Croatian.

## Paused 2026-11-10

Stopped at the director's request after submitting the client tasks in hand.

Book 1 `what-fate-decides-luck-will-and-the-life-hr-54a317`: **done and exported** (see B1). 13/13 chunks done, flagged during run 1, triaged 1 (now 0 flagged). QA 9.8, cost $0.

Book 2 `the-tide-table-hr-fc6ee3` (source `C:/Users/Infplane/Scriptorium/books/the-tide-table/out/the-tide-table.epub`): **paused** in the translating phase, not exported.
- Settings as book 1 (clientOnly, Gemini reviewer, proofread false, pauseAfterGlossary true).
- Q1 rows set: `update_glossary` with only fate/destiny/luck/chance/will before the first start; after the builder the five rows are identical to book 1 (diff empty). Glossary now 69 terms + header (70 table lines).
- Glossary phase done (2 passes answered); brief set with set_brief (literary fiction, past tense, third person, „ “ dialogue, tide terms, Kelby kept, 1974-2024).
- Chunks: 0/14 done, 14 pending, flagged 0, triaged 0. QA none yet. spend.costUsd 0.
- Lost work: 8 translator answers (chunks 1, 2, 3, 4, 6, 8, 10, 12) were accepted and then dropped by `pause_translation` (see discoveries). The answers are kept in `C:/projects/Personal/scriptorium/.claude/temp/req0006/ans/the-ti.chunk-<n>.txt`.

Engine stopped (process 43564 ended; engine.lock removed after checking no Book Translator process runs). ACP proxy left running as found (pid 22032).

### To resume

1. PowerShell: `fnm env --use-on-cd | Out-String | Invoke-Expression`; check no Book Translator runs and no `C:/Users/Infplane/BookTranslator/engine.lock`; check `curl http://127.0.0.1:8787/healthz` and that Antigravity answers.
2. `yarn headless --data C:/Users/Infplane/BookTranslator` from `C:/projects/Personal/book-translator` (master be5ecb9) in the background.
3. `start_translation {projectId: "the-tide-table-hr-fc6ee3"}` (glossary and brief are kept, so it goes straight to chunks).
4. For the 8 chunks above, check the new task's segment ids match the saved answer (same 14-chunk plan, budget 1500) and resubmit `ans/the-ti.chunk-<n>.txt` (helper `subtr.py the-ti` in the same temp folder does this after `fetch.py`); translate chunks 5, 7, 9, 11, 13, 14 (13 = end of the last chapter, 14 = Contents: Sadržaj / Naslovnica / Korice / Početak knjige).
5. Proofread, fix passes, triage every flagged chunk into triage.md, `export_project {cover: "title"}`, then the B checks (5 chapter files) and run-report.md, stop the engine.

## B2 resumed (2026-11-10 09:46 - ~10:50)

- Preflight: no Book Translator process, no `engine.lock`. ACP proxy was **down** (port 8787 refused); started the packaged `release/win-unpacked/ACP Proxy.exe`; `/healthz` ok, `/v1/models` lists `antigravity/gemini-3.8-flash`, test chat answered "ok" (Antigravity logged in, no paid model used).
- Engine: `yarn headless --data C:/Users/Infplane/BookTranslator` from book-translator master be5ecb9, pid 29356, MCP `http://127.0.0.1:47811/mcp` (same token). Log warns Strata is down (not used: clientOnly).
- `start_translation` went straight to chunks (glossary and brief kept). The 8 new translate tasks (chunks 1, 2, 3, 4, 6, 8, 10, 12) had exactly the segment ids of the saved answers: all 8 resubmitted unchanged, accepted. Chunks 5, 7, 9, 11, 13, 14 translated new.
- Proofread: all 14 chunks proofread by me (fixes e.g. d4.9 "to mu nikad nije oprostila" -> "to Kelbyju", "čamac na preklop" -> "čamac s preklopnom oplatom", "u sitne sate" -> "u sitnim satima"). One Cyrillic "е" caught in chunk 7 before submitting. Scan of the final text: no straight quotes, no Cyrillic, „ “ balanced, dialogue count and inline tags equal to the source in all 163 segments.
- Fix pass 1 (chunk 14, Gemini false "missing tags"), answered unchanged; chunk flagged. Triage in triage.md (2 edit_chunk: chunks 14 and 7).
- `edit_chunk` cleared the QA score (see discoveries), so chunks 7 and 14 of book 2 and chunk 5 of book 1 were re-run with `retry_chunk` and the same final text: Gemini scored 9, 10 and 10.
- Final: book 2 14/14 done, 0 flagged, QA 9.8, 14/14 scored by Gemini, independent, costUsd 0. Book 1 13/13, QA 9.9, 13/13 scored, costUsd 0.
- Exported both with `cover: "title"` (book 1 again, same path). B checks and run-report.md written.
- Engine stopped: killed pid 29356 and its yarn parent (no Ctrl+C from a background shell), checked no Book Translator process, removed the stale `engine.lock`; MCP port closed. ACP proxy: stopped again (it was down when I came), no ACP Proxy / agy_acp_server process left.

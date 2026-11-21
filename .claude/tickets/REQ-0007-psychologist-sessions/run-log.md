# REQ-0007 run log (T3/T4): Fifty Minutes of Common Sense

## Preflight (2026-11-11, ~12:18)

- `index/engine.lock` held pid 16920 (REQ-0004); `Get-Process -Id 16920`: no process. No Scriptorium engine running (the node processes present were other projects' `yarn test`/`yarn build`). Lock left for the engine to replace; it did (new lock pid 38576).
- ACP proxy: **down** (8787 refused). Started `C:/projects/Personal/api-acp-proxy/release/win-unpacked/ACP Proxy.exe` (pid 39660). `/healthz` ok; `/v1/models` lists `antigravity/gemini-3.8-flash`; a one-line test chat answered "ok" (header `x-acp-proxy-ignored-params: temperature`).
- LM Studio: server **down**. Started with `lms server start` (port 1234); loaded only `text-embedding-nomic-embed-text-v1.5` (`lms ps`: one model, idle).
- Strata: down, not started (as planned). Engine log: "strata is down ... jobs use the next model in their role".
- `config/formats.md` in the data folder has `id: linked-collection` (line 41).
- `SCRIPTORIUM_MCP_TOKEN` not set; engine log `mcp: listening on http://127.0.0.1:7341/mcp (no token set)`, so no token was needed.

## Temporary config

- `budget.md` caps 40/20 -> 0/0 (recorded first in config-revert.md).
- No roles.md / factory.md edits.

## Engine

- `yarn headless --data C:\Users\Infplane\Scriptorium --only fifty-minutes-of-common-sense` from the repo (branch REQ-0007_linked-collection, uncommitted T1 changes), background shell; output `.claude/temp/req0007/engine.out`.
- Log: `single-idea run: only "fifty-minutes-of-common-sense" starts and runs (--only)`. No "not enabled: the editor chooses" line.
- Engine pid 38576 (from `index/engine.lock`, started 2026-11-11T11:22:23Z).
- Helpers: `.claude/temp/req0007/mcp.py` (token only from env), `fetch.py`, `sub.py`, `wt.py`, `st.py`, `models.py`. Every task JSON and answer is kept in `tasks/` and `ans/`.

## Setup tasks (all client/claude-code)

- start_book (editor-in-chief): linked-collection, title fixed, Comic fiction, 45,000. Accepted.
- pitch: first answer 319 words, engine asked for under 300 (call 2); second 296 words, accepted.
- research_plan: `{"needs_research": false, "questions": []}`.
- outline: 15 chapters in the brief's interleaved order, 21 characters, 10 places, 7 threads, story_year null. Accepted first time.

## Drafting (12:26 - 13:37), all client/claude-code

Writer subagents (opus), fresh every 3 stories: A stories 1-3, B 4-6, C 7-9, D 10-12, E 13-14, F 15 (F fresh because the story-15 task carried ~286k characters of earlier chapters). The parent kept `.claude/temp/req0007/continuity.md` and passed it to every writer with `writer-brief.md`. Every draft was accepted first time; no tighten task (none over 3,600 words).

Draft words: 3294, 3062, 3169, 3070, 3078, 2992, 3076, 2940, 2910, 2950, 2922, 2859, 2948, 3144, 3142 = 45,558 (length gate `ok`, 45,558).

Parent edits to answer files before submitting (never to engine chapter files): ch04 "you're in Coventry" -> "you're at work" (one other "Coventry" in the same chapter was missed and is in the book); ch12 signature "Croft-Nair" -> "Croft" (an invented surname); ch14 "people in Australia" -> "people she has never met".

## Humanize (13:37 - 13:58), all client/claude-code

Three humanizer subagents (5 chapters each) made 6-15 light narration edits per chapter, copy-and-edit, checked by `.claude/temp/req0007/hcheck.py` (word ratio, dashes, new capitalised words, numbers, one-word sentences). All 15 passes were applied by the engine (log: "humanizer: chapter N humanized: A to B words"); **no refused pass**.

Final chapter words (files): 3278, 3058, 3154, 3067, 3077, 2987, 3073, 2933, 2905, 2944, 2902, 2848, 2938, 3143, 3135 = **45,442** (engine `words` 45,427). All in 2,848-3,278.

## Reviews (13:57 - 14:21)

- Round 0 on acp/antigravity/gemini-3.8-flash: the whole-book prompt is ~62.7k tokens. Gemini answered every review with a markdown report and no JSON; each job's repair round failed too. developmental-editor, line-editor, copy-editor, beta-reader and originality-checker failed for good; the book went `failed` (14:02).
- `retry_book` once (14:04): same result; book `failed` again (14:10). REQ-0004's the-tide-table (12.8k-token prompts) had no such failures.
- Fix (allowed models only, $0): `set_book_model` for those five roles -> client/claude-code, `retry_book`. Five fresh, independent opus reviewer subagents (they had not seen the writing) answered from `reviewer-brief.md`. The continuity checker stayed on Gemini, then failed for good the same way (14:17); it was re-pinned to client/claude-code and answered by a sixth fresh reviewer.
- Scores and verdicts (all round 0, all `pass`, all `model: client/claude-code` in reviews/*.md):
  - developmental-editor: structure 9, pass
  - line-editor: prose 8, pass
  - copy-editor: mechanics 8, pass
  - beta-reader: enjoyment 9, genre_fit 9, pass
  - originality-checker: originality 9, pass
  - continuity-checker: continuity 8, pass
  - weighted score 8.57. Rounds: 1 (round 0 only; no rewrite).
- "No single climax": no reviewer penalised it; all six said so explicitly. Gemini's (non-JSON) developmental and beta reports in the log were also positive and did not raise it.
- Notes the reviewers left (not fixed, no rewrite round): ch01 "two hundred and seven Sundays" vs measuring from Year Two; ch11 Desmond's watch ten minutes fast but arrives "ten past three"; ch12 "nine days and three hours" from 9:30 to 14:05 vows; ch13 "where it was nothing was waiting" reads garbled; ch14 a missing Ruth beat after "Being in town."; ch15 two consecutive "said Owen" paragraphs; Jess's shift times vary (12 vs 1, "quarter to four"); sash "stuck since spring" vs "painted shut years before"; the fern's "neither died nor thrived" tag repeats five times; the 10:15 beat and "the way"/"as if" similes recur.

## Publish (14:21)

Publisher answer: title fixed, 3 subjects, 8 keywords, cover brief, no illustrations. `stage: published`, EPUB `C:\Users\Infplane\Scriptorium\books\fifty-minutes-of-common-sense\out\fifty-minutes-of-common-sense.epub` (dc:language en, dc:title "Fifty Minutes of Common Sense", 15 chapter files). Cover PNG pending (plain Node).

## Client tasks answered (all client/claude-code)

start_book 1, pitch 2 (one length repair), research_plan 1, outline 1, draft_chapter 15, humanize_chapter 15, review 6 (after re-pin), publish 1 = **42**. No tighten, rewrite, searcher or web_search tasks.

## Models and cost

- book.md: `cost_usd: 0`, `models: client/claude-code: 41` (successful jobs only).
- log.md `_model` lines: client/claude-code 41, acp/antigravity/gemini-3.8-flash 57 (all failed review attempts).
- budget.md spend summary: today 0.0000 of 0 USD at publish. No deepseek, no lmstudio chat model, no strata job for this book. (The month's summary also lists earlier runs: researcher/client-search/wikipedia/strata rows are not from this book.)

## Checker (director-checker, fresh context, read-only)

A4 PASS (outline 15 chapters in the brief's order). A5 PASS for all 15 chapters (beats present, morals shown not lectured, side-character rows present, POV/tense held). A9 PASS (no non-English text; dc:language en). Deviations noted: "Coventry" (ch04) and "Leicester" (ch01) are place names outside the brief; ch12 does not mention the lemon sponge as the wedding cake; ch04 has "I'm busy on Tuesday" by answerphone message; ch10 only implies the charts coming off the fridge; ch06 shows the hedge window by photograph; ch11 Gordon's "I'd not recommend it" is the nearest any story comes to stating its lesson.

## T4 (14:24)

- Engine pid 38576 (`node out/engine/index.js --mcp --data C:\Users\Infplane\Scriptorium --only fifty-minutes-of-common-sense`) stopped with Stop-Process; no engine process left; MCP port 7341 refused; dead `index/engine.lock` deleted.
- budget.md caps back to 40 / 20; config-revert.md ticked.
- factory.md unchanged (`paused: false`, no `only:`). `ideas/fifty-minutes-of-common-sense.md` is `status: used`; the data-folder formats.md entry stays.
- Left running: ACP Proxy.exe (pid 39660, started by T3; it was down at preflight) and the LM Studio server with only nomic loaded (started by T3; it was down at preflight).
- Nothing in `.claude/temp/req0007/` deleted.

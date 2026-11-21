---
status: done
request: REQ-0007
repos: [C:/projects/Personal/scriptorium]
branch: REQ-0007_linked-collection
updated: 2026-11-11
---
# REQ-0007: Psychologist sessions book (linked-collection format + run)

Build the full reading, not the narrow one. Add a reusable `linked-collection` format to Scriptorium, then run one book of 15 linked session stories through the real pipeline. Do not hand-assemble the book outside the engine.

## Scope

1. A new fiction format `linked-collection` in the seed and in the data folder, mapped in the Library type table, with the minimum test and the design-doc rows.
2. A story brief for the book (`ideas/<slug>.md` form). The user sees and approves it before the run.
3. One engine run: Claude Code (subagents) answers every writing-role client task, and ACP Gemini Flash does every reviewer and checker role. Nothing paid. Temporary config is recorded and then reverted.
4. Revert, stop, report.

## Out of scope

- Any prompt change (`seed/prompts/**`) or engine code change. The format works through `guidance` alone (see "Design choice" below). So `yarn seed:hashes` is **not** needed, because `scripts/seed-hashes.mjs` tracks only `seed/prompts` and `seed/templates`.
- Making long-format prompts (`review_outline`, `act_review`, `thread_check`, `check_chapter`) format-aware.
- A migration that adds the format to existing data folders. The data folder gets it by a hand edit, the same way science-blink and idea-blink were added.
- Covers, Kindle send, translation, a series file, the VN adaptation.
- Committing, merging or pushing without the user's go-ahead (per global CLAUDE.md).
- Fixing anything listed under Discoveries in the report.
- Strata. No role is pinned to it, so it is not started.

## Design choice: a short (not `long`) format, verified in code

`long: true` would work against a collection.
- `seed/prompts/architect/outline.md` tells long books "make sure tension rises across the whole book, the middle has a turn".
- `developmental-editor/review_outline.md` checks "a turn at the midpoint and rising tension", and it has **no** `{{guidance}}`.
- `developmental-editor/act_review.md` scores tension per chapter, also with no guidance. `longHandlers.ts:270-295` writes `reports/tension.md` with `flat_stretches`, and `advance.ts:chaptersToRewrite` adds flat chapters to the rewrite round with a "raise the stakes" note. Quiet comic sessions would be pushed toward more tension.
- `thread_check.md` and `check_chapter.md` have no guidance either.

In short mode (`long: false`), every prompt that judges the story carries `{{guidance}}`: outline, pitch, draft_chapter, rewrite_chapter, humanize_chapter, and the review prompts of all six default reviewers. I checked this with `grep -L "{{guidance}}" seed/prompts/*/*.md`. Short mode also has these properties:
- Drafting goes in order, one chapter at a time (`advance.ts` ~355-372).
- The writer gets the pitch, the outline, the light bible, the owner's brief and **every earlier chapter in full** (`handlers.ts:845-858`). That suits recurring side characters who change from story to story.
- The reviewers read the whole book (`d.books.fullText`). That is about 60k tokens for Gemini Flash, whose context is 1,000,000 in providers.md.
- The humanizer does one pass over all chapters before the reviews (`advance.ts:448`).
- There is one length gate (`advance.ts:394-410`). It fires when the total is outside `words` by 15%, or more than 20% (`TARGET_BAND`) away from `target_words`, which means outside 36,000-54,000 for a 45,000 target. It then rewrites **all** chapters.
- Nothing caps the chapter count of a short format. Only the format's `chapters` tuple limits the outline (`handlers.ts:731-753`).
- Per-chapter target: `perChapterTarget` = target_words / outline chapters = 3,000. A draft over 3,600 words (`TRIM_ABOVE = 1.2`) gets one tighten request (another client task). Short formats get no expand retry (`EXPAND_BELOW` applies to long books only).

## Files and modules to touch

| File | Change |
|---|---|
| `seed/config/formats.md` | New entry `linked-collection` right after `short-story`. Add one body bullet line explaining the format. |
| `C:/Users/Infplane/Scriptorium/config/formats.md` | The same entry, right after `short-story`. This is a permanent hand edit, not reverted, like science-blink and idea-blink. |
| `src/renderer/store/bookTypes.ts` | `'linked-collection': { group: 'stories' }` in `FORMATS`. Required: `tests/renderer/bookTypes.test.ts` "maps every seed format" fails on an unmapped id, because it falls through to `'other'`. |
| `tests/nonfiction.test.ts` | Extend the existing "seed files" test with one assertion (see T1). No new file. |
| `docs/design.md` | Decisions row "Linked collection format" after "Ideas explainer format" (line ~142). A sentence in "### Long books" (line ~654) saying linked-collection is deliberately not long. A History line at the bottom. |
| `.claude/tickets/REQ-0007-psychologist-sessions/story-brief.md` | T2 output (draft). |
| `C:/Users/Infplane/Scriptorium/ideas/<slug>.md` | T3: the approved brief, copied in. |
| `C:/Users/Infplane/Scriptorium/config/budget.md` | T3 temporary: caps 0. T4 revert. |
| `.claude/tickets/REQ-0007-psychologist-sessions/config-revert.md` | T3/T4 record. |
| `.claude/temp/req0007/` | Helper scripts, engine log, task dumps (temporary). |

## Tasks

### T1: add the `linked-collection` format (implementer, standard)

**Inputs:** this plan; `seed/config/formats.md` (`short-story`, `science-blink`, `idea-blink` entries); `src/renderer/store/bookTypes.ts`; `tests/nonfiction.test.ts:359-375`; `tests/renderer/bookTypes.test.ts`; `docs/design.md` rows at lines 141-142 and History at the bottom; the global `test-discipline` skill.

**Entry (exact keys; guidance wording may be polished, not changed in meaning):**

```yaml
  - id: linked-collection
    name: Linked story collection
    enabled: true
    kinds: [fiction]
    juvenile: false
    age_band: null
    words: [20000, 60000]
    chapters: [8, 16]
    max_rounds: 1
    read_aloud: false
    guidance: |
      A collection of linked short stories. Every chapter is one complete short story with its own beginning, middle and end,
      its own small problem, its own turn and its own quiet point or moral, so a reader can read any one of them alone. The
      stories are linked by a recurring main character and the people around them, who come back and change a little from
      story to story; a reader of the whole book sees those small changes add up, but there is no single plot and no single
      climax for the whole book. Judge structure, pacing and arc story by story: each story needs a clear shape and a
      satisfying ending of its own, and the recurring characters need to stay consistent and grow. Chapters of 2,500 to
      3,500 words. A point or moral lands through what the characters do and notice, never as a lecture or a summary at the end.
```

Do not add `long`, so the default `false` applies. Do not add `humanize`, so the default `true` applies; the brief decides per book. Do not add `research`, so the default applies; the architect may answer "no research".

**Body bullet** (after the `long` bullet in the seed formats.md body): "`linked-collection` is a short format on purpose: each chapter is a whole story, reviewed with the format guidance against the whole book, with no act reviews, tension scoring or thread check."

**Test (minimum, per test-discipline):** in `tests/nonfiction.test.ts` "the formats, the gate and the prompt variants are in the seed", add one line after the formats are parsed:
`expect(formats.find((f) => f.id === 'linked-collection')).toMatchObject({ kinds: ['fiction'], long: false, nonfiction: false, chapters: [8, 16], max_rounds: 1 })`.
That line covers the schema parse and the not-long contract. The bookTypes mapping is already covered by "maps every seed format". Add no other test.

**Docs:** Decisions row "Linked collection format" (2026-11-11, REQ-0007). It gives the shape above, explains why it is short (the long-only prompts have no guidance and score tension), says "no code or prompt change; `add_story {format: "linked-collection"}` or a brief's `format:` fixes it; the editor-in-chief can pick it for `fiction` topics", says the Library lists it under Novels & stories, and says an existing data folder gets it by hand. Add one sentence in "### Long books" and one History line.

**Commands (PowerShell):**
```
fnm env --use-on-cd | Out-String | Invoke-Expression
cd C:\projects\Personal\scriptorium
yarn vitest run tests/nonfiction.test.ts tests/renderer/bookTypes.test.ts
yarn test
yarn typecheck
```

**Contract:** all tests and the typecheck pass. The data-folder formats.md parses: start nothing; check it with `yarn vitest`-free node/py YAML, or by eye, keeping the same indentation as its neighbours. Only the files in the table are changed. Work on branch `REQ-0007_linked-collection` (cut from master; the user confirms the branch, since master is the default). Nothing is committed without the user's go-ahead.

### T2: story brief (director or writer subagent, deep; the user approves)

**Inputs:** REQ-0007 requirements; `docs/mcp.md` "The story brief file"; the example `C:/Users/Infplane/Scriptorium/ideas/the-tide-table.md` (frontmatter with `role_models`); `src/shared/schemas.ts:333` (`ideaSchema`).

**Output:** `.claude/tickets/REQ-0007-psychologist-sessions/story-brief.md`, exactly in the ideas-file form:

```yaml
---
kind: idea
title: <working title, user to confirm>
title_fixed: true
topic: fic-humorous-comic-novels      # kind fiction (C:/Users/Infplane/Scriptorium/topics.md:87)
format: linked-collection
genre: Comic fiction                   # avoid research_prep_genres words (medical, thriller, crime ...) in config/factory.md
status: open
source: user
role_models:
  editor-in-chief: client/claude-code
  idea-generator: client/claude-code
  architect: client/claude-code
  writer: client/claude-code
  humanizer: client/claude-code
  publisher: client/claude-code
  developmental-editor: acp/antigravity/gemini-3.8-flash
  line-editor: acp/antigravity/gemini-3.8-flash
  copy-editor: acp/antigravity/gemini-3.8-flash
  beta-reader: acp/antigravity/gemini-3.8-flash
  child-safety-reviewer: acp/antigravity/gemini-3.8-flash
  read-aloud-reviewer: acp/antigravity/gemini-3.8-flash
  continuity-checker: acp/antigravity/gemini-3.8-flash
  originality-checker: acp/antigravity/gemini-3.8-flash
  fact-checker: acp/antigravity/gemini-3.8-flash
  researcher: acp/antigravity/gemini-3.8-flash
  archivist: acp/antigravity/gemini-3.8-flash
---
```

This is the same pin set REQ-0004 used for `the-tide-table`, so the role pins are book `role_models` and **not** a `roles.md` edit. Body sections:
- `## Premise`: the book in one paragraph. One psychologist, five patients, three sessions each, common sense as the thread, warm comedy.
- `## Plot`: a numbered list of all 15 sessions in interleaved order (1-5 first visits, 6-10 second, 11-15 third). For each: patient, the session's problem, what happens, the moral (one line, landed gently), and which side character appears and how they have changed.
- `## Characters`: one `### Name` each, with a `Role:` line plus looks, age and voice, for the psychologist, the 5 patients and 3-4 side characters. Every name is fixed here. The humanizer refuses rewrites that introduce new names.
- `## Setting`, `## Style` (close third person on the psychologist, past tense, warm and funny, about 3,000 words per story, each story readable alone, English only, no lecture endings).
- `## Side characters across the book`: an extra heading, passed to the agents as it is. It says how each recurring character changes, story by story.

**Proposal for the user to react to (T2 refines it; nothing here is settled):**
- Psychologist: Dr Ruth Penhallow, 58, practice above a bakery in a small English market town. Tea, a stubborn fern, and common sense.
- Side characters: Alan, her husband, a retired geography teacher building a canal boat in the back garden that "will never float" (it is launched in story 15). Jess, their adult daughter, who moves back home in story 3 and into her own flat by story 14. Edna, Ruth's 84-year-old mother in a care home, who gives the blunt version of Ruth's advice. Mr Okafor, the baker downstairs, whose ovens set the rhythm of the office.
- Patients (sessions 1 / 2 / 3, with a moral each):
  - Gordon Pike, 61. A hedge feud with his neighbour. Morals: you can't win a fight you won't let end / ask what the other side wants / being right is lonely.
  - Priya Nair, 34. Can't decide anything without a spreadsheet, and now has a wedding to plan. Morals: not every choice needs a column / good enough is a decision / you can't schedule a feeling.
  - Kevin Bright, 45. Apologises to everyone, furniture included. Morals: sorry is not a tax / no can be kind / let a thank-you land.
  - Marjorie Lyle, 72. Pretends to be busy so her grown children stop "helping", and takes tango in secret. Morals: you may have a life your children don't manage / secrets cost more than the truth / let them be proud of you.
  - Owen Price, 39. Has read every self-help book and diagnoses everyone. Morals: knowing is not doing / people are not projects / sit with not knowing.
- Working title: "Fifty Minutes of Common Sense", slug `fifty-minutes-of-common-sense`.

**Contract:** the file parses as an idea (frontmatter as above). The 15 sessions appear in interleaved order. Each patient has 3 sessions, each with its own moral. Each side character has a stated change. The user approves the brief, or edits it, before T3 copies it.

### T3: the run (general-purpose, deep opus; writer subagents)

**Preflight (read-only first):**
1. `Get-Process -Id 16920`. `C:/Users/Infplane/Scriptorium/index/engine.lock` holds that dead pid from REQ-0004. A lock whose process is gone is replaced at start (docs/mcp.md Troubleshooting). Delete it only if the engine refuses and no Scriptorium engine process runs.
2. ACP proxy on 8787. `curl http://127.0.0.1:8787/healthz`. If it is down, start `C:/projects/Personal/api-acp-proxy/release/win-unpacked/ACP Proxy.exe` (as REQ-0006 B2 did). Then check that `GET /v1/models` lists `antigravity/gemini-3.8-flash` and that a one-line test chat answers. The acp provider in `config/providers.md` has `base_url: http://127.0.0.1:8787/v1`, `concurrency: 4`, and Gemini `context: 1000000`.
3. LM Studio: server on :1234 with only `text-embedding-nomic-embed-text-v1.5` loaded (`~\.lmstudio\bin\lms.exe ps` / `lms server start` / `lms load text-embedding-nomic-embed-text-v1.5`). Embeddings are `roles.md: embeddings: lmstudio/text-embedding-nomic-embed-text-v1.5`, used by the pitch similarity check and the notes index.
4. Strata: **not needed**. No role is pinned to it. If it is down, it is skipped as down (expected log warning). Do not start it.
5. Confirm the T1 entry is in `C:/Users/Infplane/Scriptorium/config/formats.md`. Otherwise start_book logs "asks for the format ... which is not enabled: the editor chooses".

**Temporary config (record each change in `config-revert.md` *before* making it, in the REQ-0004 layout: file, why, before, after, undo):**
- `C:/Users/Infplane/Scriptorium/config/budget.md` frontmatter: `monthly_cap_usd: 40 -> 0`, `daily_cap_usd: 20 -> 0`. A cap of 0 refuses every paid request (`src/engine/budget/spend.ts` check; REQ-0002 config-revert.md). It also keeps paid search (`tavily`, `price_per_request: 0.008`) out, so searches go to `client-search` (Claude).
- No `roles.md` edit. The pins are the brief's `role_models`, copied to `book.md` by start_book (`handlers.ts:579`).
- No `factory.md` edit. The engine is started with `--only <slug>` (`src/engine/index.ts:87-93`), which wins over the file and refuses to start if `ideas/<slug>.md` is missing. Because the brief is written as a file before the engine starts, there is no need to pause the factory (unlike REQ-0004, which used add_story while running).

**Start (PowerShell, background, output to `.claude/temp/req0007/engine.out`):**
```
fnm env --use-on-cd | Out-String | Invoke-Expression
cd C:\projects\Personal\scriptorium
Copy-Item .claude\tickets\REQ-0007-psychologist-sessions\story-brief.md C:\Users\Infplane\Scriptorium\ideas\<slug>.md
yarn headless --data C:\Users\Infplane\Scriptorium --only <slug>
```
`yarn headless` = `yarn build:engine && node out/engine/index.js --mcp`. MCP is at `http://127.0.0.1:7341/mcp`. Check the log for `single-idea run: only "<slug>"`. Record the engine pid from `index/engine.lock`.

**MCP access:** this Claude Code has **no** `scriptorium` MCP server registered (checked: no entry in `~/.claude.json` for the project or globally). So the run uses a small Python HTTP helper in `.claude/temp/req0007/mcp.py`, modelled on `.claude/temp/req0006/mcp.py` (initialize, then `tools/call`, parsing an SSE `data:` line). Point it at port 7341. Read a bearer token only from the env var `SCRIPTORIUM_MCP_TOKEN` if it is set, and never write it to a file (the req0006 helper hard-codes a Book Translator token; do not copy that). UNVERIFIED: whether a token is set. A first call that gets 401 means the user must provide the env var.

The helper also avoids MCP output-size limits. In short mode a story-15 draft task carries 14 full stories, about 42k words or 55-60k tokens. `fetch.py` saves each `get_client_task` answer to `.claude/temp/req0007/tasks/<unit>.<task>.json`, and `sub.py <taskId> <answer-file>` submits.

**Tools used (verified in `src/engine/mcp/tools.ts` and docs/mcp.md):**
- `factory_status`
- `list_client_tasks {client?}`
- `get_client_task {client?, role?, book?, task?}`, which returns `{taskId, meta, system, user, schema?, output, leaseMinutes}` or `{none: true}`, with a 30-minute lease
- `submit_client_task {taskId, text}`; `{accepted: false, problems}` means fix and resubmit, which costs nothing
- `release_client_task {taskId}` (taskId only)
- `wait_for_book {slug, timeout_seconds?, stop_on_client_task?}`
- `get_book {book}`
- `read_book_file {book, file, chapter?}`
- `set_book_model {book, role, model|null}`, kept as a fix if a job runs off its pin

**Expected client tasks (writing roles, about 40-60):**
- `start_book`: answer `{"format":"linked-collection","title":"<fixed>","genre":"Comic fiction","target_words":45000,"notes":""}`
- pitch
- `research_plan`: answer `{"needs_research": false, "questions": []}` unless the user wants facts checked
- outline: 15 chapters in the brief's order, each summary naming patient, problem, moral and side-character beat; characters exactly as the brief names them
- 15 `draft_chapter` tasks, in order
- possible tighten tasks
- 15 `humanize_chapter` tasks
- rewrites named by reviewers (round 1 only, `max_rounds: 1`) plus their humanize passes
- publisher: 4-8 keywords; REQ-0004 found it accepted 11
- possible `web_search` (searcher) tasks from reviewers' `research_questions`

**Writer subagent loop:** one parent loop owns `fetch.py`/`sub.py`.
- Drafts run in order (short mode), so take one draft at a time.
- Hand each draft task to a writer subagent (opus) with: the task JSON path, "write only the chapter prose, about 3,000 words (stay in 2,700-3,400), no heading, the story stands alone with its own moral landed through action, keep every name from the brief, side characters as the brief's change table says, English only".
- Use a fresh subagent every 3-5 stories so each one reads the earlier chapters from the task file itself, not from a long-filled context. Keep a running `.claude/temp/req0007/continuity.md` (what each side character did or changed per story) that the parent updates after each accepted chapter and passes to the next writer.
- Humanize tasks: light edits only. Do **not** add a name or a group noun that is not already in the chapter (the humanizer guards refuse it and silently keep the old text; REQ-0004 ch-01).
- Structured tasks (schema present): one JSON object only.
- Between tasks: `wait_for_book {slug, timeout_seconds: 60}`. If the body is empty (known empty-SSE answer, REQ-0004), fall back to `list_client_tasks` plus `get_book`, polling every minute. Never treat an empty answer as done.

**What to watch:**
- `factory_status.blocked` and `providers[].down`. If acp shows down, check the proxy.
- `get_book` `stage`, `chaptersWritten`, `words`, `lengthGate`.
- `books/<slug>/log.md` for `humanized`/refused lines and for any model other than `client/claude-code` or `acp/antigravity/gemini-3.8-flash`. The `fallback_shared: true` order in `settings.md` is deepseek, strata/default, lmstudio/gemma. Deepseek is blocked by the 0 caps and Strata is down, but **LM Studio may JIT-load gemma** if Gemini fails (UNVERIFIED). If any job runs on lmstudio, stop it and `set_book_model` again or fix the proxy.
- `book.md` `models:` counts and `cost_usd: 0`.
- `budget.md` spend summary stays 0.0000.
- Reviews `books/<slug>/reviews/book-*-r0.md`: verdicts, and whether the developmental editor or beta reader penalises "no overall climax". If one does, note it in the run log. A revise round on that ground is acceptable once; do not hand-edit around it.

**Output:** a published book (`stage: published`) with `out/<slug>.epub`; `.claude/tickets/REQ-0007-psychologist-sessions/run-log.md` (preflight, pids, task counts, review scores, anything off the pins); `discoveries.md` for defects found.

### T4: revert and stop (same worker as T3)

1. Stop the engine first, so nothing runs uncapped. Stop the background shell, or `Stop-Process` the pid from `index/engine.lock` after checking that its command line is `out/engine/index.js`. Then confirm with `Get-Process`. If the lock is left with a dead pid, delete it (REQ-0006 discovery: killing node leaves the lock).
2. `budget.md`: caps back to 40 / 20. Tick each item in `config-revert.md` with the date.
3. Leave as found: ACP proxy (if it was already running; if T3 started it, say so in the report and leave it running unless the user says otherwise), LM Studio with nomic.
4. Leave `ideas/<slug>.md` (now `status: used`) and the data-folder formats.md entry. Both are intended to stay.
5. Delete nothing in `.claude/temp/req0007/` until the user has seen the report.

## Acceptance criteria and checks

| # | Criterion | Check |
|---|---|---|
| A1 | The format exists in seed and data folder, and the Library maps it | `yarn test` and `yarn typecheck` pass. `grep -n "id: linked-collection" seed/config/formats.md C:/Users/Infplane/Scriptorium/config/formats.md`. Engine log has no "not enabled: the editor chooses" line for the story. |
| A2 | The book is published | `get_book {book}` → `stage: published`. `paths.epub` exists (`Test-Path`). |
| A3 | 15 chapters, each about 3,000 words, total about 45,000 | `books/<slug>/outline.md` has 15 chapters. `chapters/ch-01.md`…`ch-15.md` exist. A word count script shows each chapter in 2,500-3,600 and the total in 40,000-50,000 (the length gate's own band is 36,000-54,000). |
| A4 | Interleaved order, 5 patients × 3 | The outline titles and summaries match the brief's table: chapters 1-5 are the first visits of patients A-E, 6-10 the second, 11-15 the third. A director-checker reads the outline against the brief. |
| A5 | Each story is self-contained with a gentle moral; side characters recur and change | A director-checker (fresh context) reads each chapter: its own problem, turn and ending; the moral shown, not lectured; side-character beats match the brief's change table. PASS/FAIL per chapter. |
| A6 | Reviews by ACP, writing by Claude, $0 | `book.md`: `cost_usd: 0`, and `models:` lists only `client/claude-code` and `acp/antigravity/gemini-3.8-flash`. Every `reviews/*.md` frontmatter `model` is `acp/antigravity/gemini-3.8-flash`. The budget.md spend summary for the day is 0.0000. |
| A7 | Temporary config reverted | `budget.md` caps are 40/20. `factory.md` has no `only:` line and `paused: false` (unchanged). `config-revert.md` has every item ticked. |
| A8 | Engine stopped | No `node out/engine/index.js` process for this data folder. `index/engine.lock` is gone, or holds a dead pid that the next start replaces. |
| A9 | English only | The checker in A5 confirms it. EPUB `dc:language` is `en`. |

The cover PNG stays `pending` under plain Node (docs/mcp.md) and is drawn at the next app start. That is not a failure.

## Risks from earlier runs and handling

| Risk | Source | Handling |
|---|---|---|
| Humanizer refuses a rewrite (new names, group nouns, fragment check) and silently keeps the old text | REQ-0004 ch-01; SCP-55/56/57 | The Claude humanizer adds no new names or group nouns and keeps sentences whole. A refused pass is acceptable (the draft stands). Log it; never hand-edit a chapter without the user's OK. |
| Stale `engine.lock` (pid 16920 now) | REQ-0004, REQ-0006 | Preflight check; the engine replaces a dead lock. T4 removes the lock if the kill leaves it. |
| `wait_for_book` returns an empty SSE body | REQ-0004 | Short timeouts, then fall back to `list_client_tasks` + `get_book`. |
| ACP proxy down or answering 400 for sampling params | REQ-0002 (AAP-28), REQ-0006 B2 | Preflight `/healthz` + test chat. AAP-28 drops sampling params (`x-acp-proxy-ignored-params`). A 400 provider is not marked down (REQ-0002 discovery), so watch for runaway retries. |
| A job falls back off its pin (LM Studio gemma JIT) | settings.md `fallback_shared: true` | Watch `book.md models:` and `log.md`. Re-pin with `set_book_model`. Fix the proxy rather than waiting. |
| Reviewers penalise "no single climax" | developmental-editor/review.md asks for "beginning, middle and end ... character arc" | The format guidance in every review prompt says to judge story by story. With `max_rounds: 1`, at most one rewrite round. Record whether it happened, as evidence for a prompt tweak later (Extra ideas). |
| Very large draft prompts (up to about 60k tokens) | short mode puts all earlier chapters in full (`handlers.ts:845-858`) | File-based helper. Fresh writer subagents every 3-5 stories. continuity.md. |
| Length gate rewrites all 15 chapters if the total misses 36k-54k | `advance.ts:394-410` | Writers stay at 2,700-3,400 per story. The parent sums words after each chapter and corrects course on the next one. |
| A chapter over 3,600 words triggers an extra tighten task | `TRIM_ABOVE = 1.2` | Same discipline. Answer the tighten task if it comes. |
| Searcher tasks multiply when a reviewer asks research questions | REQ-0002 (27 search tasks) | Answer them with real pages or an empty list. Never invent URLs. |
| `release_client_task {}` empty call refused | REQ-0006 (Book Translator; Scriptorium takes `taskId` only) | Always pass `taskId`. |
| Engine restart drops in-memory tasks | docs/mcp.md "Stopping and restarting" | Keep the answer files. After a restart, fetch again and resubmit the saved text if the task matches. |
| Publisher picks too many keywords | REQ-0004 | Answer 4-8. |

## Open questions for the user

1. Approve the T2 brief, title and cast, or replace them. The proposal above is a starting point only.
2. Should the humanizer run? It is on by default and adds 15+ Claude tasks; `humanize: false` in the brief skips it.
3. Should the editor-in-chief be allowed to pick `linked-collection` for ordinary fiction ideas (`kinds: [fiction]`, the plan's default), or only when a story fixes it?
4. Branch `REQ-0007_linked-collection` from master for T1? Commit after T1, or at the end?
5. Research: answer the architect's research plan with "no research" (the plan's default)?

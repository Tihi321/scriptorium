# SCP-55 research: fixes from the science-blink run (REQ-0003)

Evidence: `C:\Users\Infplane\Scriptorium\books\the-one-way-street-why-time-only-runs\` (log.md, chapters/, chapters/history/, research/, factbase/, reviews/), `C:\Users\Infplane\Scriptorium\jobs\failed\`, and the engine log of that run (`...\bb6d6a8203480c6e\...\scratchpad\engine.log`, 3409 lines). Scratch scripts used to reproduce item 1: `.claude/temp/scp55/frag.ts` (runs the real `fragmentShare`/`humanizeProblem` on the real texts) and `.claude/temp/scp55/frag2.ts` (prototype of the fix). Run them with `fnm exec --using default node node_modules/tsx/dist/cli.mjs .claude/temp/scp55/frag.ts 5`.

## 1. Humanizer fragment check misfires (BUG)

**Root cause.** `hasVerbCue` (`src/engine/pipeline/humanizerHandlers.ts:149-154`) only knows auxiliaries, a short list of irregular past tenses, `-ed` words, a pronoun followed by a word, and a capitalised name followed by an `-s` word. It does not know (a) contractions: `That's`, `Here's`, `don't`, `shouldn't`, `you'll` (the `'s` / `n't` forms are not in `AUXILIARIES`, and `it's` fails the pronoun rule because no space follows `it`); (b) present-tense verbs after a lowercase noun subject: "A ring of ripples spreads", "The cone keeps", "the weak energy condition, rules out". A science explainer is written in the present tense and the humanizer adds contractions, so the rewrite looks "more fragmented" although it has whole sentences. `fragmentShare` (`:160-182`) then refuses it at `:237`.

**Verified on the real texts** (original = `chapters/history/ch-0N-r0.md`, revised = the `### Output` of the `humanize--ch0N--r0` section of log.md). The current code gives exactly the logged numbers:

| ch | before | after | current result |
|---|---|---|---|
| 01 | 15% | 28% | refused |
| 02 | 15% | 26% | refused |
| 03 | 13% | 12% | accepted |
| 04 | 4% | 19% | refused |
| 05 | 21% | 33% | refused |
| 06 | 19% | 21% | accepted |
| 07 | 4% | 8% | accepted |
| 08 | 14% | 32% | refused |
| 09 | 13% | 13% | accepted |

ch05 "fragments" after the rewrite include "A ring of ripples spreads out from the splash.", "The cone keeps that order intact.", "That's the heart of it.", "The answer comes as a famous set of puzzles." (all whole sentences). ch08: "That's the price of a ticket to the past, and nobody knows how to pay it.", "Energy, like the balance in a bank account, shouldn't dip below zero." ch04: "Look closely at ... most of them don't care which way time runs [13].", "Shuffle at random and you'll almost always land on a jumble."

**Prototype fix** (`frag2.ts`): add two verb cues, (a) a contraction (`n't`, `'re`, `'ve`, `'ll`, `'m`, `'d`, straight or curly apostrophe, anywhere; `'s` only after that/here/there/what/it/he/she/who/where/let/everything/nothing/something), (b) a determiner (the/a/an/its/this/that/these/those/each/every/his/her/their/our/your/my/one/no/any/some, any case) followed by up to two lowercase words and then a lowercase word ending in `-s` (not `-ss`, `-us`, `-is`). Result: all nine chapters pass (ch05 11% to 19%, ch08 14% to 14%, ch04 4% to 7%), and the existing test texts keep their verdicts (ORIGINAL 0%, FRAGMENTED 86%). Remaining misses are real imperatives ("Drop an egg on the kitchen floor.") and short lines, which count the same before and after.

**ch06 and ch09: not a bug.** Both were humanized and accepted. `humanized: 0` is the book round the pass ran in (`ctx.job.round`, `humanizerHandlers.ts:319`), not a "not humanized" flag; the accepted chapters carry `model: client/claude-code` (`:317`, set only when the version is accepted): ch03, ch06, ch07, ch09 have it, ch01/02/04/05/08 do not. There is no log line because the handler logs only a refusal (`:306`); the job result string ("chapter 6 humanized: ...") goes to the job file, not log.md. A one-line success log is a cheap clarity fix.

Count correction: 5 of 9 were kept (1, 2, 4, 5, 8), 4 accepted (3, 6, 7, 9).

## 2. HTTP 400 never sets the provider aside (BUG, needs a decision)

**What happened.** The acp proxy (standalone at 8787, an older build) answered every request `HTTP 400 ... Parameter 'temperature' is not supported by this proxy ... unsupported_parameter`. 32 such 400s in the engine log.

**Code path.**
- `src/engine/models/types.ts:117-125`: 400 is not retryable. Correct.
- `src/engine/models/router.ts:245-250`: a non-retryable error goes straight to the next model (`deepseek/deepseek-flash`), which the budget skipped (daily cap 0). The router throws `all models failed ...` (`:259-261`).
- The router remembers some permanent failures for every later job: `retired` (404 model gone, `:228-236`, `candidates()` drops it at `:125-127`), day-full 429 (`:222-227`), unreachable `concurrency: auto` servers (`:220-225`). **A 400/422 is remembered nowhere**, so every new job and every retry asks the same model again and gets the same 400.
- `src/engine/pipeline/llm.ts:84-89`: `chatJson` asks again without the JSON schema after any error, so each attempt hit the 400 twice (engine.log lines 150 and 152 are one attempt). This retry is there on purpose (some servers reject `response_format` with a 400), so the fix must not mark a model aside on a 400 to a request that carried a schema.
- `src/engine/queue/scheduler.ts:672-686`: the job counts the attempt and is requeued with 2 s / 4 s backoff, then fails for good at `max_attempts` (3, `seed/config/factory.md:10`). **Retries are capped, not unlimited**: each research job ran 3 attempts (book log lines 66-244).
- Searcher flood: the research handler searches before its first model call (`src/engine/pipeline/researchHandlers.ts:143-147`, `gatherPages` at `:172-173`), and `ClientSearchProvider.search` (`src/engine/research/clientSearch.ts:100-106`) queues a new `searcher`/`web_search` client task each time. So every attempt of every research job queued a new search for the same query before failing on the model (engine.log: a `client-search` spend at lines 149, 172, 196, ... right before each 400).

**Proposed handling** (needs a Decisions row):
- A **refused request**: a 4xx other than 401/402/403/404/408/409/425/429, not a context error (`isContextError`) and not a retired-model error, **to a request without a schema**. The router sets that model aside for 10 minutes (`refused: Map<ref, {until, message}>`), says so once (`onModelRefused`: log + `engine.warning` with the provider's text), and `candidates()` / `chat()` skip it while another model is left, exactly like `retired`. After 10 minutes it is tried again (a fixed or restarted proxy comes back with no restart of the engine).
- Fail over: already happens (`router.ts:245`). With the model set aside, the scheduler gate (`scheduler.ts:338-366`) picks the next model before the job starts; when the only other model is over budget the job waits in the queue without starting (no attempt, no search), until the 10 minutes are over.
- Cap: keep `max_attempts`; no new cap.
- Searches: `SearchService.search` (`src/engine/research/service.ts:68`) keeps the last successful outcome per `(query, news, days)` for 30 minutes in memory, so a retried research job reuses its results instead of queueing a new searcher task.

## 3. The fact checker sees fewer notes than the writer (BUG)

**Root cause.** Both use `numberedNotes` (`src/engine/pipeline/nfcontext.ts:92-94`), which calls `formatNote(n, maxChars)` (`src/engine/research/notes.ts:175-183`) **before** `numberedNoteText` replaces each `(source: URL, date)` with `[n]`. The cut is made on the raw text, whose long source suffixes use up most of the room, and the fact checker uses a smaller cap than the writer:
- writer: `numberedNotes(notes, sources)` with the default 1800 (`nfcontext.ts:131`);
- fact checker: `numberedNotes(notes, sources, 1500)` (`src/engine/pipeline/nonfiction.ts:224`), then the whole text is cut at `min(30000, roomChars)` (`:228`).

Measured on the real notes (`books/.../research/`):
- `what-results-did-hafele-and-keating-get-flying-atomic-cl.md`: the fact "published in the journal Science, volume 177, on July 14, 1972 [11]" starts at char 1507 of the raw facts (1860 long). Writer (1800): kept. Fact checker (1500): cut. So the checker flagged "Science 1972 [11]" as unsourced although the note has it. This is the asymmetry.
- `what-is-hawking-s-chronology-protection-conjecture-about.md`: "The majority of physicists consider closed timelike curves ... artificial constructs [2]" starts at char 1748 (1972 long). Cut for **both** (the writer's 1800 cut drops the partial line). The writer got the claim from the outline ("most physicists see these solutions as artificial", `outline.md:25`) and cited [2], which is right: the note says it. The checker never saw that line. Same root cause (cutting the raw text), not only the 1500/1800 difference.

With numbering first, both notes are about 1300 to 1400 chars and fit whole at 1800. The fact checker also sorts verified-newest first (`nonfiction.ts:187`); a book with 23 notes can still run past the 30000-char total, so the notes whose sources the book cites should come first.

## 4. The story's topic is lost in a single-idea run (BUG)

**Root cause.** In a single-idea (`--only`) run, `start_book` passes an empty topic list to `pickNext`: `pickNext(..., only ? [] : await d.topics.read(), ...)` (`src/engine/pipeline/handlers.ts:447`), and so does the start gate (`src/engine/pipeline/pipeline.ts:535`). `pickNext` looks the story's topic up in that list (`handlers.ts:154`, `:158`), finds nothing, and returns `topic: undefined`. The prompt then says `no topic given` (`:489`) and the book gets `topic: null`, `topic_name: null` (`:526-527`). The topic exists: `topics.md:303` has `sci-physics` (inactive, which does not matter for an owner's story, `:157-159`). The empty list came in with SCP-48 (`edb4bcc`) so that a single-idea run never falls back to starting a fresh book from a topic (`:165-167`). The engine log shows the run was `--only` (line 5).

Side effect: `topics.adjust(... inProgress)` (`:553`) was skipped too, so the topic counts did not move.

**Fix.** Pass the real topics and add a `pickNext` option that turns off the fresh-topic fallback (`freshTopics: false` when `only`).

## 5. Jobs that failed during the outage were never retried (BUG, needs a decision)

**What happens to a failed job.** `scheduler.ts:678-680` moves it to `jobs/failed/` with `failure:`. Nothing moves it back except `retry_book` (`JobStore.retry`, `src/engine/queue/jobs.ts:142-149`, used by the MCP tool at `src/engine/mcp/tools.ts:851` for a failed book). A failed research job never fails its book (`pipeline.ts:395-397`), and asking the same question again returns `exists` because the id is the same and failed/ counts (`src/engine/research/service.ts:182-184`). There is no "provider recovered" event for a non-`concurrency: auto` provider such as acp: only `syncSlots` (`src/engine/engine.ts:244-272`) notices servers coming back, and `markDown` is limited to auto servers (`src/engine/models/registry.ts:537-542`).

Evidence: `jobs/failed/research--...--35861582a1--r0.md`, `73e7ca857f`, `bcf03d01b2` (attempts 3, failure "all models failed. acp/...: HTTP 400" or "ECONNREFUSED"). `b0d5ebd11c` failed one attempt and then succeeded because its retry came after the proxy was back. In this run the loss was small: the writer's prep later asked near-identical questions (`how-do-cosmic-ray-muons-...`, `what-results-did-hafele-...`, `how-many-microseconds-per-day-gps-...`), but nothing guaranteed that.

**Smallest sound behaviour.** When a job reaches `max_attempts` and the last error is a `ProviderError` (every model failed for provider reasons, not a handler error and not "no facts found", which completes), it is revived once: requeued with `attempts: 0`, `revived: 1` and `not_before` 10 minutes later, with the log line "Failed N times because no model answered: one more try in 10 minutes". A job with `revived: 1` fails for good as today. This covers every task, not only research, needs no provider-up signal, and keeps the existing "late research" path (`refresh_facts`, `nonfiction.ts:134-163`) to fold the late note into the fact base.

## 6. `changed: config change config/budget.md` on every request (BUG)

**Root cause.** Every recorded request (`Budget.record`, `src/engine/budget/spend.ts:258-280`, including the zero-cost `client-search` spend) calls `scheduleSummary()` (`:279`), which 2 s later rewrites the spend summary below the marker of `config/budget.md` (`writeSummary`, `:341-356`, `atomicWrite`). The watcher watches all of `config/` and ignores only temporary files (`src/engine/store/watcher.ts:49-61`), so the rename is a `change`. `src/engine/index.ts:99-102` logs it and calls `Engine.handleWatch`, which reloads the caps (`src/engine/engine.ts:765`) and kicks the scheduler and the pipeline (`:780-781`). 129 such lines in the engine log. No other engine write lands in `config/` on a timer; the Models panel and settings writes are owner intent and should keep reloading.

**Fix.** `Budget` remembers the text it last wrote; `Engine.isOwnWrite(e)` returns true when `e.rel` is `config/budget.md` and the file's text equals that; `index.ts` skips both the log line and `handleWatch` for an own write. A hand edit of the caps still reloads.

## 7. The acp seed port (NOT a bug: dropped, decision flagged)

- The proxy's own default is 8787 (`api-acp-proxy/src/settings.ts:43`, README "The default address is `http://127.0.0.1:8787`", `PROXY_PORT` default 8787). It always was; the AAP-28 change made the proxy drop `temperature` instead of answering 400.
- The creative-hub runs the proxy on **7461** (`creative-hub/services.json:172-186`: `port: 7461`, `PROXY_PORT: "7461"`), and its note names 7461 as the `acp` base URL for all five apps. Book Translator's seed uses 7461 too (`book-translator/seed/config/providers.md:139`). The note's reason ("not its default 8787 (flow-mcp's panel)") is stale: flow-mcp was retired on 2026-10-22 (`services.json:200`). The hub env also still sets `PROXY_IGNORE_SAMPLING`, which the proxy no longer reads (README "Sampling parameters").
- During the run the proxy ran standalone from its desktop app (`%APPDATA%\api-acp-proxy\settings.json` has `port: 8787`), an older build that still refused `temperature`; the live data folder was hand-edited to 8787 (`config/providers.md:11`).

**Recommendation:** keep `http://127.0.0.1:7461/v1` in the seed. The seed follows the hub, which is how the proxy is meant to run for every app, and the sibling apps use the same port. Moving to 8787 is a cross-repo decision (hub `services.json` and every app's seed together), not a Scriptorium bug. Whatever the user picks, the live data folder should point at the port the proxy is running on.

If the user chooses 8787 instead: change `seed/config/providers.md:141,255`, the SCP-44 migration's entry and message (`src/engine/store/migrations.ts:390,398,427`), the Models panel placeholder (`src/renderer/ui/ModelsDialog.tsx:346`) and the tests (`tests/migrations.test.ts:267,280,311`, `tests/customProviders.test.ts:64,120`, `tests/renderer/office.spec.ts:369-378`), plus a new migration that rewrites the `acp` entry's `base_url` only when it still is exactly `http://127.0.0.1:7461/v1`. The live folder needs nothing (it already says 8787).

## No seed prompt or template changes

None of the fixes touches `seed/prompts` or `seed/templates`, so `yarn seed:hashes` is not needed. If an implementer ends up changing one, run it.

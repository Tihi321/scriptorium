# Plan: Scriptorium MVP (milestone 1, text only)

Ticket: `SCP-02` (next after `SCP-01: init`). Ticket folder: `.claude/tickets/SCP-02-scriptorium-mvp-milestone-1-text-only/` (the design-session handoff is in `.claude/tickets/scriptorium-mvp/handoff.md`). Branch for the `implement` skill: `SCP-02_mvp-text-only`, cut from `master`.

**Implementation:** branch `SCP-02_mvp-text-only` (from `origin/master` db376ec), started 2026-10-08. Environment at start: Node v24.14.0 via fnm, LM Studio server up at `localhost:1234`, no `DEEPSEEK_API_KEY`, no Java (no epubcheck).

## Progress

- [x] Phase 0: Scaffold and foundations
  - Verified 2026-10-08: `npm install` ok; `npm run typecheck`, `npm run lint`, `npm test` (3 files, 15 tests: md round-trip incl. CRLF/BOM, zod error, atomic write, init/no-overwrite, resolution order, watcher) and `npm run build` all pass.
  - `npm run engine -- --data <repo>\.claude\temp\p0-data --once` created all 14 folders and copied 8 seed files; a second run copied 0 and kept 8. Without `--once` the engine keeps running with a heartbeat on stdout (checked with a 0.5 s interval).
  - `npm run dev` (window not visible to the agent): main log showed engine started as utilityProcess, `engine.ready`, `pong` for both the startup ping and the renderer's ping (so the renderer loaded and its preload `send` works), a `snapshot`, and heartbeats #0 to #7 relayed every 3 s. Not directly observed: the heartbeat text rendering in the window.
  - Spike passed in plain Node 24.14.0 and in Electron 44.7.0 utilityProcess (Node 24.21.0): see `spike-sqlite.md`. No better-sqlite3 fallback needed.
  - Deviations and choices: typescript pinned to 5.9 (typescript-eslint peers `<6.1`; 7.x is out); vite 7 (electron-vite 5 supports up to 7); chokidar 4. Engine is built by its own `vite.engine.config.ts` (ssr, CJS, deps external) and `npm run engine` builds then runs `node out/engine/index.js`, so it needs `node_modules` next to the repo. Atomic write and file IO live in `src/engine/store/atomic.ts` (not `shared/md.ts`) to keep `shared/` free of `fs` so the renderer can import it. Added `.gitattributes` (LF for `seed/**` and `*.md`), a `pong`/`snapshot`/`engine.ready` event beyond the listed ones, and a `kind:` field in every config file's frontmatter. Electron's binary wasn't downloaded by `npm install` here; fixed with `node node_modules/electron/install.js` (noted in README). Dropped the empty `seed/templates/` (git can't hold empty dirs; code creates it).
  - Phase 1 notes: `config/*.md` seeds are placeholders with `kind` + `placeholder: true`; replace the schemas in `src/shared/schemas.ts` as fields are defined. Renderer bundle is 643 kB, worth a look when Phaser is added. `src/engine/store/dataFolder.ts` `findSeedDir` walks up from `__dirname`, so packaging (Phase 10) must set `SCRIPTORIUM_SEED` or ship `seed/` beside the engine.
- [x] Phase 1: Model layer and budget
  - Gate run 2026-10-08: `npm run typecheck`, `npm run lint`, `npm test` (7 files, 57 tests, run twice, same result) and `npm run build` pass.
  - Unit tests (`tests/models.test.ts`, `tests/budget.test.ts`): price math incl. cached tokens, cap refusal (daily, monthly, book) and reservations, fallback order (retry then next model), family avoid, candidate ordering, local-time day/month boundaries, spend rows rebuilt into the same totals, summary written below the marker without touching the frontmatter or text above it (re-read before write), warn once at 80%, local cost 0 never hits caps, provider concurrency, mock provider scripting and abort, seed `providers.md`/`roles.md` load and every role model resolves.
  - HTTP clients tested against local fake servers (OpenAI-compatible SSE with usage and cached tokens, 429 retry-after, embeddings prefixes, model list, Anthropic, Gemini). Only the OpenAI-compatible path was run against a real server.
  - Real run: `npm run engine -- probe --data .claude\temp\p1-data` streamed a reply from `lmstudio/nvidia/nemotron-3-nano-4b` (25 in / 29 out tokens, 3.8 s, cost 0), discovered 9 LM Studio models, embedded one string with nomic (dimension 768), and wrote a spend row that showed up in the `config/budget.md` summary.
  - DeepSeek: no key on this machine, so the probe printed "skipped: no key (set DEEPSEEK_API_KEY or run: npm run key:set DEEPSEEK_API_KEY)". **Unverified:** a real DeepSeek request, its usage/cached-token fields, the real price numbers, and `extra_body` for thinking (left empty and documented). Anthropic, Gemini and OpenRouter clients are also unverified against the real services.
  - Credential store: a unit test stores, reads and deletes a key under a throwaway service/account through `@napi-rs/keyring` (passes on this machine). The hidden prompt itself can't be typed into here; `key-set` was smoke-tested with a piped value (non-TTY path) under a throwaway name, read back and deleted. The TTY raw-mode path is unverified.
  - Deviations: provider clients use `fetch` with our own SSE parser instead of the `openai`, `@anthropic-ai/sdk` and `@google/genai` packages (fewer dependencies, easy to test with a fake server; usage fields are mapped by hand). Cost reservation happens per request inside the router (estimated input at normal price plus `max_tokens` or the model's `max_output`, default 4096 output), not once per job, because the request size isn't known at claim time. At claim time a paid first choice is skipped when a cap is already reached. `tpm` is read but not enforced; only `rpm` is. Spend rows are a markdown table with local-offset timestamps. `price_cached_in` falls back to `price_in`. Seed prices: DeepSeek as given; OpenRouter, Anthropic and Gemini entries are examples marked "to verify".
- [x] Phase 2: Job queue, agents, scheduler, logs, controls
  - Gate (`tests/scheduler.test.ts`, 18 tests; `tests/recovery.test.ts`, 1 test), all on the mock provider: 3 books x 3 parallel review jobs on 6 reviewers finish with at most 2 in flight on a concurrency-2 provider; depends_on, waiting_on suspension and per-book locks hold; pause all blocks claims, is saved in `config/factory.md` and is honoured on a start with `paused: true`; stop now aborts the stream, requeues the job (attempts unchanged) and pauses; per-agent stop requeues and the job reruns; a paid job is blocked by the cap while a local job continues; a capped paid-first role falls through to its local model; model fallback is recorded in the done file; failing handlers retry with backoff and end in `failed/` with the reason; enqueue is idempotent by id in any state; hire, pause, resume, fire (graceful and now), `setModel` for an agent (writes the agent file) and for a role (writes `config/roles.md`, body kept) all apply from the next job; a new agent file, a factory.md edit and an invalid agent edit are handled through the real watcher without a restart (the invalid one keeps the old version and logs it); snapshot and ping.
  - Restart recovery: the engine runs in a child process (`node --import tsx tests/fixtures/engine-child.ts`) with the mock provider and slow replies. Two of four jobs were running when it was killed with SIGKILL. The restarted engine moved them back to queued (attempts + 1), and all four finished exactly once (4 files in done/, nothing else anywhere, each job has one `end` line in the run log, the two interrupted ones started twice).
  - `npm run dev` re-checked: the engine starts in the utilityProcess with the new code (17 starter agents emit `agent.state`, heartbeats relayed). `npm run engine -- --data <dir>` against the seed loads all 17 starter agents and writes the budget summary.
  - Deviations: `advance()` and the pipeline are left out as agreed. Handlers are registered with `scheduler.register(task, fn, {template, reviewing})`; none are registered in the real engine until Phase 3, so seeded agents are idle. `stopNow` also sets the persisted pause (otherwise aborted jobs would restart at once). `focus` is a preference (matching agents first) and `pin` is strict. Agent states are emitted on change, and `error` shows for about 3 s after a failed job. A job that is waiting on a provider slot stays queued rather than moving to a paid fallback. Job files get extra frontmatter when they run (`agent`, `model`, `prompt_version`, `paid`, `tokens_in`, `tokens_out`, `cost_usd`, `ms`, `finished`, `failure`). The full request text is saved in the job file body when the job finishes; a job killed mid-run loses it. Provider slot leases are per job, so a handler that runs several `ctx.chat` calls in parallel on the same provider bypasses the limit. New event `engine.warning` (budget warnings) and a richer `snapshot` shape. New `src/engine/engine.ts` owns the wiring; `src/engine/index.ts` is only the CLI/process shell. `tsx` added as a dev dependency for the recovery test.
- [x] Phase 3: Short book end to end, headless
  - Gate run 2026-10-08: `npm run typecheck`, `npm run lint`, `npm test` (9 files, 88 tests, run three times in a row, same result; includes the Phase 4 renderer agent's tests) and `npm run build` pass.
  - Mock e2e (`tests/pipeline.test.ts`, 15 tests): an empty folder with one active topic runs through idea generator, editor-in-chief, architect, writer, 8 reviewers, publisher to `published` for the **bedtime story (toddler)** and the **chapter book** (6+ chapters, same writer for all, `agent_hint`). The EPUB is checked: `mimetype` is the first entry and stored (method 0), no folder entries, `container.xml`, OPF 3.0 with title, creator (the pen name), language, subject, description, `urn:uuid` identifier, `dcterms:modified`, `Scriptorium (AI)` contributor, `nav.xhtml`, cover, title page with the AI line, one XHTML per chapter, every manifest item present, all XML well-formed. `topics.md` ends with `done 1`, nothing in progress, and only those cells changed. A revise round merges the notes of two reviewers into one rewrite request, the chapter goes to round 1 (old version kept in `chapters/history/`) and round 1 passes. A forced child-safety failure goes through two rewrite rounds and ends `rejected` with the reasons, no EPUB, no publisher model call, counts back to 0. Your ideas in `ideas/` (even a plain text file with no frontmatter) are picked before generated ones. With no active topic and no idea the factory does nothing and warns once. `max_books_in_progress` is respected. Fake renderer: the engine emits `cover.render`, the test writes a PNG and sends `coverRendered`, and the EPUB is rebuilt with `images/cover.png` and `cover-image`. Pending covers are requested again on start. Pure tests for `advance` (deterministic ids, every stage), scoring, markdown-to-XHTML and the topics table parser (aligned, sloppy, headerless pipes, `Y`/`x`/`yes`, counts update in place).
  - Real Electron cover capture verified: `npm run dev` with `SCRIPTORIUM_NO_WINDOW=1` against the published bedtime book: main rendered the cover in a hidden offscreen window, wrote a 1600x2560 `out/cover.png` (about 200 kB, looked at it), replied `coverRendered`, and the engine rebuilt the EPUB with the image (`cover_png: done`). First capture showed a title overlapping the author name; fixed in `templates/cover.html` (flex layout) and re-captured.
  - **Real run on LM Studio (free), `.claude/temp/p3-toddler-5/`** (roles overridden to local models: 27B `ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp` for writer, architect, editor-in-chief, idea generator and publisher; 35B MoE `nail-qwen3.6-35b-a3b-mtp` for all reviewers; topic Bedtime & Dreams, target 1). Result: **"The Moon's Blanket"** by Mara Quill, format `bedtime-toddler` (ages 2-4), **263 words** (target 450, range 300-800: below the range, see below), published after **2 rewrite rounds** (only the line editor kept asking for changes), weighted score **8.63** (enjoyment 8, genre fit 9, age fit 10, continuity 10, mechanics 8, structure 8, prose 8, originality 8, read-aloud 8), cost 0 USD, 30 jobs, **1188 s of job time in total** (about 20 minutes; wall clock 20 min from start to published). Per job: EIC 18 s, pitch 13 s, outline 11 s, draft 19 s, rewrite 33 s each, publish 36 s, each review 24-64 s (35B MoE, low reasoning, 1.4k-4k tokens out). EPUB: `.claude/temp/p3-toddler-5/books/the-moon-s-blanket/out/the-moon-s-blanket.epub`; chapter: `.../chapters/ch-01.md` (earlier versions in `chapters/history/`); also `book.md` (how it was made, per job model and prompt version), `reviews/`, `cover-brief.md`, `illustration-briefs.md`, `out/cover.png`. Earlier real attempts (folders `p3-real`, `p3-toddler`, `p3-toddler-2` to `-4`, kept, not deleted) found and fixed real problems, listed below.
  - What the real runs found and fixed: (1) Qwen3.x on LM Studio spends thousands of hidden reasoning tokens (a 500-word story: 6.6k reasoning tokens, 212 s), which emptied the output (`0 words`) and killed the first book. Fix: `extra_body: { reasoning_effort: none }` on the LM Studio chat models (verified: 25 s, 0 reasoning tokens), `low` for the review model, bigger `max_tokens`, and a clearer error. (2) The beta reader once omitted a score dimension three times and failed the book. Fix: the review JSON schema now names the reviewer's own dimensions. (3) The first calibrations made reviewers (35B, no reasoning) flip verdicts every round and reject for trivia ("a shadow falls", "similar to Where the Wild Things Are"); the book was rejected twice. Fix: calibration text in the review prompts (revise only for concrete, quotable problems, normal bedtime elements are not problems), `quality.revise_below` (a revise with all scores >= 7 from a non-must-pass reviewer counts as pass), and `low` reasoning for the reviewer model. The editor-in-chief first picked the 3-6 bedtime format; the prompt now says to use the toddler format for any bedtime story.
  - Deviations: topics list written by a throwaway generator script (`.claude/temp/gen_topics.py`, hand-written lists, no LLM; the output is `seed/topics.md`, 436 rows, all `active: no`, more than the 250-400 asked for). Prompts are also generated from a script (`.claude/temp/gen_prompts.py`) but the seed files are the source of truth. Own markdown-to-XHTML converter instead of `marked` (prose subset, guarantees well-formed XHTML). Handler per task name; all reviewers share the task `review`, and the template is chosen by the job's role. Draft jobs are enqueued one chapter at a time (so the first writer is hinted for the rest). Reviews are whole-book (`book-<role>-r<round>.md`). The bible is one light file `bible/bible.md`. The publisher decides in code (no model call for a rejection); the model only writes title, blurb, subjects, keywords and the briefs. `book.md` also gets `how made` per job under `made:`. New events/commands `cover.render` / `coverRendered`; `SCRIPTORIUM_NO_WINDOW=1` runs Electron main without the window (for scripted cover checks). The recovery code now removes leftover `*.tmp-*` files in `jobs/` on start.
  - Unverified / known gaps: no length gate (the real story is 263 words, under the toddler range of 300-800, and nothing checked it); no real DeepSeek run; the chapter book and short story were only run on the mock provider; the reviewers on the 35B are noisy (verdicts change between rounds with the same text), so a book can need several rounds or be rejected by chance; cover rendering of the toddler book was captured but the in-app window path of `npm run dev` with the window was not looked at; a book that ends in `failed` (a job that fails 3 times) is not retried by itself.
- [x] Phase 4: The office and the terminal
  - renderer done (separate implementer), not yet ticked: Phaser 3.90 office with the 2dPig CC0 assets, zustand store, overlays, agent panel, model picker, hire, terminal and a `dev:ui` demo harness. 16 store tests. The Playwright smoke test on the demo harness passed 3/3. Screenshots: `.claude/temp/p4-office.png` and `.claude/temp/p4-panel.png`. Remaining: integration with real Electron and real logs; overlapping labels in crowded rooms; the Phaser chunk is 6.7 MB, so check minification. The engine side of the contract (snapshot models, roleDefaults, summaries, new events and commands) is in `protocol-notes.md`.
  - Integrated and verified by the coordinator: real-Electron Playwright `tests/renderer/app.electron.spec.ts` passes (office, agents at work, terminal from real logs, pause all, library, reader, rating); browser suite 2/2; screenshots `.claude/temp/p4-electron.png`, `p5-electron-{library,card,reader}.png`; Phaser chunk minified to 1.2 MB. Unverified: overnight tray running, and sending real mail to Kindle (the mail path is unit-tested with a JSON transport).
- [x] Phase 5: Library room
  - Done by the renderer implementer, verified by the coordinator (see Phase 4 evidence: library, book card, reader, rating in the Electron Playwright test). The engine side (`rate`, `sendToKindle` with nodemailer, `books/<slug>/out/reader/`, `rebuild-reader`) is tested in `tests/features.test.ts`. Unverified: a real email to a Kindle.
- [x] Phase 6: Book memory and novella/novel pipeline
  - Gate run 2026-10-08: `npm run typecheck`, `npm run lint`, `npm test` (13 files, 129 tests, three runs in a row, same result; includes the renderer agent's tests) and `npm run build` pass.
  - **Mock e2e** (`tests/novel.test.ts`): a novel with 6 chapters in 3 acts runs to `published`: outline review, a continuity check after every chapter (one fix on chapter 2, rewritten once before its memory update), 6 memory updates and 6 indexing jobs, 3 act summaries and 3 act reviews with tension scores, the repetition report, 18 whole-book reviews (6 reviewers x 3 acts), the thread check, publish. All files in the planned structure: `bible/characters/*.md` (with voice sheets), `places/`, `threads.md`, `timeline.md`, `style.md`, `summaries/ch-NN.md` and `act-N.md`, `reviews/`, `reports/`. **Memory jobs for one book never overlap** (checked from the event timestamps with two archivists present; the `bible:<book>` lock). **Deleting `index/` and reindexing gives identical search results** (also at the index level in `tests/memory.test.ts`, with hybrid search, chunking, removal of deleted files, change detection and the library-wide nearest-pitch lookup). The context for a chapter is packed by priority into a token budget and laid out stable-first; every item with its token estimate is in the job log, and the request text is in the job file.
  - **Real run on LM Studio** (local models only, free; `.claude/temp/p6-novella-3/`): the novella "The Lantern Keeper's Garden" by Mara Quill (cozy fantasy, format `novella` overridden to 12k-18k words and 16 chapters in the test data folder), **13,538 words in 16 chapters**, 3 acts, published after **one rewrite round** with weighted score **7.13** (enjoyment 6.7, genre fit 7.7, continuity 7.7, mechanics 6.7, structure 6.7, prose 5.3, originality 8, threads 9). Wall clock 2 h 30 min (14:27 to 16:56), **145.9 min of job time, 134 jobs, 0 USD**. Time by task: reviews 36 jobs, 50.6 min (84 s each); rewrites 20 jobs, 31.4 min (94 s); memory updates 16, 17.7 min (67 s); chapter checks 16, 17.2 min (65 s); drafts 16, 17.2 min (65 s); act reviews 3, 3.6 min (72 s); act summaries 3, 2.0 min (39 s); thread checks 2, 1.9 min; outline 102 s; outline review 60 s; publish 64 s; indexing 0.2 s each. Writer and architect on the 27B, everything else on the 35B MoE, thinking off for the 27B and `low` for the 35B.
  - What the real runs found: (1) LM Studio loads models with an 8192-token window by default; a chapter check with a 6.5k-token prompt used up the window in reasoning and came back empty, which failed the first two attempts. Fixes: the OpenAI-compatible client now turns "stopped at the token limit with no text" into a clear error naming the likely causes, the registry reads the loaded window from LM Studio (`/api/v0/models`), prompts are packed to at most 45% of the window, and `providers.md` documents loading models with `lms load ... -c 32768 --parallel 1`. The final run used both models loaded at 32768. (2) The writers produce about 840 words per chapter however much is asked (target 940), so the book came out at 90% of 15,000. (3) Reviewers say "revise" without naming chapters, which means every chapter of that act: round 1 rewrote all 16 chapters (31 min) and a second full set of 18 reviews followed (about 40 min). (4) The tension scores flagged a flat stretch at chapters 13-16 (4, 3, 2, 2), but nothing acts on it automatically. (5) 11 of 41 story threads were still marked open in the bible at the end, although the thread check passed with 9: the archivist closes threads rarely and the checker judges from summaries. (6) The repetition counter found real tics ("ache in her chest" 11 times, "the silence between them" 8 times, 15 items flagged). (7) Bible entries duplicate ("lighthouse-cottage" and "the-lighthouse-cottage"): name matching is exact. (8) Titles repeat between runs with the same prompts.
  - Deviations: drafting is per chapter (1,000 to 3,000 words) instead of per scene. Line and copy editors read one act at a time like the other reviewers, not per chapter. The developmental review per act is advisory (notes go into the next act's context and the tension report); it does not trigger rewrites. Memory is not updated after a rewrite round (the summaries describe the first draft). Acts are split by code (3 acts for 6 or more chapters, 2 for 4-5), not by the architect. The length gate of short books does not apply to long ones. A book's `made:` list moved to `made.md` (a table), with `jobs`, `models` and `cost_usd` kept in `book.md`. `max_rounds` can be set per format (long formats: 1). The library-wide originality check compares a pitch with the pitches and blurbs of the other books (cosine, `quality.pitch_similarity_max` 0.9, up to two retries). New env var `SCRIPTORIUM_SQLITE_VEC` overrides the sqlite-vec library path (for packaging). Engine CLI exit uses `process.exitCode` because `process.exit` right after network calls crashed with a libuv assertion on Windows.
  - Part A (UI contract, done before Phase 6): see `protocol-notes.md`. Extra: length gate for short books (a draft more than 15% outside the format's range gets one length rewrite before the reviews, recorded as `length_gate` in `book.md`), reader folder, Send to Kindle (`tests/features.test.ts`), seed topic names made unique (test added).
  - Unverified: a long book on DeepSeek or any cloud model; the Anthropic/Gemini paths; a novel of 60k+ words (only 6 chapters on the mock, 16 on the real run); search quality with real nomic embeddings beyond the dimension check (768) and the reindex run on one book.
  - **Phase 6 follow-up fixes** (done in the Phase 7 session, mock tests in `tests/followup.test.ts`, 13 tests):
    - Flaky test fixed at the root, no retries added. Causes: a `start_book` race with three books open (`countBooksInProgress` plus a guard in `startBooks`), EPERM on the job-claim rename on Windows (`renameRetry` in `store/atomic.ts`, used by claim and requeue), EBUSY on the index unlink in a test, a topics `inProgress` race in a test, and Windows credential-delete lag in `tests/models.test.ts` (poll instead of a fixed wait). The final code passed 10 full `npx vitest run` in a row, 176 tests each time.
    - Targeted rewrites: reviewers name the chapters to revise (`chaptersToRewrite`, `pickWorst` in `advance.ts`); only those are rewritten. Per-chapter scores exist only for long books, so a short book still rewrites everything on an unnamed revise.
    - Expand retry for chapters under 80% of the target: long formats only; short books keep the length gate.
    - Bible duplicate names: `entryKey` and `resolveEntryFile` in `memory/bible.ts` (unit test).
    - Open threads: the memory update has an explicit close step; the end-of-book check uses the bible's open threads, closes resolved ones, writes `reports/open-threads.md`; the publisher prompt and `book.md` `open_threads` carry what stays open.
    - Flat stretches: flat chapters join the rewrite set with a "Raise tension" note.
- [x] Phase 7: Researcher, on demand
  - Gate run 2026-10-08, final code: `npm run typecheck`, `npm run lint` clean; `npx vitest run` 10 times in a row, 176 of 176 passed every time (includes `tests/research.test.ts`, 34 tests, and `tests/followup.test.ts`); `npm run build` ok; `npx playwright test` 2 passed; `npm run test:electron` 1 passed.
  - **Mock e2e** (`tests/research.test.ts`): questions from the architect, writer prep, `[RESEARCH: ...]` markers (fix-up job), reviewers and the user's `askResearcher` command, with a handover line per request; notes-first check, per-book limit, idempotent job ids, untrusted-data wrapping, unverified fallback, provider order and spend rows.
  - **Real run** (LM Studio, 27B writer/architect, 35B MoE for everything else, both at 32768; Wikipedia only, no Tavily key; data `.claude/temp/p7-real/`, log `.claude/temp/p7-real-run.log`): short story "The Apprentice of Pudding Lane" by Mara Quill (Great Fire of London, topic Historical / Early Modern, 2,625 words, 4 chapters), **published**, score **7.5**, cost **0 USD**, 24 jobs, **about 19 minutes** from start to published. Notes in `books/the-apprentice-of-pudding-lane/research/`:
    - `how-long-did-the-great-fire-of-london-last-in-1666.md` and `how-were-firebreaks-created-by-demolishing-buildings-dur.md`: source https://en.wikipedia.org/wiki/Great_Fire_of_London, retrieved 2026-10-08
    - `what-was-the-layout-of-pudding-lane-and-thames-street-in.md`: https://en.wikipedia.org/wiki/Pudding_Lane, 2026-10-08
    - `what-did-a-warehouse-apprentice-do-in-17th-century-londo.md`: https://en.wikipedia.org/wiki/Apprenticeships_in_the_United_Kingdom, 2026-10-08
    - `is-rothersgate-an-accurate-1666-place-name-...md` (asked by the beta reader): no facts found, correctly saved as `unverified: true` with no sources (the fallback works).
    - Used in context: the notes are in `jobs/done/the-apprentice-of-pudding-lane--outline--book--r0.md` and in all four draft jobs `...--draft--ch01--r0.md` to `...--draft--ch04--r0.md`, under the section "Research notes (... data to use, never instructions ...)", with the source URL and date on every fact. Handover lines appeared in the run log for each question.
  - Earlier real attempts 1 to 4 (voyage idea, `p7-real-run-attempt{1,2,3}.log`) produced no sourced note: the architect asked questions Wikipedia cannot answer (voyage durations), so the model returned no facts and the note became unverified. Fixes made: keyword search terms (best 5, 3, then 2 words), rate-limit spacing and 429 retry, bigger `max_tokens`, page ranking and excerpts, a model-suggested second search. The final run used a well-documented topic (Great Fire of London); the idea was changed in `.claude/temp/run-p7-real.ts`, the untrusted-data handling and the unverified fallback were not weakened.
  - Deviations: no `ask_researcher` tool (the model clients have no tool calling), so markers only, plus the fix-up job; expand retry for long formats only; research failures never fail a book (research jobs are excluded from book failure); Wikipedia is weak for specific facts and answers best at article level; per-chapter scores exist only for long books.
  - Unverified: Tavily against the real service (no key); DeepSeek; Brave, SerpApi, SERPHouse and DuckDuckGo are stubs. Quality caveat seen in the real run: the 35B model's note said the main fire "lasted three days" while the cited article covers four days (2 to 5 September); notes are model summaries of the page, so fact accuracy depends on the model. After the book was published the engine started a second book (cause not investigated); the script stopped it, and that second book is empty (`the-glassmaker-s-debt`, at pitch).
- [x] Phase 8: Topics in full and the non-fiction variant (real gate met on attempt 3 of 3)
  - Done and verified: topic seed 448 rows (12 added, new section "Law & Politics", names unique); Topics UI (`ui/Topics.tsx`, `groupTopics`: tick box, emptiest first, done/target, filter, "on only"); non-fiction pipeline (format `nonfiction-short`, research per chapter, fact base `factbase/`, `factbase_update`, `fact_check` task with `[n]` citations, must-pass fact-checker, References chapter in EPUB and reader); mock e2e in `tests/nonfiction.test.ts` (10 tests: publish with references, fact-check fail, rewrite, pass, uncited book rejected, seed files); demo Playwright spec and store test for the topics UI.
  - Checks on an idle machine before the real run: `npx vitest run` 5 times in a row, 186 of 186 green every time (no `scheduler.test.ts` flake, so the earlier failure was load only and nothing was changed there); `npm run typecheck`, `npm run lint`, `npm run build` ok; `npx playwright test` 2 passed; `npm run test:electron` 1 passed.
  - **Real attempt 1** (LM Studio, 27B and 35B MoE at 32768, Wikipedia only, 0 USD; data `.claude/temp/p8-real-attempt1/`, log `.claude/temp/p8-real-run-attempt1.log`): "The Movable Type Revolution" (topic `his-books-and-printing`, format `nonfiction-short`, 5 chapters, 3,351 words), **published**, score **7.2** (accuracy 10, structure 8, originality 8, prose 6, mechanics 6, genre fit 6, enjoyment 5), 58 min, 52 jobs. Fact-checker: r0 `revise` (accuracy 6, two claims in chapters 2 and 5 with mismatched citation [3]; rewrite of chapters 2 to 5), r1 `pass` (accuracy 10). References: 13 numbered en.wikipedia.org entries in `out/reader/chapter-06.xhtml` and `chapter-06.xhtml` in `out/the-movable-type-revolution.epub`. Research notes: 15 files in `books/the-movable-type-revolution/research/`, sources en.wikipedia.org only. **But it was defective: the writer model returned each chapter as a JSON object (`{"chapter": 2, "title": ..., "content": "..."}`), and the engine stored and published that JSON text as the chapter body (visible as raw JSON in the reader and EPUB; word counts and checks ran on the JSON).** This counts as a failed attempt.
  - **Fix for attempt 1:** `cleanProse` in `src/engine/pipeline/llm.ts` now unwraps a reply that is one JSON object with a long `content`/`text`/`body`/`chapter_text`/`prose` field (applies to all prose tasks); the non-fiction draft and rewrite prompts now say "Answer with the chapter text only, never as JSON or with field names". Mock test added in `tests/nonfiction.test.ts` ("takes the prose out of a reply that a model wrapped in a JSON object"). After the change: `npx vitest run` 3 times, 187 of 187 green; typecheck, lint, build ok (playwright and test:electron not rerun: no renderer code changed).
  - **Real attempt 2** (same setup; data `.claude/temp/p8-real/`, log `.claude/temp/p8-real-run.log`): same title, 3,137 words in 5 plain-prose chapters (the JSON problem is gone), citations `[n]` after factual sentences by eye look good and match the notes (en.wikipedia.org only, 0 non-Wikipedia sources). Fact-checker r0 `pass` (accuracy 10), then after the one allowed rewrite round (script sets `max_rounds` 1) r1 `revise` (accuracy 6: chapter 1 "hand-copying persisted for a century because early printed books were costly", chapter 5 two analytical claims with no support in the notes). The engine did what the design says: **rejected** with the reason, no EPUB. 63 min, 53 jobs. Not a pass, so it counts as the second failed attempt; stopped as instructed.
  - Observations: (1) the fact-checker's verdicts are noisy: the same text passed in r0 and failed in r1, and in attempt 1 the r0 flagged claims were sensible. (2) `fact_check` has `maxTokens: 6000`; the 35B thinking model ran out of budget on it 1 time in attempt 1 and 3 times in attempt 2 (`FAILED the model stopped at its token limit`), the scheduler retry then succeeded. Not fixed (not re-run). Candidate fixes: a larger `maxTokens` for `fact_check` (input is about 10k of 32k) or a no-thinking setting; allow 2 rounds for non-fiction in the real gate. (3) Prose by eye: clear and on topic but flat and repetitive ("This ... demonstrates ..." closers), some chapters near-duplicate openings; prose score 6 in attempt 1. (4) The research limit (16 questions per book) was reached in both runs; later chapters were written with the notes already collected. (5) The run script does not stop when the editor-in-chief starts a second book right after the first ends; I killed the process then.
  - Deviations: the check is the task `fact_check`, not `review`; non-fiction formats are short books only (`nonfiction-short`, plus the long form is not enabled); fiction reviewers unchanged; the topic test row cap kept at 450 (the seed has 448 rows).
  - **Fixes for attempt 2 (made before attempt 3):** (1) `fact_check` answer budget is now what the window leaves after the prompt, 4,000 to 14,000 tokens (was 6,000), and the prompt asks for a compact reply (claims of at most 15 words, details at most 20, at most 8 claims, no restated text); `chatJson` no longer retries a token-limit failure without the schema (that only burned a second budget); in `src/engine/pipeline/nonfiction.ts` a reply cut off at the limit is asked again once inside the same job for a short answer, and a second cut-off fails the job with a clear reason ("could not finish: the model hit the token limit twice ..."). (2) The rewrite after a fact-check `revise` now gets the fact-checker's flagged claims for that chapter only, numbered, with the instruction to cite a source from the list whose note says it, correct it, remove it or soften it, and add no new uncited claim (`factClaimNote` in `src/engine/pipeline/handlers.ts`; `rewrite_chapter_nf.md` says the same; the generic fact-checker note is not repeated). Mock tests in `tests/nonfiction.test.ts`: claim lines and instruction in the rewrite request; cut off once then pass in one job; cut off twice fails with the reason. Run script now uses the seed `max_rounds` (2) and ends when the first book is published or rejected.
  - Checks before attempt 3: typecheck and lint clean, `npx vitest run` 3 times, 212 of 212 green (the count includes another agent's Phase 9 test file). After attempt 3: typecheck, lint, build ok, vitest 3 times 212 of 212 green.
  - **Real attempt 3: PASSED the gate** (data `.claude/temp/p8-real/books/the-movable-type-revolution/`, log `.claude/temp/p8-real-run.log`, previous attempts in `p8-real-attempt1/`, `p8-real-attempt2/`; same local models at 32768, Wikipedia only, 0 USD). "The Movable Type Revolution" by Mara Quill, topic History of Books & Printing, format `nonfiction-short`, 5 chapters, 3,256 words (3,006 in the chapter files), **published**, score **7.53** (accuracy 10, mechanics 9, genre fit 8, originality 8, structure 6, prose 6, enjoyment 6), 2 rewrite rounds, **60 min**, 62 jobs. Fact-checker verdicts: r0 `revise` (accuracy 6, 1 claim, chapter 5, only that chapter rewritten), r1 `revise` (accuracy 6, 2 claims in chapters 1 and 5: a missing citation and a claim beyond source [8]), r2 `pass` (accuracy 10, no claims). No `token limit` failure in the whole run (0 in the log). Plain prose, no JSON in any chapter. References: 16 numbered en.wikipedia.org entries (e.g. "[8] Movable type. https://en.wikipedia.org/wiki/Movable_type. Retrieved 2026-10-09.", "[13] Global spread of the printing press", "[7] Johannes Gutenberg") in `out/reader/chapter-06.xhtml` and `chapter-06.xhtml` in `out/the-movable-type-revolution.epub`; only cited sources are listed, so the numbers have gaps (no [15]). Research notes: 15 files in `research/`, every source en.wikipedia.org (0 non-Wikipedia URLs).
  - Quality by eye: chapters are on topic, short and cited after each fact; the prose is flat and repetitive (prose 6) and the structure score is only 6. Treat the facts as model summaries of Wikipedia, not as checked beyond the fact-checker.
  - **Unverified:** the long non-fiction formats (not enabled); a non-Wikipedia search provider for non-fiction (no Tavily key); a cloud model as fact-checker; the fact-checker stayed noisy between rounds (the same book flagged different claims each round), so a pass means "no unsourced claim found this time".
- [x] Phase 9: Simple images, if easy
  - Done. `src/engine/publish/art.ts` (new):
    - a cover pattern (stripes, waves, dots or shapes) as inline SVG, seeded from an FNV-1a hash of the trimmed, lowercased title (mulberry32 random numbers), coloured by the genre variables of `seed/templates/cover.html`;
    - 12 genre chapter ornaments; unknown genres fall back to literary.
  - Cover template: the title and author sit in one flex column on a semi-opaque panel, with sizes taken from their length, so a long title can no longer overlap the author.
  - Ornaments are one file, `images/ornament.svg`. In the EPUB it has a manifest item of type `image/svg+xml` and an `<img>` above every chapter `<h2>`; the same file is in the reader folder. A file instead of inline SVG keeps the OPF simple: no `properties="svg"` per chapter.
  - Two lines in `src/engine/pipeline/books.ts` pass `genre_class` from `book.md` through. The PNG capture service (`cover.render` / `coverRendered`) is unchanged.
  - Tests: `tests/art.test.ts`, 23 tests:
    - the pattern is the same for the same title, differs between titles, and all four kinds are reachable;
    - valid SVG for every kind and every ornament;
    - every EPUB manifest item exists in the zip, ids are unique and media types are valid;
    - each chapter has the ornament before its heading;
    - the reader folder has the ornament.
  - Checks:
    - Agent: typecheck, lint, `npx vitest run` 3× 212/212, build, Playwright 2/2, `test:electron` 1/1 (taken while the P8 real run loaded the machine).
    - Orchestrator rerun on the combined P8 and P9 code: typecheck, lint, vitest 212/212, build, Playwright 2/2, `test:electron` 1/1.
  - Visual check: `.claude/temp/p9-cover-{0..7}-*.png` (8 genres, including an 88-character title with a 44-character author), `p9-ornaments.png` and `p9-reader-chapter.png`, rendered in Playwright Chromium. The orchestrator looked at the fantasy and non-fiction covers and the reader chapter: readable, no overlap.
  - Also tried on real output: a copy of the P6 novella (`.claude/temp/p9/real`) was rebuilt with `buildEpubFile` and `rebuildReader`.
  - Limitation: existing data folders keep their old `templates/cover.html`, because seed files are never overwritten. A fresh folder, or copying `seed/templates/cover.html` in by hand, gives the new cover.
  - Unverified: an Electron-captured cover PNG with the new template (only the existing Electron test covers capture), a real e-reader app, and epubcheck (no Java).
- [ ] Phase 10: Packaging and wrap-up (packaging and wrap-up done; the gate's overnight, reboot and installed-app run is not verified, so this stays unticked)
  - Done:
    - `electron-builder.yml`: NSIS, per user, x64, one-click, `asar: false`, `seed/` shipped as `resources/seed`, main passes `--seed`.
    - App icon `build/icon.ico`, drawn by `build/make-icon.mjs`, and `ATTRIBUTION.md` (2dPig Pixel Office CC0, AIOffice MIT).
    - Scripts `dist`, `dist:dir` and `test:packaged`; test file `tests/renderer/packaged.electron.spec.ts`.
    - Why no asar: sqlite-vec's `vec0.dll` and the keyring `.node` can't load from inside an archive, and the engine's `require.resolve` would return an `app.asar` path that SQLite can't open.
  - Verified on the final code (orchestrator, 2026-10-09): `npm run test:packaged` 2/2 passed:
    - the packaged engine loads `@napi-rs/keyring` and sqlite-vec, and `reindex` builds `index/library.sqlite`;
    - the packaged app seeds a data folder, starts the engine, shows the agents and renders a cover PNG.
  - `npm run dist` rebuilt `dist/Scriptorium-Setup-0.0.1.exe` (about 115 MB) on the final code; the unpacked app is `dist/win-unpacked/Scriptorium.exe`.
  - Wrap-up: `docs/design.md` (Status, Decisions rows for Simple images, Packaging and Stage, History), `README.md` status, the old `.claude/tickets/scriptorium-mvp/handoff.md`, this folder's `handoff.md` and `changelog.md`.
  - **Not verified (needs the user's machine and time):**
    - running the NSIS installer and the installed app
    - running from the tray overnight
    - resuming after a reboot mid-book (restart recovery is only covered by `tests/recovery.test.ts`, with the engine killed mid-run)
    - budget caps against real paid spend: no cloud key, so only mock tests cover them
    - start with Windows
    - code signing: none, so SmartScreen will warn

## Context

`docs/design.md` is finished and says "ready for a plan", but the repo has no code yet, only the design doc, README, CLAUDE.md and a handoff. This plan turns "Milestones → MVP: text only" (16 items) into ordered, verifiable phases. It follows the design's build order: **one short book through the whole pipeline first, then novellas, then long books.** The finished MVP is a Windows Electron app with these parts:
- a headless engine that runs agents through a file-based job queue
- a model layer with budget caps
- a full book pipeline up to 150k words, with book memory and RAG
- an on-demand researcher
- topics, including a non-fiction variant
- EPUB and template-cover output
- a pixel-art office for watching, with live terminals
- a library room

Decisions made while planning (to be added to the design doc's Decisions table in Phase 0):
| Topic | Decision |
|---|---|
| Data folder | `~/Scriptorium` (`C:\Users\Infplane\Scriptorium`) by default. Can be overridden with `--data` or `SCRIPTORIUM_DATA` |
| Topic list | Our own BISAC-like list (sections → subtopics, fiction, non-fiction, juvenile), committed in `seed/`. We don't redistribute BISG's copyrighted list |
| AIOffice | MIT licence. Its tileset is 2dPig "Pixel Office" (CC0). Its code and art can be reused with attribution. Check its `ATTRIBUTION.md` before copying any sprite |
| Archivist role | New role (Archive room) for after-chapter memory work: bible updates, summaries, indexing. The design mentions "an agent pulling out new facts" but gives that agent no role |
| Terminal view | A React monospace log view with search, filter, expand and copy, instead of xterm.js. Filtering and expanding are much simpler this way, and the design allows either |
| SQLite | Built-in `node:sqlite` plus the `sqlite-vec` loadable extension, so there's no native ABI rebuild between Node and Electron. Fallback: `better-sqlite3` |
| Starting models | Writer and architect on DeepSeek. Editors and reviewers on the local Qwen 27B (a different family, free), with DeepSeek as fallback. Archivist and checks on the local Qwen 35B-A3B MoE. Embeddings with nomic. All of this is in `config/roles.md` and the model picker |

## Architecture (applies to all phases)

**Stack:** Electron (latest stable) + electron-vite + TypeScript (strict). The renderer uses React for panels and Phaser 3 for the office. Tests use Vitest, plus Playwright `_electron` for UI smoke tests. Packaging uses electron-builder (NSIS). Run Node through fnm (`fnm env --use-on-cd | Out-String | Invoke-Expression`).

**Libraries:**
| Purpose | Library |
|---|---|
| YAML | `yaml` |
| Markdown to HTML | `marked` |
| EPUB zip | `jszip` |
| File watching | `chokidar` |
| Schemas | `zod` |
| OpenAI-compatible providers | `openai` (with `baseURL`) |
| Anthropic | `@anthropic-ai/sdk` |
| Gemini | `@google/genai` |
| Credential Manager | `@napi-rs/keyring` (N-API, so the same build works in Node and Electron) |
| Kindle email | `nodemailer` |
| UI state | `zustand` |

**Repo layout:**
```
src/shared/     types, zod schemas for every md file, frontmatter read/write, engine<->UI event & command protocol
src/engine/     headless engine (runnable with plain node: `npm run engine -- --data <dir>`)
  store/        data-folder init from seed, atomic md write (tmp+rename, retry on EBUSY/EPERM), chokidar hot reload
  config/       loaders: providers, roles, budget, quality, formats, factory, settings
  models/       registry, openai-compat client, anthropic, gemini, mock provider, embeddings, router (fallback, family-avoid)
  budget/       spend log, aggregates, caps, reservations
  queue/        job files, claim, restart recovery, scheduler, per-provider semaphores + rate limits, per-book locks
  agents/       agent files, job→agent matching, pause/stop/fire
  pipeline/     book stage machine (advance), job handlers per role, prompt assembly, output parsing
  memory/       bible, summaries, sqlite index (FTS5 + vec0), hybrid search, context builder
  research/     search providers (Tavily, Wikipedia; interface for Brave/SerpApi/SERPHouse/DDG), notes
  publish/      chapters→XHTML, EPUB3 builder, cover HTML template fill, code-drawn images
  logs/         agent + book log writers (buffered append)
src/main/       Electron main: spawns engine as utilityProcess, tray, windows, powerSaveBlocker, HTML→PNG capture service, keyring, shell.openPath, Kindle mail
src/preload/    typed bridge: window.scriptorium.{on, send, readFile}
src/renderer/   React app + Phaser office scene + library room
seed/           default data-folder contents: config/*.md, agents/*.md (starter staff), prompts/<role>/<task>.md, templates/cover.html, topics.md
tests/          vitest unit + e2e (mock provider) + playwright smoke
```

**Engine and UI.** The engine runs in its own process. It writes everything to files and sends events: `agent.state`, `job.started`, `job.token`, `job.done`, `handover`, `spend`, `book.stage`. It accepts commands: hire, fire, pause, stop, pauseAll, stopNow, setModel, askResearcher, rate, sendToKindle. The transport is an interface, MessagePort for now, so a WebSocket transport (a headless engine on a server) can be added later. The UI gets its first state from a `snapshot` command and loads history from log files. The engine asks main for anything that needs Electron (HTML→PNG capture). When the engine runs headless, cover PNGs are marked pending and rendered the next time the app opens.

**Data folder.** The layout from the design doc's "Shared files" section, plus:
- `prompts/`: per-task prompt templates, editable. An agent file's body is appended as that agent's persona and voice.
- `config/formats.md`: book formats with word ranges, age band and structure.
- `config/quality.md`: score weights, threshold, must-pass gates, maximum rewrite rounds.
- `config/factory.md`: maximum books in progress, idea low-water mark, research limit per book, persisted pause state.
- `config/settings.md`: Kindle and SMTP addresses (no secrets).

On first start, `seed/` is copied in, and existing files are never overwritten.

**Jobs.** One md file per job:
```yaml
---
id: silver-inn--draft--ch03-s2--r0     # deterministic: book--task--unit--round  → re-advancing never duplicates
book: silver-inn
task: draft_scene
role: writer
unit: ch03-s2
round: 0
requested_by: architect-ada            # agent id | you | engine  → handover line in the office
depends_on: []                          # job ids that must be in done/
waiting_on: null                        # research job id while suspended
paid: true                              # resolved at claim time from model
attempts: 0
---
(full request text written here when it runs; result path + numbers when done)
```
- **Claiming:** `fs.rename` from `queued/` to `running/`. A single engine process does the claiming, and the rename makes it safe.
- **Restart:** on start, every job in `running/` moves back to `queued/` with `attempts` + 1.
- **Book stages:** each book's `stage` is in the `book.md` frontmatter. `advance(book)` is a pure function from the book's files and job files to the jobs to enqueue. It runs after every job finishes and on startup, so a restart just recomputes the next steps.
- **Scheduler:** matches each queued job's role to an idle agent of that role that isn't paused. It respects the agent's focus or pin, provider concurrency and rate limits, the budget (paid jobs only), and per-book locks (`bible:<book>`, so only one memory job per book writes at a time).
- **Model choice:** at claim time, the agent's `model` override, else the role default from `config/roles.md`. On failure it falls back through the role's model list. Reviewer roles prefer a model family different from the book's writer's.

**Logs.**
- Each running job appends a block to `logs/agents/<agent>.md` and `books/<b>/log.md`: requester, purpose, context items with token counts, streamed output (flushed about every 250 ms), tool calls, the result and where it went, and the numbers.
- The full request text is stored in the job file, and the terminal's "expand" loads it from there. This keeps the log files from growing huge.

**LLM output parsing.** Reviews and other structured outputs ask for JSON. Where the provider supports it (OpenAI-compatible `response_format: json_schema`, which LM Studio supports), we pass the schema. Otherwise we parse leniently and do one repair retry. The engine writes the result as md with frontmatter. Prose (scenes, chapters) is plain markdown.

## Phases

Each phase ends with a verification gate. Nothing moves on until the gate passes. Every phase runs `npm run typecheck && npm test`.

### Phase 0: Scaffold and foundations (MVP item 3, partly)
- electron-vite app with main, preload and renderer, plus a separate engine entry built to `out/engine/index.js`. Scripts: `dev`, `build`, `engine`, `test`, `typecheck`, `lint`.
- `src/shared/md.ts`: parse and serialize frontmatter, with zod validation per file kind. Atomic write with retries, because Windows locks files that are open in Zed or scanned by antivirus.
- Data-folder init from `seed/`, data-folder resolution (`--data` > `SCRIPTORIUM_DATA` > `~/Scriptorium`), and chokidar hot reload of `config/`, `agents/`, `topics.md` and `ideas/`.
- **Spike:** `node:sqlite` loads `sqlite-vec` in both plain Node 24 and the Electron utilityProcess, and FTS5 is available. Record the result. If it fails, switch to `better-sqlite3` and add `electron-builder install-app-deps`.
- Electron main starts the engine as a utilityProcess, with a ping/pong over the event protocol.
- `.gitignore`: `node_modules`, `out`, `dist`, `.claude/temp/`.
- Update `docs/design.md` (Decisions rows above, Status, Stage row, History) and the README status.
- **Gate:**
  - `npm run engine -- --data <tmp>` creates the full folder layout from the seed.
  - Unit tests pass for md round-trip and atomic write.
  - The spike result is written down.
  - `npm run dev` opens a window that shows the engine heartbeat.

### Phase 1: Model layer and budget (items 2, 9)
- `config/providers.md`: one YAML entry per provider with `kind` (openai-compat | anthropic | gemini | mock | search), `base_url`, `api_key_env`, `models[{id, family, context, max_output, price_in, price_out, price_cached_in}]`, `concurrency`, `rpm`/`tpm`.
- Seed providers: DeepSeek, OpenRouter, Anthropic, Gemini, LM Studio (`http://localhost:1234/v1`), Ollama (disabled), mock.
- Clients:
  - One streaming chat interface `chat({messages, tools?, schema?, signal}) → AsyncIterable<delta> + usage`. The OpenAI-compatible client requests `stream_options.include_usage`.
  - LM Studio models are discovered via `GET /v1/models`.
  - Embeddings call `/v1/embeddings` with the nomic model, adding `search_document:` and `search_query:` prefixes.
- API keys:
  - Lookup order: the env var first, then Windows Credential Manager (`@napi-rs/keyring`, service `scriptorium`, account = the env var name).
  - `npm run key:set <ENV_NAME>` reads the key from a hidden prompt.
  - Keys are never written to files or logs.
- Router: role → ordered model list, fallback on errors, 429s and timeouts (with backoff), and a family-avoid rule for reviewers.
- Mock provider: deterministic, scripted outputs per role and task, with fake usage numbers. The e2e tests are built on it.
- Budget:
  - Each paid request appends a row to `logs/spend/YYYY-MM.md` (time, agent, book, role, provider, model, tokens in/cached/out, cost).
  - On start, aggregates are rebuilt from the spend files.
  - The engine rewrites an "engine-maintained summary" section below a marker in `config/budget.md`. It never touches the frontmatter, which holds the caps.
  - Caps: 40 USD/month, 5 USD/day, an optional per-book cap, and a warning at 80% of a cap.
  - Before each paid job, the engine reserves an estimated maximum cost and refuses to start if that would cross a cap. Local models cost 0 but their tokens and time are still recorded.
- **Gate:**
  - Unit tests: price math, cap refusal, fallback order, family avoid.
  - Manual: `npm run engine -- probe` streams one short reply from LM Studio (free) and, if a key is set, one from DeepSeek, and writes the spend row.

### Phase 2: Job queue, agents, scheduler, logs, controls (items 3, 12, engine side)
- Job files, claiming, restart recovery, `depends_on` and `waiting_on`, retries (`attempts` limit, then `failed/` with the reason).
- Agents as files (`agents/<role>-<name>.md`): role, name, model override, focus or pin, max parallel jobs, paused. The body holds the persona. Starter staff in `seed/agents/`: one of each role, two writers, and the new archivist.
- Scheduler loop:
  - Provider semaphores and rate limits (LM Studio concurrency 1–2, because it shares one GPU).
  - Budget gate and per-book locks.
  - Agent states: working, reviewing, waiting-provider, waiting-research, idle, error, paused.
- Controls as engine commands, all persisted to files:
  - hire (writes an agent file)
  - fire: graceful finishes the current job first; fire now aborts the job and requeues it
  - pause and resume an agent
  - stop the current job (`AbortController`, job back to `queued/`)
  - pause all and resume
  - stop now
- Log writers (agent log and book log). `prompt_version` (a hash of the template plus the agent body) is recorded on every job.
- **Gate:**
  - Vitest with the mock provider: 3 fake books × parallel review jobs respect concurrency.
  - Killing the engine mid-run and restarting it requeues the running jobs and finishes them without duplicates.
  - Pause all stops new claims. Stop now aborts streams.
  - The budget cap blocks paid jobs while local jobs continue.

### Phase 3: Short book end to end, headless (items 1, 5, 6, 7, part of 14)
- Topics (minimal for now):
  - `topics.md` seeded with our own BISAC-like list, grouped in sections. Each row: id, section, name, fiction/non-fiction/juvenile, active, target, done, in progress. Everything starts switched off.
  - A first cut of the list is generated once (a dev script using an LLM, reviewed by eye) and committed to `seed/`.
  - The engine updates the counts.
- `config/formats.md`: bedtime story (500–2k words, read-aloud, ages 2–6), short story (3–10k), chapter book (6–15k, ages 6–9), middle grade (30–50k), novella (20–50k), novel (60–150k). Only the short formats are enabled in this phase.
- Roles and handlers, each with prompt templates in `seed/prompts/`:
  - **idea generator:** fills `ideas/` when the bucket is below the low-water mark, using active topics.
  - **editor-in-chief:** picks your ideas first, otherwise the emptiest active topic. Sets format and target length. Creates `books/<slug>/book.md`.
  - **architect:** pitch, then outline and a light bible.
  - **writer:** chapter by chapter, with the full prior text in context for short works.
  - **reviewers** run in parallel on the whole book:
    - continuity
    - developmental editor
    - line editor
    - copy editor
    - beta reader
    - originality and content checker
    - child safety (must pass on the juvenile shelf)
    - read-aloud (juvenile)
  - **rewrite:** the notes are merged into one request, and the writer rewrites the affected chapters. `round` + 1, up to the maximum number of rounds.
  - **publisher:** weighted score against the threshold and the must-pass gates. Writes the title, blurb, metadata, cover brief, and illustration briefs for juvenile books (the image slots milestone 2 needs). Then publishes or rejects. Rejected books stay in `books/` with `stage: rejected` and the reasons.
- Reviews: `books/<b>/reviews/<unit>-<role>-r<round>.md` with frontmatter `verdict: pass|revise`, `scores: {structure, prose, continuity, genre_fit, age_fit, …}`, and notes in the body.
- Publish:
  - Chapters → XHTML → EPUB3 (OPF metadata: title, author = the writer agent's name, subject, language `en`, a description, `dc:contributor` "AI-written" plus a note, and a cover image).
  - The cover is `templates/cover.html` filled with the title, author, genre and year, with colours and fonts by genre.
  - Cover PNG: in the app, main renders the HTML in a hidden BrowserWindow (`capturePage`). Headless, the PNG is marked pending.
  - Output goes to `books/<b>/out/`.
- `book.md` records how the book was made: the model per role and job, prompt versions, rewrite counts, scores and cost.
- **Gate:**
  - e2e Vitest with the mock provider: an empty data folder with one active topic produces a published book. The EPUB unzips with a valid `mimetype`, `container.xml` and OPF, plus nav and chapters. If Java is available, run epubcheck too.
  - A forced must-pass failure ends in `rejected`.
  - **Real run:** one bedtime story fully on LM Studio (free), then one on DeepSeek. You read both, and we look at cost and quality.

### Phase 4: The office and the terminal (items 10, 11, 12 UI, 15)
- Main process:
  - The tray icon. Closing the window hides it while the engine keeps running.
  - `powerSaveBlocker` ('prevent-app-suspension') whenever jobs are running.
  - An optional start-with-Windows setting (`setLoginItemSettings`).
- Phaser scene:
  - The rooms from the design: idea room, writers' room, editing desks, archive, research library, children's corner, print room, break room, and the library door.
  - Tilemap from the 2dPig CC0 tileset, with AIOffice's characters and approach where their licence allows (attribution in `ATTRIBUTION.md`).
  - Desks are placed automatically per role.
  - States are shown by animation and icons: typing, reading, hourglass, raised hand, break room, red bubble, greyed out.
- Agent display:
  - task speech bubbles
  - role label
  - provider and model badge, with the desk colour matching the provider
  - book tag in the book's colour
  - handover lines with a label, fading out when done
  - a hover tooltip
- React overlays:
  - status bar (working, waiting and idle counts by role and provider)
  - whiteboard (books by stage; click to highlight that book's agents)
  - budget meter
  - big red stop button and pause all
- Agent panel:
  - pause, stop the job, fire
  - the model picker, listing registry models plus the LM Studio models found on this machine. Changing it writes the agent file's `model` override; changing a role default writes `config/roles.md`. Both apply from the next job.
  - Hire dialog: role, model, name.
- Terminal: a live log view for each agent and each book (tail of the file plus live `job.token` events), with scrollback, search, a book and job-type filter, an expandable full request, and copy.
- **Gate:**
  - Playwright `_electron` smoke test on the mock provider: the office renders, agents change state, clicking an agent opens a terminal that streams text, and pause all and hire work.
  - Manual: watch a real bedtime story being made.

### Phase 5: Library room (item 8)
- A library room in the office with shelves per topic (only active topics or ones that have books). Empty active shelves are visible. Books appear when they're published.
- Book card: cover, title, author, topic and genre, year, length, scores, cost, and rating. Actions:
  - **Read:** in-app reader on the same XHTML as the EPUB, in a sandboxed view.
  - **Open folder:** `shell.openPath`.
  - **Send to Kindle:** nodemailer SMTP using `config/settings.md`. The password is in Credential Manager, entered in a small Settings dialog.
  - **Rate:** 1–5 and a note, written to the `book.md` frontmatter.
- **Gate:** Playwright opens a book card, the reader shows chapter 1, and a rating persists to `book.md`. Manual: send one EPUB to Kindle.

### Phase 6: Book memory and novella/novel pipeline (items 4, 5 long-book checks)
- Bible as files: `bible/characters/*.md` (each with a voice sheet), `places/`, `threads.md` (open/closed, with a limit), `timeline.md`, `style.md`.
- After each accepted chapter, jobs run in parallel with that chapter's reviews:
  - the archivist updates the bible (under the per-book lock)
  - the archivist writes the chapter summary, plus an act summary when an act ends
  - the chapter is indexed (no LLM)
- Index: `index/library.sqlite` with a `chunks` table, an FTS5 table and a vec0 table (768 dimensions), incremental by file hash. `npm run engine -- reindex` rebuilds it from markdown. Hybrid search uses reciprocal rank fusion of BM25 and KNN.
- Context builder, for a target of about 15–25k tokens:
  1. the outline entry for the scene and the characters, places and threads it involves
  2. their bible entries and research notes
  3. RAG passages
  4. chapter and act summaries
  5. the last chapter in full
  The parts that don't change come first, so provider prompt caches can reuse them. Every item and its token estimate is listed in the job log.
- Novel flow:
  - developmental review of the outline before drafting
  - scene-by-scene drafting (1–1.5k words per scene)
  - continuity check per chapter, with the rewrite loop
  - developmental edit per act
  - whole-book reviews read one act at a time, with summaries of the other acts
  - line and copy editors work per chapter, in parallel
  Novella is the same without the act layer where it isn't needed.
- Long-book checks:
  - a repetition counter script (n-grams, sentence openers, gesture tics, no LLM), whose report goes to the line editor
  - a tension score per chapter from the developmental editor, with a flat-stretch flag
  - an end-of-book check that every open thread is closed
  - a library-wide originality check: the pitch embedding is compared against existing pitches and blurbs, and pitches that are too similar get regenerated
- Enable the novella and novel formats. The editor-in-chief sets the target length by genre.
- **Gate:**
  - Mock e2e: a 3-act novel run completes, and memory jobs never write the bible at the same time for one book.
  - Deleting `index/` and running reindex gives the same search results.
  - Real: one novella (around 25k words) on DeepSeek, with the cost per book recorded.
  - Then one long novel, run overnight with a mix of DeepSeek and local models.

### Phase 7: Researcher, on demand (item 13)
- Search providers as `kind: search` entries in `providers.md`, with an order list. MVP: Tavily plus the Wikipedia API. Brave, SerpApi, SERPHouse and DuckDuckGo go behind the same interface as they get keys. Search costs are logged to spend.
- Researcher job:
  1. check the shared notes (hybrid search over `research/` and the book's research) first
  2. if they don't cover it, search and read pages
  3. write notes as facts in its own words, with source and date, in `research/<slug>.md` or `books/<b>/research/`
  4. index the notes
  - Page text is wrapped as untrusted data, and the researcher has no tools besides search, fetch and write-note.
  - There is a per-book question limit.
- Who can ask:
  - **The architect:** a "needs research?" step after the pitch, which produces a question list and creates research jobs before the outline.
  - **A writer, before a scene:** a prep step.
  - **A writer, during a scene:** `[RESEARCH: …]` markers work with every model ("mark and keep going"), and a fix-up job later replaces each marker. For API models with tool calling, the `ask_researcher` tool suspends the job (`waiting_on`), and the agent takes other work meanwhile.
  - **Reviewers.**
  - **You:** the "Ask researcher" box in the UI, tied to a book or idea, or general.
- **Gate:** a mock e2e with questions from all five sources, and handover lines visible in the office. Real: a historical-fiction pitch triggers research, and the notes show up in a later scene's context.

### Phase 8: Topics in full and the non-fiction variant (item 14)
- Finish the BISAC-like list. UI: a tick box per topic, plus a topic overview with the emptiest first. These write to `topics.md`.
- Non-fiction pipeline:
  - research is required per chapter
  - a fact base (`factbase/`: sources, key facts, terms, argument) instead of a story bible
  - writer and editor prompts for non-fiction
  - a fact-checker reviewer that must pass (an unsourced claim is sent back)
  - a references section in the EPUB
- **Gate:** a mock e2e non-fiction book with references. Real: one short non-fiction book.

### Phase 9: Simple images, if easy (item 16)
- A cover pattern seeded from a hash of the title (stripes, waves, dots, shapes as SVG in the cover template, colours by genre), and chapter ornaments (an SVG per genre).
- Rendered to PNG by the same capture service, and shown in both the EPUB and the reader.
- Skip if it turns into more than about a day of work.

### Phase 10: Packaging and wrap-up
- electron-builder NSIS installer, the app icon, and `ATTRIBUTION.md` (the 2dPig tileset, AIOffice MIT, icon sets).
- Update `docs/design.md` (History, and any Decisions that changed during the build), the README, and write `handoff.md` in this ticket folder.
- **Gate:** the installed app runs from the tray overnight, survives a reboot mid-book (resumes from the job files), and the budget caps hold.

## Verification (end to end)
- `fnm env --use-on-cd | Out-String | Invoke-Expression; npm run typecheck; npm test` runs the unit tests and the mock-provider e2e for each format: bedtime, chapter book, novella, novel, non-fiction.
- `npm run engine -- --data $env:TEMP\scrip-e2e` runs the engine headless on the mock provider until a book is published.
- Playwright `_electron` smoke tests for the office, terminal, library and controls.
- Real-model runs, each a phase gate:
  - a bedtime story on LM Studio
  - a bedtime story on DeepSeek
  - a novella
  - a novel overnight
  - a non-fiction book
  For each run, check the spend rows against the provider dashboard, confirm the caps stop paid work, and confirm a reboot mid-run resumes.

## Critical files (created)
- `src/shared/md.ts`, `src/shared/protocol.ts`, `src/shared/schemas.ts`
- `src/engine/queue/scheduler.ts`, `src/engine/pipeline/advance.ts`, `src/engine/models/router.ts`, `src/engine/budget/spend.ts`, `src/engine/memory/context.ts`, `src/engine/publish/epub.ts`
- `src/main/index.ts` (engine process, tray, capture), `src/renderer/office/OfficeScene.ts`, `src/renderer/panels/Terminal.tsx`
- `seed/config/{providers,roles,budget,quality,formats,factory,settings}.md`, `seed/agents/*.md`, `seed/prompts/**`, `seed/templates/cover.html`, `seed/topics.md`
- `docs/design.md` (Decisions, Status, History updated in Phase 0 and Phase 10)

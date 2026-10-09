# Changelog: SCP-02 Scriptorium MVP (milestone 1, text only)

## 2026-10-09: SCP-02, MVP built (Phases 0-9), packaging done, overnight/reboot gate open

Outcome: the whole MVP from `docs/design.md` → "Milestones → MVP: text only" is built:
- a headless engine with a file-based job queue
- the model layer with budget caps
- the book pipeline from bedtime stories to novels, with book memory and RAG
- the on-demand researcher
- topics and a non-fiction variant
- EPUB and cover output with code-drawn art
- the pixel-art office with live terminals, and the library
- an NSIS installer

It is verified with 212 unit and e2e tests, Playwright and Electron UI tests, packaged-app tests, and five real books on local LM Studio models at 0 USD. Not verified: cloud models, an overnight run, resuming after a reboot, and a real install.

Plan: [plan.md](plan.md) (every phase's evidence is there). Handoff: [handoff.md](handoff.md). Contract: [protocol-notes.md](protocol-notes.md). Spike: [spike-sqlite.md](spike-sqlite.md).

### Repository `C:\projects\Personal\scriptorium`, branch `SCP-02_mvp-text-only` (from `master` db376ec)

All repo-relative. Grouped by area, with behaviour rather than line edits.

**App shell and build**
- `package.json`, `package-lock.json`: Electron 44, electron-vite 5, Vite 7, TypeScript 5.9 strict, React, zustand, Phaser 3.90, Vitest, Playwright, electron-builder.
  - Main deps: `yaml`, `zod`, `chokidar`, `jszip`, `nodemailer`, `@napi-rs/keyring`, `sqlite-vec`.
  - Scripts: `dev`, `build`, `build:engine`, `engine`, `key:set`, `dev:ui`, `test`, `test:ui`, `test:electron`, `test:packaged`, `dist`, `dist:dir`, `typecheck`, `lint`.
- `electron.vite.config.ts`, `vite.engine.config.ts` (engine to `out/engine/index.js`), `vite.ui.config.ts` (browser demo harness), `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright*.config.ts`.
- `electron-builder.yml`:
  - NSIS installer, per user, x64, `asar: false`, because sqlite-vec's DLL and the keyring `.node` can't load from an archive.
  - `seed/` ships as `resources/seed`.
- `build/icon.ico`, `build/make-icon.mjs`, `ATTRIBUTION.md` (2dPig Pixel Office CC0, AIOffice MIT), `.gitattributes` (LF for `seed/**` and `*.md`), `.gitignore` (`node_modules`, `out`, `dist`, `.claude/temp/`).

**Shared** (`src/shared/`)
- `md.ts`: frontmatter parse and serialize.
- `schemas.ts`: zod schemas for every markdown file kind: config, agents, jobs, books, reviews, notes, topics.
- `protocol.ts`: typed engine events and UI commands over a `Transport` interface (Electron parentPort today; a WebSocket can be added later).

**Engine** (`src/engine/`, runs headless with `npm run engine -- --data <dir>`)
- `index.ts`, `cli.ts`: entry point and CLI (`probe`, `key-set`, `reindex`, `rebuild-reader`, `--once`, `--seed`).
- `engine.ts`: wiring and command handling.
- `transport.ts`; `summary.ts`: snapshots for the UI.
- `store/`:
  - data-folder init from the seed; seed files are never overwritten;
  - atomic writes (tmp file plus rename, with retries on EBUSY, EPERM and EACCES);
  - chokidar hot reload;
  - topics and ideas files.
- `models/`:
  - one fetch-based client for every OpenAI-compatible provider (DeepSeek, OpenRouter, LM Studio and others), plus native Anthropic and Gemini clients, with their own SSE parser;
  - a scripted mock provider;
  - registry with LM Studio discovery: it reads each model's loaded context, and prompts use at most 45% of it;
  - limiter (semaphores, rpm);
  - router: retry, then fallback, and reviewers avoid the writer's model family;
  - keys from env vars, then Windows Credential Manager.
- `budget/spend.ts`: spend rows in `logs/spend/YYYY-MM.md`, caps of 40 USD a month and 5 USD a day with a warning at 80%, a cost reservation per request, and the engine-maintained summary in `config/budget.md`.
- `queue/`:
  - job files in `queued`, `running`, `done` and `failed`, with deterministic ids;
  - restart recovery;
  - `depends_on`, `waiting_on`, locks, `agent_hint`;
  - scheduler with a handler registry and the budget gate.
- `agents/agents.ts`: agents as files, plus hire, fire, pause, stop, pause all and stop now.
- `logs/logs.ts`: agent and book logs.
- `pipeline/`:
  - `advance.ts`: the pure book stage machine, including targeted rewrites, flat-stretch rewrites and research waits;
  - handlers for the short-book, long-book, research and non-fiction tasks;
  - prompt assembly, scoring, and `cleanProse`, which unwraps prose a model returned wrapped in JSON.
- `memory/`:
  - the bible (characters, places, threads, timeline, style), with slug normalisation and thread closing;
  - the non-fiction fact base;
  - the `node:sqlite` plus sqlite-vec plus FTS5 index with hybrid search;
  - the context builder with token-budget packing;
  - the repetition counter.
- `research/`:
  - Tavily and Wikipedia search, with stubs for Brave, SerpApi, SERPHouse and DuckDuckGo;
  - page fetch as untrusted data;
  - notes with source URL and date;
  - `[RESEARCH: …]` markers and the fix-up job;
  - a per-book question limit.
- `publish/`:
  - markdown to XHTML; EPUB3 builder;
  - cover template fill (the PNG is rendered by main);
  - in-app reader folder;
  - Kindle mail via nodemailer;
  - `art.ts`: code-drawn cover pattern and genre chapter ornaments.

**Electron main and preload** (`src/main/`, `src/preload/`)
- The engine runs as a `utilityProcess`.
- Tray; closing the window keeps the engine running.
- `powerSaveBlocker`, single-instance lock, optional start with Windows.
- File reads limited to the data folder; a `scriptorium-book://` protocol for the reader.
- A hidden BrowserWindow captures the cover HTML to PNG.

**Renderer** (`src/renderer/`)
- Phaser office: rooms per role, desks, agent sprites, state icons, task bubbles, provider and model badges, book tags, handover lines, hover tooltip.
- React overlays: status bar, whiteboard, budget meter, stop and pause-all buttons.
- The agent panel with the model picker and the hire dialog.
- A live terminal per agent and per book: search, filter, expand the full request, copy.
- Ask researcher box; library room with book cards and the reader; ratings; Kindle settings; the Topics screen (tick box, emptiest first, filter).
- Demo harness (`demo/`) for browser tests.

**Seed data folder** (`seed/`)
- `config/`: providers, roles, budget, quality, formats, factory, settings.
- 17 starter agents.
- 43 prompt templates.
- `templates/cover.html` with the pattern slot.
- `topics.md`: 448 topics of our own, BISAC-like, all switched off.

**Tests** (`tests/`)
- Unit and mock e2e: `md`, `atomic`, `dataFolder`, `models`, `budget`, `scheduler`, `recovery`, `pipeline`, `features`, `memory`, `novel`, `followup`, `research`, `nonfiction`, `art`, plus `helpers.ts` and `fixtures/engine-child.ts`.
- `renderer/`: `store`, `files`, `office.spec` (browser demo), `app.electron.spec` (real Electron), `packaged.electron.spec` (packaged app).

**Docs**
- `docs/design.md`: Decisions rows (data folder, topic list, AIOffice, Archivist, terminal, SQLite, starting models, research, non-fiction, simple images, packaging, stage), Status, History, open questions 2 and 3 resolved.
- `README.md`: status and development sections.
- `.claude/tickets/scriptorium-mvp/handoff.md`: marked as superseded.
- Ticket folder: `plan.md`, `protocol-notes.md`, `spike-sqlite.md`, `checkpoint-p6p7.md`, `checkpoint-p8.md`, `handoff.md`, and this file.

### Deviations from the plan

- **Libraries:** `fetch` clients instead of the `openai`, `@anthropic-ai/sdk` and `@google/genai` SDKs, with their own SSE parser (a smaller bundle and one code path). Our own markdown-to-XHTML converter instead of `marked`.
- **No `ask_researcher` tool:** the model clients have no tool calling, so writers use `[RESEARCH: …]` markers plus a fix-up job.
- **Expand retry** for chapters under 80% of target applies only to long formats; short books keep the length gate.
- **Research failures never fail a book.** Notes fall back to `unverified: true`.
- **Rewrites:** per-chapter scores exist only for long books, so a short book rewrites every chapter when a review says revise without naming chapters.
- **Non-fiction:**
  - The check is a separate `fact_check` task, not a `review`.
  - Only short non-fiction formats are enabled (`nonfiction-short`, `nonfiction-kids`).
  - The fiction reviewers are unchanged.
- **Ornaments** are one SVG file in the EPUB and the reader, not inline SVG.
- **Existing data folders keep their old `templates/cover.html`**, because seed files are never overwritten.
- **LM Studio specifics found during the real runs:**
  - `reasoning_effort: none` (or `low` for the 35B reviewer), because the Qwen models spent their output on hidden reasoning.
  - Models must be loaded with `lms load <model> -c 32768 --parallel 1`; the default context of 8192 broke chapter checks.
- **Process (user request mid-implementation):** each phase was given to a fresh implementer agent with a checkpoint file, because one agent's context grew too large and slow. Phases 6-7 and 8 have checkpoint files in this folder.

### Verification

**Run on the final combined code** (orchestrator, 2026-10-09 13:40), all passed:
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run`: 17 files, 212 of 212 passed.
  - The agents' earlier loops: 186 tests passed 5 times in a row on an idle machine.
  - The Phase 8 and 9 agents each then ran 212 tests 3 times, all green.
  - Phase 6/7: 176 tests passed 10 times in a row.
- `npm run build`: exit 0.
- `npx playwright test`: 2 passed. This is the browser demo of the office, terminal, controls, library, reader, rating and topics.
- `npm run test:electron`: 1 passed. This is the real app: office, agents at work, terminal from real logs, pause all, library, reader, rating.
- `npm run test:packaged`: 2 passed.
  - The packaged engine loads keyring and sqlite-vec, and reindex works.
  - The packaged app seeds a data folder, starts the engine, shows the agents and renders a cover PNG.
- `npm run dist`: exit 0. It built `dist/Scriptorium-Setup-0.0.1.exe` (about 115 MB).

**Real runs, all on local LM Studio models** (Qwen 27B and Qwen 35B-A3B at 32k context) **with nomic embeddings, at 0 USD:**

| Run | Book | Result |
|---|---|---|
| Phase 3 | bedtime story *The Moon's Blanket*, 263 words (`.claude/temp/p3-toddler-5/`) | published, score 8.63, about 20 min |
| Phase 6 | novella *The Lantern Keeper's Garden*, 13,538 words (`.claude/temp/p6-novella-3/`) | published, score 7.13, 2 h 30 min, 134 jobs |
| Phase 7 | historical short story *The Apprentice of Pudding Lane*, 2,625 words, 4 Wikipedia-sourced notes used in every draft (`.claude/temp/p7-real/`) | published, score 7.5, about 19 min |
| Phase 8 | non-fiction *The Movable Type Revolution*, 3,256 words, fact-checker passed on r2, 16 Wikipedia references (`.claude/temp/p8-real/`) | published, score 7.53, 60 min, 62 jobs |
| Phase 9 | covers for 8 genres, an ornament sheet and a reader chapter (`.claude/temp/p9-*.png`) | checked by eye |

**Not run or not verified:**
- DeepSeek or any cloud model, and Tavily (no keys). Budget caps against real paid spend: mock tests only.
- A real Kindle email.
- epubcheck (no Java). The EPUB structure is checked in tests only.
- Novels of 60k+ words, and an overnight run.
- Running the NSIS installer, the installed app from the tray, start with Windows, and a reboot mid-book. Restart recovery is covered only by the engine-kill test.
- An Electron-captured cover PNG with the new pattern template, and a real e-reader app.
- Code signing.

### Follow-ups and known limitations

- **Before relying on it:** run the installed app overnight, including a reboot mid-book. Set a DeepSeek key with `npm run key:set DEEPSEEK_API_KEY`, run one bedtime story on it, and compare the spend rows with the DeepSeek dashboard.
- **Quality:**
  - Local-model prose is clear but flat and repetitive (prose scores about 6). Expect better from cloud writers.
  - The fact-checker's verdicts are noisy between rounds.
  - Research notes are model summaries of the page and can be slightly off (the "three days" fire).
- **Wikipedia** is weak for specific questions. Article-level questions work.
- **Existing data folders** need `seed/templates/cover.html` copied in by hand to get the new covers.
- **Engine behaviour:** after a book is published, the editor-in-chief starts the next book right away. That's expected for the factory, but the real-run scripts had to stop it.
- **Milestone 2** (ComfyUI images) and everything under "Later" stay out of scope.

### Commit status

- Commit `602485a` "SCP-01: Init", made by the user on 2026-10-08 at 21:54 and pushed to `origin/SCP-02_mvp-text-only`, holds the work up to the Phase 8 checkpoint: 219 files.
- **Uncommitted** since then:
  - the Phase 8 gate fixes: `src/engine/pipeline/{llm,nonfiction,handlers}.ts`, `seed/prompts/fact-checker/fact_check.md`, `seed/prompts/writer/{draft,rewrite}_chapter_nf.md`, `tests/nonfiction.test.ts`;
  - Phase 9: new files `src/engine/publish/art.ts` and `tests/art.test.ts`; changes to `src/engine/publish/{cover,epub,reader}.ts`, `src/engine/pipeline/books.ts` and `seed/templates/cover.html`;
  - docs: `docs/design.md`, `README.md`, `.claude/tickets/scriptorium-mvp/handoff.md`, and the ticket folder files.

# Protocol notes for the renderer and main

Source of truth: `src/shared/protocol.ts` (types) and `src/engine/engine.ts` (behaviour). This file is kept up to date by the engine side. Last updated: Phase 8 (topics and the non-fiction variant). See the list at the bottom for what changed since the first version.

## How the engine talks

- Events (engine to UI) and commands (UI to engine) go through `window.scriptorium.on / send` as before.
- Ask for the first state with `{type: 'snapshot'}`. The engine answers with one `snapshot` event. After that keep it up to date from the incremental events below. The snapshot is built from the files on every request, so asking again is always safe (for example after a window reload).
- All paths in events are relative to the data folder (`snapshot.dataDir`) and use forward slashes.

## `snapshot` (event)

| Field | Type | Notes |
|---|---|---|
| `dataDir` | string | absolute |
| `paused` | boolean | pause all (saved in `config/factory.md`) |
| `agents` | `AgentSummary[]` | see below |
| `books` | `BookSummary[]` | every folder in `books/` with a valid `book.md`, including rejected and in progress |
| `topics` | `TopicSummary[]` | every row of `topics.md` |
| `models` | `ModelSummary[]` | chat models for the picker, including the LM Studio models found on this machine. Usable ones first. Embedding models are not listed |
| `roleDefaults` | `Record<role, ref>` | first model of each role in `config/roles.md` |
| `spend` | `{today, month, dailyCap, monthlyCap}` | USD |
| `running` | `{jobId, agent}[]` | |
| `settings` | `SettingsSummary` | Kindle and SMTP settings, no secrets |
| `secretsSet` | `string[]` | names of secrets that exist (SMTP password, provider key variables). Never values |

`AgentSummary`: `id, name, role, model` (the agent's own override, or null), `resolvedModel` (what it will use next: the override, else the first usable model of the role; null only when nothing is configured), `paused, state` (`working | reviewing | waiting-provider | waiting-research | idle | error | paused`), and `task, book, jobId` when it has a job.

`ModelSummary`: `ref` (`provider/model`, what `setModel` takes), `provider, model, family, local, enabled`. `enabled` means the provider is usable right now (switched on and has its key, or local).

`BookSummary`: `slug, title, author, topic {id,name}|null, kind` (topic kind such as `juvenile-fiction`), `format, stage, words, year, score` (weighted overall, or null), `scores` (average per dimension), `costUsd, rating` (1-5 or null), `ratingNote, coverPng, epub, readerDir, publishedAt`. `coverPng`, `epub` and `readerDir` are null until the file exists. Stages: `new, pitch, outline, drafting, length-fix, reviewing, rewriting, publishing, published, rejected, failed`.

`TopicSummary`: `id, section, name, kind, active, target` (0 = no limit)`, done, inProgress`.

## Incremental events

- `agent.state {agent, role, state, jobId?, task?, book?}`: unchanged.
- `agent.hired {agent: AgentSummary}`: a new agent file appeared (hire command, or the user added a file).
- `agent.removed {agent: id}`: the agent file is gone (fire, finished graceful fire, or the user deleted it).
- `factory.paused {paused}`: pause all changed (command, or the user edited `config/factory.md`).
- `book.updated {book: BookSummary}`: sent on every stage change, when a book is published or rejected, after `rate`, and when its cover PNG is done. Replace the book with this slug.
- `book.stage {book, stage}`: still sent, just before `book.updated`.
- `topics.updated {topics: TopicSummary[]}`: whole list, after any change to `topics.md` (counts, active flags, edits by hand).
- `kindle.sent {book, ok, error?}`: the answer to `sendToKindle`. `error` is a short sentence for the user, never contains the password.
- `secrets.updated {secretsSet}`: after `setSecret`.
- `engine.warning {message}`: budget warnings and "nothing to write" warnings. Show them in the status bar or a toast.
- `cover.render {book, htmlPath, outPath, width, height}`: for main only (see below).
- `job.started / job.token / job.done / handover / spend`: unchanged in shape. For research jobs the `task` of `job.started`/`agent.state` and the `label` of `handover` is the question itself (job frontmatter `label`, cut to 100 characters), so the office can draw the line `asker -> researcher` with the question on it. Askers are the architect, a writer, a reviewer (agent ids) or `you`. Search requests also send `spend` events with `model: "search"` (provider = the search provider id, cost = `price_per_request`). `handover.from` can be an agent id, `you`, `engine`, or a role label such as `architect`, `editors`, `editor-in-chief`: map role labels to a room, not to an agent.

## Commands

| Command | Effect |
|---|---|
| `snapshot` | answers with `snapshot` |
| `hire {role, name?, model?}` | writes `agents/<role>-<name>.md`, then `agent.hired` |
| `fire {agent, now?}` | graceful: finishes the job, then the file is removed. `now`: aborts the job (it goes back to the queue) and removes the file. `agent.removed` follows |
| `pause {agent}` / `resume {agent}` | writes `paused` in the agent file |
| `stop {agent}` | aborts the agent's current job (goes back to the queue) |
| `pauseAll` / `resumeAll` / `stopNow` | `factory.paused` follows. `stopNow` also aborts running jobs and leaves the factory paused |
| `setModel {model, agent?}` | writes the agent's `model` override. `model: null` clears it |
| `setModel {model, role}` | puts the model first in the role's list in `config/roles.md`. Applies from the next job |
| `rate {book, rating 1-5, note?}` | writes `rating` and `rating_note` into `books/<slug>/book.md`, then `book.updated`. Out-of-range ratings are ignored |
| `setTopicActive {id, active}` | edits the `active` cell in `topics.md`, then `topics.updated` |
| `addIdea {text, topic?}` | creates `ideas/<slug>.md` (source `user`). The first line is the title. Your ideas are picked before generated ones |
| `saveSettings {kindleAddress, fromAddress, smtpHost, smtpPort, smtpUser, smtpSecure}` | writes `config/settings.md` (the text below the frontmatter is kept) |
| `setSecret {name, value}` | stores the value in the Windows credential store. Allowed names: `SCRIPTORIUM_SMTP_PASSWORD` and the `api_key_env` of each provider in `config/providers.md`. Anything else is refused (and logged without the value). Then `secrets.updated` |
| `sendToKindle {book}` | the engine mails `out/<slug>.epub` with nodemailer. Answers with `kindle.sent` |
| `coverRendered {book, ok, error?}` | main's answer to `cover.render` |
| `askResearcher {question, book?, idea?}` | creates a research job (task `research`, role `researcher`, `requested_by: you`). With `book` the notes go to `books/<book>/research/`, otherwise (also with `idea`) to the shared `research/`. The same question for the same book or library is the same job (`research--<book or shared>--<hash>--r0`): asking again does nothing. The per-book limit is `research_limit_per_book` in `config/factory.md`. At the limit the engine sends `engine.warning`. Without a researcher in `agents/` nothing is queued and a warning is sent. There is no direct answer event: watch the researcher's agent state and the `handover` line |

## Research (Phase 7)

- Files: shared notes `research/<slug>.md`, notes of one book `books/<slug>/research/<slug>.md`. Frontmatter: `kind: research`, `question`, `scope` (`book`|`shared`), `book`, `created`, `asked_by`, `purpose`, `provider`, `unverified` (true when the facts come from the model's own knowledge), `sources: [{url, title, retrieved}]`. Body: one line per fact, ending with `(source: <url>, <date>)`. The notes are in the search index (`kind: research`, book `''` for shared ones).
- Per book: `research-plan.md` (the architect's questions and their job ids, written before the outline), `reports/prep-ch-NN.md` (the writer's questions before chapter NN, only when the prep step is on), `reviews/*` carry `research_jobs: [ids]` when a reviewer asked something.
- New job tasks: `research_plan` (architect), `research_prep` (writer), `research` (researcher), `research_fix` (writer, replaces `[RESEARCH: ...]` markers). New job frontmatter field `label`. Book stages are unchanged (the plan runs in `outline`; waiting for research keeps the current stage).
- Config: `config/providers.md` entries with `kind: search` (`engine`, `price_per_request`, `api_key_env`) and `search_order`; `config/factory.md` `research_limit_per_book` and `research_prep_genres`; `config/formats.md` `research_prep`.
- The `waiting-research` agent state is still not emitted by the engine: a book that waits for research just has no job for its writer (the writer takes other work).

## Reader

When a book is published (and again whenever its EPUB is rebuilt, for example when the cover PNG arrives), the engine writes the unzipped book to `books/<slug>/out/reader/`: `index.html` (table of contents with links), `cover.xhtml`, `title.xhtml`, `chapter-NN.xhtml`, `style.css`, `images/cover.png`. `BookSummary.readerDir` is that folder (relative). The in-app reader should open `<dataDir>/<readerDir>/index.html` in a sandboxed view (file URL, no node integration, no preload). `npm run engine -- rebuild-reader --data <dir>` creates it for books published earlier.

## What main needs

- Nothing new for the commands: forward every command from the renderer to the engine and every engine event to the renderer, as now. Do not filter by type, new events will keep arriving.
- `cover.render` is handled in main (already done in `src/main/cover.ts`): render the HTML to a PNG at the given size and answer `coverRendered`. On engine start under Electron, covers left `pending` are requested again by the engine itself.
- Opening a book folder: `shell.openPath(<dataDir>/books/<slug>)`. Opening the EPUB for another app: `shell.openPath(<dataDir>/<epub>)`.
- `setSecret`: the renderer sends the value over the normal command channel. Do not log commands of this type in main (the value is in the command).
- `SCRIPTORIUM_NO_WINDOW=1` runs main without the window (used for scripted cover checks).

## Environment variables the engine reads

- `SCRIPTORIUM_DATA`: the data folder (the `--data` argument wins).
- `SCRIPTORIUM_SEED`: the seed folder to copy from on first start (set it to the packaged `seed/` resources folder).
- `SCRIPTORIUM_SQLITE_VEC`: full path of the sqlite-vec library (`vec0.dll`). Without it the engine asks the `sqlite-vec` package, which finds the file inside `node_modules`. In a packaged app the DLL must be outside the asar archive (`asarUnpack` for `sqlite-vec-windows-x64`), and this variable can point at it.
- `SCRIPTORIUM_NO_WINDOW=1` (main): run without the window.
- API keys: the variables named in `config/providers.md` (including `TAVILY_API_KEY` for web search; Wikipedia needs none), and `SCRIPTORIUM_SMTP_PASSWORD`.

## Changes since the first version of the contract

1. `snapshot` got `models`, `roleDefaults`, `topics`, `settings`, `secretsSet`, typed `books` and richer `agents`.
2. New events: `agent.hired`, `agent.removed`, `factory.paused`, `book.updated`, `topics.updated`, `kindle.sent`, `secrets.updated`.
3. New commands: `setTopicActive`, `addIdea`, `saveSettings`, `setSecret`. `rate` and `sendToKindle` are implemented. `setModel` accepts `model: null`.
4. Part B (long books) changed no event or command. New book stages you may see in `BookSummary.stage`: `outline` (also while the outline is reviewed), `drafting`, `length-fix`, `reviewing`, `rewriting`, `publishing`. New files per book: `made.md` (how it was made), `reports/`, `summaries/`, `bible/characters|places/`, `reviews/act-*`.
5. Phase 7: `askResearcher` is implemented (see the command table). `handover.label` of research requests is the question. New `spend` events for search requests. Review frontmatter may carry `chapters` (named chapters to rewrite, as before) and `research_jobs`. Rewrite rounds are now targeted: `book.md` has `rewrite_chapters` (the chapters of the round), `tension_rewrite` (those among them that are in a flat tension stretch) and, after the end-of-book thread check, `open_threads` (threads still open at publishing). No event or command changed for this.

## Non-fiction (Phase 8)

- No event or command changed. `setTopicActive` and `topics.updated` already carried everything the topic overview needs (`TopicSummary`: `section`, `kind`, `active`, `target`, `done`, `inProgress`). The overview is in the renderer (`src/renderer/ui/Topics.tsx`, grouping in `store/shelves.ts`).
- A book made with a `nonfiction: true` format has `nonfiction: true` in `book.md`. Its job tasks are the usual ones plus `factbase_update` (archivist, unit `chNN`, before each chapter is drafted) and `fact_check` (fact-checker, instead of `review`, unit `book`). Both appear in `job.started`/`agent.state` like any task. The fact-checker is a reviewing agent (`reviewing` state), and sits in the archive room.
- New files per non-fiction book: `factbase/thesis.md`, `terms.md`, `sources.md`, `facts.md`; reviews `reviews/book-fact-checker-r<round>.md` carry `claims: [{chapter, claim, problem: unsourced|contradicted, detail}]`, `chapters` and `research_jobs`. There is no `bible/` folder. The EPUB and `out/reader/` end with a `References` chapter (one more `chapter-NN.xhtml`) built from the sources the chapters cite.
- Research limit: `research_limit_nonfiction` in `config/factory.md` (default 40) replaces `research_limit_per_book` for non-fiction books.

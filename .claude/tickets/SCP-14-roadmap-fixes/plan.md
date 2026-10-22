# SCP-14: Roadmap fixes (Scriptorium)

Ticket folder: `.claude/tickets/SCP-14-roadmap-fixes/` (this plan, plus a `changelog.md` that each phase appends to). Branch `SCP-14_roadmap-fixes` from `master` (794fd23, clean). Commits are named `SCP-14: <summary>`, one or more per phase.

The source is the "Scriptorium" and "All three" sections of `C:\projects\Personal\creative-hub\ROADMAP.md` (2026-10-21). Every item was checked against master. Where a bug was confirmed in the live data folder (`~/Scriptorium`, read only), the evidence is cited.

## Ground rules for the implementer

- Read `CLAUDE.md` and the Decisions table in `docs/design.md` first. Each phase adds its own Decisions row or rows, dated 2026-10-21 or later, saying "(Ticket SCP-14, branch SCP-14_roadmap-fixes)", plus one History line. When it changes a behaviour that an earlier row describes, it says "Overrides <row> where it differs" and also updates the matching body section.
- Every MCP change goes into `docs/mcp.md`. Visual-novel changes go into `docs/visual-novel.md`. Seed config bodies (`seed/config/*.md`) document new fields.
- Every new UI control gets a `data-testid`. The demo engine `src/renderer/demo/fake.ts` must handle every new command or field the UI sends or reads.
- Tests use vitest with temp data folders (`tests/helpers.ts` `makeEnv` / pipeline env). Never touch `~/Scriptorium`.
- **Never start the engine** against the real data folder: no `yarn engine`, `yarn headless`, `yarn dev` or app start. It resumes the factory and spends money.
- Node comes only from fnm.
  - Bash: `eval "$(fnm env --shell bash)"; fnm use 24.14.0`.
  - PowerShell: `fnm env --use-on-cd | Out-String | Invoke-Expression`.
- A phase that edits any file under `seed/prompts/` or `seed/templates/` re-runs `yarn seed:hashes` (added in Phase A) before it commits. A test enforces this.

## Status of every item

| Item | Status on master | Root cause (file:line) | Phase |
|---|---|---|---|
| X1 prompt sent twice | Still broken | `src/engine/mcp/tools.ts:689` sends `messages` whenever `t.messages.length > 1`. Every task has system + user, so the whole prompt goes out twice (in `user` and in `messages`) | B |
| X2 client `context` | Applies, but milder than in the other repos | Scriptorium has no 8,192 default: an unknown window means no cap in `memoryContext` (`pipeline/handlers.ts:189-190`) and the 20,000-token default in `sourceExcerpt` (`pipeline/adapt.ts:106-120`). The seed client model (`seed/config/providers.md`, `- id: client` block) has no `context` | A |
| X3 client provider in old data folders | Still broken | `store/dataFolder.ts:107` copies seed files only when missing. No migration adds `client` to an existing `config/providers.md` (only `client-search` is added, `store/migrations.ts:157-190`) | A |
| X4 providers.md reload | Already works; verification only | `engine.ts:570-577`: a `config` watch event for `providers` runs `registry.load()`, sends a snapshot and calls `discoverModels()`. No test covers providers.md (`tests/scheduler.test.ts:455` covers agents and factory.md) | A (test) |
| S1 wait tool | Missing | No tool exists. The hub uses `creative-hub/scripts/wait-book.ps1` | B |
| S2 absolute paths | Still broken | `summary.ts:78` makes data-folder-relative paths. `factory_status` (`mcp/tools.ts:115-137`) has no `dataDir` | B |
| S3 parsed script | Missing | Only `publish/xhtml.ts` reads the grammar (`SCENE`, `CAST`, `LINE` at :14-17). The JSON shape is in `docs/visual-novel.md`, section "A JSON shape for the parsed book" | B |
| S4 full MCP run | Verification only | Done live in `creative-hub/runs/the-clockless-god.md` (18 chapters, all model work through MCP, published). No code | B (docs) |
| S5 `add_story {models}` at start | Still broken | `pipeline.ts:477-483` queues `start_book` with no idea or book. `scheduler.ts:308` looks up a book model only when `j.book` is set. `handlers.ts:284` picks the idea inside the job, after the model was chosen | C |
| S6 day limit blocks the role | Partly misdiagnosed; there is a real gap | `router.candidates` (`models/router.ts:89-115`) already drops day-full and down providers while any usable one is left. In the live case all three were unusable (OpenRouter day-full, Strata and LM Studio down), so `candidates` returned all of them. The scheduler then hit `hasCapacity` false on the day-full one and broke out (`queue/scheduler.ts:317-322`). Literally "trying the next candidate" would launch on a down server, fail 3 attempts (2 s, 4 s) and fail the book. Wrong; see the fix | C |
| S7 missing embeddings fails a draft | Still broken, confirmed | In a long book, `draft_chapter`, then `memoryContext` (`handlers.ts:187-204`), then `buildDraftContext`, then `index.search` (`memory/context.ts:129` and `:141`) with no try/catch. The embedding fetch throws ECONNREFUSED and the job fails. The scheduler's backoff of 2 s and 4 s (`scheduler.ts:589`) matches the live log. `MemoryService.available()` (`memory/service.ts:15-18`) ignores `provider.down` | C |
| S8 "revise" without notes | Still broken, root cause found | The live job `~/Scriptorium/jobs/done/the-hour-that-happens-twice--check--ch12--r0.md` shows DeepSeek putting the itemised problems as objects inside `chapters`. The zod schema (`pipeline/longHandlers.ts:16-23`) refused it. The repair round (`pipeline/llm.ts:94-101`) got a "valid" answer that dropped the items, so the notes kept only "Three concrete fixes below." No check exists for a revise without usable notes | D |
| S9 rewrite gets only a summary | Still broken, same root cause | `the-clockless-god--check--ch11--r0.md`: the details were in `chapters[]` objects and were lost in the repair round. `ch-11-check.md` holds only the summary paragraph. `handlers.ts:796` passes the whole file body, which is all there was | D |
| S10 "about 4091 words" | Still broken, confirmed | `handlers.ts:840` uses `chapter_words: target_words / chapters.length`, which counts the chapters written so far. At the ch11 check, 45,000 / 11 = 4,091 | E |
| S11 clearing a book model on a published book | Still broken | `mcp/tools.ts:592` refuses terminal stages other than rejected, for null too | B |
| S12 reopen a published book | Still broken | `mcp/tools.ts:614` and `pipeline/pipeline.ts:127` accept only `rejected` | B |
| S13 pin not exclusive | Still broken | `scheduler.ts:352-370` `pickAgent`: a pin only restricts the pinned agent. Other agents are never excluded from the book's jobs, and the pin gives no sort preference (only the writer's `agent_hint`, with its 20 s wait at :363-367) | C |
| S14 humanizer guards | Still broken | `pipeline/humanizerHandlers.ts:158-185` has no fragment guard and no language guard. `newNames` (:129-145) flags units such as "Hz". The seed prompt even says "Sometimes a sentence is one word." (`seed/prompts/humanizer/humanize_chapter.md`) | F |
| S15 seed prompt upgrades | Missing | `store/dataFolder.ts:86-92` never overwrites. There is no history of seed versions | A |
| S16 humanizer seed model | Open | `seed/config/roles.md:21-22` `humanizer: [strata, paid]` | A |
| S17 refresh a published book's fact base | Missing | The refresh runs only from `advance` before a rewrite or review round (`pipeline/advance.ts:228-233`), and `advance` skips terminal books (`advance.ts:292`) | B |
| S18 researcher drops facts | Still broken | `pipeline/researchHandlers.ts:143-162`: one summarising pass, a cap of 12 facts (:161), and `copiesPage` (:155) drops any fact that quotes 12 or more words verbatim. Nothing checks that the page's figures and dates reached the notes | F |
| S19 article slugs | Still broken | `store/ideas.ts:22-29` cuts to 60 characters mid-word, from the premise label (`shared/brief.ts:133-137`). `pipeline/books.ts:21-28` cuts to 48 mid-word (`france-s-atomic-clock-on-air-the-als162-signal-t`) | F |
| S20 news mode for every article question | Still broken | `researchHandlers.ts:62` and `:121` set `news: true, days: 7` for every search of an article | F |
| S21 adaptations name places freely | Still broken | Neither the draft nor the rewrite prompt for script formats lists the bible's place names, and the engine never checks `SCENE:` places | E |
| S22 leaked prompt text accepted | Still broken, confirmed | `~/Scriptorium/books/the-clockless-god-2/chapters/history/ch-09-r2.md` ends with the template's closing paragraphs. `ClientTaskQueue.submit` (`models/client.ts:166-178`) checks only a schema, and the handlers keep everything after `cleanProse` | C (plumbing), E and F (handlers) |
| S23 choice wording fixed at the outline | Still broken | The rewrite (`handlers.ts:775-855`) writes only the chapter body. Choices live only in `outline.md` frontmatter | E |
| S24 script word targets | Still broken | The short-book length gate (`advance.ts:337-354`) compares with the format range ±15%, not the book's target. There is no per-chapter check | E |
| S25 prose word targets | Still broken | The expand retry exists only for long books under 80% (`handlers.ts:636`). Nothing handles too long. Long books have no length gate at all (`advance.ts:338` `!s.format.long`) | E |
| S26 reviewers don't know the dates | Still broken | The review prompts (`handlers.ts:714-728`, `longHandlers.ts:80-88`) carry no year or calendar. The outline records no story year | D |
| S27 archivist mis-files | Still broken | `memory/bible.ts:82-99` `resolveEntryFile` matches only by exact `entryKey`, with no aliases and no word-subset match. No date or weekday check | D |
| S28 rewrite carries the whole book | Still broken | `handlers.ts:823-829` adds every other chapter in full, long books included. `:797-801` adds every revise note on the whole book | E |

## Phases and order

```
A (config, migrations) ─┐
                        ├─> C (scheduler, models, memory, pins) ─┬─> D (reviews, calendar, archivist) ─> E (writer, rewrites, lengths, choices, places, leak guard)
B (MCP surface) ────────┘                                         └─> F (humanizer, research, slugs)
                                                                           └─> G (wrap-up)
```

- **A and B can run in parallel.** Their files are disjoint. A owns `store/migrations.ts`, `store/dataFolder.ts`, `seed/config/*`, `scripts/`, `package.json` and the new `store/seedHistory.ts`. B owns `mcp/tools.ts`, `pipeline/pipeline.ts` (the `reopenBook` part), `engine.ts`, `publish/script.ts`, `docs/mcp.md` and `docs/visual-novel.md`.
- **C comes after B.** Both touch `mcp/tools.ts`, `engine.ts`, `pipeline/pipeline.ts`, `shared/protocol.ts` and `docs/mcp.md`.
- **D and F can run in parallel after C.**
  - D owns `pipeline/longHandlers.ts`, the review part of `pipeline/handlers.ts`, `pipeline/llm.ts`, `memory/bible.ts`, the new `pipeline/reviewNotes.ts` and `pipeline/calendar.ts`, and the reviewer, archivist and architect-outline prompts.
  - F owns `pipeline/humanizerHandlers.ts`, `pipeline/researchHandlers.ts`, `research/*`, `store/ideas.ts`, the new `shared/slug.ts`, the slugify lines of `pipeline/books.ts`, and the humanizer, researcher and research-plan prompts.
  - The only shared file is the generated `src/engine/store/seedHistory.ts`. Regenerate it after merging (`yarn seed:hashes`).
- **E comes after D** because both edit `pipeline/handlers.ts`. It needs C (the leak-guard module and plumbing). E and F both touch `pipeline/books.ts`, but in different functions. Merge F first, or rebase.
- **G** runs last: the full run of checks, then the docs and changelog consistency pass.

Each of the parallel pairs adds its own design.md row at the end of the Decisions table and its own History line. When merging, keep both: append and reorder by date.

---

## Phase A: config, seeds and migrations (X2, X3, X4, S15, S16)

### A1. X2: `context: 200000` on the seed client model

- In `seed/config/providers.md`, inside the `- id: client` block, under `- id: claude-code`, add `context: 200000`.
- In the "Client provider" body section, add one line: "`context: 200000`: Claude's window. It sizes the memory context (45%) and source excerpts (30%); without it Scriptorium uses its smaller defaults."

### A2. X3: add missing seed providers to an existing providers.md

In `store/migrations.ts`, add `migrateClientProvider(dataDir, seedDir)`, modelled on `migrateClientSearch` (text-level edit, keeps comments and line endings, idempotent).

1. **No client entry yet.** If the frontmatter has no provider with `kind: client` and no `- id: client` line:
   - Take the seed's `client` block, including the two comment lines directly above `- id: client`. Read it from `seedDir/config/providers.md` with the same block scanner as `formatBlocks`, extended to keep preceding `  #` comment lines. If there is no seed, use a built-in constant.
   - Insert it before the first `kind: search` provider. If there is none, insert it before `search_order:`, else before the closing `---`.
   - Log `config/providers.md: added the client provider (client/claude-code, switched off, context 200000)`.
2. **Client entry without a context.** If a `kind: client` provider exists and its `claude-code` model block has no `context:` line, insert `        context: 200000` after that model's `family:` line, at the same indent. Log it.
3. The added block keeps `enabled: false`. Never switch on a provider the user has.

Wire it into `initDataFolder` after `migrateClientSearch` (`store/dataFolder.ts:112`).

Tests (new `tests/migrations.test.ts`):
- A providers.md without client gets the block before `tavily`. Comments and CRLF stay. A second run changes nothing.
- An existing client entry without context gets `context: 200000`; one with `context: 100000` is untouched.
- A folder without providers.md is untouched.
- The engine registry loads the migrated file: `registry.getModel('client/claude-code')?.context === 200000`, provider not available (switched off).

### A3. X4: test the providers.md reload

No code change. Add to `tests/scheduler.test.ts` (or a new `tests/reload.test.ts`, which avoids conflicts with C): "providers.md edits apply without a restart (watcher)".

1. Start `watchDataFolder` as the existing watcher test does (`tests/scheduler.test.ts:455`).
2. Rewrite `config/providers.md` with an added `kind: client` provider `cl` (model `claude-code`, `context: 123456`). Wait until `engine.registry.getModel('cl/claude-code')?.context === 123456`.
3. Change the context to 200000 and wait for it.
4. Set `enabled: false` and wait for `providers.get('cl').available === false`.
5. Assert that a `snapshot` event followed each change.

Record in design.md History: "X4 verified by test, no change".

### A4. S15: upgrade unedited seed prompts in existing data folders

- **New script `scripts/seed-hashes.mjs`** (plain Node ESM, no tsx), with `"seed:hashes": "node scripts/seed-hashes.mjs"` in `package.json`.
  - For every file git tracks under `seed/prompts/` and `seed/templates/`, it takes every historical version (`git log --format=%H --follow -- <path>`, then `git show <sha>:<path>`) plus the working-tree file.
  - It normalises CRLF to LF, hashes with `sha256` (first 16 hex chars) and dedupes.
  - It writes `src/engine/store/seedHistory.ts`:
    - `export const SEED_HISTORY: Record<string, string[]> = { "prompts/humanizer/humanize_chapter.md": [...] }`, with paths relative to the seed folder, sorted, and a header comment saying the file is generated;
    - `export const seedHash = (text: string) => ...`, the same normalisation and hash.
  - It is TS rather than JSON so that `seed/` (copied file by file into data folders) holds no stray file, and the packaged engine bundles it.
- **New `migrateSeedPrompts(dataDir, seedDir, history = SEED_HISTORY)`** in `store/migrations.ts`. For each `rel` in the history whose data file and seed file both exist:
  1. `h = seedHash(data)`.
  2. If `h === seedHash(seed)`, skip.
  3. Else, if `history[rel].includes(h)`, the user never edited it: overwrite the data file with the seed text, converted to the data file's EOL, using `atomicWrite`. Log `prompts/<rel>: upgraded to the current seed version (it was an unedited earlier version)`.
  4. Else it was edited: keep it, silently.

  Call it in `initDataFolder` after the other migrations.
- **Tests** (`tests/migrations.test.ts`):
  - With an injected history and a temp seed folder: an older version is upgraded (EOL kept), an edited file is kept, the current version is untouched, and a missing data file is left to `copyTree`.
  - A guard test: for every file under `seed/prompts` and `seed/templates`, `SEED_HISTORY[rel]` contains `seedHash(current file)`. This fails whenever someone edits a seed prompt without running `yarn seed:hashes`, and so keeps the history complete.
- **Docs.** A design.md Decisions row "Seed prompt upgrades". The `seed/config/settings.md` or providers body needs nothing. CLAUDE.md gets one line: "After editing a file under `seed/prompts` or `seed/templates`, run `yarn seed:hashes`."

### A5. S16: humanizer seed chain

- `seed/config/roles.md:21-22`: `humanizer: models: [deepseek/deepseek-flash, paid]`. Update the body line 48 to explain why: Strata and the free OpenRouter models fragmented and needed retries, and DeepSeek Flash is cheap.
- In the humanizer migration (`migrations.ts:25-29`), a data folder with no humanizer role now gets `[deepseek/deepseek-flash, paid]`, not the line editor's chain. This is a design change: the row says it overrides the SCP-13 seed chain.
- Folders that have a chain keep it. No migration of existing chains.
- Tests: update any test that asserts the seed chain or the migrated chain (`tests/humanizer.test.ts`).

**Acceptance A:**
- `yarn typecheck`, `yarn lint` and `yarn test` pass. The new migration and reload tests pass.
- `yarn seed:hashes` is idempotent: run twice, it gives no diff.
- `initDataFolder` on a copy of a fixture folder logs the expected migrations once, and nothing the second time.

**Done (A), 2026-10-21.** Commit `SCP-14: phase A`. Verification: typecheck and lint clean, `yarn test` 401 passed (baseline 390 with one flaky pipeline test that passes alone), `yarn seed:hashes` twice gives no diff.
- New: `scripts/seed-hashes.mjs`, `src/engine/store/seedHistory.ts`, `tests/migrations.test.ts`, `tests/reload.test.ts` (X4 as a separate file, as the plan allows).
- `migrateClientProvider` and `migrateSeedPrompts` in `store/migrations.ts`, wired in `initDataFolder`. The humanizer migration now gives `[deepseek/deepseek-flash, paid]`.
- Deviation: `tests/clientsearch.test.ts` `OLD_PROVIDERS` now has a client provider (with context), otherwise the new migration also added the client block and the test's "only one migration" asserts failed. The `SEED_HISTORY` file is TS with a `createHash` import, as planned.

---

## Phase B: MCP surface (X1, S1, S2, S3, S4, S11, S12, S17)

### B1. X1: send `messages` only for real conversations (`mcp/tools.ts:683-689`)

- `system`: all system messages joined, as now.
- Let `turns` be the non-system messages.
- If `turns` has exactly one user message and no assistant message:
  - return `user: turns[0].content` and **no** `messages`.
- Else (a repair or follow-up round):
  - return `messages: turns.map(...)`, the conversation without the system turns, since `system` already holds them;
  - set `user` to the **last user turn only**, so nothing is sent twice in full;
  - change the `get_client_task` description to say: "`user` is the turn to answer; `messages` holds the whole conversation when there is more than one turn".

Tests: update `tests/mcp.test.ts:395`. Two system messages and one user message now give no `messages`. Add a case where the handler's second call has `[user, assistant, user]`: assert `messages.length === 3` (no system), `user` equals the last user content, and `system` is unchanged. Update `docs/mcp.md:107`.

Book Translator and VN Studio need the same change in their own repos. That is out of scope here; say so in the changelog.

### B2. S1: new tool `wait_for_book`

Input:
- `slug` (a story slug or a book slug);
- `timeout_seconds?` (default 60, minimum 1, maximum 900);
- `stop_on_client_task?` (default true).

Logic, in a polling loop every 1 s that honours the MCP request's abort signal (the SDK handler's second argument `extra.signal`; extend `run` to pass it through):

1. Resolve the slug. If a book with this slug exists, use it. Else, if it is a story, take its `data.book` (null while not started). Else it is a tool error.
2. It is **done** when the book's stage is `published`, `rejected` or `failed`.
3. If `stop_on_client_task` is set, it also returns early when the client queue holds a *waiting* task:
   - with `book === slug`;
   - or, while the story has no book yet, a waiting task with `role === 'editor-in-chief'` and `task === 'start_book'`. This needs S5's start-job-on-client; until C, only books are matched.
4. Return:
   - `{done, reason: 'published'|'rejected'|'failed'|'client-task'|'timeout', story, book, title, stage, chaptersWritten, chaptersPlanned, words, targetWords, score, clientTasks: {waiting, leased} for this book, folder, epub, articlePage, waitedMs}`;
   - paths absolute (see B3);
   - `reasons` for rejected or failed.

Description: "Long tool. Call it again after `timeout`; answer client tasks when it returns `client-task`."

Tests (`tests/mcp.test.ts`):
- A story without a book times out after 1 s with `book: null`.
- A book whose stage is set to `published` by `books.update` while waiting returns `done: true, reason: 'published'` within 2 s.
- With a client provider and a waiting client task for the book, it returns `reason: 'client-task'`.
- An unknown slug is a tool error.

Docs: `docs/mcp.md` Reading section, and the hub note that `scripts/wait-book.ps1` can be retired (hub repo, not here).

### B3. S2: absolute paths

- `get_book`: keep the relative fields and add `paths: {dataDir, folder, epub, coverPng, readerDir, articlePage, articleMarkdown, chapters}`. Each is absolute (`path.join(engine.dataDir, rel)`, native separators) or null when the file is not there. `chapters` is the chapters folder.
- `factory_status`: add `dataDir: engine.dataDir`.
- `list_articles` rows: add `pagePath` (absolute).
- `list_books` rows: add `folder` (absolute).
- Docs: "`paths` are absolute (Windows separators); the older relative fields stay".
- Tests: `factory_status.dataDir === env.dir`, and `get_book(...).paths.folder === path.join(env.dir, 'books', slug)`.

### B4. S3: parsed script

New `src/engine/publish/script.ts`. It reuses `SCENE`, `CAST` and `LINE` from `publish/xhtml.ts` and follows the grammar in `docs/visual-novel.md`.

- `parseScript(body): {scenes: ScriptScene[]}`.
  - A scene is `{place, time, background, beats}`.
  - A beat is one of `{type: 'cast', cast: [{name, look}]}`, `{type: 'line', speaker, expression, text}`, `{type: 'narration', text}`, or `{type: 'break'}` for `---`.
  - `SCENE: a, b` splits at the **last** comma: place `a`, time `b`. Without a comma, the whole text is the place and the time is `''`.
  - A `## heading` also opens a scene.
  - `background` holds the narration lines after a SCENE up to the first speaker or cast line, joined.
  - Speaker names are title-cased against the bible names when one matches (`sameName`); else the name is kept as written in capitals.
  - Text before the first scene goes into an implicit scene with place `''`.
- `parseLightBible(text)`: `characters [{name, looks, voice}]` (split ` Voice: ` from the bullet), `places [{name, looks}]` and `style` (the `## Style` text). Reuse the `bibleEntriesOf` regex logic from `pipeline/series.ts:64-80` (export a pure text version).
- New MCP tool `get_script {book, chapter?}`. The book must be a script format (`book.md` `script: true`), else a tool error naming the format. It returns the JSON shape of `docs/visual-novel.md`:
  - `{slug, title, author, genre, format, style, characters, places, chapters: [{n, title, choices, ending, sourceChapters?, scenes}]}`;
  - choices and ending come from `books.outline()`;
  - with `chapter`, only that chapter;
  - any stage (drafts too).
- Tests (new `tests/script.test.ts`): the doc example parses to the doc's JSON (place "The harbour wall", time "dusk", a cast beat, a line with expression, narration, a break); no comma; a `## heading` scene; a speaker not in the bible; bullet parsing with `Voice:`. MCP: `get_script` on a script book returns chapters with scenes, and is refused for a prose book.
- Docs: `docs/visual-novel.md` ("A JSON shape ...": "`get_script` returns this") and `docs/mcp.md`.

### B5. S4: verification only

No code. Add a History line in `docs/design.md`: "SCP-07's open point 'full book run over MCP' was verified live (creative-hub `runs/the-clockless-god.md`, 2026-10-20)". The hub ROADMAP item can be struck through (hub repo, see G).

### B6. S11: book models at any stage

- `mcp/tools.ts:592`: drop the stage check. `set_book_model` works on any stage, so a model can be set before `retry_book` or `reopen_book`. `model: null` always works.
- `engine.ts:519-531` needs no change.
- Docs: `docs/mcp.md:100`, `:119` and the "Models per book" row: "refused for published and failed books" is replaced, with a new row saying it overrides that sentence.
- Tests: `set_book_model {model: null}` on a published book clears `role_models`, and setting one on a failed book works.

### B7. S12: reopen a published book

`pipeline/pipeline.ts:123-174` `reopenBook` accepts `rejected` **or** `published`. For a published book:

- Topics: `adjust(topic, {done: -1, inProgress: 1})`. A rejected book keeps `{inProgress: 1}`.
- Mode `rewrite` without `chapters`: use the chapters the round's reviews named, pass or revise, from `state.reviews` `chapters`.
  - If none named any, refuse with "give the chapters to rewrite (a published book's reviews named none)", so a whole published book is never rewritten by accident.
  - A rejected book keeps today's `chaptersToRewrite` behaviour.
- Patch book.md: `reopened_from: 'published'`, `published_before: <old published>`, plus the existing fields. Keep `out/` (the old EPUB and article page) until the publisher publishes again; `publish` overwrites them.
- The non-fiction refresh before the round already happens (`advance.ts:365` and `:373`), which also covers S17 on reopen.
- `mcp/tools.ts:600-626`: accept both stages. Change the description and the error text.
- In `engine.ts`, `releasePins` already ran at publish. No change.

**Default for the user to confirm:** if the publisher rejects the reopened round, the book becomes `rejected` like any other. The old EPUB stays in `out/` and the old text in `chapters/history/`. It can be reopened again.

Tests (`tests/pipeline.test.ts`, mirroring "a rejected book is reopened ..."):
- A published book is reopened with `chapters: [2]`. The `--r<r+1>` rewrite runs, then the reviews, then it is published again. Topic `done` goes back.
- A published book without chapters and with no named chapters is refused.
- MCP `reopen_book` accepts published and refuses a book in progress.

Docs: `docs/mcp.md` (the `reopen_book` paragraph and `:92`). The design row "Reopen a rejected book" is overridden.

### B8. S17: refresh a book's fact base on demand

- New `Engine.refreshFactbase(slug)`:
  - the book must be non-fiction (`nonfiction: true` or `article: true`);
  - count `unmergedNotes` (`pipeline/nfcontext.ts`); if there are none, return `{queued: null, unmerged: 0}`;
  - else enqueue `{id: '<slug>--factbase--refresh--manual<ms>', task: 'factbase_update', role: 'archivist', book: slug, unit: 'refresh', round: book.round, locks: ['bible:<slug>']}`, then kick.
  - It works at any stage. The handler (`nonfiction.ts:82` and `:134`) does not depend on the stage. `loadState`'s `refreshJobs` map already tolerates other ids, and `refreshStep` checks only its own id.
- New MCP tool `refresh_factbase {book}`, returning `{queued, unmerged}`. The description says the published text and references do not change: reopen the book (S12) to have the writer use the new facts.
- Tests: a published non-fiction book with one unmerged verified note queues the job. After the job, `factbase/merged.md` lists the note and `facts.md` has the fact. A book with no unmerged notes returns `queued: null`. A fiction book is a tool error.

**Acceptance B:**
- New and updated MCP tests pass.
- `docs/mcp.md` lists `wait_for_book`, `get_script` and `refresh_factbase`, and documents the absolute paths and the X1 change.
- The tool-list test (`tests/mcp.test.ts:76`) includes the new tools.

**Done (B), 2026-10-21.** Commit `SCP-14: phase B`. Verification: typecheck and lint clean, `yarn test` run after the phase (see the commit notes in the final report).
- New: `src/engine/publish/script.ts` (`parseScript`, `parseLightBible`), `lightBibleEntries` exported from `pipeline/series.ts`, `Engine.reopenBook` (returns the reason, used by the command and the tool), `Engine.refreshFactbase` and `Pipeline.refreshFactbase`, tools `wait_for_book`, `get_script`, `refresh_factbase`. `run` in `mcp/tools.ts` passes the request's abort signal.
- Deviation: `reopen_book` over MCP now returns the engine's real reason (for example "give the chapters to rewrite") instead of the generic "could not be reopened". The refresh job's `requested_by` is `you`, as for other owner-made jobs. `wait_for_book` matches a story's `start_book` task by role and task only until Phase C gives the job an idea.
- Tests: `tests/mcp.test.ts` (messages, wait_for_book x3, paths, book models, reopen, get_script, refresh refused), `tests/script.test.ts`, `tests/pipeline.test.ts` (published reopen), `tests/latefacts.test.ts` (refresh on a published article).

---

## Phase C: scheduler, models, embeddings, pins, start models, answer-guard plumbing (S5, S6, S7, S13, S22 part 1)

### C1. S5: a story's `role_models` reach `start_book`

- `pipeline/pipeline.ts:477-483` `startBooks`: enqueue with `idea: pick.idea?.slug` (the job schema is loose; research jobs already carry `idea`) and `label: start "<idea title>"` when there is an idea.
- `queue/scheduler.ts`:
  - add `getIdeaModel?: (idea: string, role: string) => Promise<string|undefined>` to `SchedulerDeps`;
  - at :308, `bookModel = j.book ? await getBookModel(j.book, role) : typeof j.idea === 'string' ? await getIdeaModel?.(j.idea, role) : undefined`.
  - `JobFrontmatter` is loose, so read `(j as {idea?: unknown}).idea`, or add `idea: z.string().optional()` to `jobSchema` in `shared/schemas.ts`. Prefer adding it, with a doc comment.
- `engine.ts`: add `ideaModel(idea, role)`, reading `ideas/<idea>.md` `role_models`, with the same 3 s cache as `bookModel` (:506-516). Pass it into the Scheduler (:153).
- `pipeline/handlers.ts:284` `start_book`: when `ctx.job.idea` names a story that is still open, not waiting (`waitingStories`), and fits a free slot (`isArticleStory` with `room`), start that story. Else fall back to `pickNext` as now. This way the model chosen for the job and the story started agree.
- Tests:
  - Pipeline: `add_story {models: {'editor-in-chief': 'client/claude-code'}}` with a client provider. The `start_book` job becomes a client task with role `editor-in-chief`; answer it over the queue; the book starts with `role_models` copied.
  - Scheduler unit: a job with `idea` set uses `getIdeaModel` first.

### C2. S6: unusable providers never block, and a block is visible

- `models/router.ts:81`: make `usable(p)` public. Add `blockReason(p): string | null`, one of:
  - "down (<baseUrl> does not answer)";
  - "used up its requests for today (resets HH:MM UTC)";
  - "rate limit (N/min)", for `rpmWaitMs > 0`;
  - "busy (k of n requests at once)";
  - null.
- `queue/scheduler.ts:315-330` candidate loop:

  ```ts
  for (const m of models) {
    if (isPaidModel(m) && !budget.isExhausted(j.book).ok) continue
    if (!router.usable(m.provider)) { reasons.push(`${m.ref}: ${router.blockReason(m.provider)}`); continue } // down or day-full: never wait on it, try the next
    if (!router.limiter.hasCapacity(m.provider)) { busy = true; reasons.push(...); break } // concurrency/rpm: wait for the preferred provider (unchanged)
    ...
  }
  if (!chosen) { if (busy || reasons.length) { blocked.set(agent.id, reasons.join('; ')) } continue }
  ```

  `blocked` becomes a `Map<agentId, reason>`. The `waiting-provider` state carries the reason in `task`, so the agent panel and hover card show it.
- When every candidate is unusable the job **waits**. It is not launched onto a down server, which would fail it 3 times and fail the book. It starts once a server answers again (the 10 s `syncSlots`) or the day resets.
- `factory_status` gets `blocked: [{job, role, agent, reason}]`, from a new `Scheduler.blockedJobs()` kept by `tickOnce`. It also gets `providers: [{id, dayFull, resetsAt, down}]` for the API and local providers. Then an MCP client can see "nothing can run the editor-in-chief" and set a book model or `set_model client/claude-code`.
- **Optional, needs the user's OK:** a `last_resort_model` setting in `settings.md` (default empty), used when every candidate is unusable. It is not built by default: a `client` last resort would make the factory's own ideas wait for a Claude session.
- Tests (`tests/scheduler.test.ts`):
  - (a) Role `[a/x, b/y]`, with `a` day-full (rpd 1 and one request seeded): the job runs on `b/y` with no wait. This is a regression test; it already passes through `candidates`.
  - (b) Role `[a/x]`, with `a` day-full: the job stays queued, the agent is `waiting-provider` with a "used up" reason, attempts stay 0, and `blockedJobs()` lists it.
  - (c) `a` day-full and `b` down (a `concurrencyAuto` mock or `down = true`): the same wait, with both reasons, and no failed attempts. After `b.down = false` and a kick, the job runs on `b`.
  - The existing router test "everything down: try them anyway" (`tests/models.test.ts:307`) stays: it covers jobs already running.

### C3. S7: an embeddings server that is down is "server down", not a job failure

- `models/types.ts`: add `export class ServerDownError extends Error { name = 'ServerDownError'; constructor(message, readonly provider: string) }`.
- `models/registry.ts:492-499` `embed`: wrap it. A `ProviderError` with `unreachable` calls `this.markDown(m.provider)` (only a `concurrencyAuto` provider, as now) and throws `ServerDownError("the embeddings server <id> is not running (<baseUrl>)", id)`. The engine's `syncSlots` brings it back up when it answers.
- `memory/service.ts`: keep `available()` (configured) and add `ready()` (`available() && !provider.down`).
- `memory/context.ts:128-142`:
  - `buildDraftContext` gets an optional `log`;
  - each `index.search` is guarded: a failure, or `!ready`, skips the passages with one log line ("search skipped: <reason>; the chapter is written from the bible and summaries");
  - `memoryContext` (`handlers.ts:187-204`) uses `d.memory.ready()` instead of `available()` and passes `d.log`.
- `research/context.ts:31` uses `ready()`, so it goes straight to the keyword fallback without an error per note. `handlers.ts:381` (pitch similarity) uses `ready()`: no check and no upsert while it is down. The next `index_chapter`'s `reindex` picks the pitch up.
- `pipeline/longHandlers.ts:138-153` `index_chapter`: if `available() && !ready()`, throw `ServerDownError`. Never mark `indexed: true` without indexing. `reindex` errors propagate: an `unreachable` error becomes `ServerDownError`.
- `queue/scheduler.ts:575-578`: handle `ServerDownError` like `BudgetError`.
  - Requeue with `not_before` set 30 s ahead and no attempt counted.
  - Log "waiting: <message>".
  - Agent state `waiting-provider` with the message.
  - Emit `job.done ok:false` with the error.
- `factory_status`: add `embeddings: {model, provider, down}` (null when none is configured).
- Tests:
  - `tests/memory.test.ts`: `buildDraftContext` with an index whose embedder throws still returns a context without passages and logs once.
  - `tests/scheduler.test.ts`: a handler that throws `ServerDownError` is requeued with `attempts` 0 and `not_before` set, and the agent is `waiting-provider`.
  - A long-book pipeline test with an embedder that throws `ProviderError(..., unreachable)` and a provider marked `concurrencyAuto`: `draft_chapter` completes, `index_chapter` waits, and after the embedder recovers (`down = false`) the chapter is indexed. No job is failed and the book does not fail.

### C4. S13: exclusive pins

- `shared/schemas.ts:248-259` `agentSchema`: add `pin_exclusive: z.boolean().default(false)`.
- `queue/scheduler.ts:352-370` `pickAgent`:
  1. `owners` are the defs with `role === j.role && pin === j.book && pin_exclusive`, not retiring.
  2. If `owners` has any, only those may take the job: return the first free one, or undefined. The job waits for them, even while they are paused.
  3. Add a sort key: agents pinned to this book (exclusive or not) come before the others, after the hint. A pin is then a real preference too.
- `engine.ts:482-504` `assignBook(agent, book, exclusive?)` writes `pin` and `pin_exclusive: !!exclusive && book !== null`. `releasePins` (:534-541) clears both.
- `shared/protocol.ts:363`: the `assignBook` command gets `exclusive?: boolean`. `AgentSummary` gets `pinExclusive: boolean`. `summary.ts:119-137` `agentSummary` sets it.
- `mcp/tools.ts:820-836` `assign_agent {agent, book, exclusive?}`. The description explains it: "exclusive: only the agents assigned to this book (exclusively) take its jobs; without it the assigned agent prefers the book and others still help".
- UI, `ui/AgentPanel.tsx:125-135`: under "Works on", when a book is chosen, a checkbox "Only assigned agents work on this book" (`data-testid="agent-book-exclusive"`) sends `assignBook` with `exclusive`. Add `pinExclusive` to the store's `AgentView` (`renderer/store/model.ts:27`, `store.ts:187`). `renderer/demo/fake.ts:404-410` stores `exclusive` and sends `pinExclusive` in `summaryOf` (:195). This adds to the UI row's controls (design.md row).
- Tests:
  - Scheduler: two writers; A pinned exclusively to book b1, B free. A b1 job while A is busy waits more than 20 s of fake time (use `now` in `SchedulerDeps`) and is never taken by B. A non-exclusive pin lets B take it after the hint wait.
  - MCP: `assign_agent {exclusive: true}` shows `pinExclusive: true`.
  - Playwright (`tests/renderer/office.spec.ts`, demo): pick a book, tick the checkbox, and the store shows `pinExclusive`.
  - Docs: `docs/mcp.md:119` replaces "weaker alternative ..." with the exclusive option.

### C5. S22 part 1: answer-guard plumbing and the leak detector

- New `src/engine/pipeline/leak.ts`:
  - `instructionLines(templateBody: string, appended: string[]): string[]`:
    - render the template with every `{{var}}` replaced by `\u0000`;
    - split into lines, then into sentences on `[.!?]\s`;
    - keep segments without `\u0000` that are at least 40 characters long after normalising (lowercase, collapse spaces, strip markdown `*`, `_`, `` ` ``);
    - for each appended section, take its first two paragraphs (the heading and the instruction paragraph), split them the same way;
    - dedupe, at most 80 lines.
  - `findLeaks(answer, lines): string[]` returns the normalised candidate lines found as substrings of the normalised answer.
  - `stripTrailingLeak(answer, lines): {text, cut: boolean} | null`: find the earliest answer line containing a leak such that every non-blank line after it is a leak line or shorter than 25 characters. Cut there. Return null when a leak sits in the middle.
- Plumbing:
  - `models/types.ts` `RequestMeta` gets `forbid?: string[]` ("instruction lines an answer must not repeat; the client queue refuses one that does");
  - `queue/scheduler.ts` `ChatOptions` gets `forbid?: string[]`, passed into `meta` at :485;
  - `models/router.ts` passes `req.meta` unchanged (it already does);
  - `models/client.ts`: `add` stores `meta.forbid` on the task (not shown by `get_client_task`). In `submit`, for a task without a schema and with `forbid`, `findLeaks(text, forbid)` refuses with `{accepted: false, problems: ['the answer repeats the task\'s instructions ("<first leak, 80 chars>"): send only the chapter text, without the task text']}`.
- Tests:
  - `tests/leak.test.ts`: the template skeleton lines are found; the live ch9 tail (the three closing paragraphs of `rewrite_chapter_vn.md` and the `_choices.md` rewrite section) is detected and stripped as a trailing block; a chapter quoting nothing passes; a leak in the middle gives null.
  - `tests/models.test.ts` (client queue): `submit` refuses a prose answer containing a forbid line and keeps the task leased; the clean answer is accepted.

**Acceptance C:**
- All scheduler, models, memory and MCP tests pass.
- No existing test regresses. If a test relied on launching onto an unusable provider, update it and say why in the changelog.
- design.md rows:
  - "Blocked providers wait visibly" (overrides the "Provider limits" phrase "unless no other model is left" for scheduling);
  - "Embeddings server down";
  - "Exclusive pins";
  - "Start job uses the story's models";
  - "Answer guard (prompt leaks)".

**Done (C), 2026-10-21.** Commit `SCP-14: phase C`. Verification: typecheck and lint clean, full `yarn test` and `yarn test:ui` run at the end of the phase (counts in the final report).
- New: `pipeline/leak.ts`, `ServerDownError` (`models/types.ts`), `MemoryService.ready()`, `ModelRouter.usable/blockReason` (public), `Scheduler.blockedJobs()`, `getIdeaModel` and `idea` on jobs, `pin_exclusive` on agents with the UI checkbox, the demo engine and `AgentSummary.pinExclusive`, `factory_status.blocked/providers/embeddings`.
- Tests: `tests/leak.test.ts`, `tests/blockers.test.ts` (start job with a client story model, embeddings down in a long book), scheduler tests (a/b/c, ServerDownError, exclusive pins, idea model), `tests/models.test.ts` (client forbid), `tests/series.test.ts` (search failure), `tests/mcp.test.ts` (assign_agent exclusive, factory_status), `tests/renderer/office.spec.ts` (checkbox).
- Deviations: `instructionLines` takes the first two paragraphs of an appended section that hold an instruction (a paragraph of only `{{variables}}` does not count), so the live ch9 tail (the whole `_choices.md` rewrite section) is detected. `factory_status.providers` lists every available provider but search and client ones (mock ones too, which only tests have). The `last_resort_model` setting is not built (decision 3). No existing test needed changing for the blocked-provider rule.

---

## Phase D: reviews, checks, calendar, archivist (S8, S9, S26, S27)

### D1. S8 and S9: keep every problem a checker finds, and refuse a revise without usable notes

- New `src/engine/pipeline/reviewNotes.ts`:
  - `normalizeReviewJson(raw: unknown): unknown`:
    - if `raw.chapters` is an array, each number stays, a numeric string becomes a number, and an object becomes its chapter number (`chapter`, `n`, `ch` or `number`) **plus** a problem text pushed onto `raw.problems`;
    - `raw.problems` items that are objects become strings;
    - `problemText(o)`: `Chapter N: <issue|problem|description|text>` + ` Quote: "<quote|quote_new|quote_chapter>"` + ` Established: "<quote_established|quote_bible>"` + ` Fix: <fix|suggestion|change>`, with empty parts left out.
  - `notesProblem(verdict, notes, problems): string | null`. For a revise, a non-null result is the reason:
    - notes shorter than 40 characters with no problems;
    - notes promising items ("below", "as follows", "the following", "here are", a trailing `:`) with no list (no `-`, `*` or `1.` lines) and no problems;
    - a promised count ("three fixes", "2 problems"; number words two to ten) greater than the list items plus problems;
    - notes ending without terminal punctuation (cut off), unless there are problems.
  - `reviewBody(notes, problems)`: the notes, then `\n\n## Problems\n\n1. ...` when there are any.
- `pipeline/llm.ts` `chatJson`:
  - add `opts.normalize?: (raw: unknown) => unknown`, applied to `extractJson(text)` before `schema.safeParse`;
  - the repair message (:98-100) adds: "Keep everything your first reply said (every finding, quote and fix); change only the format."
- Schemas: `longHandlers.ts:16-23` `reviewSchema` and `handlers.ts:731-737` add `problems: z.array(z.string()).default([])`. Pass `normalize: normalizeReviewJson`. The provider JSON schema then lists `problems` as an array of strings, and the client submit check accepts it.
- After the parse in `check_chapter` (`longHandlers.ts:89`) and in `review` (`handlers.ts:738`), if `notesProblem(...)` returns a reason:
  1. Ask once more in the same job: messages + assistant (the first reply, clipped to 6,000 characters) + user. The user turn says: "Your verdict is revise, but <reason>. Reply again with the whole JSON object: the same verdict and scores, and every problem in "problems", one item each: where it is (chapter and a short quote), what is wrong, and what to change." Use the same schema and normalize.
  2. If it is still incomplete and this is not the job's last attempt (`ctx.job.attempts + 1 < (ctx.job.max_attempts ?? d.getFactory().max_attempts)`), throw `Error('the check said revise without usable notes: <reason>')`. The job runs again.
  3. On the last attempt, keep it, log a warning and write it. A book never fails over this.
- The written body is `reviewBody(notes, problems)`, for chapter checks and book or act reviews. The rewrite then gets everything: `handlers.ts:796` reads the whole check body, and `loadReviews` (:1003-1029) reads the whole review body.
- Prompts:
  - `seed/prompts/continuity-checker/check_chapter.md` and every `*/review*.md`: describe `"problems"` (a list of strings: where, quote, what is wrong, the fix; required for revise) and add `"problems": []` to the example JSON;
  - say that `chapters` holds numbers only.
  - For data folders with edited prompts (S15 upgrades the unedited ones): when a loaded template's raw text lacks `"problems"`, append the engine's built-in rule (`PROBLEMS_RULE` in `reviewNotes.ts`) with `appendToPrompt`, as with `ARTICLE_IDEAS_RULE` at `handlers.ts:256`.
  - Run `yarn seed:hashes`.
- Tests (new `tests/reviews.test.ts`):
  - the two live shapes, `chapters: [{chapter: 11, issue, quote_new, quote_established}]` and `[{type, quote_chapter, quote_bible, fix}]`, normalise into numbers plus problem strings;
  - `notesProblem` cases: "Three concrete fixes below." gives a reason; a notes list with 3 items and "three fixes" gives null; cut-off text gives a reason; a pass gives null;
  - pipeline: a mock continuity checker that first answers revise with "Two fixes below." and no list, then the full JSON, makes the follow-up ask, and the check file holds `## Problems` with 2 items. The `--chk` rewrite prompt contains both problem texts. A checker that never gives problems throws and is retried; on the last attempt it is accepted with a log line.

### D2. S26: the reviewers get the story's calendar and the series canon

- New `src/engine/pipeline/calendar.ts`:
  - `storyYear(book, texts)`: book.md `story_year` (number) if set. Else the most frequent year from 1000 to 2999 in `[brief setting, bible style and setting, pitch, timeline]`; else null.
  - `datesIn(text)`: day-month and month-day patterns with an optional weekday and year ("Saturday 24 October", "October 24, 2026", "Sat, 24 Oct").
  - `weekdayOf(y, m, d)` via `Date.UTC`.
  - `weekdayMismatches(text, year)`: a list of `{said, date, actual}`.
  - `calendarSection(year, text)`:
    - With a year: "## The story's calendar\nThe story is set in YYYY (from the book's own files). Do not assume the current year. The dates this text names fall on: 24 October = Saturday, 25 October = Sunday, ... (at most 30 dates). <If any mismatch:> The engine found these weekday slips in the text: 'Sunday 24 October' (24 October YYYY is a Saturday)." Then: "A note about a weekday, a date or a count of years must agree with this calendar."
    - Without a year: "The story's year is not stated: do not report a weekday or a count of years as an error unless the text contradicts itself."
    - In both cases: "Facts that come from the earlier books of the series (the series section) are canon: never report them as contradictions."
- The outline records a year:
  - `handlers.ts:463-488` outline schema adds `story_year: z.coerce.number().int().nullable().default(null)`;
  - in the outline handler, `if (r.value.story_year) books.update(slug, {story_year})`;
  - the seed `architect/outline*.md` prompts ask for `"story_year"` ("the year the story is set in, or null for no fixed year");
  - `bookSchema` (`shared/schemas.ts:302-341`) adds `story_year: z.number().int().optional()`;
  - the owner may set it by hand in book.md.
- Appended with `appendToPrompt` to:
  - `review` (`handlers.ts:726-728`), with the text being the book or act text;
  - `check_chapter` (`longHandlers.ts:88`), the chapter text;
  - `act_review`, `thread_check` and `fact_check` (`nonfiction.ts`), only where dates matter: add it to all;
  - `memory_update` (D3);
  - `rewrite_chapter` (the E phase owns its other changes; D adds only this one line in the rewrite handler, after `allNotes`): "Notes about weekdays, dates, counts of years, or facts from earlier books of the series are open to judgement: check them against the calendar below and the series section; if the text is right, keep it." followed by `calendarSection(year, current.body)`.
- Tests (new `tests/calendar.test.ts`):
  - `weekdayOf(2026, 10, 24) === 'Saturday'`;
  - mismatches found for "Sunday 24 October" in 2026;
  - `storyYear` picks 2026 from the bible setting;
  - a null year gives the no-year text;
  - pipeline: the review prompt of a book with `story_year: 2026` contains "The story is set in 2026" and the weekday line; the rewrite prompt contains "open to judgement".

### D3. S27: the archivist (aliases, duplicates, dates)

- `memory/bible.ts`:
  - `memoryUpdateSchema` (:10-18) characters and places get `aliases: z.array(z.string()).default([])`.
  - `resolveEntryFile` (:82-99), in order:
    1. exact `entryKey` (file name, then `name`), as now;
    2. any entry whose frontmatter `aliases` contains the key;
    3. the entries of the group for which `sameName(name, entry.name)` holds (word subset, from `pipeline/series.ts:31`, moved into `memory/bible.ts` or a small shared helper to avoid a cycle). Use it only when exactly one entry matches; ambiguity gives a new entry plus a warning.
  - In `apply` (:195-213), when an entry was matched under another name, add that name (and the update's `aliases`) to the entry's `aliases`, deduped.
  - `entries()` returns `aliases`, and the digest shows "(also: ...)".
- `pipeline/longHandlers.ts:105-135` `memory_update`:
  - the `known` list shows `- Dec Hartley (character; also: Dec, Declan)`;
  - append `calendarSection(year, chapter.body)` (D2);
  - after the answer, run `weekdayMismatches` over `summary` and `timeline`. A slip where the chapter text has the same date with the right weekday, or with none, is corrected in the summary and timeline (replace the weekday word) with `ctx.log(warning)`. A slip that is in the chapter text itself is only logged: the continuity check sees it through D2.
- `seed/prompts/archivist/memory_update.md`: add the rules.
  - "Use the exact name from the list. A person called by another name (first name, surname, title, nickname) is the same entry: use the list's name and put the other name in "aliases"."
  - "A group (the twins, the family) is not an entry: update each member."
  - "Record a relationship only when the chapter states it in so many words; never infer kinship."
  - "A weekday next to a date must match the calendar."
  - Add `"aliases": []` to the example. Run `yarn seed:hashes`.
- Tests (`tests/memory.test.ts`):
  - "Dec" after "Dec Hartley" resolves to the same file and adds the alias;
  - "Hartley", with both "Dec Hartley" and "Mara Hartley" present, makes a new entry and a warning;
  - "The twins" plus "Novák twins" resolve to one entry;
  - an alias from the update is stored and used next time;
  - the summary weekday slip is corrected (pipeline or unit test with a mocked archivist reply).

**Acceptance D:**
- All tests pass.
- The `yarn seed:hashes` guard passes.
- design.md rows: "Review problems kept", "Story calendar for reviewers", "Archivist aliases and dates". The "Book memory" body section is updated for aliases.

**Done (D), 2026-10-21.** Commit `SCP-14: phase D`. Verification: typecheck and lint clean, full `yarn test` (see the final report for counts), `yarn seed:hashes` run after the prompt edits.
- New: `pipeline/reviewNotes.ts`, `pipeline/calendar.ts`; `chatJson` `normalize` option; `Bible.resolveEntry`, `aliases` on entries, `sameName` now in `memory/bible.ts` (re-exported from `pipeline/series.ts`); seed reviewer, checker, outline and archivist prompts.
- Tests: `tests/reviews.test.ts` (both live shapes, `notesProblem`, a long-book pipeline with a checker that needs a follow-up and one that never gives problems), `tests/calendar.test.ts` (unit and a pipeline with the year in the review and rewrite prompts), `tests/archivist.test.ts` (aliases, ambiguity, twins, the weekday correction in a pipeline).
- Deviations: `tests/helpers.ts` mock reviewers now write notes of 40 or more characters (the old 39-character note counted as unusable) and the outline mock can carry `story_year` (`storyYear` option). `followup.test.ts` adds `aliases: []` to its typed updates. The `story_year` prompt rule is in `outline.md` and `outline_vn.md` only (non-fiction and articles have no story). `review_outline`, `act_review` and `thread_check` get `problems` and the calendar but not the follow-up question (the plan names `check_chapter` and `review` for it).

**Done (F), 2026-10-21.** Commit `SCP-14: phase F`. Done before E, as the plan advises. Verification: typecheck and lint clean, full `yarn test` and `yarn seed:hashes` (counts in the final report).
- New: `shared/slug.ts`, `isNewsQuestion`, `missingFigures`, `fragmentShare`, `foreignLines`, `englishShare`, `NoteExcerpt`, `buildMessages` returns `template` (E6 needs it too).
- Tests: `tests/humanizerGuards.test.ts`, `tests/researchFigures.test.ts`, `tests/slug.test.ts`; `tests/humanizer.test.ts` and `tests/newspaper.test.ts` and `tests/research.test.ts` were adjusted (see deviations).
- Deviations: the excerpt line has the date (`(source: <url>, <date>)`) so `candidateFacts` takes it as a fact. `slugify` of `ideas.ts` stays for series and topics (stories use `storySlug`). The humanizer's call of `canonicalScenes` (E5) is added in phase E, since E runs after F here. A sentence of three words or fewer counts as a fragment even with a verb (the plan's rule), so the humanizer test text in `humanizer.test.ts` was lengthened; the newspaper test no longer expects every search to be news (the chapter's own background question is not); the research page-count test dedupes the pages the follow-up repeats.

---

## Phase E: writer, rewrites, lengths, choices, scene places, leak guard (S10, S21, S22 part 2, S23, S24, S25, S28)

### E1. S10: a sane word target in rewrites

- New helper in `handlers.ts`: `perChapterTarget(book, outline, chaptersWritten)`, which is `round(target_words / (outline?.chapters.length || chaptersWritten || 1))`.
- `rewrite_chapter` (:840):
  - a `--len` job uses the number in its job body (`/about (\d+) words/`);
  - every other rewrite uses `clamp(current.words, 0.85*P, 1.15*P)`, which keeps the chapter's own length when it is near the target and pulls it back otherwise.
- `draft_chapter` (:585) already uses the outline. Use the same helper there.
- Test: a 6-chapter outline with target 6,000 and only 3 chapters written. The `--chk` rewrite prompt says "about 1000 words" (or the clamped current length), never 2,000.

### E2. S28: the rewrite prompt carries the chapter, its neighbours, summaries and only its notes

New `src/engine/pipeline/rewriteContext.ts`.

- `chapterNotes(reviews, n, title, acts)`:
  - Split each revise review's notes into items: numbered or bulleted items, else paragraphs. Keep the `## Problems` items from D1 as items.
  - An item that names chapters, by `/\b(?:chapters?|ch\.?)\s*(\d+)(?:\s*(?:-|–|to|and|,|&)\s*(\d+))*/gi` with ranges expanded or an `(act k)` prefix mapped to that act's chapters, is kept only when it includes `n`.
  - An item that names no chapter is general: keep at most 1,200 characters of general items per reviewer.
  - The result is `- From the <role>: <items>`. A reviewer with no kept items is left out.
- `otherChaptersText(chapters, outline, n, branches, summaries)`:
  - Chapters `n-1` and `n+1` in full.
  - For a book with choices, the direct parents (`waysIn` from `branches.ts:73`) and children (the choice targets) in full, replacing the full `ancestors` set at `handlers.ts:822`.
  - Every other chapter as `### Chapter k: Title\n<summary>`: `summaries/ch-kk.md` for long books, else the outline entry's summary.
  - When the writer's window is known (`d.contextTokens('writer')`), cap the full neighbours to 35% of it, cutting from the middle (the `headTail` style).
- `handlers.ts:790-801` and `:823-829` use these. `ctx.context(...)` lists "neighbours in full", "N chapter summaries" and "notes for this chapter (k of m items)".
- Seed `writer/rewrite_chapter*.md`:
  - "The editors' notes on the whole book (take what applies...)" becomes "The editors' notes that concern this chapter";
  - "The other chapters:" becomes "The chapters before and after this one in full, the others as summaries:".
  - Run `yarn seed:hashes`. Old data-folder prompts still work, since the variables are unchanged.
- Tests:
  - `chapterNotes` unit tests: an item naming ch5 is dropped for ch3; "chapters 2-4" is kept for ch3; `(act 2)` keeps the act's chapters; the general cap holds.
  - Pipeline: the rewrite of ch3 of a 6-chapter short story contains the ch2 and ch4 bodies, not the ch1, ch5 or ch6 bodies (only their outline summaries), and not a note that names only ch5. The prompt is under 40% of the whole-book prompt size in that test.

### E3. S23: a rewrite can reword the choices

- `_choices.md` `## rewrite` (seed): "If the notes ask you to change what a choice says, end your answer with a line `CHOICES:` and then one line per choice, in the same order: `- <new wording> -> <chapter number>`. Keep where each choice leads. Write nothing after it."
- `## review`: "You may ask for a choice to be reworded: quote it and give the new words."
- If a data folder's `_choices.md` lacks the `CHOICES:` text, append the built-in sentence (`CHOICES_RULE`).
- New in `branches.ts`: `splitChoicesBlock(text): {body, choices: {text, to}[] | null}`. It parses a trailing `CHOICES:` block.
- The rewrite handler, when `fmt.choices` and a block is present, validates it:
  - same count as the outline entry's choices;
  - the same `to` in the same order;
  - each text 3-120 characters.

  If valid, it calls a new `books.setChoiceTexts(slug, n, texts)` and logs it. Invalid: log and ignore. The block is always stripped from the body.
- `books.setChoiceTexts` rewrites `outline.md` frontmatter `chapters[n-1].choices[i].text`. It regenerates the body with a `renderOutlineBody(numbered, acts, fmt)` helper extracted from `handlers.ts:527-535`; the outline handler uses the same helper.
- Tests: a rewrite answer with a valid block updates `outline.md`, and the EPUB `choicesHtml` shows the new text; one with a changed target is ignored and the block is stripped; a chapter without a block leaves the outline untouched.

### E4. S24 and S25: enforce word targets, and flag the book

- Per chapter, in `draft_chapter` (:631-658) for every format, prose and script, and in `rewrite_chapter` round rewrites (not `--len`):
  - if `words > P × 1.2` (`TRIM_ABOVE = 1.2`), make one tighten retry: "This chapter has W words, but it should have about P. Cut it to about P words: <prose: tighten, cut repetition and description, keep every event, name and line of dialogue that matters | script: cut narration lines and minor lines, keep every SCENE, ON SCREEN and plot beat>. Write the whole chapter again ...";
  - keep the retry if its count is between 0.8P and W;
  - log "chapter n was W words (target P); trimmed to X".
  - The existing expand retry (long books, < 0.8) stays.
- Book level, `advance.ts`:
  - **Short books** (:337-354): the gate fires when the total is outside `[min×0.85, max×1.15]` **or** outside `[target×0.8, target×1.2]`. `lengthNote` (:245-253) computes `per` from the target: `round(target/total)`, clamped so that per × chapters stays in the format range.
  - **Long books**: a new gate in `advance`, after `advanceLongDrafting` returns null and before the repetition report, while `r === 0`.
    - It runs when the total is over `max` (the format ceiling, for example the novella's 50k) or over `target × 1.15`, or under `min` or `target × 0.85`.
    - It patches `length_gate` and queues `lengthJobs` only on the chapters over `P×1.1` (too long) or under `P×0.9` (too short), each told "about P words".
    - The same `length_gate.status` flow as for short books: rewriting, then done.
    - Settled chapters keep their summaries; the trims don't change events.
- The flag: `BookSummary` (`shared/protocol.ts:115-168`) gets an optional `lengthGate?: {status, words, min?, max?, wordsBefore?} | null`, set in `summary.ts` from book.md. `get_book` shows it. If the publisher still publishes a book over `max`, `book.md` gets `length_over: true` and the publish handler logs a warning.
- Tests:
  - The pure `advance` test: a long book at 51,400 words of a 20-50k format, target 45k, gives `length_gate` rewriting with jobs only for the long chapters.
  - A short VN at 26k against a 22k target gives the gate.
  - A pipeline test with `draftRatio: 1.5` gives a trim retry and the chapter near target.
  - `lengthNote` uses the target.

### E5. S21: script `SCENE:` places use the bible's names

- New `src/engine/pipeline/scriptPlaces.ts`:
  - `scenePlaces(body)`: the place is the text before the last comma of each `SCENE:` line.
  - `canonicalScenes(body, places)`: rewrite a `SCENE:` whose place matches exactly one bible place by `entryKey` equality or `sameName` to the bible's exact name, keeping the time. It returns `{body, renamed, unknown}`.
- In `draft_chapter` and `rewrite_chapter` for `fmt.script`:
  - append a block "## Places\nIn every SCENE: line name the place exactly as one of these bible places: <names>. A new place is allowed only when the story moves somewhere the bible does not have."
  - after the answer, apply `canonicalScenes`;
  - append unknown places to the light bible's `## Places` (create the heading if missing) as `- **<place>**: <first narration line of that scene, at most 300 characters> (first seen in chapter n)`, so every scene maps at import;
  - log both.
  - The humanizer (`_vn`) keeps `SCENE` lines because its guard counts them; also run `canonicalScenes` after the humanizer (F owns `humanizerHandlers.ts`; E adds the one call at the end of E, or F adds it if F runs after E. Note it in the changelog).
- Seed `writer/draft_chapter_vn.md` and `rewrite_chapter_vn.md` get the same rule. Run `yarn seed:hashes`.
- Tests (`tests/adapt.test.ts` or a new `scriptplaces.test.ts`):
  - "SCENE: the grand hall of the observatory, night" with a bible place "Observatory Grand Hall" becomes the bible name;
  - an unknown place is added to the bible;
  - an ambiguous place is left as it is;
  - pipeline: an adaptation's draft gets the places block.

### E6. S22 part 2: the leak guard in the writer's handlers

- In `draft_chapter` and `rewrite_chapter` (and `research_fix` is JSON, so it is not included):
  - compute `forbid = instructionLines(promptTemplateBody, [choices section, brief header, owner-notes header, series header, adapt intro, places block])`;
  - `buildMessages` returns the loaded template body too: extend its return value with `template: prompt.body`;
  - pass `forbid` in `run.chat({..., forbid})` so the client queue refuses a leaky answer up front;
  - after `cleanProse`: run `stripTrailingLeak`. If something is cut, log it. If it returns null (a leak in the middle), throw `Error('the answer repeats the task instructions')` so the job is retried.
- Tests (pipeline): a mock writer answer ending with the ch9 tail is stored without it; a mock answer with a leak in the middle is retried; with the client provider, `submit_client_task` of a leaky text is refused.

**Acceptance E:**
- All tests pass.
- The seed-hash guard passes.
- design.md rows: "Rewrite context" (overrides the Pipeline section on whole-book rewrites), "Word targets" (overrides the short-book length gate), "Choice wording in rewrites", "Script places", "Prompt-leak guard".
- `docs/visual-novel.md` adds: "`SCENE:` places use the bible's names; new places are added to the bible".

---

## Phase F: humanizer, research, slugs (S14, S18, S19, S20)

### F1. S14: humanizer guards and prompt

In `pipeline/humanizerHandlers.ts`:

- **Fragments.** `fragmentShare(text)`:
  - split the narration (outside `"…"` and `“…”` quotes, and, for scripts, only narration lines) into sentences;
  - a fragment is a sentence of 3 words or fewer, or one with no verb cue. Verb cues: auxiliaries and modals (is, are, was, were, be, been, has, have, had, do, does, did, can, could, will, would, shall, should, may, might, must), a pronoun followed by any word, or a word ending in `-ed`, or `-s` after a capitalised name or pronoun;
  - the result is the share of fragments among the sentences.

  Guard: refuse when `after - before > FRAGMENT_RISE` (0.08) and `after > before × 1.5`, with the message "it broke sentences into fragments (x% before, y% after)".
- **Language.** `foreignLines(text)`:
  - lines or paragraphs of 6 or more words whose English function-word share (a list of about 120: the, and, of, to, a, in, is, was, he, she, it, you, that, not, ...) is under 0.1 **and** that contain at least 2 function words of French, Spanish, German or Italian (le, la, les, des, est, je, vous, pas, que / el, los, las, es, y / der, die, das, und, ist, nicht / il, che, non);
  - also the whole-text English share.

  Guard: refuse when `foreignLines(after) > foreignLines(before)`, or the English share falls by more than 30% relative. Message: "it changed the language of N line(s)". The book is English only (CLAUDE.md).
- **Units and abbreviations** in `newNames` (:129-145): skip a capitalised token that
  - directly follows a number (`/\d[\d.,]*\s*$/` before it), or
  - is in a `UNITS` set (Hz, kHz, MHz, GHz, kW, MW, GW, kWh, km, cm, mm, kg, mg, mL, dB, °C, °F, pH, ...), or
  - is all capitals of 2-5 letters and appears in the bible or the original lowercased? No: all-caps acronyms that are new still count.

  Keep the rule simple: number-adjacent tokens and the units list only.
- Order in `humanizeProblem` (:158-185): after the names guard, add the fragment guard, then the language guard.
- **Prompt** (`seed/prompts/humanizer/humanize_chapter*.md`):
  - replace "Sometimes a sentence is one word. Sometimes it runs on ..." with "Vary the length, but keep whole sentences: every sentence has a subject and a verb. Do not break a sentence into a string of verbless fragments ("Eighty-four years old, widow of a judge, second floor.") and do not add one-word sentences. A script counts them and refuses a version with more than the original."
  - add "Write in English, as the original is. Keep every line of dialogue in the language it is in; never translate it."
  - Run `yarn seed:hashes`. Data folders with unedited prompts get them through A4.
- Also: run `findLeaks` and `stripTrailingLeak` (C5) and `canonicalScenes` (E5, for scripts; add it here if F runs after E) on the humanized text.
- Tests (`tests/humanizer.test.ts`):
  - the live fragment example (original full sentences, humanized into "Eighty-four years old, widow of a judge, second floor. Not young.") is refused;
  - a version with the same share passes;
  - a French dialogue exchange added to an English chapter is refused;
  - "50 Hz" and "the hum at 50 Hz" give no new-name error; "Captain Rourke" is still caught;
  - the seed prompt no longer contains "Sometimes a sentence is one word".

### F2. S18: notes keep the search's facts

In `pipeline/researchHandlers.ts`:

- `factsFrom` (:143-162): raise the cap to 16. After the first pass, run `missingFigures(pages, facts)`:
  - years (1800-2100) and numbers with 2 or more digits that occur in a page paragraph sharing at least one query keyword, and in no fact;
  - for each, the sentence around it (at most 240 characters) and the page number.

  If any are missing, make one follow-up `chatJson` with the same messages, plus assistant (the facts JSON), plus user: "The pages also give these figures and dates you did not note: <list with page n and sentence>. Add a fact for each one that bears on the question, in your own words, with its source." Merge the new facts, deduped by normalised text.
- Still missing after that: write them to the note as `excerpts` (at most 4, each at most 300 characters, verbatim and attributed). `ResearchStore.write` (`research/notes.ts:126-150`) gets an `excerpts?: {text, url}[]` input, rendered in the body as `## Source excerpts (verbatim, for checking)` with `- "<text>" (source: <url>)`. `formatNote` (:165-169) keeps them inside its cap (raise `maxChars` to 2,400). The fact base's `candidateFacts` (refresh) may take the excerpt lines as facts too. This keeps "decision by end 2027" in front of the writer even when the model omits it.
- `copiesPage` stays for facts. Excerpts are explicitly quoted data, not prose.
- Prompt `seed/prompts/researcher/write_notes.md`: "Between 3 and 16 facts. Every figure, date, deadline and named event on the pages that bears on the question must be one of your facts." Run `yarn seed:hashes`.
- Tests (`tests/research.test.ts`):
  - a mock search with a page that says "outages in 2023" and "a decision by the end of 2027", and a mock researcher whose first answer omits both: the follow-up is asked, and the note has both;
  - when the follow-up still omits them, the note has `## Source excerpts` with both sentences, and `formatNote` shows them.

### F3. S19: short, word-boundary slugs

- New `src/shared/slug.ts`: `slugify(text, {max = 40, maxWords = 8, fallback})`.
  - Remove accents (NFKD) and drop a possessive `'s` or `’s` ("France's" becomes "frances").
  - Split on anything that is not `a-z0-9`.
  - Add whole words while the length stays at or under `max` and the words at or under `maxWords`. A first word longer than `max` is cut.
  - Strip trailing stopwords (the, a, an, of, and, in, on, at, to, for, with).
- `store/ideas.ts:22-29` and `pipeline/books.ts:21-28` re-export or use it:
  - stories: `max 40, maxWords 6, fallback 'idea'`;
  - books: `max 40, maxWords 8, fallback 'untitled'`.
- A story without a title (`ideas.ts:117`) slugs from `briefLabel`, as now, but with the new cut.
- Existing files and slugs never change: only new ones.
- Tests:
  - `slugify("France's atomic clock on air: the ALS162 signal turns 60")` gives `frances-atomic-clock-on-air-the-als162` (40 characters or fewer, no cut word, no trailing "the");
  - a long premise gives at most 6 words;
  - accents and an empty input give the fallback;
  - `freeSlug` adds `-2` on a clash.

### F4. S20: news mode only for current angles

- `research/service.ts:117-190` `AskInput` gets `news?: boolean`, stored on the job as `news`.
- `researchHandlers.ts`:
  - `research_plan` (:218-262): for an article, the schema accepts `questions` as strings or `{question, news}` objects (`z.union`). Questions given as strings default to `isNewsQuestion(q)`: a regex for recent-time words (latest, this week, today, yesterday, announced, new, recent, now, current year, or "<this year>").
  - The fallback questions (:248): "the latest news" has `news: true`, "history and background" has `news: false`.
  - `research_prep` (:265-310) does the same for `research_prep_article`.
- The research handler (:62, :121): `news = ctx.job.news ?? (await isArticle(book) && isNewsQuestion(question))`, so `news: true, days: 7` applies only then. A non-article never uses news.
- Prompts:
  - `seed/prompts/architect/research_plan_article.md` asks for `{"questions": [{"question": "...", "news": true}]}`: "news true only for what happened in the last days or weeks; background, history, how something works and official explanations are news false".
  - The same for `writer/research_prep_article.md`.
  - Run `yarn seed:hashes`.
- Tests:
  - a mock search provider records `opts.news`: the article question "How does the ALS162 time signal work?" goes without news; "What did ANFR announce this week about ALS162?" goes with news, `days` 7;
  - `{question, news: false}` objects are honoured;
  - string questions use the regex.

**Acceptance F:**
- All tests pass.
- The seed-hash guard passes.
- design.md rows: "Humanizer guards: fragments, language, units" (extends the SCP-13 row), "Research keeps the figures", "Short slugs", "News search only for current angles" (overrides the Newspaper row's "Tavily is asked for news ... last 7 days" for evergreen questions).

**Done (E), 2026-10-21.** Commit `SCP-14: phase E`. Verification: typecheck and lint clean, full `yarn test` and `yarn seed:hashes` (counts in the final report).
- New: `pipeline/rewriteContext.ts`, `pipeline/scriptPlaces.ts`, `perChapterTarget`/`TRIM_ABOVE` and the helpers `chapterAnswer`, `tighten`, `settlePlaces` in `handlers.ts`, `splitChoicesBlock`/`renderOutlineBody`/`CHOICES_RULE` in `branches.ts`, `BookStore.setChoiceTexts`, the long-book length gate and the target in the short gate in `advance.ts`, `BookSummary.lengthGate`/`lengthOver`, `length_over` on publish.
- Tests: `tests/rewrites.test.ts` (notes, neighbours, choices, places, a rewrite of 6 chapters, a story with choices, the leak guard), `tests/lengths.test.ts` (targets, both gates, the tighten retry, the share in a rewrite), `tests/leak.test.ts` (the client queue through the scheduler); `tests/helpers.ts` mock writer understands "Cut it to about N words".
- Deviations: the tighten retry skips an owner-note rewrite (their choice of length). `instructionLines` takes up to four instruction paragraphs of an appended section (the plan said two), and the callers cut a section that holds the story's own text (brief, series, owner notes, source) to its heading and instruction first. The humanizer renames places (`canonicalScenes`) but never adds places to the bible. The `length_over` flag has no test of its own (it needs a book published over its ceiling). A short book's length note keeps the sentence "the format wants N to M words" and adds the target after it.

---

## Phase G: wrap-up

1. Run the full checks, from the repo root:
   ```bash
   cd /c/projects/Personal/scriptorium
   eval "$(fnm env --shell bash)"; fnm use 24.14.0
   yarn seed:hashes && git diff --exit-code src/engine/store/seedHistory.ts   # no diff: the history is current
   yarn typecheck
   yarn lint
   yarn test
   yarn test:ui      # Playwright demo specs (the agent panel checkbox)
   ```
   PowerShell equivalent: `fnm env --use-on-cd | Out-String | Invoke-Expression; yarn typecheck; yarn lint; yarn test; yarn test:ui`.
   Do **not** run `yarn engine`, `yarn headless`, `yarn dev` or `yarn test:electron` against `~/Scriptorium`. `test:electron` builds and starts the app with its own temp data only if its config says so; skip it unless verified.
2. Docs pass:
   - `docs/design.md`: every phase's rows are present and dated, "Overrides ..." is noted where needed, the body sections are updated (Model layer: blocked providers and embeddings down; Book memory: aliases and calendar; Pipeline: rewrite context and length gates), and there is one History entry per phase.
   - `docs/mcp.md` lists every new tool and field.
   - `docs/visual-novel.md` covers `get_script` and places.
   - The `seed/config/*.md` bodies are updated.
3. Fill in `changelog.md` in the ticket folder: per phase, what was done, the deviations and the test counts.
4. Hub follow-ups (a separate repo; the caller handles them): strike through the fixed Scriptorium items and the "All three" X1-X3 items for Scriptorium in `creative-hub/ROADMAP.md`. Note that `scripts/wait-book.ps1` can give way to `wait_for_book`. X1-X3 remain open for Book Translator and VN Studio.
5. Live verification, only with the user's go-ahead (it restarts the factory): restart Scriptorium.
   - The migrations log `client` provider added or skipped, and humanizer prompts upgraded.
   - `factory_status` shows `dataDir`, `embeddings`, `blocked`.
   - `wait_for_book` on a new small story returns `client-task`, then `published`.
   - `get_script` on `the-clockless-god-3` returns scenes.

## Decisions for the user (defaults chosen; implement the default unless told otherwise)

1. **S12, a reopened published book that is rejected:** by default it becomes `rejected` like any book. The old EPUB stays in `out/` and the old text in `chapters/history/`. The alternative is to restore the published version automatically, which is more code and not chosen.
2. **S12, reopen a published book without `chapters`:** by default the chapters the last reviews named are used, and the call is refused when there are none (no accidental whole-book rewrite).
3. **S6, `last_resort_model`:** not built by default. If wanted, it would be a `settings.md` field used only when every model of a role is down or used up.
4. **S11, set (not only clear) a book model on published and failed books:** allowed by default, since `reopen_book` and `retry_book` can follow.
5. **S16:** the seed humanizer chain becomes `[deepseek/deepseek-flash, paid]`, and a folder without a humanizer role gets it too. Existing chains are not migrated.
6. **S24/S25 thresholds:** per chapter, a trim retry above 1.2× the target. The book gate is ±20% of the target for short books, and for long books it fires over the format ceiling or over 1.15× the target. Easy to tune: they are constants in `advance.ts` and `handlers.ts`.
7. **S13:** the exclusive pin is also a UI checkbox, which adds one control to the UI row. It could be MCP-only instead.

### Critical Files for Implementation
- C:\projects\Personal\scriptorium\src\engine\mcp\tools.ts
- C:\projects\Personal\scriptorium\src\engine\pipeline\handlers.ts
- C:\projects\Personal\scriptorium\src\engine\queue\scheduler.ts
- C:\projects\Personal\scriptorium\src\engine\pipeline\longHandlers.ts
- C:\projects\Personal\scriptorium\src\engine\store\migrations.ts
---

## Implementation notes (G, 2026-10-21)

**Done (G), items 1 to 3 of Phase G.** No commit: nothing changed in the repo. The hub ROADMAP (item 4), live verification (item 5) and `changelog.md` are for the orchestrator.
- `yarn seed:hashes` gives no diff, `yarn typecheck` and `yarn lint` are clean, `yarn test` 501 passed in 39 files (baseline 390 in 26 files), `yarn test:ui` 5 passed.
- Flaky tests, not caused by this ticket: `tests/recovery.test.ts` (kills an engine child; it fails now and then in a full run, passes alone every time, and it already failed on this branch in phase B before any scheduler change) and, at the start, `tests/pipeline.test.ts` "a revise round" (baseline). A few other timing tests failed once each in loaded runs and passed alone.
- Docs pass: every phase has its Decisions rows and a History line in `docs/design.md` (A: 3 rows, B: 3, C: 5, D: 3, E: 5, F: 4); the Model layer (blocked providers, embeddings down), Book memory (aliases, calendar) and Pipeline (rewrites, length gates) sections were updated; `docs/mcp.md` lists `wait_for_book`, `get_script`, `refresh_factbase`, the absolute paths, the `messages` change, `blocked`/`providers`/`embeddings`, `assign_agent {exclusive}` and `lengthGate`; `docs/visual-novel.md` has `get_script` and the places rule; `seed/config/providers.md` and `roles.md` bodies are updated; CLAUDE.md has the `yarn seed:hashes` line.

## Implementation notes (stabilize the test suite, 2026-10-22)

Commit `SCP-14: stabilize the test suite`. Baseline (master 794fd23 in a worktree, 3 full runs): 2 green, 1 run with `features` "setModel with null clears an agent override" failing. The branch has 39 test files against 26, so it was loaded more and failed in different places each run.
- **Real engine bug, fixed:** `JobStore.requeue` moved the job to `queued/` and only then wrote its patch (`attempts`, `not_before`). A scheduler tick could claim the job in between, so the patch was lost: the retry ran at once with no backoff and the attempt was not counted. Now the patch is written before the move. This explained the flaky retry tests (leak retry, "a failing handler is retried") and probably the recovery test.
- **Real engine race, fixed:** a scheduler tick that was claiming a job while `stop()` ran launched it after `stopAll`; nothing aborted it, so a job waiting for a client held `stop()` until the hook timeout (the blockers and role-models "Hook timed out in 30000ms"). The claim path now requeues the job when the scheduler has stopped.
- **Tests made deterministic:** `features` and the two `reopen` pipeline tests switch the topic off once the first book exists (the factory started a second book that raced with them; features then expects `active: false`); `waitFor` default 8 s to 20 s, `testTimeout` and `hookTimeout` 30 s and `maxWorkers: 8` in `vitest.config.ts`; the research note wait ignores `.tmp-` files; the embeddings test tolerates a job claimed between listing and reading; the humanizer ordering checks have 5 s slack instead of 250 ms.
- Result: 5 consecutive green full runs (501 tests) after the last change, preceded by 13 green out of 14 during the work, `yarn typecheck`, `yarn lint` clean and `yarn seed:hashes` no diff.

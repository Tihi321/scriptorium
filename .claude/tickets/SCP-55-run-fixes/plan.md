---
status: done
request: REQ-0003
repos: [scriptorium]
branch: SCP-55_run-fixes
updated: 2026-11-09
---

# SCP-55: fixes from the science-blink run

Findings, evidence and file:line references: `research.md` in this folder. Six fixes, one commit each, in the order below. Item 7 (acp seed port) is dropped: not a bug (see "Out of scope").

## Scope

1. Humanizer: the fragment check counts whole present-tense sentences and contractions as fragments. Fix the verb cues; log an accepted pass.
2. Models: a model that answers a non-retryable 4xx to a plain request is set aside for 10 minutes, for every job. Research searches are reused across attempts.
3. Non-fiction: the fact checker sees each note at least as fully as the writer did (number the sources before cutting, one shared cap, cited notes first).
4. Start: a single-idea run keeps the story's topic.
5. Scheduler: a job that failed for good only because no model answered gets one more try 10 minutes later.
6. Watcher: the engine's own spend-summary write to `config/budget.md` no longer logs `changed:` or reloads.

## Out of scope

- Item 7, the acp port: the seed's `http://127.0.0.1:7461/v1` matches the creative-hub (`services.json`, `PROXY_PORT 7461`) and Book Translator's seed. It only becomes a change if the user moves the hub to 8787 (decision D3 below); the edit list for that case is in `research.md` section 7.
- Hub and proxy cleanup (stale `PROXY_IGNORE_SAMPLING`, stale flow-mcp note): REQ-0003 piece P4.
- Marking a non-`concurrency: auto` provider down on ECONNREFUSED (acp was unreachable for a while too): needs a way to notice it is back; item 5's revive covers the loss.
- Re-running the three failed research jobs of the existing book (`jobs/failed/research--...--{35861582a1,73e7ca857f,bcf03d01b2}--r0.md`): the book is published; the owner can `retry_book` or leave them.
- Sending no `temperature` to providers that refuse it (a provider flag): the proxy now drops it.

## Decisions for the user

- **D1 (item 2):** a model that answers a 4xx (other than 401, 402, 403, 404, 408, 409, 425, 429; not a context error; not a retired model) to a request without a JSON schema is set aside for **10 minutes** for every job; jobs use the next model or wait. Alternatives: until the engine restarts (like a retired model), or count only after two such answers.
- **D2 (item 5):** a job that reaches `max_attempts` with a provider error is revived **once**, 10 minutes later, for every task (not only research). Alternative: research jobs only, or no revive.
- **D3 (item 7):** keep 7461 in the seed (recommended), or move the hub and every app's seed to 8787 together.

## Files and modules

| Item | Files |
|---|---|
| 6 | `src/engine/budget/spend.ts`, `src/engine/engine.ts` (new `isOwnWrite`), `src/engine/index.ts`, `tests/reload.test.ts` |
| 4 | `src/engine/pipeline/handlers.ts` (`pickNext`, `start_book`), `src/engine/pipeline/pipeline.ts`, `tests/singleIdea.test.ts` |
| 1 | `src/engine/pipeline/humanizerHandlers.ts`, `tests/humanizerGuards.test.ts`, `tests/fixtures/humanizer/ch05-before.md`, `tests/fixtures/humanizer/ch05-after.md`, `docs/design.md` |
| 3 | `src/engine/pipeline/nfcontext.ts`, `src/engine/pipeline/nonfiction.ts`, `src/engine/research/notes.ts` (only if `formatNote` gets a text hook), `tests/nonfiction.test.ts`, `tests/fixtures/nonfiction/hafele-keating-note.md` |
| 2 | `src/engine/models/router.ts`, `src/engine/engine.ts` (`onModelRefused`), `src/engine/research/service.ts` (search reuse), `tests/models.test.ts`, `tests/clientsearch.test.ts`, `docs/design.md` |
| 5 | `src/engine/queue/scheduler.ts`, `src/engine/queue/jobs.ts` (frontmatter type: `revived`), `tests/scheduler.test.ts`, `docs/design.md` |

No file under `seed/prompts` or `seed/templates` changes, so `yarn seed:hashes` is not needed. If any task does change one, run `yarn seed:hashes` in that commit.

## Tasks

Order: 6, 4, 1, 3, 2, 5. Items 2 and 6 both touch `engine.ts` (different methods); items 1, 2 and 5 touch `docs/design.md` (different rows, one History line each). One commit per item, message `SCP-55: <item>`, written with a Bash heredoc. Node through fnm (`fnm exec --using default yarn ...`). Each commit passes `yarn typecheck`, `yarn lint` and the touched test files; the last commit passes `yarn test`.

### Task 1 (item 6): own budget.md writes are not config changes
Commit: `SCP-55: the engine's own budget.md writes do not reload config`
- Inputs: `Budget.writeSummary` (`spend.ts:341-356`), the watcher callback (`index.ts:99-102`), `Engine.handleWatch` (`engine.ts:742-782`).
- Outputs:
  - `Budget` keeps `lastSummaryText: string | undefined`: the full file text it wrote (or found already equal, so the first summary after start counts too).
  - `Engine.isOwnWrite(e: WatchEvent): Promise<boolean>`: true only when `e.rel === 'config/budget.md'`, `e.change === 'change'` and the file's current text equals `budget.lastSummaryText` (CRLF-insensitive compare is not needed: the engine writes the file itself).
  - `index.ts`: `if (await engine.isOwnWrite(e)) return` before the `changed:` log and `handleWatch`.
- Contract: a hand edit of the caps (text differs) still logs and calls `budget.loadCaps()`. No other config file is filtered.

### Task 2 (item 4): a single-idea run keeps the story's topic
Commit: `SCP-55: a single-idea run keeps the story's topic`
- Inputs: `pickNext` (`handlers.ts:142-168`), its callers (`handlers.ts:447`, `pipeline.ts:535`).
- Outputs: `pickNext` gets an options object or a trailing parameter `freshTopics = true`; with `false` it skips the topic fallback at `:165-167` (returns null instead). Both callers pass `await topics.read()` always and `freshTopics: !only`.
- Contract: a single-idea run still never starts a book from a topic alone (the SCP-48 single-idea tests stay green); the story's topic (active or not, for an owner's story) reaches the prompt (`topic:` var), `book.md` (`topic`, `topic_name`), the format filter (`formatsForKind(formats, topic.kind)`) and `topics.adjust`.

### Task 3 (item 1): the fragment check knows present tense and contractions
Commit: `SCP-55: humanizer fragment check counts present tense and contractions as verbs`
- Inputs: `hasVerbCue` (`humanizerHandlers.ts:149-154`); prototype in `.claude/temp/scp55/frag2.ts`.
- Outputs:
  - `hasVerbCue` also returns true for (a) a contraction: a word ending in `n't`, `'re`, `'ve`, `'ll`, `'m`, `'d` (straight `'` or curly `’`), or `'s` after that/here/there/what/it/he/she/who/where/let/everything/nothing/something (any case); (b) a determiner (the/a/an/its/this/that/these/those/each/every/his/her/their/our/your/my/one/no/any/some, any case, including sentence-initial "The"/"A") followed by up to two lowercase words and then a lowercase word of 3+ letters ending in `s` but not `ss`, `us` or `is`. Optionally add `went` to `COMMON_VERBS`.
  - A success log line in the handler: `humanizer: chapter N humanized: X to Y words` (next to `:306`).
  - `docs/design.md`: the row "Humanizer guards: fragments, language, units" lists the two new cues; a History line for SCP-55.
  - Fixtures: `tests/fixtures/humanizer/ch05-before.md` = body of `C:\Users\Infplane\Scriptorium\books\the-one-way-street-why-time-only-runs\chapters\history\ch-05-r0.md` (no frontmatter); `ch05-after.md` = the `### Output` of the `humanize--ch05--r0` section of that book's `log.md`, without the `_model ..._` line and the `humanizer: ...` line (`.claude/temp/scp55/frag.ts` shows how it is cut out). Book content is English, from this factory: fine to commit.
- Contract: `FRAGMENT_RISE` and the refusal rule stay; the existing ORIGINAL/FRAGMENTED/LIVELIER texts keep their verdicts.

### Task 4 (item 3): the fact checker reads the notes at least as fully as the writer
Commit: `SCP-55: fact checker sees whole notes, numbered before the cut`
- Inputs: `numberedNotes` (`nfcontext.ts:92-94`), `formatNote` (`notes.ts:175-183`), `numberedNoteText` (`memory/factbase.ts:41-46`), the fact check (`nonfiction.ts:179-228`), the writer (`nfcontext.ts:131`).
- Outputs:
  - `numberedNotes` replaces the source suffixes with `[n]` before it cuts each note (for example: number the note's body, then call `formatNote` on `{ ...note, body: numbered }`, or give `formatNote` a text transform). Unknown URLs stay as they are.
  - One exported constant for the per-note cap (`NOTE_CHARS = 1800`), used by the writer and the fact checker (the `1500` at `nonfiction.ts:224` goes).
  - Fact check: notes whose sources the book text cites come first (verified, newest), then the rest, before the 30000 / `roomChars` cut.
- Contract: the writer's prompt shows the same notes as before, with more of each note fitting; the excerpts block of a note still fits as `formatNote` already guarantees.

### Task 5 (item 2): a refusing model is set aside; searches are reused
Commit: `SCP-55: a model answering 400 is set aside for 10 minutes, searches reused`
- Inputs: `ModelRouter.chat` / `candidates` (`router.ts:110-261`), `problemKind` (`:266-279`), `chatJson` (`llm.ts:69-89`), `SearchService.search` (`research/service.ts:68`), engine hooks (`engine.ts:127-147`).
- Outputs:
  - `isRefusedRequest(err, hadSchema)`: a `ProviderError` with status 400 to 499 except 401, 402, 403, 404, 408, 409, 425, 429; not `isContextError`; not `isRetiredModelError`; and `hadSchema` false.
  - `ModelRouter.refused: Map<ref, { until: number; message: string }>` with `REFUSED_MS = 10 * 60_000` and the router's injectable `now`. Set in the `catch` of `chat()` next to the retired branch; `onModelRefused(model, message)` fires once per set-aside. `candidates()` drops refused models while another is left (like `retired`, `:125-127`); `chat()` skips one while a later model is usable (like `:155`). Expired entries are removed when read.
  - `Engine`: `router.onModelRefused` logs `models: <ref> refused a request at <provider> (<text>): jobs use the next model in their role for 10 minutes` and emits an `engine.warning`, then kicks the scheduler.
  - `SearchService.search`: an in-memory map `(query, news, days) -> { outcome, at }`; a hit younger than 30 minutes returns the stored outcome without asking a provider (no client task, no spend row). Only non-null outcomes are kept.
  - `docs/design.md`: Decisions row "Refused requests (SCP-55)" (D1) and a History line.
- Contract: `chatJson`'s schema-less retry still runs (a 400 to a schema request does not set the model aside); a context error, a retired model, a 429 and auth errors keep their current handling; the last model of a list is never dropped.

### Task 6 (item 5): one more try after an outage
Commit: `SCP-55: a job that failed only because no model answered is revived once`
- Inputs: the failure branch (`scheduler.ts:672-686`), `JobFrontmatter` (`queue/jobs.ts`).
- Outputs:
  - At `attempts >= max`: when `err instanceof ProviderError` and `j.revived` is not set, `jobs.requeue(j.id, { attempts: 0, revived: 1, not_before: now + 10 min })` and log `### Result\nFailed ${attempts} times because no model answered (${message}). One more try at HH:MM.` Otherwise fail for good as today.
  - `JobFrontmatter.revived?: number`; `JobStore.retry` (retry_book) resets it to null.
  - `docs/design.md`: Decisions row "Revive after an outage (SCP-55)" (D2) and a History line.
- Contract: handler errors (plain `Error`), budget blocks and aborts are unchanged; a revived job that fails again fails for good; the book's failure rule (`pipeline.ts:395-397`) is unchanged, so a non-research job's book fails only after the revive also failed.

## Acceptance criteria

| # | Criterion | Proven by |
|---|---|---|
| 1 | The real ch05 humanized version is accepted (no fragment refusal); a genuinely fragmented version is still refused | `tests/humanizerGuards.test.ts`: new test "accepts the real science-blink ch05 rewrite" + the existing "refuses a version that broke sentences into fragments" |
| 2 | After a model answers 400 to a plain request, the next job's candidates leave it out while another model exists, and it is back after 10 minutes | `tests/models.test.ts`: new test "a model that refuses a request is set aside for 10 minutes" |
| 2b | A retried research job does not queue a second searcher task for the same query | `tests/clientsearch.test.ts`: new test "the same query within 30 minutes is answered from the last search" |
| 3 | The fact checker's note text for the real Hafele-Keating note contains the Science 1972 fact with `[11]` | `tests/nonfiction.test.ts`: new test "numbered notes keep the facts that fit once the sources are numbered" |
| 4 | A single-idea run of an owner's story with `topic: sci-physics` (inactive topic) creates `book.md` with `topic: sci-physics` and does not start a topic book | `tests/singleIdea.test.ts`: new test "a single-idea run keeps the story's topic" + the existing "the pipeline starts only the chosen idea" |
| 5 | A job failing 3 times with a `ProviderError` is queued again 10 minutes later with `revived: 1`, and fails for good after the next 3 | `tests/scheduler.test.ts`: new test "a job that failed only because no model answered is revived once" |
| 6 | The engine's summary write is an own write (no `changed:` log, no reload); a hand edit of the caps is not | `tests/reload.test.ts`: new test "the engine's own budget.md summary is not a config change" |
| all | Typecheck, lint and the whole suite pass | `yarn typecheck`, `yarn lint`, `yarn test` |

## Reproduction tests (fail before the fix)

Seven new tests in all, no near-duplicates; each fails on `master` (c0b2d47) and passes after its task.

1. **Item 1** (`tests/humanizerGuards.test.ts`): read `tests/fixtures/humanizer/ch05-before.md` and `ch05-after.md` (the real texts); `expect(humanizeProblem(before, after, { nonfiction: true })).toBeNull()`. Before the fix: `'it broke sentences into fragments (21% before, 33% after)'` (verified with `.claude/temp/scp55/frag.ts`).
2. **Item 2** (`tests/models.test.ts`): a router with two free mock models (`a` answers `HTTP 400 {"error":{"code":"unsupported_parameter","param":"temperature"}}` to every request, `b` answers text) and a fake `now`. Run one `chat()` with no schema: it falls over to `b`. Then `candidates(role)` has no `a`; advance `now` by 10 minutes: `a` is back. Before the fix: `candidates` still lists `a` first.
3. **Item 2b** (`tests/clientsearch.test.ts`): a `SearchService` over the client search provider; call `search('muon time dilation')` twice, answering the first client task; the second call returns the same results and the client queue got one task. Before the fix: a second task is queued (the second call waits for it).
4. **Item 3** (`tests/nonfiction.test.ts`): load the real note `tests/fixtures/nonfiction/hafele-keating-note.md` (copy of `books/the-one-way-street-why-time-only-runs/research/what-results-did-hafele-and-keating-get-flying-atomic-cl.md`) through `ResearchStore` (as `tests/researchFigures.test.ts` does) with sources numbered so dvidshub is 11; `expect(numberedNotes([note], sources, NOTE_CHARS)).toContain('Science, volume 177')` and that line ends with `[11]`. Before the fix: with the fact checker's 1500 the line (raw offset 1507) is cut. Use the fact checker's own call path or the shared constant so the test fails if the checker's cap drifts below the writer's.
5. **Item 4** (`tests/singleIdea.test.ts`): a data folder whose `topics.md` has an inactive non-fiction topic, an owner's story with `topic:` that id and `format: science-blink`, `setOnly(story)`, mock editor-in-chief answer; run the `start_book` job; read `book.md`: `topic` is the id, `topic_name` its name. Before the fix: `topic: null`.
6. **Item 5** (`tests/scheduler.test.ts`): a handler that throws `new ProviderError('all models failed. x: HTTP 400 ...')` with `max_attempts: 3` and a fake clock; after the third failure the job is in `queued/` with `revived: 1`, `attempts: 0` and `not_before` 10 minutes ahead; after three more it is in `failed/`. Before the fix: in `failed/` after the third.
7. **Item 6** (`tests/reload.test.ts`): engine env; `budget.record(...)`, `budget.flush()`; `isOwnWrite({ kind: 'config', change: 'change', rel: 'config/budget.md', path })` is true; append text above the marker by hand: false. Before the fix: `isOwnWrite` does not exist (the test also asserts no `changed: config change config/budget.md` reaches the log when the watcher is wired as in `index.ts`, if the env exposes the log).

## Verification after implementing

- UNTESTED until run in the real app: a science-blink book on the live data folder, checking that log.md has `humanizer: chapter N humanized` lines for most chapters, no `changed: config change config/budget.md` noise in the engine log, and `topic: sci-physics` in book.md of an `--only` run. Running a live book costs model time: ask the user first.

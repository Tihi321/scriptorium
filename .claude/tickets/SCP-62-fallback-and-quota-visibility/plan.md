---
status: done
request: REQ-0026
repos: [scriptorium]
branch: SCP-62_fallback-and-quota-visibility
updated: 2026-11-16
---
# SCP-62: fallback and quota visibility

Follow-up to SCP-61 (merged on `master` as `c9b64dd`; plan in `.claude/tickets/SCP-61-production-bugs/plan.md`, read its "Fixed interfaces" first). Line numbers below were read on `master` on 2026-11-16. SCP-61 has no separate changelog file; its ROADMAP entry (`ROADMAP.md:93`) and the Decisions row "Book model lists, loud fallback, usage limits (SCP-61)" in `docs/design.md:150` are the record.

Nothing is implemented until the user says yes to this plan. Never start or restart the live Scriptorium (`~\Scriptorium`) to test: it resumes the whole book factory and may spend on paid models. Unit tests use temp data folders (`tests/helpers.ts`) only. Node through fnm (repo `CLAUDE.md`).

## Scope

1. **Every deviation in the book tooltip.** The "Fallback" line of the whiteboard's book info (`Whiteboard.tsx:154-165`) has a `title` with only the newest entry's reason. It becomes every `modelDeviations` entry (book.md keeps the last 20), newest first, one line each: local time, role, model, reason.
2. **Usage-limited models in the Models panel.** The Models dialog lists the models set aside for a usage limit (`router.limitedModels()`), each with its reset time in local time. The snapshot carries the list; a new limit sends a new snapshot.
3. **A per-book "no local fallback" switch.** `no_local_fallback: true` in book.md (and in a story file, copied into book.md when the book starts). When it is on, models on this machine (see "On this machine" below) that are not in the book's own `role_models` list are never used for that book's jobs: not as a shared fallback row, not as the agent's own model, not as `last_resort_model`. A job with nothing else left waits in the queue with a blocked reason that starts `no local fallback: `. Set through a new MCP tool `set_book_local_fallback` (the `set_book_paused` / `set_book_byline` pattern) and `add_story` / `update_story` `noLocalFallback`; the UI shows the state, it does not set it.
4. **Quota warnings, as far as they can be known.** A list `quotaWarnings` in `factory_status` and the snapshot: a model set aside for a usage limit, a provider whose daily request limit is used up, and a provider at 80% or more of its `rpd`, each with the reset time and the in-progress books whose jobs it serves. The status bar shows a pill when any warning names a book, and the book info shows the book's own. Plus (4b) Scriptorium reads the ACP proxy's `/healthz` every 10 s and sets aside the models of a proxy provider the proxy reports exhausted, before any of its requests fails.

### What can and cannot be known (feature 4)

Read from the code on 2026-11-16 (`api-acp-proxy/src/server.ts:377-399`, AAP-31 contract in the SCP-61 plan):

| Source | What it says | Used |
|---|---|---|
| A 429 `usage_limit_exceeded` or Codex's "try again at" text (SCP-61) | this model is used up until a time | yes: `limitedModels` |
| `rpd` in providers.md / config/models.md, `requestsToday` (the limiter) | requests left today, for providers with a daily limit (OpenRouter free, Gemini free) | yes: `day-full`, and `day-nearly-full` at 80% |
| `/healthz` `providers.<id>` | `active`, `queued`, `max_concurrent`, `max_queue`, `auth_method`, and `exhausted_until` only while exhausted | yes (4b): `exhausted_until` |
| `/v1/models` `exhausted_until` per model | the same fact per model | no: `/healthz` gives it in one call |

**Not possible, and not planned:**
- A "nearly used up" warning for subscription providers (Claude, Codex, Antigravity through the proxy, `client/claude-code`). Neither the proxy nor the providers report how much of a subscription window is left; the proxy has no counts, only `exhausted_until` after the provider refused a turn. Scriptorium learns of the limit when it is already reached (by its own request, or 4b by the proxy's state, which another client such as the hub's Claude Code may have caused).
- Remaining quota for API-key providers without an `rpd` (DeepSeek, Anthropic API): they have no request quota, only money; the budget caps already cover that.
- Counting tokens against an unknown subscription window: guesswork, left out.

## Out of scope

- A UI control to switch `no_local_fallback` (the UI Decisions row, `docs/design.md:52`, limits on-screen controls; set it with MCP or in book.md). The UI only shows it.
- Pausing a book on a deviation, or failing it instead of waiting.
- Embeddings: the memory index keeps its local embedding model (`lmstudio/text-embedding-nomic...`) for every book; the flag covers chat jobs only.
- Web search providers and the `client` provider: never "on this machine" for the flag.
- Reading `/v1/models` of the proxy; a "nearly used up" for subscriptions (see above).
- Budget (money) warnings: the status bar's spend pills already show them.
- Changing the live `~\Scriptorium\config\settings.md` or `providers.md`.
- A migration: absent `no_local_fallback` and absent `on_device` mean the old behaviour (see the default rule).
- A Models-panel checkbox for `on_device` on custom providers (set it in providers.md).

## On this machine (the definition the flag uses)

`ProviderInfo.local` is not enough: the seed's `acp` (the proxy to cloud subscriptions) and `client` are `local: true` too (`seed/config/providers.md:71-151`, `registry.ts:206`). So:

- New optional provider field `on_device: boolean` in providers.md (`providerEntrySchema`, `schemas.ts:66-75`), documented in `seed/config/providers.md` "Fields of a provider".
- `ProviderInfo.onDevice: boolean` (`registry.ts:19-60`, filled at `:195-210`) = `entry.on_device` when set, else `local && kind === 'openai-compat' && id !== 'acp'`. So `lmstudio`, `strata`, `ollama` (and a custom local OpenAI-compatible server) are on the machine; `acp`, `client`, `mock`, `search` and API providers are not. A custom provider that is another proxy sets `on_device: false`.
- `ProviderSummary.onDevice: boolean` (`protocol.ts`, `summary.ts:176-200`).
- The test helper's `TestProvider` gets `onDevice?: boolean`, written as `on_device` (`tests/helpers.ts:44-55`), because the test providers are `kind: mock`.

## Files and modules (file:line on master)

| File | Lines | Feature | What |
|---|---|---|---|
| `src/renderer/store/model.ts` | helpers (after `problemInfo`, :240) | 1, 2, 4 | `deviationTooltip`, `limitedLines`, `quotaLine` |
| `src/renderer/ui/Whiteboard.tsx` | 108-190 (`BookInfo`), 154-165 (Fallback row) | 1, 3, 4 | tooltip; "Local fallback" row; "Quota" row |
| `src/shared/protocol.ts` | 80-95 (`ProviderSummary`), 142-185 (`ModelDeviation`, `BookSummary`), 307-335 (`SnapshotEvent`), `EngineEvent`, commands near `setBookModel` | 2, 3, 4 | `LimitedModel`, `limitedModels`, `onDevice`, `noLocalFallback`, `QuotaWarning`, `quotaWarnings`, `quota` event, `setBookLocalFallback` command |
| `src/renderer/store/store.ts` | 222-260 (`engine.warning`, `snapshot`) | 2, 4 | keep `limitedModels`, `quotaWarnings`; handle `quota` event |
| `src/renderer/ui/ModelsDialog.tsx` | 434-445 (dialog head) | 2 | the "Set aside for a usage limit" block |
| `src/renderer/ui/StatusBar.tsx` | 62-95 | 4 | the quota pill |
| `src/renderer/demo/library.ts` :112, `tests/renderer/store.test.ts` :37 | | 3 | new `BookSummary` field (typecheck) |
| `src/engine/models/router.ts` | 10-17 (`CandidateOptions`), 68-82 (limited map), 115-130 (`isLimited`, `limitedModels`), 155-196 (`candidates`) | 2, 3, 4b | `noLocalFallback` option, exported `LimitedModel` type, `setLimited` / `clearLimited` |
| `src/engine/models/registry.ts` | 19-60, 195-210 | 3 | `onDevice` |
| `src/shared/schemas.ts` | 66-75 (provider entry), 377-378 (story), 419-441 (book) | 3 | `on_device`, `no_local_fallback` |
| `src/shared/brief.ts` | 46-47, 168 | 3 | `noLocalFallback` in the brief |
| `src/engine/store/ideas.ts` | 41-42, 142 | 3 | write/strip `no_local_fallback` |
| `src/engine/pipeline/handlers.ts` | 610-620 (`start_book` writes book.md) | 3 | copy the flag into book.md |
| `src/engine/queue/scheduler.ts` | 65-85 (`RunningJob`), 105-128 (deps), 236-245 (`modelsFor`, `bookModelChanged`), 345-398 (`tickOnce` model choice), 478-482 (`launch`), 725-760 (`catch`) | 3 | flag, limited = unusable, last resort gate, no attempt for a limit |
| `src/engine/engine.ts` | 135-160 (router callbacks), 162-180 (scheduler deps), 239-293 (`syncSlots`), 680-760 (caches, `contextTokens`, `setBookModel`), command switch, 1451 (`snapshot`) | 2, 3, 4 | snapshot fields, flag cache and command, `quotaWarnings()`, healthz |
| `src/engine/models/proxyHealth.ts` (new) | | 4b | `readProxyExhausted` |
| `src/engine/summary.ts` | 82-112 (`bookSummary`), 176-200 | 3 | `noLocalFallback`, `onDevice` |
| `src/engine/mcp/tools.ts` | 144-190 (`factory_status`), 561-616 (`add_story`), 638-700 (`update_story`), 858-866 (`set_book_paused`, the pattern) | 3, 4 | new tool, inputs, `quotaWarnings` |
| `docs/design.md` | Decisions table (new row after :150), "Model layer", History (:842) | 3, 4 | per repo CLAUDE.md |
| `docs/mcp.md` | :68 (`factory_status`), :71 (`get_book`), :109 (`set_book_model`), `add_story` / `update_story` | 3, 4 | new fields and tool |
| `seed/config/providers.md` | "Fields of a provider" (:226-240) | 3 | `on_device` (a config file, not a prompt: no `yarn seed:hashes`) |
| Tests: `tests/renderer/store.test.ts`, `tests/scheduler.test.ts` (:693 "book models in the scheduler", :822 "last resort"), `tests/mcp.test.ts` (:519 SCP-61 test), `tests/models.test.ts` (:477 usage limit), `tests/helpers.ts` | | all | see Acceptance |

## Tasks for workers

Run the four tasks **one after another** on `SCP-62_fallback-and-quota-visibility` (cut from `master`), one commit each, in the order T1, T2, T3, T4: they share `protocol.ts`, `Whiteboard.tsx` and `engine.ts`, so parallel workers would conflict. Each worker runs `yarn typecheck`, `yarn lint` and the tests it touched, then the orchestrator runs the whole `yarn test` before each commit.

### Fixed interfaces (all tasks code against these)

```ts
// src/shared/protocol.ts
export interface LimitedModel { model: string; until: string /* ISO UTC */; message: string }
SnapshotEvent.limitedModels: LimitedModel[]                       // T2
ProviderSummary.onDevice: boolean                                  // T3
BookSummary.noLocalFallback: boolean                               // T3 (false when absent)
export interface QuotaWarning {                                    // T4
  kind: 'usage-limit' | 'day-full' | 'day-nearly-full'
  /** a `provider/model` ref for usage-limit, a provider id for the day kinds */
  ref: string
  until: string            // ISO UTC: the limit's reset, or the day's reset (midnight UTC)
  detail: string           // one line for people, times in the engine machine's local time
  books: string[]          // in-progress book slugs whose jobs this serves, sorted; may be empty
}
SnapshotEvent.quotaWarnings: QuotaWarning[]                        // T4
EngineEvent |= { type: 'quota'; warnings: QuotaWarning[] }         // T4, sent only when the list changed
Command  |= { type: 'setBookLocalFallback'; book: string; noLocalFallback: boolean }   // T3

// src/engine/models/router.ts
CandidateOptions.noLocalFallback?: boolean                         // T3
limitedModels(): LimitedModel[]                                    // exists; return type named
setLimited(m: ModelInfo, until: number, message: string, source: 'answer' | 'proxy'): void   // T4b; calls onModelLimited when newly limited
clearLimited(ref: string, source: 'proxy'): void                   // T4b; removes only an entry of that source

// src/engine/queue/scheduler.ts
SchedulerDeps.getNoLocalFallback?: (book: string | null | undefined, idea: string | null | undefined) => Promise<boolean>   // T3
```

book.md / story file key: `no_local_fallback: true` (absent or `false` = off). MCP name: `noLocalFallback`. Blocked reason text for a flagged book: starts with `no local fallback: `.

### T1: feature 1, every deviation in the tooltip (renderer only)

Inputs: `Whiteboard.tsx:154-165`; `ModelDeviation` (`protocol.ts:143`): `{at, job, role, model, wanted, reason}`.
- `src/renderer/store/model.ts`: `export function deviationTooltip(list: ModelDeviation[]): string`. Newest first (the stored list is newest last), one line per entry joined with `\n`: `<local time> · <role with - as space> · <model> · <reason>`; local time is `new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })`; an unreadable `at` prints as given. The job id goes in too, after the role: `<role> (<job>)`. First line: `<n> fallback(s), newest first:`.
- `Whiteboard.tsx`: `title={deviationTooltip(b.modelDeviations)}` on `data-testid="book-deviation"`; the visible text stays (`<role> ran on <model> (<n> times)`).
Output: the tooltip shows all (up to 20) entries. No engine change.

### T2: feature 2, usage-limited models in the Models panel

Inputs: `router.limitedModels()` (`router.ts:123-130`), `engine.ts:153-158` (`onModelLimited`), `engine.ts:1451` (`snapshot`), `ModelsDialog.tsx:434-445`.
- `protocol.ts`: `LimitedModel`, `SnapshotEvent.limitedModels`; `router.limitedModels()` returns `LimitedModel[]` (import the type).
- `engine.ts` `snapshot()`: `limitedModels: this.router.limitedModels()`. `onModelLimited`: also `void this.snapshot().then((s) => this.emit(s))`, as `onProviderDayFull` does at :139.
- Renderer store: keep `limitedModels` from the snapshot (default `[]`).
- `model.ts`: `export function limitedLines(list: LimitedModel[], now: number): string[]`: drops entries whose `until` is not after `now`, sorts by `until`, each `"<model> until <local date and time>: <message cut to 160 characters>"` with `toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })` (the engine warning's format).
- `ModelsDialog.tsx`: under the dialog title, when `limitedLines(...)` is not empty, a `warn` block `data-testid="models-limited"`: heading "Set aside for a usage limit (jobs use their next model until then):" and one line per entry. `now` from `useNow(30_000)` (`store/hooks`), so an entry disappears after its reset without an engine event.
Output: the panel lists set-aside models. MCP `factory_status.limitedModels` is unchanged.

### T3: feature 3, the per-book "no local fallback" switch

Inputs: "On this machine" above; SCP-61 `bookModels` code (`engine.ts:680-760`, `scheduler.ts:236-245, 345-398`); `set_book_paused` (`tools.ts:858-866`) as the tool pattern; `start_book` (`handlers.ts:610-620`) and the story `humanize` flag (`schemas.ts:377`, `ideas.ts:41-42,142`, `brief.ts:46-47,168`) as the copy pattern.

1. **Schemas and registry.** `on_device: z.boolean().optional()` on the provider entry; `no_local_fallback: z.boolean().optional()` on the book and story schemas; brief `noLocalFallback?: boolean`, written as `no_local_fallback: true` only when true (`ideas.ts`), stripped with the others at `ideas.ts:142`; `start_book` copies `no_local_fallback: true` into book.md like `humanize: false`. `ProviderInfo.onDevice` and `ProviderSummary.onDevice` by the default rule. `tests/helpers.ts`: `TestProvider.onDevice`.
2. **Router.** `candidates(role, { ..., noLocalFallback })`: right after the list is built (before the `up` filter at `router.ts:170`), when the flag is set, drop every model with `m.provider.onDevice` whose ref is not in the resolved `bookModels`. This filter is hard: it may leave the list empty (the other filters keep their "unless nothing else is left" rule).
3. **Engine caches and command.** The `bookModels` / `ideaModels` cache entries (`engine.ts:681-707`) also hold `noLocalFallback: boolean` from the same file read. Dep `getNoLocalFallback(book, idea)` reads them (book first, else idea, else false). `contextTokens` (`:715`) passes the flag. Command `setBookLocalFallback`: `books.update` sets `no_local_fallback: true`, or removes the key for false (write `false` if `books.update` cannot delete a key; readers treat absent and false alike); refills the cache; logs `book <slug>: local fallback off|on`; emits the book update; calls `scheduler.bookFallbackChanged(book, flag)`.
4. **Scheduler.**
   - `RunningJob.noLocalFallback?: boolean`, set in `launch` (`:478`) from the value `tickOnce` read; `modelsFor` (`:237-240`) passes it.
   - `bookFallbackChanged(book, flag)`: sets it on the book's running jobs; when on, a running job whose current model (`rj.model`) is on the machine and not in `rj.bookModels` is aborted with reason `'stop'` (it goes back to the queue, no attempt counted, `scheduler.ts:725-728`); otherwise `changeModel({ book })`.
   - `tickOnce` (`:345-398`): read the flag with `getNoLocalFallback(j.book, j.idea)` and pass it to `candidates`. In the model loop, a model with `router.isLimited(m)` counts as unusable (`unusable++`, reason `router.setAsideReason(m)`), like a provider that is down: a job whose only models are set aside waits instead of sending a request that 429s again. This applies to every book. Last resort: when the flag is on and `lastResort.provider.onDevice` and its ref is not in the book's list, push `<ref> (last resort): runs on this machine` and do not use it. When the flag is on and no model is chosen (including an empty `models` list, which today sets the agent to `error` "no model available for this role" at `:348-352`), push a blocked job (not the error state) whose reason is `no local fallback: <book> uses no model on this machine outside its list; ` + the reasons joined (or `no other model of <role> is configured` when the list is empty). The agent shows `waiting-provider` with that reason (the existing `blocked` map).
   - `run` catch (`:741-760`): a `ProviderError` thrown when every model of the job's current list `isLimited` now goes back to the queue with `not_before` = the earliest `until` of those models (from `router.limitedModels()`), at most 1 hour ahead, **without** counting an attempt, log line `Waiting: every model of this job is set aside for its usage limit until <local time>. No attempt counted.` (for every book; without this a flagged book's job would fail for good after three tries).
5. **MCP** (`tools.ts`):
   - New tool after `set_book_paused`: `set_book_local_fallback {book, noLocalFallback: boolean}`, WRITE. Description: "Allow or forbid models on this machine (LM Studio, Strata, Ollama: providers with `on_device`, by default the local OpenAI-compatible servers except the ACP proxy) as fallbacks for ONE book. With `noLocalFallback: true` the book's jobs use its own `role_models` list (set_book_model), the agent's model and the role's other rows, but never a model on this machine outside its list, nor the last resort when that is one; a job with nothing else left waits, and `factory_status.blocked` says `no local fallback: ...`. Running jobs on such a model go back to the queue. Works at any stage." Returns `book(slug)`.
   - `add_story` and `update_story`: `noLocalFallback: z.boolean().optional()` with the same meaning for the book made from the story (update: `false` removes it).
   - `get_book` / `list_books`: `noLocalFallback` comes with `BookSummary`.
6. **UI (display only).** `summary.ts`: `noLocalFallback: d.no_local_fallback === true`. `Whiteboard.tsx` `BookInfo`: when true, a row `Local fallback` / `off: own models and cloud fallbacks only` (`data-testid="book-no-local"`). Demo and test fixtures get `noLocalFallback: false`.
7. **Docs.** Decisions row "No local fallback per book (SCP-62)" (overrides SCP-61's "Not done: a strict never-leave-the-list flag" only in part: the flag forbids models on this machine, not every shared row); "Model layer"; History; `docs/mcp.md` (`set_book_local_fallback`, `add_story`/`update_story` `noLocalFallback`, `get_book` `noLocalFallback`, `factory_status.blocked` reason); `seed/config/providers.md` `on_device`.

Output: a flagged book never runs on lmstudio/strata/ollama unless its own list names it; its jobs wait with a readable reason.

### T4: feature 4, quota warnings (4a) and the proxy's `/healthz` (4b)

Inputs: T2's `LimitedModel`, T3's `onDevice`; `ProviderLimiter` (`dayFull`, `requestsToday`, `dayResetsAt`); `engine.syncSlots` (`engine.ts:261-293`, every `SLOT_SYNC_MS` = 10 s, `:61`); the contract table above.

**4a, warnings.** `engine.ts`: `async quotaWarnings(): Promise<QuotaWarning[]>`:
- one `usage-limit` per `router.limitedModels()` entry: `detail` `<ref> is set aside for its usage limit until <local time>`;
- one `day-full` per provider with `limiter.dayFull(p)`: `<id> used up its <rpd> requests for today, until <local time>`;
- one `day-nearly-full` per provider with an `rpd`, not full, and `requestsToday >= 0.8 * rpd`: `<id> used <n> of its <rpd> requests today; the day starts again at <local time>`.
- `books`: from the queued and running jobs (`jobs.list('queued')`, `jobs.list('running')`) of books that are not in a terminal stage: a job's book is listed under a warning when the warning's model (usage-limit), or any model of the warning's provider (day kinds), is in the book's list for the job's role (`bookModel(book, role)`) or is the role's first row (`registry.roleModelRefs(role)[0]`, resolved). Deduplicated, sorted.
- Sorted by `kind` (usage-limit, day-full, day-nearly-full), then `ref`.
- Wiring: `snapshot()` gets `quotaWarnings`; `syncSlots` (every 10 s) and the `onModelLimited` / `onProviderDayFull` callbacks recompute it and emit `{type: 'quota', warnings}` when its JSON differs from the last one sent; a warning that newly names a book writes one engine log line `quota: <detail> (books: a, b)`.
- MCP `factory_status`: `quotaWarnings: await engine.quotaWarnings()`; the description names it and says plainly: "subscription providers (the ACP proxy, client) report no remaining quota, so there is no early warning for them: a usage-limit entry appears when the limit is reached".
- Renderer: store keeps `quotaWarnings` from the snapshot and the `quota` event. `model.ts`: `quotaLine(w: QuotaWarning): string` = `w.detail` plus `(books: ...)` when any. `StatusBar.tsx`: a pill `data-testid="quota-warning"` with an ochre dot, text `quota <n>` where n counts the warnings that name a book, `title` the `quotaLine`s; hidden when n is 0. `Whiteboard.tsx` `BookInfo`: a row `Quota` (`data-testid="book-quota"`, class `warn`) with the `detail` of each warning whose `books` holds this book.

**4b, the proxy's `/healthz`.** New `src/engine/models/proxyHealth.ts`:

```ts
/** GET <origin of baseUrl>/healthz with a 2 s timeout. Returns provider id -> exhausted_until (ISO) for the providers that have one,
 *  {} for a proxy with none exhausted, or null when the answer is not the proxy's shape (no `providers` object) or the call fails. */
export async function readProxyExhausted(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Record<string, string> | null>
```

- In `syncSlots`, for each provider that is enabled, available, `kind: openai-compat`, not `onDevice`, with a loopback `baseUrl` (`127.0.0.1`, `localhost`, `::1`): call it. A provider whose answer is `null` twice in a row is not asked again in this engine run (it is not the proxy).
- For each `(proxyId, until)` with `until` in the future: every chat model of that Scriptorium provider whose id starts with `<proxyId>/` (e.g. `acp/codex/gpt-6-luna` for `codex`) gets `router.setLimited(m, Date.parse(until), 'the ACP proxy reports <proxyId> used up until <ISO>', 'proxy')`. For a proxy id no longer reported: `router.clearLimited(ref, 'proxy')` for its models (an entry set from a real 429, source `answer`, stays until its time).
- Router: the `limited` map entries get `source`; the existing 429 path uses `'answer'`. `setLimited` fires `onModelLimited` only for a model not limited before, so the warning, the snapshot (T2) and the quota event follow.
- This widens SCP-61's "only the model that failed" for this one case: the proxy itself reports the whole provider used up, and refuses all its models.

Output: `factory_status.quotaWarnings`, the status pill and the book row, and set-aside proxy models before a request fails.

## Acceptance criteria and tests

Per the test-discipline skill: few tests, extend the existing ones, no near-duplicates. Each test runs in a temp data folder.

| # | Criterion | Test |
|---|---|---|
| A1 | The tooltip has every deviation, newest first, with time, role, job, model and reason | `tests/renderer/store.test.ts`: one `it` for `deviationTooltip` with three entries: four lines, the newest entry's model on line 2, each reason present |
| A2 | The Models panel's list holds the set-aside models with a local reset time, and drops one after its time | same file: one `it` for `limitedLines` (one entry before and after `now`); snapshot wiring is proven by typecheck |
| A3 | With `no_local_fallback: true`, a book whose list model is set aside never runs on an on-device row nor on an on-device last resort; the job stays queued and `blockedJobs()` gives a reason starting `no local fallback: ` that names the usage limit; the same setup without the flag runs on the on-device row | `tests/scheduler.test.ts`, one new `it` in "book models in the scheduler" (:693): providers `acp` (not on device) and `loc` (`onDevice: true`), writer rows `[acp/a, loc/g]`, `last_resort_model: loc/g`, book list `[acp/a]`, `acp/a` set aside with `router.setLimited` (or a mocked 429), two books, one flagged |
| A4 | Setting the flag through MCP writes book.md, `get_book` returns `noLocalFallback: true`, and `false` turns it off | `tests/mcp.test.ts`: extend the SCP-61 `set_book_model` test (:519) with two `set_book_local_fallback` calls |
| A5 | The default "on this machine" rule: `on_device` absent gives true for a local `openai-compat` provider, false for `acp`, `client` and an API provider; `on_device: false` wins | `tests/models.test.ts`: one `it` near the registry tests (four providers, one assertion line) |
| A6 | A job whose every model is set aside for a usage limit goes back to the queue with `not_before` at the reset and no attempt counted | extend A3's `it`: the flagged book's job launched just before the limit (or a second job) shows `attempts: 0` and `not_before` |
| A7 | `factory_status.quotaWarnings` lists a usage-limited model with the books whose jobs it serves, and a provider at 80% of its `rpd` as `day-nearly-full` | `tests/mcp.test.ts`: extend the SCP-61 test's `factory_status` line (:553), which today asserts `limitedModels: []`: after the limit, `quotaWarnings` has the `usage-limit` entry naming the book; seed `requestsToday` with `limiter.seedToday` for an `rpd: 10` provider at 8 |
| A8 | `/healthz` with `providers.codex.exhausted_until` in the future sets aside `acp/codex/*` (not `acp/claude/*`); without it the proxy-set entry is cleared; a non-proxy answer gives null | `tests/models.test.ts`: one `it` with an injected `fetchFn` calling `readProxyExhausted` and the router's `setLimited`/`clearLimited` |
| A9 | Typecheck, lint, the whole unit suite | `yarn typecheck`, `yarn lint`, `yarn test` |

Not covered by unit tests (UNTESTED until the live checks): the rendered tooltip, the Models panel block, the status pill and book rows on screen; the real proxy's `/healthz`; a real usage limit overnight.

## ROADMAP.md entry (the implementer adds it, after the SCP-61 entry under "Open: found by the hub's *Ash & Brass* run (2026-11-15)")

```markdown
- **SCP-62 (open, branch `SCP-62_fallback-and-quota-visibility`; plan in `.claude/tickets/SCP-62-fallback-and-quota-visibility/`; hub REQ-0026): fallback and quota visibility after SCP-61.** (1) The whiteboard's Fallback tooltip lists every `model_deviations` entry (time, role, job, model, reason), not only the newest. (2) The Models panel lists the models set aside for a usage limit with their reset in local time. (3) `no_local_fallback: true` in book.md (MCP `set_book_local_fallback`, `add_story`/`update_story` `noLocalFallback`): models on this machine (`on_device`, by default the local OpenAI-compatible servers except the ACP proxy) outside the book's own list are never used for its jobs, nor as the last resort; its jobs wait with `no local fallback: ...` in `factory_status.blocked`. A job whose every model is set aside for a usage limit now waits instead of counting attempts. (4) `factory_status.quotaWarnings` and a status-bar pill: a usage-limited model, a provider whose daily requests are used up or at 80% of `rpd`, each with the books it serves; Scriptorium reads the ACP proxy's `/healthz` `exhausted_until` and sets those models aside before a request fails. Not possible: an early "nearly used up" warning for subscription providers (the proxy and the providers report no remaining quota). Not done: a UI switch for the flag.
```

When done, "open" becomes "done, merged <date>" with what was verified (as the SCP-61 entry does).

## Live checks (all UNTESTED until run after a deploy the user agrees to)

- UNTESTED: hover the Fallback line of a book with several deviations (e.g. one from the *Ash & Brass* run): every entry shows, newest first, in local time.
- UNTESTED: with the ACP proxy reporting a provider exhausted (or after a real usage limit), the Models panel shows the models with their local reset time, and the entry disappears after the reset.
- UNTESTED: `set_book_local_fallback {book, noLocalFallback: true}` on a book whose list is one acp model; when that model hits its limit overnight, `factory_status.blocked` shows `no local fallback: ...`, `log.md` gets no `DEVIATION:` line naming lmstudio or strata, and the job runs on its own model after the reset.
- UNTESTED: `factory_status.quotaWarnings` and the status pill while a book's model is limited; `/healthz` of the live proxy has the shape this plan reads (`providers.<id>.exhausted_until`).

## Commit plan

On `SCP-62_fallback-and-quota-visibility`, cut from `master`. Each commit carries its tests and its docs (`docs/design.md`, `docs/mcp.md`). Messages written with a Bash heredoc (`git commit -F - <<'EOF'`), subject, blank line, body, the attribution line.

1. `SCP-62: the book's Fallback tooltip lists every deviation` (T1)
2. `SCP-62: the Models panel shows models set aside for a usage limit` (T2)
3. `SCP-62: no_local_fallback per book; a usage-limited job waits` (T3)
4. `SCP-62: quota warnings in factory_status and the status bar; read the proxy's /healthz` (T4)
5. `SCP-62: ROADMAP entry and ticket files` (the ROADMAP entry above, this plan's status, a changelog if the implement skill writes one)

## Deploy note

- Build and restart only with the user's go, when no production is running: a restart resumes the book factory.
- No data migration. Old books have no `no_local_fallback` (off). The live `providers.md` needs no `on_device`: the default rule gives lmstudio, strata and ollama as on the machine and acp as not. A custom provider in the live file that points at another proxy needs `on_device: false`.
- After the deploy, set the flag on the books that must never use gemma (`set_book_local_fallback`), instead of removing the gemma row from `settings.md` for every book.

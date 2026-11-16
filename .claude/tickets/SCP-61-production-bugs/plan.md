---
status: done
request: REQ-0025
repos: [scriptorium]
branch: SCP-61_production-bugs
updated: 2026-11-16
---
# SCP-61: four production bugs from the Ash & Brass run

Research: `.claude/tickets/SCP-61-production-bugs/research.md` (read it first; the line numbers below were rechecked on `master` on 2026-11-15). Hub request: `C:\projects\Personal\creative-hub\.claude\director\requests\REQ-0025-production-bugs-from-ash-and-brass.md`, bugs 1-4. Linked proxy ticket: `C:\projects\Personal\api-acp-proxy\.claude\tickets\AAP-31-usage-limit\plan.md` (its Contract is copied below).

Nothing is implemented until the user says yes to this plan, and no code is built, run or deployed while the REQ-0024 production keeps Scriptorium running (see "Deploy note"). Unit tests that use temp data folders (`tests/helpers.ts`) are fine; never point a test or a script at `~\Scriptorium`.

## Scope

1. **Bug 1 (must): the humanizer's new-name guard flags ordinary words.** In `newNames`: strip `*` and `_` before the sentence-start test; skip contractions of "I" (`I'm I've I'll I'd`, straight `'` and curly `’`); skip a short list of conventionally capitalised religious words and any word whose lower-case form is in `ENGLISH_WORDS`. A real new name must still be caught.
2. **Bug 2 (must): no quiet downgrade to a shared fallback.** The user chose "model list + loud fallback":
   - a book's (and a story's) `role_models` accepts an ordered list per role; a single string keeps working;
   - the book's list is tried in order first; only when it is exhausted are the agent's model and the role's rows (with `fallback_shared`: the shared rows deepseek, strata, lmstudio) used;
   - every job answered by a model outside the book's list writes a `DEVIATION` line to the book log and the engine log, and is recorded in `book.md` so it shows in the book status (UI whiteboard) and in MCP `get_book`;
   - `isUsageLimitError` recognises the proxy's 429 `usage_limit_exceeded` and Codex's raw "usage limit" / "try again at ..." text; the router sets that one model aside (not the provider) until the parsed time (default 1 hour), and does not retry it;
   - the window used to size prompts follows the book's model (`engine.ts:202` ignores it today); the publisher and the short-book whole-book review are sized to it, so a too-long prompt goes to the next model of the book's list, and is cut down only when no model of the list can take it;
   - MCP `set_book_model`, `add_story`, `adapt_book`, `update_story` accept the list. The UI writes no `role_models` (grep of `src/renderer`: none), so the UI change is display only.
3. **Bug 3 (nice): the outline review checks the brief and notes.** `review_outline` gets `ownerNotesSection`; the seed prompt gets a brief/notes compliance paragraph, also appended in code for data folders whose prompt was edited.
4. **Bug 4 (nice): clear humanizer front matter.** Write `humanizer_round: N` and `humanizer_result: rewritten | kept`; read the old `humanized` key as a fallback; a refused pass is not saved to history with the `-humanized` suffix.

## Out of scope

- The automatic cast pre-check of the outline against the brief/series cast (research 3, option 2): listed as an extra idea.
- SCP-39 (weekdays and months as names): same function, separate open ticket; do not fold it in.
- A "strict" book flag that fails instead of using any shared fallback (`fallback: own`): the user chose list + loud fallback.
- The proxy's side (AAP-31) and the hub's `hub.ps1` status (HUB-35).
- A data migration of old `humanized: N` files (the reader falls back; none needed).
- Changing the live `~\Scriptorium\config\settings.md` (`fallback_shared: true` stays the user's choice).
- Pausing a book on a deviation.

## Files and modules (file:line on master)

| File | Lines | Bug | What |
|---|---|---|---|
| `src/engine/pipeline/humanizerHandlers.ts` | 109 (`NAME_WORD`), 184-202 (`newNames`), 263 (`ENGLISH_WORDS`) | 1 | the guard |
| `src/engine/pipeline/humanizerHandlers.ts` | 393-403 (`writeChapter` call), 334 (doc comment) | 4 | front matter written by the pass |
| `src/engine/pipeline/books.ts` | 69-70 (`ChapterFile.humanized`), 332 (reader), 339-353 (`writeChapter`, history suffix at 346) | 4 | read/write the fields |
| `src/engine/pipeline/pipeline.ts` | 390 | 4 | builds the `humanized` map from `c.humanized` (unchanged if the reader maps the new key into it) |
| `src/engine/models/router.ts` | 10-17 (`CandidateOptions`), 125-157 (`candidates`), 165-305 (`chat`), 315-345 (classifiers), 69-73 (callbacks) | 2 | list option, usage limit, set-aside map |
| `src/engine/models/types.ts` | 53-65 (`ProviderError`), 126-134 (`httpError`, body cut at 300 chars) | 2 | carry `code` and `until` parsed before the cut |
| `src/engine/models/openaiCompat.ts` | 104 (SSE error envelope, cut at 300 chars) | 2 | same |
| `src/shared/protocol.ts` | 16 (`ProblemKind`), 142-185 (`BookSummary`), 418-419 (`setBookModel` command) | 2 | `usage-limit` kind, `modelDeviations`, list in the command |
| `src/renderer/store/model.ts` | 226 | 2 | label for `usage-limit` (the map is typed by `ProblemKind`) |
| `src/shared/schemas.ts` | 348-349 (story `role_models`), 410-416 (book `role_models`) | 2 | `string | string[]`, plus `model_deviations` |
| `src/shared/brief.ts` | 40-41, 173-176 | 2 | brief `models` keeps lists |
| `src/engine/store/ideas.ts` | 41 | 2 | passes `models` through (check only) |
| `src/engine/engine.ts` | 143-153 (router callbacks), 170 (`getBookModel`), 202 (`contextTokens`), 672-724 (`bookModels` cache, `ideaModel`, `bookModel`, `setBookModel`), 1233 | 2 | lists, sync window, deviation sink |
| `src/engine/queue/scheduler.ts` | 83-84 (`RunningJob.bookModel`), 121-124 (deps), 235-245 (`modelsFor`, `bookModelChanged`), 344-345, 411, 477-480, 600-630 (attempt/problem/done events) | 2 | list, deviation detection |
| `src/engine/mcp/tools.ts` | 56 (`modelsSchema`), 99-108 (`checkRoleModels`, `book()`), 133 (`factory_status`), 571/614/646 (`models` inputs), 881-897 (`set_book_model`) | 2 | accept lists, show deviations and set-aside models |
| `src/engine/summary.ts` | 82 (`bookSummary`) | 2 | `modelDeviations` from book.md |
| `src/renderer/demo/library.ts` | 90 | 2 | demo `bookSummary` gets the new field (typecheck) |
| `src/renderer/ui/Whiteboard.tsx` | 148-151 (reasons line) | 2 | one line for the latest deviation |
| `src/engine/pipeline/handlers.ts` | 108 (`PipelineDeps.contextTokens`), 280-283 (`memoryContext`), 989 (short-book review full text), 1150 (`otherChapters` window), 1256 (publisher `book_text`) | 2 | window per book, fit whole-book prompts |
| `src/engine/pipeline/adapt.ts` 151, `nfcontext.ts` 17/120, `nonfiction.ts` 247-249 | | 2 | pass the book slug to `contextTokens` |
| `src/engine/pipeline/longHandlers.ts` | 40-81 (`review_outline`), 57-59 | 3 | owner notes + compliance rule |
| `seed/prompts/developmental-editor/review_outline.md` | whole | 3 | compliance paragraph |
| `src/engine/store/seedHistory.ts` | 34 | 3 | regenerated by `yarn seed:hashes` |
| `docs/design.md` | Decisions table, "Model layer", 99 and 802 (`humanized`), History | 2, 4 | per repo CLAUDE.md |
| `docs/mcp.md` | `set_book_model`, `get_book`, `factory_status` | 2 | list and new fields |
| Tests: `tests/humanizerGuards.test.ts` (70-80), `tests/models.test.ts` (420-445, 1140), `tests/scheduler.test.ts`, `tests/mcp.test.ts` (489-512), `tests/series.test.ts` (357), `tests/humanizer.test.ts` (235-275) | | all | see Acceptance |

Readers of `humanized:` outside Scriptorium (grep of every repo under `C:\projects\Personal`, code files `*.ts *.tsx *.js *.mjs *.cjs *.py *.ps1 *.sh *.rs *.json`, without `node_modules`/`dist`/`out`/`build`/`release`): **none**. The only hits are text, not code: hub run logs and notes (`creative-hub/runs/ash-and-brass.md:44,56`, `runs/france-als162-article.md`, `runs/the-clockless-god-vn.md`, `runs/the-lighthouse-that-kept-lists.md`), copied chapter files in `creative-hub/runs/**/chapters/*.md` and `creative-hub/.claude/temp/scp-backup/`, hub notes (`.claude/temp/scriptorium-pb-loop.md:10`, `scriptorium-snail-loop.md`, the SCP-10-12 ticket docs, REQ-0024/REQ-0025), and two VN Studio backups (`visual-novels-orchestrator/.claude/temp/prod01/backups/*.md`). Book Translator, VN Studio, creative-hub-web and the others do not read the key. Inside Scriptorium: `books.ts:70,332,339,346,352`, `pipeline.ts:390`, `advance.ts:123,449,458,572` (presence only), `humanizerHandlers.ts:334,402`, `docs/design.md:99,802`, `tests/humanizer.test.ts`.

## Tasks for workers

Four groups that can run in parallel: T1, T2 (three slices, interface fixed below), T3, T4. File overlap: T1 and T4 both edit `humanizerHandlers.ts` (T1 lines 100-270, T4 lines 330-405); T2a owns `router.ts`/`types.ts`/`openaiCompat.ts`, T2b owns `engine.ts`/`scheduler.ts`/`schemas.ts`/`brief.ts`/`tools.ts`/`protocol.ts`/`summary.ts`/renderer, T2c owns `handlers.ts`/`adapt.ts`/`nfcontext.ts`/`nonfiction.ts`. One commit per bug on `SCP-61_production-bugs` (T2 slices land as one commit "SCP-61: bug 2 ..." or three commits, the orchestrator's choice), in the order T1, T2a, T2b, T2c, T3, T4. Node through fnm (repo CLAUDE.md); after T3 run `yarn seed:hashes`.

### Fixed interfaces (all T2 slices code against these)

**role_models shape.** In `book.md` and in `ideas/<story>.md`:

```yaml
role_models:
  publisher: [acp/antigravity/gemini-4-argon, acp/claude/claude-sonnet-5]   # ordered list
  writer: acp/claude/claude-sonnet-5                                         # a single string keeps working
```

- Schema (book and story): `z.record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))`.
- One helper in `src/shared/schemas.ts`: `export function roleModelList(v: string | string[] | undefined | null): string[]` (trims, drops empties, keeps order, drops duplicates). Every reader goes through it.
- Writing: one model is written as a string, two or more as a list (old files and diffs stay as they were).
- MCP inputs: `modelsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))`; `set_book_model {model: string | string[] | null}`; each ref is checked with `needModel`. Engine command: `{ type: 'setBookModel'; book; role; model: string | string[] | null }`.
- `get_book` / `set_book_model` return `roleModels` as stored (string or list).

**Router option.** `CandidateOptions.bookModels?: string[]` replaces `bookModel` (all callers move: scheduler 237/345, engine 202, `tests/models.test.ts:1140-1142`). Order of `candidates`: the book's list (resolved, in order), then the agent's model, then `registry.roleModelRefs(role)`, duplicates dropped. With `avoidFamily`, the whole book list and the agent's model stay first (as `chosen` does today).

**Usage limit.** In `router.ts`:

```ts
export function isUsageLimitError(err: unknown): boolean
export function usageLimitUntil(err: unknown, now: number): number   // ms epoch
export const USAGE_LIMIT_FALLBACK_MS = 60 * 60_000
onModelLimited?: (m: ModelInfo, until: number, message: string) => void
limitedModels(): { model: string; until: string; message: string }[]   // for factory_status
```

**DEVIATION line.** Written once per job and model (the first `done` event of a model outside the book's list), on its own line, to the job's log session (agent log and book log) and, shorter, to the engine log:

```
DEVIATION: <role> job <job id> was answered by <model ref>, a shared fallback outside the book's list (<ref 1>, <ref 2>). Why: <ref 1>: <reason>; <ref 2>: <reason>
```

`<reason>` is the router's problem text for that model in this request, cut to 200 characters (e.g. `usage limit until 2026-11-29T10:07:00.000Z`, `prompt is too long ... about 45538 tokens, its context is 45000`, `down`, `over budget`); a model of the list that the candidates filter already dropped (set aside, down) gets the filter's reason. The line starts with `DEVIATION: ` and contains the word "fallback", so the hub's `waitbook.sh` (which stops on "fallback") and a grep for `^DEVIATION:` both find it. A book with no list for the role never writes one (the role's own list is then normal behaviour).

**get_book field.** `book.md` gets `model_deviations` (newest last, at most the last 20):

```yaml
model_deviations:
  - at: 2026-11-15T16:56:12.000Z
    job: the-automaton-who-confessed--publish--r1
    role: publisher
    model: lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic
    wanted: [acp/antigravity/gemini-4-argon]
    reason: "acp/antigravity/gemini-4-argon: prompt is too long ... about 45538 tokens, its context is 45000"
```

`BookSummary.modelDeviations: { at: string; job: string; role: string; model: string; wanted: string[]; reason: string }[]` (empty when none), so `get_book`, `list_books` (through `slim`) and the UI get it. The whiteboard book card shows the newest one as one warning line: `Fallback: <role> ran on <model> (<n> times)`.

### T1: bug 1, the guard (`humanizerHandlers.ts:184-202`)

Inputs: research section 1; `tests/humanizerGuards.test.ts:70-80`.
Changes in `newNames`:
- `before = text.slice(0, at).replace(/[ \t*_]+$/, '')` (emphasis marks do not hide a sentence start; "the *Engine*" still gives `before = "the"`).
- Skip `/^I['’](?:m|ve|ll|d)$/u`.
- `const CAPITALISED_WORDS = new Set(['god', 'gods', 'lord', 'heaven', 'heavens', 'hell', 'christ', 'devil'])` (keep it this short); skip a word whose `nameKey` is in it or in `ENGLISH_WORDS`. Move the `ENGLISH_WORDS` declaration above `newNames` if needed for clarity (it is a module `const`, used at call time, so order only matters for reading).
- Update the doc comment above `newNames`.
Output: `newNames` returns `[]` for the three failing cases; the guard cases still flag. No other caller changes (`humanizeProblem` at 311-312 is the only caller).

### T2a: bug 2, router and errors (`router.ts`, `types.ts`, `openaiCompat.ts`, `protocol.ts:16`, `renderer/store/model.ts:226`)

- `ProviderError` gets `readonly code?: string` and `readonly until?: number` (pass them through an optional last `extra?: { code?: string; until?: number }` argument; keep the positional ones). `httpError` and the SSE envelope at `openaiCompat.ts:104` parse the body JSON before cutting it to 300 characters: `error.code` and `error.exhausted_until` (contract below), and `Retry-After`.
- `isUsageLimitError(err)`: a `ProviderError` with `code === 'usage_limit_exceeded'`, or whose message matches `/usage_limit_exceeded|usage limit|try again at/i`. Any status (the Codex text came as an SSE envelope with no status). `provider_queue_full` (also 429) must not match.
- `usageLimitUntil(err, now)`: `err.until`; else `retryAfterMs`; else the "try again at <Mon> <d>[st|nd|rd|th], <yyyy> <h>:<mm> [AM|PM]" text, read as local time; a time in the past, unparsable or more than 31 days ahead gives `now + USAGE_LIMIT_FALLBACK_MS`.
- In `chat`, before the daily-limit check: on a usage limit, set `limited.set(model.ref, { until, message })`, call `onModelLimited` once, push the failure (`<ref>: usage limit until <ISO>`), `break` to the next model, no retry and no `Retry-After` sleep. Never `markDayFull` (that blocks every acp model).
- `candidates` drops set-aside models while another is left (as `isRefused`), and `chat` skips one the same way (as at 175-176); an expired entry is removed. `problemKind` returns `'usage-limit'` first. Add `'usage-limit'` to `ProblemKind` and a label in `renderer/store/model.ts` ("Usage limit reached", short "limit", hint "This model takes no request until its limit resets; the next model of the list answers.").
- `candidates` takes `bookModels` (interface above).

### T2b: bug 2, lists, deviation and status (`schemas.ts`, `brief.ts`, `engine.ts`, `scheduler.ts`, `tools.ts`, `protocol.ts:142-185,418-419`, `summary.ts`, `renderer/demo/library.ts`, `Whiteboard.tsx`)

- Schemas and `roleModelList` as above; `brief.ts:173-176` keeps lists (string or non-empty string array).
- `engine.ts`: caches hold `Record<string, string[]>`; `bookModel`/`ideaModel` return `string[]`; `getBookModel`/`getIdeaModel` deps return `Promise<string[] | undefined>`. `setBookModel` takes `string | string[] | null`, writes one as a string and more as a list, and refills the cache with the new map instead of deleting it (the sync window below reads it). Log line `book <slug>: <role> uses <a, b>`.
- `engine.ts:202`: `contextTokens: (role, book, pick = 'first') => ...` built on `this.router.candidates(role, { bookModels: book ? this.cachedBookModels(book, role) : undefined })`: `'first'` = the first candidate's context, `'largest'` = the largest context among the candidates that belong to the book's list (else the first). `cachedBookModels` reads the cache synchronously (the scheduler always fills it before it launches a job of the book).
- `router.onModelLimited` in the engine: `models: <ref> hit its usage limit until <local time>: jobs use the next model of their list until then. Provider said: ...` plus an `engine.warning`, then `scheduler.kick()`.
- `scheduler.ts`: `RunningJob.bookModels?: string[]`; `bookModelChanged(book, role, models: string[] | undefined)`. In `run`, collect the `problem` events of each request by model; on a `done` event whose model ref is not in the resolved book list (and the list is non-empty), write the DEVIATION line through `logAll`, `this.d.log?.(...)`, and call a new dep `onDeviation?(d: ModelDeviation)`; once per job and model. The engine's `onDeviation` appends to `book.md` `model_deviations` (cap 20) and emits the book update. For a `start_book` job (story list, no book yet) only the log lines are written.
- `summary.ts`: `modelDeviations` from `book.md`. `Whiteboard.tsx`: the one warning line.
- `tools.ts`: `modelsSchema` and `checkRoleModels` take lists; `set_book_model` description says "a model or an ordered list ... the book's list is tried first, then the role's models; a job that falls back writes DEVIATION to the book log and `modelDeviations` in get_book"; `factory_status` gets `limitedModels` (`router.limitedModels()`) and its description names it.

### T2c: bug 2, the window and whole-book prompts (`handlers.ts`, `adapt.ts`, `nfcontext.ts`, `nonfiction.ts`)

- `PipelineDeps.contextTokens(role: string, book?: string | null, pick?: 'first' | 'largest'): number | undefined` (`handlers.ts:108`, `nfcontext.ts:17`, `adapt.ts:138` deps type). Every caller passes the book slug: `handlers.ts:282`, `:1150`, `adapt.ts:151`, `nfcontext.ts:120`, `nonfiction.ts:248`. Test stubs `() => undefined` keep compiling.
- New helper `fitBookText(d, slug, windowTokens)` in `handlers.ts`: when `estimateTokens(fullText)` is at most 60% of the window (or the window is unknown), the full text; else the first and last chapters in full and every other chapter as its summary (`summaries/ch-NN.md`, else the outline entry's summary), headed "Chapters 2-18 are given as summaries". Log `publish: the book (about N tokens) does not fit <ref> (W): sent summaries` to the job log.
- Publisher (`handlers.ts:1256`) and the short-book review (`handlers.ts:989`) use `fitBookText(d, slug, d.contextTokens(role, slug, 'largest'))`. With the book list `[argon 45k, sonnet 200k]` the full book goes out, the router skips argon as too big and sonnet answers (no deviation); only when no model of the list fits is the text cut.

### T3: bug 3, outline review (`longHandlers.ts:40-81`, `seed/prompts/developmental-editor/review_outline.md`)

- `appendToPrompt(messages, await ownerNotesSection(d, slug))` after `seriesSection` (line 58); import from `./handlers`.
- Seed prompt, after the "Check:" paragraph: "Then check the outline against the owner's brief, the series notes and the owner's notes below: every named character, plot point and setting the brief or a note asks for must appear in some chapter. Name each missing item as a problem with the chapter where it should go. A missing required item is a "revise" whatever the structure score."
- The same text as a code rule, `BRIEF_RULE`, appended when the data folder's prompt lacks the phrase "owner's brief" (the `ensureProblemsRule` pattern, `reviewNotes.ts:114`), so an edited prompt also gets it.
- `yarn seed:hashes`.
- How it reaches installs: `migrateSeedPrompts` (`store/migrations.ts:492`) replaces a data-folder prompt at the next start only if it is byte-for-byte an earlier seed version (its hash is in `seedHistory.ts:34`); a prompt the owner edited stays as it is, and gets the rule from code. Nothing reaches `~\Scriptorium\prompts` before the engine is restarted on the new build.

### T4: bug 4, front matter (`books.ts`, `humanizerHandlers.ts:393-403`, `docs/design.md:99,802`)

- `writeChapter` takes `humanizer?: { round: number; result: 'rewritten' | 'kept' }` and writes `humanizer_round` and `humanizer_result`; it stops writing `humanized`.
- Reader (`books.ts:332`): `humanized` (in memory, unchanged name) = `humanizer_round` if an integer, else the old `humanized`; new `humanizerResult?: 'rewritten' | 'kept'` (undefined for an old file). `pipeline.ts:390` and `advance.ts` stay as they are.
- History suffix (`books.ts:346`): `-humanized` only when the old file has `humanizer_result: rewritten`, or (old file) an integer `humanized` and no `humanizer_result`.
- `humanizerHandlers.ts:394-403`: pass `{ round: ctx.job.round, result: problem ? 'kept' : 'rewritten' }`; fix the comment and the doc comment at 334.
- `docs/design.md:99,802`: the two fields.

## Contract

Copied word for word from AAP-31's plan ("Contract"):

> Identical in HUB-35's plan. Consumers detect the case by `error.code === "usage_limit_exceeded"`, never by the status alone
> (`provider_queue_full` is also a 429).
>
> Refusal (and the first failing request), HTTP:
>
> ```
> HTTP/1.1 429 Too Many Requests
> Content-Type: application/json
> Retry-After: 1203420
>
> {
>   "error": {
>     "message": "Codex has hit its usage limit; it resets at 2026-11-29 11:07 (local time). Use another model or wait.",
>     "type": "rate_limit_error",
>     "param": "model",
>     "code": "usage_limit_exceeded",
>     "provider": "codex",
>     "exhausted_until": "2026-11-29T10:07:00.000Z",
>     "retry_after": 1203420
>   }
> }
> ```
>
> - `provider`: the provider id (`codex`, `claude`, `antigravity`), the prefix of the model id.
> - `exhausted_until`: ISO 8601 in UTC (`Z`), always present. `retry_after`: whole seconds from now, at least 1, always
>   present, equal to the `Retry-After` header.
> - `message` is for people; do not parse it.
> - A stream refused before it starts gets this same HTTP answer (JSON, not SSE). Only a stream whose first request fails
>   mid-turn gets it as an SSE event `data: {"error": {...same object...}}` with no `Retry-After` header.
>
> `/healthz` (unauthenticated) and `/v1/models`:
>
> ```
> GET /healthz
> { "status": "ok", "uptime_seconds": 28994,
>   "providers": { "codex": { "active": 0, "queued": 0, "max_concurrent": 4, "max_queue": 0,
>                             "exhausted_until": "2026-11-29T10:07:00.000Z" } } }
>
> GET /v1/models
> { "object": "list", "data": [ { "id": "codex/gpt-6-luna", "object": "model", "created": 0, "owned_by": "openai",
>                                 "exhausted_until": "2026-11-29T10:07:00.000Z" } ] }
> ```
>
> `exhausted_until` is absent when the provider is not exhausted (including after the time has passed).

Scriptorium uses only the 429 body and the SSE event (`code`, `exhausted_until`, `Retry-After`). It still recognises the old raw Codex text (an older proxy, or a mid-stream message), and it sets aside only the model that failed, not every `acp/codex/*` model. `/healthz` and `/v1/models` are not read.

## Acceptance criteria and tests

Per test-discipline: few tests, extend existing ones, no near-duplicates. "R" marks a reproduction test that fails on master.

| # | Criterion | Test |
|---|---|---|
| A1 (R) | "wishing to God", "I've / I’m / I'll / I'd", and `*...refused.* These` / `_..._ These` are not new names | `tests/humanizerGuards.test.ts`, one new `it` in "units and group nouns are not names": the three research cases (fails now: `['God']`, `["I've"]`, `['These']`) |
| A2 | The guard still catches real names: "Then Captain Rourke came in." gives `['Captain','Rourke']`; "She asked *Rourke* about it." gives `['Rourke']`; "Rourke's dog" stays flagged | same `it` (the existing "Captain Rourke" line at :77 stays) |
| A3 (R) | A usage limit, as the proxy's 429 JSON and as Codex's raw text in an SSE error, costs exactly one request, sets that model aside until `exhausted_until` / the parsed "try again at" time, leaves another `acp` model usable, and the model is back after the time (injected `now`) | `tests/models.test.ts`, one `it` next to the too-big test (:420): two mocked errors, request counts, `candidates()` before and after (fails now: three requests, no set-aside) |
| A4 (R) | A book list `[acp/a (context 100), acp/b (100000)]` with `fallback_shared: true` and `lmstudio/g` in the rows: a long prompt calls only `b`; with both too small, `lmstudio/g` answers (the loud fallback) | `tests/models.test.ts`, extend the too-big `it` or add one (`candidates(role, { bookModels })`); also update :1140-1142 to `bookModels` (fails now: no list option) |
| A5 (R) | A job of a book with a list that is answered by a model outside it writes one `DEVIATION: ` line to the book log, adds an entry to `book.md` `model_deviations`, and `get_book` returns it in `modelDeviations`; a book with no list writes none | `tests/mcp.test.ts`, extend the `set_book_model` test (:489): set a list (also proves the MCP input and `roleModels` output), make the mocked list models fail, run the job, read `log.md` and `get_book` (fails now: list refused by the schema) |
| A6 | The window follows the book's model, and the publisher sends the whole book when a model of the book's list fits it, summaries when none does | one test where the publish tests live (`tests/pipeline.test.ts` or `tests/novel.test.ts`): book list with a small and a large context: the publish prompt holds the full text; only the small one: the prompt is under its window and says "given as summaries" |
| A7 | The outline review prompt carries the owner's notes and the brief/notes rule | `tests/series.test.ts`, extend the `grab('review_outline')` case (:357): add a book note, assert its text and "owner's brief" are in the prompt |
| A8 | A refused humanizer pass writes `humanizer_round` and `humanizer_result: kept`, and its predecessor is not saved as `-humanized`; an accepted pass writes `rewritten`; a chapter file with only the old `humanized: 0` still counts as humanized | `tests/humanizer.test.ts`: update the expectations at :240, :267, :273 to the new keys, add one refused-pass case with an old-format fixture |
| A9 | Typecheck, lint, the whole unit suite and the seed-hash test pass | `yarn typecheck`, `yarn lint`, `yarn test` (temp data folders only) |

Not tested by unit tests (UNTESTED until the live check): the whiteboard line, the real proxy wire format, a real Codex limit.

## Reproduction tests per must-fix bug (fail before the fix)

- **Bug 1:** A1 above. Before: `newNames('He turned back, wishing to God he had not.', 'He turned back, wishing he had not.')` returns `['God']`; `newNames("She said I've learned it.", 'She said I have learned it.')` returns `["I've"]`; `newNames('*Request refused.* These were dead words.', 'Request refused. The words were dead.')` returns `['These']`.
- **Bug 2:** A3 (three requests to codex then fallthrough, no set-aside, on master), A4 (no `bookModels` option; gemma gets the call) and A5 (the list is refused by the schema; no `DEVIATION` line exists). Write these first, run them red on master, then fix.

## ROADMAP.md entry (to be added by the implementer, not done by this plan)

Under a new heading after "Open: found by the hub's *The Rooster* run (2026-11-14)":

```markdown
## Open: found by the hub's *Ash & Brass* run (2026-11-15)

- **SCP-61 (open, branch `SCP-61_production-bugs`; plan in `.claude/tickets/SCP-61-production-bugs/`; hub REQ-0025 bugs 1-4): four bugs of the series run.** (1) The humanizer's new-name guard refused valid rewrites for "God", "I've" and a capital after an italic sentence end ("*...* These"). (2) An acp model that hit its usage limit or could not take a 45,538-token publisher prompt fell quietly to LM Studio gemma: `role_models` takes an ordered list per role, the book's list goes first, a job answered by a shared fallback writes a `DEVIATION:` line and `model_deviations` (shown in `get_book`), a usage limit (the proxy's 429 `usage_limit_exceeded`, AAP-31, or Codex's "try again at") sets that one model aside until the reset, and whole-book prompts are sized to the book's own models. (3) The outline review now reads the owner's notes and checks the outline against the brief. (4) `humanized: N` becomes `humanizer_round` and `humanizer_result: rewritten | kept` (the old key is still read). Not done: the automatic cast pre-check of the outline; SCP-39 stays open.
```

When done, the implementer changes "open" to "done in code" and adds what was verified.

## Deploy note

- Build and restart Scriptorium only after the REQ-0024 production has stopped it, and only with the user's go. A restart resumes the whole book factory (and may spend on paid models): never start it to test this ticket.
- At that start `migrateSeedPrompts` upgrades an unedited `review_outline.md` in `~\Scriptorium\prompts`; an edited one keeps its text and gets the rule from code.
- Old `book.md` files with single-string `role_models` and old chapters with `humanized: N` need no migration.
- The live `settings.md` keeps `fallback_shared: true`; a book that should never leave its acp models needs its list set with `set_book_model {model: [...]}` before its jobs run.
- AAP-31 can ship before or after this ticket: without it, the raw Codex text is still recognised; with it, `exhausted_until` gives the exact time.
- Live check after deploy (the user plays nothing here, but REQ-0025 needs it recorded): one book with a two-model publisher list whose first model is too small; expect no `DEVIATION`, then one with only the small model; expect one `DEVIATION:` line in `log.md` and in `get_book`.

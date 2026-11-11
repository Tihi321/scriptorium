---
status: done
request: REQ-0009
repos: [C:/projects/Personal/scriptorium]
branch: SCP-59_acp-context-and-json-repair
updated: 2026-11-11
---
# SCP-59: ACP context limits, JSON repair after a model switch, leaked Book Translator token

Source: `.claude/tickets/REQ-0009-acp-review-json/research.md` (root cause: the Antigravity ACP agent silently keeps only the first ~192,000 characters of a prompt). Companion ticket: AAP-30 in api-acp-proxy (rejects over-cap prompts with HTTP 400). Implement with the global `implement` skill, passing this file.

Reading: the full fix of the three approved items. No change to prompts, review templates or the reviewer failure policy.

## Scope

1. **Context limits for ACP models.** Correct `context` of the `acp/antigravity/*` models in the data folder, and add a size check in `ModelRouter.chat` so a model whose `context` is smaller than the estimated prompt is skipped without a request, the same way a context error skips it today. Scriptorium handles both its own check and AAP-30's 400.
2. **chatJson repair after a model switch.** A repair round never goes to a model other than the one that wrote the reply it repairs. When the model changes (agent, role or book model, or a fallback), the JSON request starts again from the original messages on the new model. The repair round sends the JSON schema when the first ask accepted it. The repair carries the whole first reply (without reasoning blocks), not a 6,000-character cut.
3. **Security.** Delete the plain-text Book Translator bearer token from `.claude/temp/req0006/` (four files hold it) and tell the user how to rotate it.

## Out of scope

The "fix later" and "ignore" items of research.md stay out:
- Reviewer failure policy: one failed review job fails the whole book (P4-2, `advance.ts:332-334`), and research option 4 (repair failure falls through to the next model).
- Short-mode writer context budget (discovery 5, `handlers.ts:845-854`).
- Flaky VN test with "The Moon Lamp" fixture (discovery 1, with SCP-57's item).
- MCP `shutdown` tool / `engine.lock` left by a killed headless (P4-8).
- Data-folder `config/formats.md` drift from the seed (discovery 2).
- book.md `models:` counting only successful jobs (P4-5).
- Moving the JSON instruction to the top of review prompts (research option 3: not the fix).
- The api-acp-proxy change itself (AAP-30, its own ticket and repo).

## Facts checked (2026-11-11)

- `src/engine/models/router.ts:274-276`: a context error is not retried and goes to the next model. `isContextError` is at `:344-347` and already matches `prompt is too long`. `isRefusedRequest` (`:304-308`) excludes context errors, so a 400 "prompt is too long" never sets a model aside for 10 minutes. `problemKind` returns `too-big` for it (`:314`).
- `router.ts:181`: the only size estimate before a request is `estimateCost`. `ModelInfo.context` (`registry.ts:69`) is never compared with the prompt.
- Token estimator: `estimateTokens(text) = ceil(chars / 4)` (`src/engine/models/types.ts:113-115`), used by `estimateCost` (`budget/spend.ts:115-119`) on `messages.map(m => m.content).join('\n')`.
- `httpError` builds `HTTP <status>: <first 300 chars of the body>` (`types.ts:118-126`), not retryable for 400.
- `src/engine/pipeline/llm.ts`: first ask with schema `:85`; a failed first ask is asked again without schema `:86-89`; the repair conversation `:101-108` cuts the reply to 6,000 characters (`:103`) and is asked without schema (`:109`).
- `src/engine/queue/scheduler.ts:545-627` (`ctx.chat`): `models` lives across the job's requests; a model change aborts the request in flight (`changeModel`, `:214-228`) and the loop asks the **same** `o.messages` again on the new list (`:551-555`, `:616-621`). That is how the new model got the old model's repair conversation. An `attempt` event on another provider gives the leased slot back (`:582-585`).
- Data folder `C:/Users/Infplane/Scriptorium/config/providers.md`: `acp/antigravity/gemini-3.8-flash` and `acp/antigravity/gemini-4-argon` have `context: 1000000`; the codex rows have none; `claude/claude-sonnet-5` has 200000.
- Repo: the seed `acp` provider has `models: []` (`seed/config/providers.md:136-145`) and `migrateAcpProvider` adds no models, so no repo default carries 1,000,000 for ACP models. (The `1000000` values in the seed belong to other providers and to `client/antigravity`, the MCP-client path, which is not the ACP agent.)
- Token: `.claude/temp/` is gitignored (`.gitignore:5`), `git ls-files .claude/temp` is empty, `git log --all -- .claude/temp/req0006` is empty: never committed. A byte search (value not printed) of the repo including `.claude/`, the data folder's `config/` and this project's Claude Code transcripts found the literal in: `.claude/temp/req0006/mcp.py`, `.claude/temp/req0006/__pycache__/mcp.cpython-313.pyc`, `.claude/temp/req0006/headless.log`, `.claude/temp/req0006/headless2.log` (Book Translator's headless prints "token (shown once)"), and 5 subagent transcripts under `C:/Users/Infplane/.claude/projects/C--projects-Personal-scriptorium/*/subagents/`. No tracked file holds it. The user-level environment variable `BOOK_TRANSLATOR_MCP_TOKEN` is set and equals the leaked value (checked by comparison, not printed); Book Translator reads that variable before its credential-store entry (`book-translator/src/engine/mcp/token.ts`, README "Safety").

## Files and modules

| File | Change |
|---|---|
| `src/engine/models/router.ts` | Size check in `chat()` before the retry loop |
| `src/engine/models/types.ts` | `ModelSwitchedError` (next to `ProviderError`) |
| `src/engine/queue/scheduler.ts` | `ChatOptions.sameModel`, `ChatOptions.fromModel`; enforce them in `ctx.chat`; log a too-big skip in the job log |
| `src/engine/pipeline/llm.ts` | `chatJson`: restart on `ModelSwitchedError`, schema on repair, whole reply in the repair |
| `seed/config/providers.md` | One bullet in "The ACP proxy" (seed config, not prompts or templates: no `yarn seed:hashes`) |
| `docs/design.md` | New Decisions row, History line |
| `tests/models.test.ts`, `tests/scheduler.test.ts` | Tests below |
| `C:/Users/Infplane/Scriptorium/config/providers.md` | Data folder, not committed: two `context` values |
| `.claude/temp/req0006/` | Deleted (gitignored, not committed) |

## Tasks

### T1. Router size check (`router.ts`)

Input: `RoutedRequest.messages`, each candidate's `ModelInfo.context`.
Change: compute once per `chat()` call `promptTokens = estimateTokens(req.messages.map((m) => m.content).join('\n'))` (the same estimate as `estimateCost`; import from `./types`). In the model loop, after the down/retired/refused skips and before the retry loop:

```ts
if (model.context !== undefined && promptTokens > model.context) {
  const message = `prompt is too long for ${model.ref}: about ${promptTokens} tokens, its context is ${model.context}`
  yield { type: 'problem', model, kind: 'too-big', message }
  lastError = new ProviderError(message, undefined, false)
  failures.push(`${model.ref}: ${message}`)
  continue
}
```

Contract:
- Compare the estimated **prompt** only, not prompt plus `maxTokens`, with no extra margin in code. Reason: the check must not skip models that work today (OpenAI-style servers include output in the window, llama.cpp-style ones do not; a real overflow there still comes back as a context error and is handled as now). The margin for ACP lives in the configured `context` (T4).
- The skip applies to every model, also the last one of the list (unlike the refused rule): sending an over-cap prompt to the ACP agent gives a silently truncated answer, which is worse than an error.
- No request, no budget reservation, no limiter slot for a skipped model. The message contains `prompt is too long`, so `isContextError`, `problemKind` (`too-big`) and the final `all models failed. <ref>: prompt is too long ... | ...` text all work unchanged.
- A model with no `context` is never skipped.

### T2. Contract with AAP-30 (no Scriptorium code beyond T1)

The proxy answers an over-cap prompt with HTTP **400** and an OpenAI-style body whose `error.message` comes first and starts with the exact string **`prompt is too long`**, for example:

```json
{"error":{"message":"prompt is too long for Antigravity: 251987 characters, limit 180000","type":"invalid_request_error","code":"context_length_exceeded"}}
```

Scriptorium sees `ProviderError("HTTP 400: {...}", 400, retryable=false)`. The phrase must fall inside the first 300 characters of the body (`httpError` keeps 300). `isContextError` matches it, so: no retries on that model, straight to the next model, not set aside as "refused", problem kind `too-big`. Add this exact message to the tests (T6), so a change of wording on either side breaks a test. Write the string into AAP-30's plan too (the director passes it on).

### T3. chatJson repair and model switch (`types.ts`, `scheduler.ts`, `llm.ts`)

New in `types.ts`:

```ts
/** A request that had to stay on one model (a JSON repair round) would go to another one. `model` is the ref it would go to. */
export class ModelSwitchedError extends Error { constructor(readonly model: string) { super(`the request would go to ${model}`); this.name = 'ModelSwitchedError' } }
```

`ChatOptions` (scheduler.ts:15) gets:
- `sameModel?: string`: only this `provider/model` ref may answer. In `ctx.chat`: (a) at the top of the loop, after a model change has refreshed `models`, if the list's first model is not `sameModel`, throw `ModelSwitchedError(models[0].ref)`; (b) on an `attempt` event whose `ev.model.ref !== sameModel` (fallback inside the router, or a size skip), throw `ModelSwitchedError(ev.model.ref)` **before** the `job.model` emit and slot handling. Throwing inside the `for await` returns the router generator, whose `finally` releases the reservation and the limiter, and no request is sent (the `attempt` event comes before `client.chat`). Log `_the repair round would go to <ref>: the JSON request starts again from its first message_` to the job log.
- `fromModel?: string`: this request starts the job's list at that ref (`models.slice(index)`; the whole list when the ref is not in it). `rj.first` is the first model of the list actually used.

`chatJson` (llm.ts):
- Keep `messages` (the original) and loop at most `MAX_RESTARTS = 2` times: first ask (`ask(messages, true, { fromModel })`, the existing no-schema fallback kept), parse, and on failure the repair ask with `{ sameModel: reply.model.ref }`. On `ModelSwitchedError` start the loop again with `fromModel = err.model` (the repair never reaches the new model with the old reply). After `MAX_RESTARTS` restarts throw `the model did not return valid JSON: the repair round needed another model <n> times`.
- Repair with schema: `withSchema` of the repair = whether the first ask was sent with the schema and did not throw (today always `false`). A client task of the repair round then has `schema`, so `submit_client_task` checks it.
- Repair reply text: `stripThinking(reply.text).slice(0, 32_000)` instead of `reply.text.slice(0, 6000)`. 32,000 characters is about 8,000 tokens, the largest `maxTokens` any `chatJson` caller uses (6,000 in 11 calls, 8,000 in 3), so a reply is in practice never cut and "Keep everything your first reply said" can be followed. Small and clearly right, so it is in scope.
- `ModelSwitchedError` from the first ask cannot happen (no `sameModel`); if it escapes anywhere else it is a plain handler error (one attempt).

Interaction with T1: a repair conversation is larger than its first ask (prompt + reply + repair turn). When the repair is too big for the model that wrote the reply, T1 skips that model, the next model's `attempt` triggers `ModelSwitchedError`, and the JSON request starts again from the original messages on that next model. That ends, because the restart starts at the new model.

### T4. Data folder context values (not committed)

In `C:/Users/Infplane/Scriptorium/config/providers.md`, `acp` block: `antigravity/gemini-3.8-flash` and `antigravity/gemini-4-argon`: `context: 1000000` becomes `context: 45000`, with a comment `# the agent keeps only the first ~192,000 characters of a prompt (REQ-0009); 45000 estimated tokens = 180,000 characters`. Edit only these two lines (the file is hot-reloaded; keep comments and order). Leave the codex and claude rows unchanged (their caps were not probed).

Why 45,000: the router estimate is characters / 4, so 45,000 means at most 180,000 characters of messages. The measured cap is about 191,800 characters of the proxy's prompt, which adds role tags and a preamble; 11,800 characters (6 %) of margin cover them and a slightly different agent build.

Seed: add one bullet to "The ACP proxy" in `seed/config/providers.md`: the Antigravity agent keeps only about the first 192,000 characters of a prompt and drops the rest without an error; give each `antigravity/*` model `context: 45000` after Detect models, and the engine sends longer prompts to the next model; the proxy (from AAP-30) also refuses such prompts with HTTP 400 "prompt is too long". No seed model rows are added (the seed `acp` provider keeps `models: []`).

### T5. Token clean-up (security)

1. Delete the whole `.claude/temp/req0006/` folder. It is scratch for REQ-0006, which is closed (both books done, fixes merged); its `ans/` holds only briefs and glossaries, and nothing in `docs/` or the code reads it. If the user wants to keep the rest, the minimum is the four files that hold the token: `mcp.py`, `__pycache__/mcp.cpython-313.pyc`, `headless.log`, `headless2.log`. Use a normal delete; never print, copy or grep-output the value. Afterwards repeat the byte search over the repo (value read from nowhere: compare against the env variable inside a script that prints only paths) and expect no hit.
2. Tell the user to rotate the token (Claude does not do it: it changes a secret and a user setting):
   - The live token is the **user environment variable `BOOK_TRANSLATOR_MCP_TOKEN`** (Windows: Settings > System > About > Advanced system settings > Environment Variables, user section). It takes priority over the credential store. Either set it to a new random value, or delete it so Book Translator uses (or creates) the one in the Windows credential store (service `book-translator`, name `BOOK_TRANSLATOR_MCP_TOKEN`; Credential Manager > Windows Credentials, generic credentials). To force a new stored token, delete that credential entry too; Book Translator makes a new one on its next start.
   - Restart Book Translator (and any headless run) and open shells, then update every MCP client that uses it: the token is shown in Book Translator's Settings, card "MCP server" (README, "MCP server"), and clients registered with `claude mcp add --transport http book-translator ... --header "Authorization: Bearer <token>"` need the new header.
   - The old value also sits in 5 Claude Code subagent transcripts under `C:/Users/Infplane/.claude/projects/C--projects-Personal-scriptorium/` (local files). Rotation makes them harmless; scrubbing them is optional and the user's call.

### T6. Tests (test-discipline: four tests, three new, one extended)

| # | File | Test | Fails before the fix because |
|---|---|---|---|
| 1 | `tests/models.test.ts`, `describe('router')` | **A prompt larger than a model's context skips it without a request.** Providers `a/x`, `b/y`; after `registryWith`, set `registry.getModel('a/x')!.context = 100`. A 1,000-character prompt (250 estimated tokens): the mock sees only `y`, the events have a `problem` with kind `too-big` for `a/x` and a message matching `/prompt is too long/`. With `b/y` also at `context: 100`, `chat()` rejects with `/all models failed\. a\/x: prompt is too long.* \| b\/y: prompt is too long/` and the mock got no call. | today `x` gets the request (reproduction: the over-context prompt is routed to that model) |
| 2 | `tests/models.test.ts`, existing `it('names the kind of each failure')` | Add the AAP-30 string: `problemKind(new ProviderError('HTTP 400: {"error":{"message":"prompt is too long for Antigravity: 251987 characters, limit 180000","type":"invalid_request_error","code":"context_length_exceeded"}}', 400))` is `too-big`, and `isRefusedRequest(<same>, false)` is `false`. | passes today; it pins the contract with AAP-30 |
| 3 | `tests/scheduler.test.ts`, in `describe('agent controls and hot reload')` next to the setModel test | **A model change during a JSON repair starts again from the original messages on the new model.** Providers `a/x`, `b/y`, role writer `[a/x]`. A task handler calls `chatJson(ctx, [{role:'user', content:'give a'}], z.object({ a: z.number() }))`. Mock: `x` answers the first ask with prose (`'not json'`); `x` streams the repair slowly (messages length 3); `y` answers `{"a": 1}`. While the repair streams, `setModel` to `b/y`. Expect: the job is done with result `a: 1`; the mock's `y` call has the original messages only (one user turn `'give a'`, no assistant turn); the calls are `['x', 'x', 'y']`; the `y` call carries the schema. | today `y` gets `[user, assistant 'not json', repair user]` (reproduction: the repair task after a switch carries the old reply) |
| 4 | `tests/scheduler.test.ts`, same describe | **The repair asks with the schema and carries the whole reply.** Mock `x`: first ask returns `'<think>' + 'r'.repeat(500) + '</think>' + 'finding '.repeat(1500)` (12,000 characters of prose, no JSON); repair returns `{"a": 1}`. Expect the repair call's `schema` is set, its assistant turn is the 12,000-character text without the think block, and the job is done. | today the repair has no schema and the assistant turn is cut at 6,000 characters |

The fallback branch of T3 (the router itself moves the repair to another model) uses the same `ModelSwitchedError` path as test 3; no separate test.

Note for tests 3 and 4: `MockProvider.calls` records only `meta`, `model` and time, so capture `req.messages` and `req.schema` inside the `mock.onAny((req) => ...)` callback (as the existing router tests do with `seen.push(req.model)`).

Commands (PowerShell, from the repo root):

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
yarn test
yarn typecheck
```

No `yarn seed:hashes` is needed: nothing under `seed/prompts` or `seed/templates` changes.

### T7. design.md

- New Decisions row at the end of the table: **"ACP context and JSON repair (SCP-59)"** (2026-11-11; ticket SCP-59, branch `SCP-59_acp-context-and-json-repair`; request REQ-0009): the router skips a model whose `context` is smaller than the estimated prompt (characters / 4, prompt only), with a `too-big` problem and no request, also the last model of a list; the message starts with "prompt is too long", the same phrase the api-acp-proxy (AAP-30) returns with HTTP 400, and both go to the next model without retries. The Antigravity agent keeps only about the first 192,000 characters of a prompt, so `acp/antigravity/*` models have `context: 45000`. A `chatJson` repair round stays on the model that wrote the reply: when the model changes (a model change or a fallback), the JSON request starts again from its first message on the new model (at most twice). The repair carries the schema when the first ask did, and the whole first reply without reasoning blocks (up to 32,000 characters). Overrides "Model change now" where it says the request in flight is asked again on the new model (a repair round is not; its JSON request starts again), and "Refused requests (SCP-55)" where it says the repair is sent without a schema (it is not counted as refused now when it has one).
- History line at the bottom: `- 2026-11-11: ACP context and JSON repair (ticket SCP-59, request REQ-0009): ...` one sentence each for the size check, the 45000 contexts, the repair restart, the schema on repair and the whole reply. See the Decisions row.

## Acceptance criteria

| # | Criterion | Proof |
|---|---|---|
| A1 | A prompt whose estimate exceeds a model's `context` is never sent to it; the next model answers; when none fits the error names every model with "prompt is too long" | Test 1 |
| A2 | AAP-30's 400 "prompt is too long" goes to the next model without retries and does not set the model aside | Test 2 (with the existing test "a context-size error goes straight to the next model") |
| A3 | After a model change during a repair, the new model gets the original messages, not the old reply | Test 3 |
| A4 | The repair round has the schema and the whole first reply without reasoning | Test 4 |
| A5 | Data folder: both `acp/antigravity/*` rows have `context: 45000`, nothing else in providers.md changed | `git diff --no-index` style check by eye; engine reloads without a `providers.md` error in its log (UNTESTED in the running app unless the engine is started) |
| A6 | No file in the repo or `.claude/` holds the token | The path-only byte search returns no hit |
| A7 | design.md row and History line present; `yarn test` and `yarn typecheck` pass | Commands above |

## What the router does next for a whole-book review that is too big for Gemini (behaviour, no code)

Example: `fifty-minutes-of-common-sense`, ~252,000 characters, ~63,000 estimated tokens, which is over 45,000.

1. If the reviewer's book model is `acp/antigravity/gemini-3.8-flash` (or `-4-argon`), it is first, and T1 skips it at once: the agent shows a red "request too big" problem, and the job log gets `acp/antigravity/gemini-3.8-flash skipped: prompt is too long ...`.
2. The next candidates come from the role list. In this data folder `fallback_shared: true` and `fallbacks: [deepseek/deepseek-flash, strata/default, lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic]`, so the next model is **DeepSeek V4.1 Flash, a paid model** (0.30 / 1.20 USD per million tokens in / out: about 0.03 USD per review request at 63k tokens in and 6,000 out). The budget reserves that estimate first; with today's caps (20 USD a day, 40 a month) it is allowed, so the review runs there. The job log shows `_model deepseek/deepseek-flash (fallback or retry)_` and the spend row shows the cost.
3. If the budget refuses, the router goes on to `strata/default` (131,072 context, fits when Strata runs), then the LM Studio model (131,072). A down server is skipped as today.
4. If no model fits or answers, the job fails its attempt with `all models failed. ... prompt is too long ...`, is retried up to `max_attempts`, is revived once after 10 minutes (it is a `ProviderError`), and then fails for good, which fails the book (today's rule). Nothing is silent: the agent problem box, the job log, the book log and `factory_status` show it.

Today, before the fix, the same job never left Gemini: the JSON failure is a plain handler error, so it retried Gemini until it failed (219 requests in REQ-0007). So the fix changes the outcome from "fail after many wasted requests" to "review on the next model, which here is paid". Whether that is wanted is the user's config: to keep such reviews free, pin the book's reviewer roles to `strata/default` or `client/claude-code`, or put a free model before DeepSeek in `fallbacks`, or lower the caps.

## Risks

- A `context` value set too low in `providers.md` now skips a model that used to work. Mitigation: only models with a `context` are checked, the check is prompt-only, and the skip is visible (problem box, job log).
- The 192k cap is measured on the 2026-11 agent build; a new build may change it (edit the two values).
- The repair now sends a larger conversation (up to 32,000 characters of reply instead of 6,000); a few more repairs will fall to the next model via T1 near a model's limit.

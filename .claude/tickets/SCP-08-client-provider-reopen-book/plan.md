# SCP-08: client provider (Claude Code does the model work) and reopen_book

Ticket folder: `.claude/tickets/SCP-08-client-provider-reopen-book/`. Branch `SCP-08_client-provider` (from origin/master 26371be). Commits `SCP-08: <summary>`. The hub plan is `C:\projects\Personal\creative-hub\.claude\tickets\external-llm-jobs\plan.md` (sections "How it is meant to work" and "SCP-08"). VN Studio ports the same contract in VNO-05.

## Implementation status

- [x] A. Provider (hub steps 1-5): kind `client`, `src/engine/models/client.ts`, registry, `RequestMeta.job`, scheduler passes the job id, the Engine owns one queue
  - Verified 2026-10-20: `yarn typecheck` exit 0, `yarn lint` exit 0, `yarn test` 20 files / 294 tests passed. New tests: `tests/models.test.ts` (6, "client provider"), `tests/scheduler.test.ts` (3, "client provider in the scheduler").
  - `ClientTaskQueue` (`add`, `list`, `lease`, `submit`, `release`, `cancel`, `counts`) and `ClientProvider`. `submit` runs `extractJson` from `pipeline/llm.ts`, then a small built-in JSON-schema check (`checkAgainstSchema`: type, enum, const, required, properties, items, anyOf/oneOf, minItems, minLength). No ajv: it is in node_modules only as a transitive dependency, and adding it as a direct one was not needed.
  - The registry forces `local: true` for `kind: client` and builds `new ClientProvider(id, queue)` with no key check. `isPaidModel` and `groupOf` needed no change (local, so never paid and in no group). The `vision` model field is in `providerModelSchema`.
  - Deviations: `cancel(id)` is an extra queue method (the provider uses it on abort); `DEFAULT_LEASE_MS` is exported; task meta fields are `''` when a request had none (not undefined or null); `registry.clientQueue` makes its own queue when none is passed (cli.ts builds registries without an Engine); `Engine.clientQueue` is public and the MCP tools read it from the engine they already get.
- [x] B. Tools (hub steps 6-7): `list_client_tasks`, `get_client_task`, `submit_client_task`, `release_client_task`, `clientTasks` in `factory_status`, `reopen_book`, Models dialog and provider summary
  - Verified 2026-10-20: same runs as A. New tests in `tests/mcp.test.ts` (3, "MCP client tasks and reopen_book"), tool-list check extended; `tests/features.test.ts` lets `reopenBook` through `isCommand`.
  - `get_client_task` answers `{taskId, meta, system, user, schema?, maxTokens?, output, leaseMinutes}`, with `messages` when there is more than one, or `{none: true, waiting}`. `user` joins the user and assistant messages with blank lines.
  - UI: `providerSummaries` reports a client provider as local; the Models dialog shows its models as "free (Claude Code)" and says Claude Code answers (no Detect models). Not looked at in a running window (the app runs from `out/`, which was not rebuilt).
- [x] C. Reopen a rejected book (hub step 8): `reopenBook` command, `Pipeline.reopenBook`, book.md `extra_rounds`, `maxRoundsOf`
  - Verified 2026-10-20: `tests/pipeline.test.ts` "a rejected book is reopened for a rewrite round, rejected again, then reopened for a review round and published" passed (rewrite round 3 rejected again, review round 4 published, `extra_rounds` 1 then 2, `--r3` jobs, topic in-progress count back up, reasons and score cleared); also in the full run.
  - It refuses non-rejected books (log line plus the MCP tool's own error with the stage) and chapters outside the outline. `maxRoundsOf` is `max_rounds + extra_rounds` (`BookState.extraRounds`).
  - Finding: `releasePins` frees an agent pinned to a book when it is rejected, so after `reopen_book` the client writer must be assigned again (`assign_agent`). The docs say so. Also `assign_agent` pins by preference, not exclusively (see Context).
- [x] D. Docs and seed (hub steps 9-11): `docs/mcp.md` (tools, `retry_book` vs `reopen_book`, "Do the model work yourself"), `docs/design.md` (two Decisions rows, Model layer section and table row, History entry), `seed/config/providers.md` (a `client` entry with `enabled: false`, field docs, a "Client provider" section)
  - Done 2026-10-20: docs only plus the seed test ("the seed lists a client provider that is switched off").
- [x] E. Tests and checks (hub steps 12-16)
  - `yarn test` 20 files / 294 tests passed, `yarn typecheck` exit 0, `yarn lint` exit 0 (Node 24.14.0 through fnm). No test touched `~/Scriptorium`: every test uses a temp data dir. `yarn build`, `yarn headless` and `yarn engine` were not run (the live engine runs from `out/`).
- [x] G. Follow-up review fixes (2026-10-20)
  - Per-book models: `role_models` in book.md (role -> ref, default `{}`; named `role_models` because `models` in book.md already holds the job counts per model), `role_models` in the idea frontmatter and `StoryBrief.models`, copied to the book in `start_book`. `add_story {models}`, `update_story {models}` (`{}` clears), new tool `set_book_model {book, role, model | null}` (command `setBookModel`), `book` results gain `roleModels`. `ModelRouter.candidates(role, {bookModel})` puts it first, before the agent's own model, and keeps it first under `avoid_family`. The scheduler reads it per job (`getBookModel`, a 3 s cache in the Engine) and `Scheduler.bookModelChanged` switches running jobs. Any agent of the role may take the job (pickAgent was already that way for unpinned agents).
  - `model_order`: a `client` provider's refs rank first in `roleEntries`.
  - Submit check: a property that has `default` in its JSON schema is not demanded (zod marks defaulted fields required but gives them a `default`). `io: 'input'` was not used: OpenAI-style strict json_schema needs every property required, so changing `jsonSchemaOf` could break real providers.
  - Verified: `yarn typecheck`, `yarn lint`, `yarn test` (see the last run below). New tests in models (2), scheduler (2), mcp (1), pipeline (1).
- [ ] F. Live check (hub step 17): not done here. Needs a restart of the hub's Scriptorium with the user's go-ahead (the factory resumes), then hire `claude-writer` on `client/claude-code`, add a `bedtime-story` test story, assign the writer, and take its tasks over MCP until it publishes.

## Context

Why: `runs/the-local-patch.md` in the creative hub. The book was rejected after DeepSeek's round-2 rewrite repeated chapter 3 inside chapter 4, and a rejected book could not get another round. Book Translator already lets Claude Code do the model work (`get_translation_task` / `submit_translation`); Scriptorium and VN Studio could only use LM Studio, Strata or a paid API.

Design: every model call goes through `JobContext.chat` -> `ModelRouter.chat` -> `ProviderClient.chat`. A new provider kind `client` puts the request in an in-memory `ClientTaskQueue` owned by the engine and waits (no timeout) until an MCP client answers. The scheduler, router, `chatJson` parsing and repair and the handlers are unchanged. See the Decisions rows "Client provider" and "Reopen a rejected book" in `docs/design.md`.

Contract shared with VN Studio (VNO-05):
- Provider kind `client`, model ref `client/claude-code`, config `local: true`, `concurrency`, models with optional `vision`.
- Task `{id: '<job>#<call>', job, call, role, task, book, agent, unit, messages, schema?, maxTokens?, images?, createdAt, leaseUntil?}`; `call` counts per job from 1; a request without a job id gets `adhoc-<n>`.
- Queue `add(req, meta)`, `list()`, `lease(filter, leaseMs = 30 min)`, `submit(id, text)`, `release(id)`, `counts()` (+ `cancel(id)`). A failed schema check keeps the task leased. Gone task: `{accepted: false, problems: ['task not found (it was aborted, answered, or the engine restarted)']}`.
- Provider: abort drops the task and throws an `AbortError` (name `AbortError`, as the other clients), which the scheduler already treats as "requeue without an attempt".

Open points and findings:
- (Superseded by G: use `role_models` / `set_book_model` for one book.) `assign_agent` pins an agent to a book (`pin`), and the scheduler's `pickAgent` then lets that agent take only that book's jobs. It does not stop other writers from taking the book's jobs: the writer hint (`agent_hint`) makes the pinned agent preferred, and other writers get a job only when the hinted one is busy for more than 20 seconds or the hint is missing. For exclusive client work on one book, pause or keep busy the other writers, or switch the role. The hub plan asked to check this.
- `z.toJSONSchema` (used by `jsonSchemaOf`) lists fields that have a zod default as required, so the submit check can ask for a field the job's own zod schema would default (for example `subjects: []`). The client then adds it. It is never looser than the job's check.
- With `model_order` set in settings.md, a role that lists `client/claude-code` first is sorted behind the `paid`, `strata` and `lmstudio` groups (a client provider is in no group). Per-agent models are not affected. Not changed; documented only here.
- Tasks are lost on engine restart (by design); the running job is requeued by the scheduler's startup recovery as for any model call.

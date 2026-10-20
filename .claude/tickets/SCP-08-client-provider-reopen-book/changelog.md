# SCP-08 changelog

## 2026-10-20: client provider, per-book models, reopen a rejected book

Branch `SCP-08_client-provider` from origin/master 26371be. Uncommitted.

**What changed**
- **New provider kind `client`** (`src/engine/models/client.ts`, new). A request waits in the engine's `ClientTaskQueue` until an MCP client answers it.
  - JSON answers are checked against the request's schema on submit.
  - The task is leased for 30 minutes. An abort drops it.
  - Cost is 0, and there is no timeout.
- **Wiring:**
  - `shared/schemas.ts` adds the kind `client` and the model field `vision`.
  - `models/types.ts`: `RequestMeta.job`.
  - `models/registry.ts` builds the client provider and sorts client refs first under `model_order`.
  - `queue/scheduler.ts` passes the job id.
  - `engine.ts` owns the queue.
- **MCP tools** (`mcp/tools.ts`):
  - `list_client_tasks`, `get_client_task`, `submit_client_task`, `release_client_task`
  - `factory_status.clientTasks`
- **Per-book models:**
  - `add_story` and `update_story` take `models`. They are stored as `role_models` in the idea and copied into book.md when the book starts.
  - `set_book_model {book, role, model|null}` sets one on a book in progress or a rejected book.
  - `router.candidates` puts the book model before the agent's own model.
  - The scheduler switches running jobs when the book model changes.
- **`reopen_book {book, mode: rewrite|review, chapters?}`** gives a rejected book one more round. It uses book.md `extra_rounds`, which `maxRoundsOf` now adds.
- **UI:** `summary.ts` and `ModelsDialog.tsx` show client as local and free.
- **Docs and seed:**
  - `docs/mcp.md`: the tools, `retry_book` vs `reopen_book`, and "Do the model work yourself"
  - `docs/design.md`: Decisions rows, the Model layer section, History
  - `seed/config/providers.md`: a disabled `client` entry

**Deviations**
- The book.md field is `role_models`, because `models` already holds job counts.
- The schema check skips required keys that have a `default`. We did not switch to `io: 'input'`, because OpenAI's strict `json_schema` needs every key required.
- `assign_agent` pins are not exclusive. Per-book models were added for that reason.

**Verification** (Node 24, fnm)
- `yarn test`: 20 files, 300 passed.
  - One run done in parallel with two other repos' suites had one failure (299/300).
  - Two more runs, one under the same load, passed.
  - The failure was not reproduced, and the failing test is not known.
- `yarn typecheck`: ok.
- `yarn lint`: ok.
- Not run:
  - a live run on the hub's Scriptorium (a restart resumes the factory; it needs the user's go-ahead)
  - the Models dialog in a window

**Follow-ups**
- Live run, then commit and PR.
- Add the `client` provider to `~/Scriptorium/config/providers.md`: existing data folders do not get new seed entries.
- Rescue `the-local-patch`: `set_book_model` the writer to `client/claude-code`, then `reopen_book {mode: rewrite, chapters: [3, 4]}`.

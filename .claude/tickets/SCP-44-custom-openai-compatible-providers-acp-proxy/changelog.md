# SCP-44 changelog

## 2026-10-24: custom OpenAI-compatible providers, seeded ACP proxy, named MCP clients

Branch `SCP-44_custom-providers` (from origin/master d7c4499). **Uncommitted.** 23 files changed, plus 2 new files.

### What changed
- **Custom providers.** New file `src/engine/models/customProviders.ts`:
  - Turns the provider name into a slug and builds the key name `CUSTOM_<ID>_API_KEY`.
  - Checks the URL is http(s).
  - Edits `providers.md` with a yaml `parseDocument` round trip that touches only `custom: true` entries and keeps comments.
- **New commands.** `src/engine/engine.ts` has `saveCustomProvider`, `removeCustomProvider` and `testCustomProvider`. They are listed in `src/shared/protocol.ts` together with two new events, `provider.tested` and `provider.saved`.
  - Removing a provider deletes its stored key. It cleans `models.md` (`picked`, `hidden`, `limits`), the fallback rows and `last_resort_model`.
- **Provider info.** In `src/engine/models/registry.ts`, `ProviderInfo` gets `name` and `custom`. `kindOfRef` now makes every custom provider its own kind, free or paid, so aliases such as `acp-home` / `acp-home-2` work. `summary.ts` and `schemas.ts` carry the new fields.
- **UI.** `src/renderer/ui/ModelsDialog.tsx`:
  - An Add provider form with Name, Base URL, API key, Free, Send JSON schema, Parallel, Enabled, Test and Save.
  - Edit and Remove for custom providers.
  - Provider names in the provider list and in the kind labels.
- **Settings.** `src/renderer/ui/Settings.tsx` gets its key select from the key names the engine reports (`keyNames`) instead of a hardcoded list. The demo backend `src/renderer/demo/fake.ts` supports the new commands.
- **ACP proxy entry.** `seed/config/providers.md` has a new `acp` entry: off, local, `http://127.0.0.1:7461/v1`, `json_schema: false`, 2 in parallel. The client provider gets an `antigravity` model. Its documentation now covers `name`, `custom`, the ACP proxy (`PROXY_IGNORE_SAMPLING=1`, text only, `PROXY_TIMEOUT_MS`, the terms risk) and named clients. `seedHistory.ts` was regenerated.
- **Migrations.** `src/engine/store/migrations.ts` has two new ones, called from `dataFolder.ts`:
  - `migrateAcpProvider` adds `acp` to an existing data folder.
  - `migrateAntigravityClient` adds the antigravity client model.
- **Named clients.** In `src/engine/models/client.ts`, each task records which client it is for. A lease with no client named means `claude-code`.
- **MCP tools.** In `src/engine/mcp/tools.ts`, `get_client_task`, `list_client_tasks` and `wait_for_book` take `client`.
- **Docs.** `docs/design.md` has new decision rows and updates to Model layer and History. `docs/mcp.md` has a new section "Antigravity CLI as a client". `ROADMAP.md` has an SCP-44 row.

### Deviations
- `testCustomProvider` takes an optional `id`, so testing during an edit can use the stored key.
- `wait_for_book` also takes `client`. The plan did not list it, but without it Claude Code would be woken for Antigravity tasks.
- The `acp` migration is idempotent in the same way as the existing client migration: if the entry is deleted by hand, it comes back at the next start. It is off by default.
- Removing a provider also clears `last_resort_model` when that model belongs to it. If removing would leave the fallback list empty, the list is kept as it was.

### Verification
- `yarn vitest run`: 641 tests in 52 files pass. New: `tests/customProviders.test.ts` (keyring mocked), cases in `tests/migrations.test.ts` and `tests/mcp.test.ts`, and edits to `tests/clientsearch.test.ts`.
- Other checks: `yarn test:recovery` passes. `yarn typecheck` and `yarn lint` are clean.
- `yarn test:ui`: 5 specs pass. This includes a new add/test/edit/remove provider case in `tests/renderer/office.spec.ts`, run against the demo backend.
- **Not run (live checks):**
  - A custom provider on LM Studio in the real app.
  - The ACP proxy on port 7461 (HUB-09).
  - `get_client_task {client:"antigravity"}` over HTTP against a running engine.

### Follow-ups
- Antigravity CLI's own MCP config: the user sets up the login and the config file.

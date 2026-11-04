# SCP-52 changelog

## 2026-11-04 SCP-52: Scriptorium follows whichever model Strata runs (hub HUB-26, T3)

Branch `SCP-52_strata-model-discovery`, from `master` (758c384). Committed on that branch; not pushed, not merged. Replay of VN Studio VNO-60 (9d0d173).

Behaviour: `strata/default` and `strata/default-low` are `loaded` rows. The engine asks Strata which model it serves, applies the matching `profiles` entry to those rows in place (family, context, `extra_body`, `json_schema`), shows `Strata: <model>` in the Models dialog, the status bar tooltip and `check_servers`, and follows a model switch within one status check (10 s). Because the `ModelInfo` objects stay the same, the reviewers' `avoidFamily` (`router.ts:134`) and the book's `writer_family` (`handlers.ts:903`) see the family of the model Strata runs. The old ids resolve through `aliases`.

### C1 rule -> file:line map (line numbers on this branch)

| C1 | what | where |
|---|---|---|
| C1.1 | model row `loaded`, `aliases`, `json_schema`; profile schema; provider `profiles` | `src/shared/schemas.ts:47-51` (row fields), `:55` (`providerProfileSchema`), `:109` (`profiles`) |
| C1.1 | seed block (rows, `discover: true`, profiles) | `seed/config/providers.md:100-125` (strata block), field-docs bullet `:238`, `## Strata` section `:240` |
| C1.2 r1 | L from `/status` `model` | `src/engine/models/registry.ts:470-473` (`syncServerSlots`) |
| C1.2 r1 | L from `/models` (first entry without `alias_of`), `meta.n_ctx` | `registry.ts:505-508` (`noteServed`), `:402-407` (`discover`), `src/engine/models/openaiCompat.ts:226-228,257-258` (`aliasOf`, `nCtx`) |
| C1.2 r1 | L kept across reloads, memory only | `registry.ts:165-166` (`servedIds`, `servedCtx`), `:220` (read back in `load`) |
| C1.2 r2 | profile K: same id, else longest prefix | `registry.ts:94-101` (`profileFor`) |
| C1.2 r3 | family, context, json_schema, extra_body of each `loaded` row | `registry.ts:522-534` (`applyServed`), `:248-255` (rows built in `load`) |
| C1.2 r4 | `-low` is only another `loaded` row | seed rows; no code |
| C1.2 r5 | `strata` alias finds the first `strata/...` fallback row | unchanged `aliasMap`; seed `settings.md:11` |
| C1.2 r6 | legacy refs through `aliases` | `registry.ts:253,257-258` (`aliasRefs`), `:545-547` (`getModel`), `:603-606` (`resolve`, also for an alias whose fallback row is an old ref) |
| C1.2 r7 | discovery adds no models; `picked` skipped; catalog lists none | `registry.ts:402-407`, `:268`, `:328-332` |
| C1.2 r8 | switch re-applies in place; `served` changes returned; log and event | `registry.ts:511-519` (`setServed`), `:501` (`{ slots, served }`), `src/engine/engine.ts:259` (log `models: strata now serves <L> (was <old>)`), `:267-269` (servers event + snapshot), `:320` (discovery log) |
| C1.2 r9 | Strata down keeps L; UI text `not running (last: <L>)` | `registry.ts:511-519` (L never cleared), `src/renderer/ui/ModelsDialog.tsx:25-29` (`servedNote`), `:511-515`, `src/renderer/ui/StatusBar.tsx:30-34` (tooltip) |
| C1.2 r10 | `served` on model summaries, server status (so `check_servers`), provider summary, spend event | `src/shared/protocol.ts:48,50,80-83,117,370`, `src/engine/summary.ts:165-166,192-193,206`, `src/engine/mcp/tools.ts:1075` (unchanged: returns `serverStatuses`), `src/engine/queue/scheduler.ts:604`; labels `ModelsDialog.tsx:32-37`, `:195`, `:285` |
| C1.2 r11 | per-model `json_schema` | `src/engine/models/router.ts:193`, `openaiCompat.ts:74`, `src/engine/models/types.ts:31` |
| C1.3 | neutral refs in defaults and seed | `src/shared/schemas.ts:283`, `seed/config/settings.md:11`, `seed/config/roles.md:30-38` (+ text :44,49,50), `src/renderer/demo/fake.ts:192` |
| C1.4 | migration | `src/engine/store/migrations.ts:551-634` (constants, `editFrontmatter`, `renameStrataRefs`, `migrateStrataLoaded`), `src/engine/store/dataFolder.ts:120` (after `migrateFallbacks`) |

### Differences from VNO-60

- Migration: one function `migrateStrataLoaded(dataDir)` instead of three `SEED_MIGRATIONS` entries (Scriptorium has no id list). Without an id it is made idempotent by its condition: the `strata` provider must have an old row (`qwen3.8-flash-next` or `-low`) and no `loaded` row. After it ran, the old rows are gone, so a row removed later never comes back. The ref rename (exact strings, every string of `roles.md` and `settings.md`) is idempotent by itself. Runs after `migrateFallbacks`, so an old `default_strata_model` folder ends with `strata/default` (existing test adjusted).
- `resolve()` also maps an alias whose fallback row is still an old ref (`fallbacks: [strata/qwen3.8-flash-next]` before the migration ran) to the `loaded` row; without it the shared-order role lists got `strata/default` twice. VN has the same gap (not hit by its tests).
- UI: Scriptorium has `ModelsDialog.tsx` and `StatusBar.tsx` (not `ModelsPage.tsx`); provider names come from `providerLabel` ("Strata") when providers.md gives none. The status bar shows `served` in the server pill's tooltip, not in the pill text.
- `check_servers` needed no code: it returns `serverStatuses`, which now carries `served`.
- `noteServed` is synchronous (it does no I/O).
- AC-1 test also shows the router: with DeepSeek on Strata, `avoidFamily: 'deepseek'` puts `strata/default` last; after the switch to Qwen it is first again.
- Seed roles text: says that with DeepSeek on Strata the reviewers are the same family as a DeepSeek writer (as Edu's T2 note asks for its roles).

### Kept from VNO-60

- `syncServerSlots` returns `{ slots, served }`; existing test calls use `.slots`.
- Extra summary fields `thinking` (model), `followsServer` and `served` (provider).
- `registry.catalog()` on a provider with `loaded` rows lists nothing and only refreshes L.
- The per-call spend table is unchanged (ref id `default`); the UI `spend` event carries `served`.

### Verification

- `yarn typecheck`: no errors. `yarn lint`: no output. `yarn test`: 58 files, 720 tests passed, plus `test:recovery` 1 passed.
- AC-1: extended test "a server that does not answer is down ... its loaded rows follow the model it runs" (`tests/models.test.ts:112`).
- AC-3: `tests/migrations.test.ts` "migrateStrataLoaded (HUB-26)" (old rows replaced, own row and comment kept, CRLF kept, profiles added, refs renamed in roles, fallbacks and `last_resort_model`, second run and a removed row change nothing, no strata provider untouched).
- AC-2: the existing seed-config tests, green (refs updated to `strata/default`).
- AC-5: grep for `run-iq2_xs`, `coder-iq1_m`, `84 GB`, `48 GB`, `Qwen3.8-Flash-Next server`, `server for Qwen3.8` over `seed/config`: no hit.
- Existing tests adjusted: `tests/models.test.ts` (new refs, `.slots`), `tests/migrations.test.ts:257` (the old ref is renamed after `migrateFallbacks`), `tests/features.test.ts:131` (seed fallbacks).

### Not run

- Nothing against a running Strata (hub live checks L3, L5); the app, the engine, the CLI probe and the factory were not started; `~\Scriptorium` was not touched (it is migrated at the next start, which needs the user's yes; `strata/default` still has to be added to its `fallbacks` by hand, see the hub plan).
- The Models dialog and status bar labels were typechecked, not looked at in the running app.

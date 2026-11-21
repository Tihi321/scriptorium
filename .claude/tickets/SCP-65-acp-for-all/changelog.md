# Changelog SCP-65

## 2026-11-21 - SCP-65 ACP for all (HUB-38, REQ-0030)

Outcome: seed and code defaults route local models through the ACP proxy; `strata` provider off; proxy local models count as on this machine for `no_local_fallback`. Not committed. Live check (HUB-38 C5) not run.

### scriptorium, branch `SCP-65_acp-for-all` (from master)
- `seed/config/providers.md`: acp block = C1 (enabled, concurrency 4, `discover_skip`, six local rows); `strata` row `enabled: false` (rows, profiles kept); `lmstudio` comment says embeddings only (AAP-43); "Strata" and "The ACP proxy" sections rewritten (Strata runs under the proxy, direct provider off, one local model at a time, switch takes minutes, bat paths `D:\Strata\terminal\run-*.bat`); `on_device` field doc covers the per-model rule.
- `seed/config/roles.md`: aliases `strata` become `acp`, `lmstudio` dropped from lists, checks/researcher use LOCAL by full id, archivist `[acp/antigravity/gemini-4-hydrogen, LOCAL, paid]`, `embeddings:` unchanged; prose updated.
- `seed/config/settings.md`, `src/shared/schemas.ts`: `fallbacks` = deepseek-flash, LOCAL; prose examples use `acp`.
- `src/shared/schemas.ts`: model schema gets optional `on_device`.
- `src/engine/models/registry.ts`: `ModelInfo.onDevice` + exported `modelOnDevice()` (row `on_device`, else openai-compat provider and id prefix `gufo/` `strata/` `llama/`, else provider); set for providers.md rows, picked rows and discovered rows.
- `src/engine/models/router.ts` (`candidates`), `src/engine/queue/scheduler.ts` (`localOutsideBook`, last-resort reason) use the model's flag. `engine.ts:312` (exhausted polling) left per provider, as planned.
- `src/engine/mcp/tools.ts` (3 descriptions), `src/engine/cli.ts` (probe default `[LOCAL]`), `src/engine/index.ts` (help text).
- `src/engine/store/migrations.ts`: only the `migrateAcpProvider` message no longer says "switched off" when the added block is on (the seed block now is).
- `src/renderer/ui/ModelsDialog.tsx`: one hint line names `acp` instead of Strata/LM Studio kinds.
- Docs: `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/design.md` (decision row, on-device paragraph, log line), `docs/mcp.md`, `ROADMAP.md` row.
- Tests: `tests/models.test.ts` (extended the SCP-62 "on this machine" test with the model-level rule and the A1 candidates rows; the seed load test now asserts the new seed (acp on, six rows, strata off, role chains); a small `directStrata()` helper turns the direct Strata provider and old chains back on for the three tests of the Strata machinery), `tests/features.test.ts` (seed fallbacks, A2), `tests/migrations.test.ts` (acp added from the seed is on, concurrency 4, message). No test added or removed.

### Migration read-through (scope 6)
Read every migration run by `initDataFolder` (`src/engine/store/dataFolder.ts:110-121`):
- `migrateAcpProvider`: with an `acp` provider present it only rewrites a switched-off entry with URL port 7461 to 8787; otherwise it adds the seed block once. It does not touch an existing block, so it cannot revert the hub's rewrite. For a folder with no `acp` it now adds the seed block (on, with local rows), which matches the new seed.
- `migrateFallbacks`: acts only when old `default_*_model` / `model_order` keys exist and `fallbacks` is absent; never when `fallbacks` is present.
- `migrateStrataLoaded`: acts on providers.md only while the `strata` provider has an old fixed row (`qwen3.8-flash-next`, `-low`) and no `loaded` row; does not change `enabled`. In roles.md and settings.md it renames only the exact refs `strata/qwen3.8-flash-next(-low)`; `acp/strata/...` is a different string, `strata/default` is never re-added.
- `migrateSeedPrompts`: history covers `prompts/` and `templates/` hashes only, not `config/`; the seed prompts are untouched here.
- Humanizer, newspaper, screenplay, puzzles, picture-book, client-search, client-provider and antigravity-client migrations touch formats, agents or other providers and never providers' `strata`/`acp` rows, roles or `fallbacks`.
Result: none re-enables `strata`, re-adds `strata/default` or an `lmstudio/` chat row, or reverts the acp block. No guard added.

### Deviations
- C1 says "existing cloud rows (codex/*, antigravity/*, claude/*) unchanged", but the seed's acp block had `models: []`; only the six local rows were added (cloud rows come from Detect models, and the archivist's `acp/antigravity/gemini-4-hydrogen` is not a seed row; the seed test skips it in the "role models exist" loop).
- Seed-load tests of the direct Strata machinery needed the old setup; solved with the `directStrata()` test helper instead of rewriting them.
- `src/renderer/demo/fake.ts` left alone: it is a self-consistent demo with its own direct `strata` provider.

### Verification
- `yarn typecheck`: passed (no errors).
- `yarn test` (vitest run + test:recovery): 58 files / 760 tests passed; recovery 1 test passed.
- `yarn build`: passed (built in 6.34s).
- Not run (UNTESTED): live probe `npm run engine -- probe --model acp/strata/... --data ~\Scriptorium` (HUB-38 C5, loads Strata on the GPU), the real data folder rewrite (hub HUB-38 L2), the app UI. The engine was never started.

### Follow-ups
- Embeddings switch to the proxy after AAP-43, by config in the hub.
- The user's data folder (`~\Scriptorium`) still has the old providers, roles, settings and 24 books with old refs until HUB-38 L2.

Commit status: uncommitted on branch `SCP-65_acp-for-all`.

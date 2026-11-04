# SCP-52 Strata model discovery (Scriptorium)

Branch: `SCP-52_strata-model-discovery` (from `master`). Ticket of the hub task HUB-26, task T3: a replay of VN Studio's VNO-60 (`visual-novels-orchestrator`, branch `VNO-60_strata-model-discovery`, commit 9d0d173), adapted to Scriptorium's migration style.

The plan is `C:\projects\Personal\creative-hub\.claude\tickets\HUB-26-strata-model-discovery\plan.md`. Read these parts of it:

- "C1. The shared contract" (C1.1 providers.md shape and schema fields, C1.2 resolution rules 1-11, C1.3 neutral refs, C1.4 migration contract).
- Table "Files and modules per repo", row `scriptorium` (its line numbers were checked against `master` 758c384; see the changelog for the real ones).
- "T3 (replay of T1, adapted)" and "T7", the paragraph "Seed doc text for T1-T6".
- Acceptance criteria AC-1 to AC-4 (AC-5 over this repo's `seed/config`).

Reference change: `C:\projects\Personal\visual-novels-orchestrator\.claude\tickets\VNO-60-strata-model-discovery\` (`plan.md`, `changelog.md`, `replay-bundle.md`).

## Adapted for Scriptorium

- No `SEED_MIGRATIONS` id list: one function `migrateStrataLoaded` in `src/engine/store/migrations.ts`, called from `dataFolder.ts` right after `migrateFallbacks` (whose fallbacks may name the old ref). Same behaviour as VN's three entries: the providers block, then the ref rename in `roles.md` and `settings.md` (`fallbacks`, `last_resort_model`). Idempotent without an id: it acts only while the `strata` provider has an old row and no `loaded` row, so a row removed later is never brought back.
- `check_servers` (MCP) shows `served` (it returns `serverStatuses`).
- Labels in `ModelsDialog.tsx` (rows, fallback picker, a served note) and `StatusBar.tsx` (server pill tooltip).
- Family matters here: the router's `avoidFamily` (`router.ts:134`) and `writer_family` (`handlers.ts:903`) read `family` from the same `ModelInfo` objects, which a switch updates in place (C1 rule 8). The AC-1 test shows `avoidFamily` follow the served model.
- Kept from VNO-60: `syncServerSlots` returns `{ slots, served }`; the per-call spend table is unchanged (only the `spend` event carries `served`); `catalog` (Detect models) lists nothing for a provider with `loaded` rows.

## Checklist

- [x] C1.1 schema fields: `loaded`, `aliases`, model `json_schema`, provider `profiles` (`src/shared/schemas.ts`)
- [x] C1.2 rules 1-11 in `registry.ts`, `router.ts`, `openaiCompat.ts`, `types.ts`, `summary.ts`, `engine.ts`, `scheduler.ts` (spend event), `ModelsDialog.tsx`, `StatusBar.tsx`; `check_servers` through `serverStatuses`
- [x] C1.3 neutral refs in seed `roles.md`, `settings.md`, the code default (`schemas.ts`) and the renderer demo
- [x] C1.4 migration `migrateStrataLoaded`, registered after `migrateFallbacks`
- [x] Seed docs (T7 text) in `seed/config/providers.md`, roles text in `seed/config/roles.md`
- [x] Tests: AC-1 (`tests/models.test.ts`, the down/up test), AC-3 (`tests/migrations.test.ts`, one case)
- [x] `ROADMAP.md` row
- [x] `yarn typecheck`, `yarn lint`, `yarn test` green (AC-4); AC-5 grep over `seed/config` no hit

Never start the Scriptorium app, its engine, its CLI probe or its factory. Tests only.

Result and the C1 rule to file:line map: `changelog.md` in this folder.

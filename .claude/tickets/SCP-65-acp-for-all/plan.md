---
status: done
request: creative-hub/REQ-0030
repos: [scriptorium]
branch: SCP-65_acp-for-all
updated: 2026-11-21
---

# SCP-65 ACP for all: local models through the ACP proxy; Strata and LM Studio chat switched off

Part of creative-hub HUB-38 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-38-acp-for-all\plan.md`). The user's decision: every app reaches every LLM, local ones included, through the ACP proxy (provider `acp`, `http://127.0.0.1:8787/v1`), which now serves `gufo/*`, `strata/*`, `llama/*`. The `lmstudio` and `strata` providers stay in the code, switched off in config ("disable, keep code"). Exception: Scriptorium's `embeddings:` stays on LM Studio until the proxy's `/v1/embeddings` (api-acp-proxy AAP-43) is merged and live-checked; then the hub switches it by config (no code here).

This ticket changes **code and the seed only**. The user's live data in `~\Scriptorium` is changed by the hub (HUB-38 L2) after approval; do not edit `~\Scriptorium`, and **never start Scriptorium's engine or factory** (it resumes writing every open idea and may spend). Tests and the build do not start it.

## Contracts (copied from HUB-38; keep identical)

LOCAL = `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` (the id the proxy lists; Strata's `model_name`). Defaults never name a `gufo/*` or `llama/*` model.

C1, the `acp` provider (seed `seed/config/providers.md`), cloud rows unchanged, local rows appended:

```yaml
  - id: acp
    name: ACP proxy
    kind: openai-compat
    enabled: true
    local: true
    base_url: http://127.0.0.1:8787/v1
    concurrency: 4            # the hub's live config uses 8 for Scriptorium
    json_schema: false
    discover: true
    discover_skip: [ qwen-image, nomic-embed ]
    models:
      # ... existing cloud rows (codex/*, antigravity/* with context 45000, claude/*) unchanged ...
      # Local models through the proxy (HUB-38). One local model is loaded at a time across gufo, strata and llama;
      # a request for another one waits until the proxy has switched (minutes). LOCAL is the strata row.
      - id: strata/qwen3.8-flash-next-unsloth-ud-iq4_xs
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: gufo/Qwen3.8-27B
        family: qwen
        context: 32768
        extra_body: { reasoning_effort: none }
      - id: gufo/deepseek4
        family: deepseek
        context: 16384
        extra_body: { reasoning_effort: none }
      - id: gufo/flash-next-q4
        family: qwen
        context: 32768
        vision: true
        extra_body: { reasoning_effort: none }
      - id: llama/inkling-2-mini
        family: inkling
        context: 32768
        vision: true
      - id: llama/inkling-2-mini-dspark
        family: inkling
        context: 32768
        vision: true
```

`reasoning_effort` is forwarded by the proxy after AAP-42; before it, it is ignored (harmless). The proxy answers a request with `tools` to a local model with 400 and does not enforce `response_format` (prompt plus repair, as `json_schema: false` already does).

## Scope

1. Seed: `seed/config/providers.md` acp block = C1 (acp `enabled: true` in the seed); `strata` row gets `enabled: false` (rows, profiles and comments kept); `lmstudio` row stays enabled (embeddings) and its prose says it is only for embeddings now. The "Strata" and "The ACP proxy" prose sections: say Strata runs under the proxy (it starts `D:\Strata\terminal\run-unsloth-ud-iq4_xs-parallel.bat` on an `acp/strata/*` request), that the direct `strata` provider is off and kept as a way back, that only one local model is on the GPU at a time and a switch takes minutes, and fix the bat paths (`D:\Strata\terminal\run-*.bat`; the `D:\Strata\run-*.bat` paths in today's text do not exist).
2. Seed `seed/config/roles.md`: the aliases `strata` become `acp`; `lmstudio` is dropped from every list; `strata/default-low` becomes LOCAL (one proxy id cannot carry the `-low` variant; the checks run with thinking off); archivist `[acp/antigravity/gemini-4-hydrogen, LOCAL, paid]`; `embeddings:` unchanged (`lmstudio/text-embedding-nomic-embed-text-v1.5`). Update the prose below the front matter to match (aliases `paid`, `acp`; Strata and LM Studio no longer named as chat defaults; embeddings on LM Studio until AAP-43).
3. Seed `seed/config/settings.md` and the code default in `src/shared/schemas.ts:287`: `fallbacks` = `['deepseek/deepseek-flash', 'acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs']`. Prose examples that name `strata/default` or LM Studio chat rows: replace with LOCAL / remove.
4. **On-device rule for proxy local models** (`no_local_fallback`, SCP-62). Today `onDevice` is per provider (`src/engine/models/registry.ts:209`: a local openai-compat provider except `acp`), so through the proxy `acp/strata/...` would count as off this machine and a `no_local_fallback` book would use it. Add `onDevice: boolean` to `ModelInfo`: the model row's new optional `on_device` field (add to the model schema in `src/shared/schemas.ts`) if set, else `true` when the provider's `kind` is `openai-compat` and the model id starts with `gufo/`, `strata/` or `llama/`, else the provider's `onDevice`. Discovered rows get the same rule. Use the model's value wherever a decision is about a model: `src/engine/models/router.ts:194` (`!m.onDevice || book.includes(m.ref)`) and the running-job check in `src/engine/queue/scheduler.ts:249-258` (read it; switch to the model's flag where it tests the current model). `engine.ts:312` (proxy exhausted polling skips on-device providers) stays per provider. MCP descriptions in `src/engine/mcp/tools.ts:580,661,879` that say "(LM Studio, Strata, Ollama)": add "or Gufo, Strata and Llama.cpp models behind the ACP proxy".
5. `src/engine/cli.ts:26` `probe` default refs: `['acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs']` (no paid default); `src/engine/index.ts:29` help text "Stream one short reply from the local model through the ACP proxy (or --model) and embed one string with the roles' embeddings model".
6. Seed migrations (`src/engine/store/migrations.ts`, the strata rows and old defaults around `:513-645`): read every migration that runs against an existing data folder and confirm none re-enables `strata`, re-adds `strata/default` or an `lmstudio/` chat row to `fallbacks`/roles, or reverts the acp block. Migrations record themselves as done in the data folder, so they should not re-run; if one would re-run and revert, guard it (do not delete it). Write what you found in the changelog.
7. Docs: `CLAUDE.md:15-16`, `AGENTS.md:14`, `README.md` (LM Studio / Strata setup sections), `docs/design.md`, `docs/mcp.md:100`: local models through the ACP proxy, LM Studio only for embeddings (until AAP-43), Strata provider off. UI text that tells the user to start Strata or LM Studio for chat (`src/renderer/ui/ModelsDialog.tsx`, `Settings.tsx`, `StatusBar.tsx`): only wording where it would now mislead; no UI removal.
8. `ROADMAP.md` row (below).

## Out of scope

- Removing LM Studio/Strata code, UI, tests or migrations; the LM Studio loader stays.
- The user's data folder (`~\Scriptorium`: providers, roles, settings, the 24 books with old refs): the hub's HUB-38 L2 does it with a rewrite script and backups.
- Embeddings through the proxy (config switch after AAP-43, by the hub).
- Vision (Scriptorium is text only).
- Starting the engine for any check.

## Files

`seed/config/providers.md`, `seed/config/roles.md`, `seed/config/settings.md`, `src/shared/schemas.ts`, `src/engine/models/registry.ts`, `src/engine/models/router.ts`, `src/engine/queue/scheduler.ts`, `src/engine/mcp/tools.ts`, `src/engine/cli.ts`, `src/engine/index.ts`, `src/engine/store/migrations.ts` (read; guard only if needed), `src/renderer/demo/fake.ts` (demo refs, if they name `strata/default` as a default), docs listed above, `ROADMAP.md`. Tests: `tests/models.test.ts` / `tests/scheduler.test.ts` (the SCP-62 `no_local_fallback` tests), `tests/migrations.test.ts`, `tests/helpers.ts`.

## Tasks

- T1 Seed providers, roles, settings and the schema default (scope 1-3).
- T2 Per-model on-device rule and its users (scope 4).
- T3 Probe default and help text (scope 5).
- T4 Migration read-through (scope 6).
- T5 Docs and roadmap (scope 7-8).

## Acceptance and tests (test-discipline: extend existing tests, no near-duplicates)

- A1 A `no_local_fallback` book whose own list does not name LOCAL never gets `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`, while `acp/codex/gpt-6-luna` is still allowed. Test: extend the existing SCP-62 router/candidates test with these two rows (one table, two rows).
- A2 A fresh data folder from the seed has acp enabled at 8787 with the six local rows, `strata` disabled, and `fallbacks` = deepseek-flash, LOCAL. Check: the existing seed/init test if one asserts the seed defaults (update it); else no new test, verify by reading `initDataFolder` output into a temp dir in the existing test helper.
- A3 `yarn test` (vitest) and `yarn typecheck` / `yarn build` pass (Node through fnm: put the fnm default alias dir on PATH; `fnm exec yarn` fails on this machine).
- Live (hub HUB-38 check C5; loads Strata onto the GPU, needs the proxy and LM Studio up; the user's go-ahead; not by the worker unless told): `npm run engine -- probe --model acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs --data C:\Users\Infplane\Scriptorium` streams one sentence at cost `0 (local)` and embeds one string. This is the CLI probe, not the factory.

## ROADMAP row

`- **SCP-65 (branch \`SCP-65_acp-for-all\`; plan in \`.claude/tickets/SCP-65-acp-for-all/\`; hub HUB-38, REQ-0030): local models through the ACP proxy.** Seed and defaults move to \`acp\` (local rows gufo/strata/llama, Inkling listed, not default; LOCAL = \`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs\`); the \`strata\` provider is off and LM Studio only embeds until AAP-43; proxy local models count as on this machine for \`no_local_fallback\`; \`probe\` defaults to LOCAL. Live check UNTESTED.`

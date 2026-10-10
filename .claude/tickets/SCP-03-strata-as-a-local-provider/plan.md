# SCP-03: Strata as a local provider

**Branch:** `SCP-03_strata-provider` (from `origin/master` at 3c2227e). **Plan:** `.claude/tickets/SCP-03-strata-as-a-local-provider/plan.md`.

## Context

The user installed **Strata** (`D:\Strata`), a fast local server for Qwen3.8-Flash-Next with an OpenAI-compatible API. They want Scriptorium to use it in place of the LM Studio chat models.

What I found:
- **Address.** `http://127.0.0.1:8080/v1` (notes in `C:\projects\Cowork\Computer\notes\strata.md`).
- **Starting it.** The user starts it with `D:\Strata\run-iq3_s.bat` (or `run-iq2_xs.bat`). The model takes 1–3 minutes to load. It serves one model per process.
- **Model names.** Strata ignores the `model` field in chat requests. `/v1/models` reports `qwen3.8-flash-next-iq3_s` or a similar name, depending on the quant.
- **No key.** None is needed. Strata reads the optional `STRATA_API_KEY`.
- **Context.** 128K (`--max-context 131072`).
- **Thinking.** On by default at `high`. `reasoning_effort` turns it down or off. The thinking text streams as `reasoning_content`, which our client already ignores.
- **Structured output.** `response_format` works by prompting and then checking the answer, not by constrained decoding. A bad answer returns **502 `structured_output_failed`**. Our client treats 5xx as retryable, and the router moves to the next model on any error. So one failed JSON answer would be retried twice, then go to LM Studio (likely down while Strata runs), then to paid DeepSeek. `chatJson`'s own "parse, then repair" path (`src/engine/pipeline/llm.ts:69`) already handles JSON without `response_format`, and the prompts spell out the JSON shape. So Strata gets **no `response_format`**.
- **Memory.** IQ3_S takes about 84 GB, so it can't run next to the LM Studio 27B and 35B models. Only nomic (84 MB) fits beside it, and LM Studio still has to run with nomic loaded for embeddings.

**User decisions (2026-10-10):**
- **Strata first:** it becomes the default local model in every role that uses LM Studio now, with LM Studio and then DeepSeek after it.
- **User starts it:** Scriptorium only connects; it doesn't start the server.

## Changes

### 1. Config field to skip `response_format`
- **`src/shared/schemas.ts:40`** (`providerEntrySchema`): add `json_schema: z.boolean().default(true)`, documented as "send the JSON schema as `response_format`; false for servers that reject bad JSON instead of constraining it".
- **`src/engine/models/registry.ts`:**
  - add `jsonSchema` to `ProviderInfo`;
  - set it in `load()` (around line 95);
  - pass it to `new OpenAiCompatClient({...})` in `setupClient()` (line 173).
- **`src/engine/models/openaiCompat.ts`:**
  - add `jsonSchema?: boolean` to `OpenAiCompatOptions`;
  - in `chat()` (line 58), only set `body.response_format` when `req.schema && this.opts.jsonSchema !== false`.

### 2. Provider entry in `seed/config/providers.md`
Put it after `lmstudio`:
```yaml
  - id: strata
    kind: openai-compat
    local: true
    base_url: http://127.0.0.1:8080/v1
    api_key_env: STRATA_API_KEY   # optional; only sent if set
    concurrency: 1
    discover: false               # Strata answers any model name; fixed ids keep roles.md stable across quants
    json_schema: false
    models:
      - id: qwen3.8-flash-next
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: qwen3.8-flash-next-low
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: low }
```
- **Why two entries:** they mirror today's split. Editors use the 27B with no thinking; checks use the 35B on `low` for steadier verdicts. This works because Strata serves any model name.
- **Body text, new "Strata" paragraph:**
  - start it with `D:\Strata\run-iq3_s.bat`; check it with `curl http://127.0.0.1:8080/health` and look for `loaded: true`;
  - one model per process, and all quants use port 8080;
  - it doesn't fit next to the big LM Studio models, so keep only nomic loaded in LM Studio;
  - `context` must match `--max-context` in the run config;
  - why `json_schema: false` is set.
- **`concurrency` field note:** also mention Strata there.

### 3. Roles in `seed/config/roles.md` (Strata first)
- **Editors and reviewers** (developmental, line, copy, beta-reader, child-safety, read-aloud):
  `[strata/qwen3.8-flash-next, lmstudio/ista-daslab-qwen3.8-27b-…, deepseek/deepseek-v4-flash]`
- **Checks, researcher, archivist:**
  `[strata/qwen3.8-flash-next-low, lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]`
- **DeepSeek-first roles** (editor-in-chief, idea-generator, architect, writer, publisher):
  `[deepseek/deepseek-v4-flash, strata/qwen3.8-flash-next, lmstudio/ista-daslab-…]`
- `embeddings` stays `lmstudio/text-embedding-nomic-embed-text-v1.5`.
- Update the "Starting choices" text to match.

**Live data folder:** `initDataFolder` never overwrites existing files, and `C:\Users\Infplane\Scriptorium\config` doesn't exist yet. At implementation time, check `SCRIPTORIUM_DATA` and any data folder that is in use. If one exists, add the same entries to its `config/providers.md` and `config/roles.md`, and tell the user.

### 4. UI labels
- **`src/renderer/store/model.ts:110`:** `strata: 'Strata'` in `PROVIDER_LABELS`, and a distinct colour in `PROVIDER_COLORS` (for example `'#d4a017'`, not used yet).
- **`src/renderer/office/scene.ts:295`** (`badgeLabel`): Strata shows as `'Strata local'`, like LM Studio.
- **`src/renderer/demo/fake.ts:122`:** treat `strata/` as local too. Optional, demo only.

### 5. Tests (`tests/models.test.ts`)
- **Seed configs:** `strata` is available with no key, `isPaidModel(strata/qwen3.8-flash-next)` is false, and `candidates('line-editor')` starts with `strata/qwen3.8-flash-next`.
- **Fake-server `OpenAiCompatClient`:**
  - with `jsonSchema: false` and a `schema`, the request body has no `response_format`;
  - the default still sends it;
  - `reasoning_content` deltas are not emitted as text.
- **Check existing tests still pass:** `tests/renderer/office.spec.ts:73` selects the LM Studio 35B in the picker; it should still pass because that model is still offered.

### 6. Docs
- **`docs/design.md`:**
  - new Decisions row (2026-10-10), "Strata": local Qwen3.8-Flash-Next server at `127.0.0.1:8080`, default local model for the LM Studio roles, LM Studio kept for nomic embeddings and as fallback, started by the user, no `response_format`;
  - add Strata to the "Local" row of the Model layer provider table;
  - one line under the local-models table about memory (Strata IQ3_S is about 84 GB);
  - a History entry.
  - It amends the "Provider list" (local: LM Studio and Ollama only) and "Starting models" rows. The new row says it overrides them where they differ.
- **`CLAUDE.md` "Machine" section:** one line about Strata (`D:\Strata`, `run-iq3_s.bat`, port 8080, `/health`). `AGENTS.md` is an untracked copy, so mirror the line there only if it is identical.
- **Ticket folder:** per the global CLAUDE.md, copy this plan to `.claude/tickets/SCP-03-strata-provider/plan.md` when implementation starts.

## Verification
1. Run `npm test` (vitest) and the renderer Playwright spec if it is part of the normal run. Run `npm run typecheck` / lint if the repo has them.
2. **Live check.** Ask the user to start `D:\Strata\run-iq3_s.bat` (it isn't running now) and wait for `curl http://127.0.0.1:8080/health` to show `"loaded": true`. Then:
   - `npm run engine -- probe --model strata/qwen3.8-flash-next`: streams a reply, logs token usage (this also checks that Strata sends `usage` with `stream_options.include_usage`), and writes a spend row at 0 USD;
   - `npm run engine -- probe --model strata/qwen3.8-flash-next-low`: confirms that Strata accepts the made-up model name.
3. Run a short book (or a `chatJson` job such as a line-editor review) against Strata. Check that it goes through with no 502s and no fallback to DeepSeek in the agent's terminal log.
4. Stop Strata and run the probe again. The failure should be a retryable `network error`, and the router should fall back to LM Studio and then DeepSeek.

## Implementation status (2026-10-10)

Sections 1-6 done.
- [x] 1. `json_schema` in `providerEntrySchema`, `ProviderInfo.jsonSchema`, `OpenAiCompatOptions.jsonSchema`; `response_format` only sent unless `jsonSchema === false`.
- [x] 2. `strata` entry in `seed/config/providers.md` (after `lmstudio`), new "Strata" section, `json_schema` field note, `concurrency` note mentions Strata.
- [x] 3. Roles in `seed/config/roles.md` as planned, "Starting choices" text updated. Live data folder: `C:\Users\Infplane\Scriptorium` does not exist and `SCRIPTORIUM_DATA` is unset, so there was nothing to update.
- [x] 4. `PROVIDER_LABELS` / `PROVIDER_COLORS` (`#d4a017`) in `src/renderer/store/model.ts`, `badgeLabel` gives 'Strata local' in `scene.ts`, `fake.ts` treats `strata/` as local.
- [x] 5. Tests in `tests/models.test.ts`: seed config assertions (strata available, not paid, `jsonSchema: false`, `line-editor` starts with strata) and a fake-server test (default sends `response_format`, `jsonSchema: false` does not, `reasoning_content` is not emitted as text).
- [x] 6. `docs/design.md` (Decisions row, Local provider row, memory line, History) and `CLAUDE.md` Machine line. `AGENTS.md` not edited (untracked, user-owned). The ticket folder is `SCP-03-strata-as-a-local-provider`, so no copy to `SCP-03-strata-provider` was made.

Verification: `npm run typecheck` clean, `npm run lint` clean, `npm test` 17 files / 213 tests passed, `npm run test:ui` 2 passed. Live Strata probe (Verification steps 2-4) not run: the server is not running.

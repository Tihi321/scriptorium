# SCP-03 changelog

## 2026-10-10: Strata as a local provider

Strata (a local Qwen3.8-Flash-Next server, OpenAI-compatible, `127.0.0.1:8080/v1`) is now a provider. It is the default local model in every role that used LM Studio.

### Repository `scriptorium`, branch `SCP-03_strata-provider` (from `origin/master` 3c2227e)

- `src/shared/schemas.ts`: new provider field `json_schema` (boolean, default `true`).
- `src/engine/models/registry.ts`: `ProviderInfo.jsonSchema` is read from the config and passed to `OpenAiCompatClient`.
- `src/engine/models/openaiCompat.ts`: new `jsonSchema` option. When it is `false`, `chat()` doesn't send `response_format`, and `chatJson` relies on the prompt plus its parse-and-repair step. This keeps a Strata 502 `structured_output_failed` from being retried and then falling through to paid DeepSeek.
- `seed/config/providers.md`:
  - `strata` provider entry: local, concurrency 1, `discover: false`, `json_schema: false`, optional `STRATA_API_KEY`.
  - Two model ids, both 131072 context: `qwen3.8-flash-next` (`reasoning_effort: none`) and `qwen3.8-flash-next-low` (`reasoning_effort: low`).
  - A "Strata" section on starting it, memory, context, and why `json_schema` is off, plus a note on the new field.
- `seed/config/roles.md`:
  - Editors and reviewers: Strata `qwen3.8-flash-next` first, then LM Studio 27B, then DeepSeek.
  - Checks, researcher and archivist: `qwen3.8-flash-next-low` first, then LM Studio 35B, then DeepSeek.
  - DeepSeek-first roles: Strata is now second, ahead of LM Studio.
  - Embeddings are unchanged (LM Studio nomic). The "Starting choices" text is updated.
- `src/renderer/store/model.ts`: label "Strata" and colour `#d4a017`.
- `src/renderer/office/scene.ts`: the desk badge reads "Strata local".
- `src/renderer/demo/fake.ts`: demo data treats `strata/` as local.
- `tests/models.test.ts`:
  - The seed provides an available, local, unpaid `strata` provider, and the line-editor's first candidate is Strata.
  - A fake-server test checks that `response_format` is sent by default and left out with `jsonSchema: false`, and that `reasoning_content` isn't emitted as text.
- `docs/design.md`: new Decisions row "Strata (local provider)" (it overrides Provider list and Starting models where they differ), Strata in the Local provider row, a memory note under the local models, and a History entry.
- `CLAUDE.md`: a Machine line about Strata.

### Deviations

- No live data folder exists (`C:\Users\Infplane\Scriptorium` is missing and `SCRIPTORIUM_DATA` is unset), so only `seed/` changed. An existing data folder would need the same entries added by hand, because seed files never overwrite.
- `AGENTS.md` (untracked, owned by the user) was not edited.

### Verification

- **Passed:**
  - `npm run typecheck`: clean.
  - `npm run lint`: clean.
  - `npm test`: 17 files, 213 tests passed.
  - `npm run test:ui`: 2 Playwright tests passed.
- **Live checks** (Strata IQ3_S running, `/health` reports `loaded: true`, `max_context` 131072, model `qwen3.8-flash-next-iq3_s`):
  - `npm run engine -- probe --model strata/qwen3.8-flash-next`: streamed a reply. Usage 20 in / 14 out, a 0 USD spend row.
  - `... --model strata/qwen3.8-flash-next-low`: streamed a reply. Usage 48 in / 33 out. Strata accepts the made-up id.
  - Both probes exit 1 only because the embedding step failed: LM Studio wasn't running, which is expected.
  - Rerun with LM Studio up and nothing loaded: discovery found 9 LM Studio models, the Strata reply streamed, and nomic JIT-loaded and embedded (dimension 768). Exit 0.
  - A line-editor-style JSON request with no `response_format` and `reasoning_effort: none` returned a valid JSON object in 4.2 s.
- **Not run:**
  - the down-server fallback check (plan Verification 4), which needs Strata stopped;
  - a full book run on Strata.

### Follow-ups

- A full book run on Strata, with LM Studio up for nomic embeddings.

### Commit status

Uncommitted.

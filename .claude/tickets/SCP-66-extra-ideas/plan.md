---
status: in-progress
request: creative-hub/REQ-0030
repos: [scriptorium]
branch: SCP-66_extra-ideas
updated: 2026-11-22
---

# SCP-66 Seed `lmstudio` in line with the live data, embeddings through the proxy, and a chunker cap

Part of creative-hub HUB-40 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-40-extra-ideas\plan.md`, ideas 10, 24, 25 of REQ-0030). Follow-up to SCP-65 (HUB-38). Never start Scriptorium (`yarn start`, `yarn engine` against `C:\Users\Infplane\Scriptorium`, or the app): it resumes a book factory that may spend on paid models. The tests use temp data folders and the mock model, which is fine.

Background (verified 2026-11-22): the live data folder (`C:\Users\Infplane\Scriptorium\config`, read only) was changed by the hub after AAP-43: `lmstudio` is `enabled: false`, `discover: false`, its only model is the nomic embedding row; the `acp` provider has a `llama/nomic-embed-text-v1.5` row (`family: nomic`, `embedding: true`); `roles.md` says `embeddings: acp/llama/nomic-embed-text-v1.5`. The seed still has the five LM Studio chat rows, `discover: true`, and embeds through LM Studio, which is not installed. A new data folder would therefore have no working embedder.

## Scope

1. Seed `config/providers.md`: the `lmstudio` block like the live one; the `acp` block gets the nomic embedding row; the prose that names the removed rows.
2. Seed `config/roles.md`: `embeddings:` through the proxy, and its prose.
3. `src/engine/memory/index.ts` `chunkText`: a hard cap of 1800 characters per chunk, and no chunk made only of separators (`---`, `***`, `* * *`).
4. Tests updated (`tests/models.test.ts`, `tests/memory.test.ts`); ROADMAP row.

## Out of scope

- Any book's `book.md` `models:` map, job history, the live data folder (the hub already changed it), migrations (the seed reaches only new data folders; do not add a migration).
- Removing the LM Studio code (load, concurrency, discovery stay; the provider is only switched off in the seed).
- Re-indexing the live library (needs Scriptorium's data folder and the proxy: the hub's N2, with the user's go-ahead).
- `docs/`, `README.md`, `CLAUDE.md` wording about embeddings (not part of this ticket).

## Files and modules to touch (lines verified on master, 2026-11-22)

**`seed/config/providers.md`**
- Line 69: `  - id: lmstudio                  # embeddings only now (chat goes through the ACP proxy) until the proxy serves /v1/embeddings (AAP-43)` becomes `  - id: lmstudio                  # switched off (HUB-38): LM Studio is not installed; embeddings go through the ACP proxy (acp/llama/nomic-embed-text-v1.5, AAP-43). Kept as a way back`.
- Insert `    enabled: false` after line 70 (`    kind: openai-compat`), as the `strata` block does (`:103`).
- Line 74 `    discover: true` becomes `    discover: false`.
- Lines 78-96 (the five chat rows `ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp`, `nail-qwen3.6-35b-a3b-mtp`, `poolside/laguna-s-2.1`, `tiel-coder-35b-a3b-mtp`, `gemma-4-e4b-it-ultra-uncensored-heretic`, each with its keys): removed. The `text-embedding-nomic-embed-text-v1.5` row (lines 97-99) stays. Keep `concurrency`, `discover_skip`, `load_models` as they are.
- `acp` block (starts line 137): after the `llama/inkling-2-mini-dspark` row (its `vision: true`, about line 172) add, at the same indent:
  ```yaml
      - id: llama/nomic-embed-text-v1.5
        family: nomic
        embedding: true
  ```
- Line 256: "for example `lmstudio/nail-qwen3.6-35b-a3b-mtp`." becomes "for example `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`."
- Line 277: "- Strata takes most of the GPU memory with any of these models: keep only the nomic embedding model loaded in LM Studio, and no ComfyUI, while it runs." becomes "- Strata takes most of the GPU memory with any of these models: no ComfyUI while it runs. The proxy's small nomic embedding server (port 8083) runs beside it."
- Line 332: "The LM Studio chat models here send `reasoning_effort: none`" becomes "The local models here send `reasoning_effort: none`", and delete the sentence "The Qwen 35B MoE (used for review) uses `low` so its verdicts are steadier." (its row is gone). The rest of the bullet stays.
- Find each line by its text first; the numbers were read on 2026-11-22.

**`seed/config/roles.md`**
- Line 3: `embeddings: lmstudio/text-embedding-nomic-embed-text-v1.5` becomes `embeddings: acp/llama/nomic-embed-text-v1.5`.
- Line 45: "the `strata` provider is switched off and LM Studio only serves embeddings:" becomes "the `strata` and `lmstudio` providers are switched off:".
- Line 51: "- Embeddings: the local nomic model in LM Studio, until the proxy serves `/v1/embeddings` (AAP-43); the hub then switches it by config. LM Studio is not a chat default any more. Only one local model is on the GPU at a time: a request for another one waits for the proxy to switch (minutes)." becomes "- Embeddings: the local nomic model through the ACP proxy (`acp/llama/nomic-embed-text-v1.5`, AAP-43), on its own small server beside the chat model. Only one local chat model is on the GPU at a time: a request for another one waits for the proxy to switch (minutes)."

**`src/engine/memory/index.ts`** (`chunkText`, lines 33-56)
- A constant `MAX_CHUNK_CHARS = 1800` (comment: nomic-embed-text-v1.5 takes 2048 tokens per input; 1800 characters stay under it even for text with few letters per token).
- Before the loop: drop paragraphs with no letter or digit (`!/[\p{L}\p{N}]/u.test(p)`): scene breaks and leftover front-matter separators.
- After the loop: any chunk longer than `MAX_CHUNK_CHARS` is split into pieces of at most that length, each cut at the last whitespace before the limit, or hard at the limit when there is none. Chunks keep their order. The `size` parameter keeps its meaning (the target size).
- Update the doc comment (line 33) to say both rules.

**Tests**
- `tests/memory.test.ts:105-110` (`'chunks long text at paragraph borders'`): add two cases to this `it`: (a) `'word '.repeat(1000)` plus a `.`-free 5000-character paragraph between two short ones: every chunk is at most 1800 characters and the joined text equals the input with whitespace normalised; (b) `'Intro line.\n\n---\n\nMore text.'` (and a variant with a paragraph over 1800 characters after the `---`): no chunk lacks a letter or digit.
- `tests/models.test.ts`: the seed test `'providers.md and roles.md load, and every role model exists'` (line 82) and the LM Studio tests (`'a server that does not answer is down...'` line 158 if it uses the seed's LM Studio rows, `'discovery adds the models LM Studio lists...'` line 214, `'concurrency: auto for LM Studio adds up...'` line 269) use the seed's LM Studio chat rows. Do not delete what they prove. Add one helper next to `directStrata()` (line 44), `lmStudioBack()`: it writes the old `lmstudio` block (copied from `git show master:seed/config/providers.md`, lines 69-99, `enabled` removed, `discover: true`) into the temp `config/providers.md` in place of the new one. Call it, then `registry.load()`, at the start of each test that needs those rows. In the seed test: `registry.providers.get('lmstudio')?.available` is now `false` (line 87); the acp rows are 7 (line 91: 6 local plus the nomic row); `registry.embeddingModel()?.ref` is `'acp/llama/nomic-embed-text-v1.5'` (line 120); move the LM Studio assertions of lines 99 and 107-117 after a `lmStudioBack()` + `load()` inside that test. No new test file, no copy of a test.

## Tasks for workers

- **T1 seed** (inputs: the two seed files above; output: the edited files). Contract with T3: the acp nomic row id is exactly `llama/nomic-embed-text-v1.5`, the embeddings ref exactly `acp/llama/nomic-embed-text-v1.5` (the proxy's AAP-43 contract; `registry.embed` adds the nomic prefixes for ids matching `/nomic/i`, `src/engine/models/registry.ts:683`).
- **T2 chunker** (input: `src/engine/memory/index.ts`; output: the new `chunkText`). Contract: same signature `chunkText(text, size = 1200): string[]`.
- **T3 tests** (after T1 and T2): as listed above.
- **T4 ROADMAP** (`ROADMAP.md`, after the SCP-65 bullet at line 97, same style):
  `- **SCP-66 (branch `SCP-66_extra-ideas`; plan in `.claude/tickets/SCP-66-extra-ideas/`; hub HUB-40, REQ-0030): seed embeddings through the proxy and a chunker cap.** The seed's `lmstudio` provider is off with only its nomic row and `discover: false` (as the live data); embeddings are `acp/llama/nomic-embed-text-v1.5`; a chunk is at most 1800 characters and separator-only paragraphs (`---`) are not indexed. Re-indexing the live library is the hub's step (UNTESTED).`

## Acceptance criteria and the command that proves each

Commands (Bash): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"; cd /c/projects/Personal/scriptorium`, then `yarn test` (vitest and `test:recovery`), `yarn typecheck`, `yarn lint`, `yarn build`.

| # | criterion | proof |
|---|---|---|
| A1 | A new data folder made from the seed embeds with `acp/llama/nomic-embed-text-v1.5`, and `lmstudio` is off with no chat rows and `discover: false` | `tests/models.test.ts` seed test |
| A2 | The LM Studio features (load settings, concurrency auto, discovery) are still proven | the LM Studio tests pass with `lmStudioBack()` |
| A3 | No chunk is longer than 1800 characters, whatever the punctuation | `tests/memory.test.ts` case (a) |
| A4 | No chunk is made only of separators | `tests/memory.test.ts` case (b) |
| A5 | Nothing else changed | `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build` pass; `git diff --stat` shows only the files above |

## UNTESTED

- Embedding a real 1800-character chunk through the proxy (needs the proxy's embedding server; the hub's N2 re-index covers it).
- The re-index of the live library (hub N2, the user's go-ahead).

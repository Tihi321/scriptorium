# Changelog SCP-66

## 2026-11-22 SCP-66 (REQ-0030, HUB-40): seed embeds through the proxy, chunker cap

Branch `SCP-66_extra-ideas` (from master).

- `seed/config/providers.md`: `lmstudio` is `enabled: false`, `discover: false`, only its nomic row; the `acp` block gains `llama/nomic-embed-text-v1.5` (embedding); prose updated.
- `seed/config/roles.md`: `embeddings: acp/llama/nomic-embed-text-v1.5` and its prose.
- `src/engine/memory/index.ts`: `chunkText` drops paragraphs without a letter or digit and caps every chunk at 1800 characters (cut at whitespace).
- `tests/models.test.ts`: `lmStudioBack()` helper (also called by `directStrata()`); seed test expects lmstudio off, 7 acp rows, embeddings ref; LM Studio tests keep their rows through the helper.
- `tests/memory.test.ts`: cap case and separator case.
- `ROADMAP.md`: SCP-66 row.

Deviation: the chunker tests are two `it` blocks (cap in the existing one, separators in a new one), not one.

Verification: `yarn test` 760/761 (the one failure, `tests/adapt.test.ts` ENOENT, passed alone: load); `test:recovery`, `yarn typecheck`, `yarn lint`, `yarn build` pass.
Not run: embedding a real chunk through the proxy; re-index of the live library.

Commit status: see git log of the branch.

## Polish 1

- `tests/models.test.ts`: on-device check uses `lmstudio/text-embedding-nomic-embed-text-v1.5` (a seed row) instead of the near-duplicate `acp/llama/nomic-embed-text-v1.5`; `embeddingModel()` assertion also checks `embedding: true`; stale "six local rows" comment fixed (7 acp rows).
- `src/engine/memory/index.ts`: the hard cut in `splitLong` backs up one character when it would split a surrogate pair; one assertion added to cap case (a) in `tests/memory.test.ts`.
- `seed/config/providers.md`: the LM Studio prose no longer names removed rows (LM Studio switched off, HUB-38; example is the nomic row).

Deviations the first worker did not record: `directStrata()` calls `lmStudioBack()`; the on-device check was changed from `m(lmstudio/nail-qwen...)` to the acp nomic row (reverted here to the lmstudio nomic row).

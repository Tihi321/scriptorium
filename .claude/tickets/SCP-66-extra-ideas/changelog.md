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

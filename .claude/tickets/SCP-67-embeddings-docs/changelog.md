# Changelog SCP-67

## 2026-11-22 SCP-67: docs say embeddings go through the ACP proxy; 8787 as sample URL in a test

Repo scriptorium, branch `SCP-67_embeddings-docs` (from master).

- `README.md`: models line names `acp/llama/nomic-embed-text-v1.5` instead of "LM Studio only for embeddings".
- `CLAUDE.md`: LM Studio is not installed; embeddings go through the proxy since SCP-66; Strata line says the nomic embeddings run on the proxy's small embedding server (three phrases only).
- `docs/design.md`: the engine table cell and the "Embeddings run locally and free" bullet name the proxy (LM Studio before).
- `tests/customProviders.test.ts`: sample URL of the "ACP Home" provider 7461 -> 8787 (two lines).
- `ROADMAP.md`: SCP-67 bullet after SCP-66.

Deviations: none.

Verification: S1, S2, S3 greps print nothing; `npx vitest run tests/customProviders.test.ts` 7 passed; `yarn test` exit 0 (main suite and recovery); `yarn typecheck`, `yarn lint`, `yarn build:engine` exit 0.
Not run: nothing runtime changes; live `roles.md` is the hub's step (HUB-41 L2).

Commit status: committed on the branch (see git log); not merged, not pushed.

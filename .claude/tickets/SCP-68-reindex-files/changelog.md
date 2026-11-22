# Changelog SCP-68

## 2026-11-22 SCP-68: `engine reindex` lists the files it embedded and removed

Repo scriptorium, branch `SCP-68_reindex-files`.

- `src/engine/memory/index.ts`: `reindex` also returns `indexedFiles` and `removedFiles` (data-folder relative paths); counts and abort-on-embed-error unchanged. `MemoryService.reindexAll` passes the object through (inferred type); other callers (`longHandlers.ts`, tests) use only the counts.
- `src/engine/cli.ts`: `reindexLibrary` prints `  embedded: <file>` / `  removed: <file>` lines after the summary.
- `tests/memory.test.ts`: two assertions in "removes files that are gone and reindexes changed ones".
- `ROADMAP.md`: SCP-68 bullet.

Deviations: none.

Verification: `npx vitest run tests/memory.test.ts` 7 passed; `npx vitest run` 58 files, 761 tests passed; `yarn test:recovery`, `yarn typecheck`, `yarn lint` exit 0.
Not run: the CLI against real data (UNTESTED, by rule).

Commit status: committed on the branch (not merged, not pushed).

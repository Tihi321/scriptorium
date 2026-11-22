# Changelog SCP-69

## 2026-11-22 SCP-69: lms examples name a chat model, adapt test waits for book.md, one-file test note

Repo scriptorium, branch `SCP-69_small-leftovers` (from master).

- `seed/config/providers.md`: both `lms load` examples use `<model>` instead of the embedding model id; nothing else changed.
- `tests/adapt.test.ts` (line ~433, test "starts without asking the editor-in-chief"): the `waitFor` returns the slug only once `books/<slug>/book.md` can be read. No assertion changed. A race cannot be made to fail on demand; the test is green with `npx vitest run tests/adapt.test.ts` (15 tests passed).
- `CLAUDE.md`: one line: run one test file with `npx vitest run <file>`; `yarn test <file>` runs the whole suite.
- `ROADMAP.md`: SCP-69 bullet after SCP-68.

Deviations: none. Verification: `npx vitest run tests/adapt.test.ts` 15 passed; `yarn test` 58 files, 761 tests passed plus test:recovery 1 passed; `yarn typecheck` and `yarn lint` exit 0. Not run: whether the original ENOENT was this race (never reproduced).
Commit status: committed on SCP-69_small-leftovers (not pushed, not merged).

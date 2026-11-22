# Changelog SCP-70

## 2026-11-22 SCP-70: the length-target adaptation test waits for book.md

Repo scriptorium, branch `SCP-70_adapt-test-race` (cut from master f67b39a).

Files:
- `tests/adapt.test.ts`: new module-level helper `scriptBookSlug(e)` that waits for the adaptation's slug directory and for `book.md` to be readable. The SCP-69 test ("starts without asking the editor-in-chief") and "SCP-37: the length target follows the source" both call it. No assertion changed.
- `ROADMAP.md`: SCP-70 bullet.
- `src`: unchanged (the mutation below was reverted; `git diff --stat -- src` empty).

Failing first (temporary 300 ms delay between `mkdir` and `writeMd` in `BookStore.create`, old test file):
`Error: ENOENT: no such file or directory, open '...\books\the-moon-lamp\book.md'` at `tests/adapt.test.ts:467`.
With the delay kept and the helper in place: the SCP-37 test and the SCP-69 test both pass.

Verification after revert: `npx vitest run tests/adapt.test.ts` 15/15; `yarn test` 58 files / 761 tests plus recovery 1/1 pass; `yarn typecheck` and `yarn lint` exit 0.

Not verified: that the ENOENT seen once in a real run was this race (proven only with the inserted delay).

Commit status: committed on `SCP-70_adapt-test-race`; not pushed or merged.

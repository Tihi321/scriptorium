---
status: in-progress
request: creative-hub/REQ-0031
repos: [scriptorium]
branch: SCP-70_adapt-test-race
updated: 2026-11-22
---

# SCP-70 The second adaptation test waits for book.md too (the race SCP-69 fixed at :433)

Hub ticket: creative-hub HUB-44, request REQ-0031 (an extra idea of the SCP-69 check; the user said 2026-11-22 "use all recommendation, add all possible extras"). Checked on master f67b39a (2026-11-22).

Commands (from `package.json`; Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first; `fnm exec yarn` fails): one file `npx vitest run tests/adapt.test.ts` (`yarn test <file>` runs the whole suite: the argument goes to `test:recovery`), `yarn test` (`vitest run && yarn test:recovery`), `yarn typecheck`, `yarn lint`. No build. **Never start Scriptorium** (no `npm run engine`, no `yarn dev`, no `yarn start`); never touch `C:\Users\Infplane\Scriptorium`.

Rules: branch `SCP-70_adapt-test-race` cut from master f67b39a; the worker does not commit; the orchestrator makes **one commit** `SCP-70: the length-target adaptation test waits for book.md` (Bash heredoc `git commit -F - <<'EOF'`, blank line after the subject, last line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`); no push, no merge. `.ts` files are CRLF in the tree, `*.md` LF: keep each file's endings. Test-discipline: no new test; one existing test made safe and the SCP-69 copy moved into the same helper; the race is shown failing by a temporary mutation in `src` that is reverted before the end.

## Scope (the pattern in the whole file, read on master)

| place | verdict | evidence |
|---|---|---|
| `tests/adapt.test.ts:466-467` ("SCP-37: the length target follows the source") | IN | `:466` waits only until a second slug directory exists (`books.slugs()` lists directories, `src/engine/pipeline/books.ts:128-135`), then `:467` reads `books/<slug>/book.md`. `BookStore.create` makes the directory first and writes `book.md` after (`books.ts:167-169`), so under load the read can hit ENOENT: the race SCP-69 fixed at `:433-442`. |
| `:433-442` ("starts without asking the editor-in-chief") | IN (refactor only) | SCP-69's inline fix of the same race; moved into the shared helper below so the two copies cannot drift. Behaviour of the test unchanged. |
| `:342-347` | NO CHANGE | waits until `books.read(s)` says `stage === 'published'`, which needs `book.md` read; `:347` reads it after. |
| `:422` | NO CHANGE | waits for two slugs and reads no file. |
| `:505-507` | NO CHANGE | takes the slug after the outline prompt was seen (the book started long before) and waits for `books.outline(slug)` before reading. |

## Files to touch

- `tests/adapt.test.ts`, after `const ref = ...` (`:97`), a module-level helper:
  ```ts
  /** The adaptation's slug once its book.md can be read: BookStore.create makes the folder before it writes book.md (SCP-69, SCP-70). */
  async function scriptBookSlug(e: TestEnv): Promise<string> {
    return waitFor(async () => {
      const s = (await e.engine.books.slugs()).find((x) => x !== 'moon-lamp')
      if (!s) return null
      try {
        await readFile(path.join(e.dir, 'books', s, 'book.md'), 'utf8')
        return s
      } catch {
        return null
      }
    }, 30000, 'the script book to start')
  }
  ```
  (`TestEnv`, `waitFor`, `readFile`, `path` are already imported, `:1`, `:3`, `:21-22`.)
- `:433-442` becomes `const slug = await scriptBookSlug(e)`.
- `:466` becomes `const slug = await scriptBookSlug(e)`.
- No assertion changes.
- `ROADMAP.md`: a new last bullet after the SCP-69 bullet (the last line), in its style: "- **SCP-70 (branch `SCP-70_adapt-test-race`; plan in `.claude/tickets/SCP-70-adapt-test-race/`; hub HUB-44, REQ-0031): the length-target adaptation test waits for `book.md` too, through one helper shared with the SCP-69 test.** One test file; behaviour unchanged."
- `.claude/tickets/SCP-70-adapt-test-race/changelog.md` (new): the failing-first evidence, test counts, the revert of the mutation.

## Test proof (failing first by a temporary mutation)

1. On the unchanged test file, temporarily add `await new Promise((r) => setTimeout(r, 300))` between the `mkdir` and the `writeMd` in `BookStore.create` (`src/engine/pipeline/books.ts:168-169`). Run `npx vitest run tests/adapt.test.ts -t "SCP-37: the length target follows the source"`: it must fail with ENOENT on `book.md` (paste the line into the changelog). If it does not fail, raise the delay to 1000 ms once and say so in the changelog.
2. Keep the mutation, make the test change, rerun the same command and the SCP-69 test (`-t "starts without asking the editor-in-chief"`): both pass.
3. **Revert the mutation** (`git diff src` must be empty), then `npx vitest run tests/adapt.test.ts`, `yarn test`, `yarn typecheck`, `yarn lint`.

## Tasks for workers

One worker: `tests/adapt.test.ts`, `ROADMAP.md`, the changelog (and the temporary, reverted edit of `src/engine/pipeline/books.ts`). Output: the three proof runs, final counts, `git diff --stat` showing only the test file, ROADMAP and the ticket folder.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| S1 | no adaptation test reads `book.md` before it can be read | code review: both former copies call `scriptBookSlug`; the mutation run fails before and passes after |
| S2 | `src` unchanged | `git diff --stat master -- src` empty |
| S3 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` exit 0 |

## UNTESTED

- Whether the ENOENT seen once in a real run was this race (it is proven only with the inserted delay).

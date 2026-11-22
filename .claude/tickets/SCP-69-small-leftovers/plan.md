---
status: done
request: creative-hub/REQ-0031
repos: [scriptorium]
branch: SCP-69_small-leftovers
updated: 2026-11-22
---

# SCP-69 Small leftovers: the LM Studio load example names a chat model, the adaptation test waits for book.md, one test file runs with npx vitest

Hub ticket: creative-hub HUB-44 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-44-pending-ideas\plan.md`, triage row P-35; P-31, P-32, P-34 are the hub's live steps, P-33 no change), request REQ-0031. Checked on master 980e415 (2026-11-22).

Commands (from `package.json`; Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first; `fnm exec yarn` fails): `yarn test` (`vitest run && yarn test:recovery`), one file `npx vitest run tests/adapt.test.ts` (`yarn test <file>` runs the whole suite: the argument goes to `test:recovery`), `yarn typecheck`, `yarn lint`. No build needed (prose and a test). Never start Scriptorium; never touch `C:\Users\Infplane\Scriptorium`.

Rules: branch `SCP-69_small-leftovers` cut from `master`, one commit; `seed/**` and `*.md` are LF in the tree (`.gitattributes`), `.ts` CRLF (`core.autocrlf`): keep each file's line endings; backslashes through the Edit tool; test-discipline (no new test; one existing test made stricter); `yarn seed:hashes` is not needed (CLAUDE.md asks for it after `seed/prompts` or `seed/templates` changes; this edits `seed/config`).

## Scope (P-35, five parts read on master)

| part | verdict | evidence |
|---|---|---|
| a. `splitLong` loops forever for max 1 with an emoji first | NO CHANGE | `src/engine/memory/index.ts:37-59`; its only caller is `:90` with `MAX_CHUNK_CHARS` 1800 (`:33-34`); a loop needs a cut of 0, which needs max 1 |
| b. a long emoji-only or punctuation-only run is dropped after a hard cut | NO CHANGE (by design) | `:90` keeps only chunks with a letter or digit (`/[\p{L}\p{N}]/u`), as the paragraph filter at `:70`: such a chunk cannot be found by a search; `tests/memory.test.ts:119-120` covers it |
| c. the `lms load` examples use the embedding model | IN | `seed/config/providers.md:315` advises "load the models you use with 32768 or more" for long books and shows `lms load text-embedding-nomic-embed-text-v1.5 -c 32768 --parallel 1 ...` and `... --parallel 4 ...`: the context advice is about chat models, the example is the embedding model |
| d. `tests/adapt.test.ts` "starts without asking the editor-in-chief" failed once with ENOENT | IN | `:433` waits until a second slug directory exists (`books.slugs()` lists directories), then `:434` reads `books/<slug>/book.md`; under load the directory can exist before `book.md` is written |
| e. `yarn test <file>` does not run one file | IN (a note) | `package.json:16` `"test": "vitest run && yarn test:recovery"`: the file argument lands on `test:recovery` |

## Files to touch

- `seed/config/providers.md:315`: in both examples replace `text-embedding-nomic-embed-text-v1.5` with `<model>` (the chat model's id), so they read `lms load <model> -c 32768 --parallel 1 --ttl 28800 -y` and `lms load <model> -c 32768 --parallel 4 --ttl 28800 -y`. Nothing else in the line changes. The live `C:\Users\Infplane\Scriptorium\config\providers.md` is not edited (its LM Studio provider is off; the hub may sync prose later).
- `tests/adapt.test.ts:433`: the `waitFor` callback returns the slug only once `books/<slug>/book.md` can be read: `async () => { const s = (await e.engine.books.slugs()).find((x) => x !== 'moon-lamp'); if (!s) return null; try { await readFile(path.join(e.dir, 'books', s, 'book.md'), 'utf8'); return s } catch { return null } }`, same timeout and label. No assertion changes. A race cannot be made to fail on demand: the changelog says so and shows the test green with `npx vitest run tests/adapt.test.ts`.
- `CLAUDE.md`: one line where the commands are listed (the worker finds the place; if there is no commands list, after the rules list): "Run one test file with `npx vitest run <file>`; `yarn test <file>` runs the whole suite (the argument goes to `test:recovery`)."
- `ROADMAP.md`: a new last bullet after line 100 (SCP-68), in its style: "- **SCP-69 (branch `SCP-69_small-leftovers`; plan in `.claude/tickets/SCP-69-small-leftovers/`; hub HUB-44, REQ-0031): the LM Studio load examples name a chat model, the adaptation test waits for `book.md`, CLAUDE.md says how to run one test file.** Prose and one test; behaviour unchanged."

## Out of scope

- P-31 (full re-chunk), P-32 (stale `index\engine.lock`), P-34 (the new prose read on start): the hub's live round.
- P-33 (three Strata sentences): no change (hub triage).
- Any `reindex --full` option: the user chose a delete and a re-index in the live round.

## Tasks for workers

One worker: the three files and ROADMAP; `npx vitest run tests/adapt.test.ts`, `yarn test`, `yarn typecheck`, `yarn lint`. Output: one commit `SCP-69: lms example names a chat model, adapt test waits for book.md, one-file test note`; `.claude/tickets/SCP-69-small-leftovers/changelog.md` with the test count.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| S1 | no `lms load` example names the embedding model | `grep -n "lms load text-embedding" seed/config/providers.md` prints nothing |
| S2 | the adaptation test reads `book.md` only after it exists | code review; the file green |
| S3 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- Whether the adaptation test's ENOENT was this race (it never reproduced on demand).

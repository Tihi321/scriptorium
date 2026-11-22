---
status: in-progress
request: creative-hub/REQ-0030
repos: [scriptorium]
branch: SCP-68_reindex-files
updated: 2026-11-22
---

# SCP-68 `engine reindex` lists the files it embedded and removed

Hub ticket: creative-hub HUB-42 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-42-pending-ideas-and-proxy-monitor\plan.md`, triage row P9; P10, the stale `index\engine.lock`, is NO CHANGE here), request REQ-0030. Checked on master b6071c9 (2026-11-22).

Never start Scriptorium (it resumes its book factory and may spend on paid models). Do not run `engine reindex` against `C:\Users\Infplane\Scriptorium`; tests only.

Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first): test `yarn test` (`vitest run && yarn test:recovery`; one file: `npx vitest run tests/memory.test.ts`, since `yarn test <file>` does not filter); typecheck `yarn typecheck`; lint `yarn lint`; engine build `yarn build:engine`.

## Scope

`reindexLibrary` (`src/engine/cli.ts:78-92`) prints only counts: `index/library.sqlite: N file(s) indexed, N unchanged, N removed. {stats}`. `reindex` (`src/engine/memory/index.ts:316-333`) knows each file (`f.file` when `upsert` returns true; `known` when removed) but returns counts only. After the HUB-40 N2 run (35 files embedded) nobody could say which 35. Change: `reindex` also returns the lists; the CLI prints them, one per line, after the summary. Behaviour is otherwise unchanged (an embed error still aborts the run, as today; no per-file failure handling).

## Out of scope

Per-file failure handling (a decision of its own: today the first embed error aborts the run); the stale `index\engine.lock` (written only by the long-running engine, `src/engine/index.ts:78`; a dead pid or a lock from before the last boot is already treated as stale, `src/engine/store/dataFolder.ts:154-165`, tested in `tests/mcp.test.ts:322-336`; the hub's `hub.ps1 stop` now clears it, HUB-42 H2).

## Files to touch (verified)

**`src/engine/memory/index.ts:315-333`** `reindex`: return type `{ indexed: number; unchanged: number; removed: number; indexedFiles: string[]; removedFiles: string[] }`; push `f.file` to `indexedFiles` where `indexed++` runs and `known` to `removedFiles` where `removed++` runs. Doc comment: "... Returns the counts and the files embedded again and dropped (data-folder relative paths)." The worker checks `MemoryService.reindexAll()` passes the object through unchanged (widen its return type if it names the fields).

**`src/engine/cli.ts:88`**: after the existing `out(...)` line, `for (const file of r.indexedFiles) out(`  embedded: ${file}`)` and `for (const file of r.removedFiles) out(`  removed: ${file}`)`.

**`ROADMAP.md`**, a new bullet after the SCP-67 bullet (`ROADMAP.md:99`), same style: "- **SCP-68 (branch `SCP-68_reindex-files`; plan in `.claude/tickets/SCP-68-reindex-files/`; hub HUB-42, REQ-0030): `engine reindex` lists the files it embedded and removed.** One line per file after the summary; counts and behaviour unchanged."

## Test (one assertion, test-discipline)

`tests/memory.test.ts:75-90`, "removes files that are gone and reindexes changed ones": add `expect(r.indexedFiles).toEqual(['books/silver-inn/chapters/ch-02.md'])` and `expect(r.removedFiles.length).toBe(r.removed)` after `expect(r.indexed).toBe(1)` (the worker checks the path form the test data gives and uses it as stored).

## Tasks for workers

One worker: the two code changes, the assertion, ROADMAP; `npx vitest run tests/memory.test.ts`, then `yarn test`, `yarn typecheck`, `yarn lint`. Output: one commit on `SCP-68_reindex-files` (`SCP-68: reindex lists the files it embedded and removed`), `changelog.md` with the test count.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| S1 | `reindex` returns the embedded and removed files | the memory test assertion |
| S2 | the CLI prints them | code review of `cli.ts` (the CLI is not run against the live data) |
| S3 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

The printed lines on a real re-index (the next one the user asks for).

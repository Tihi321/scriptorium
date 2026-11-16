---
status: in-progress
request: REQ-0028
repos: [scriptorium]
branch: SCP-64_leftovers
updated: 2026-11-16
---
# SCP-64: leftovers after SCP-61 and SCP-62

Follow-up to SCP-62 (plan in `.claude/tickets/SCP-62-fallback-and-quota-visibility/plan.md`, "On this machine"). Never start the live Scriptorium to test; unit tests use temp data folders.

## Scope

1. **The empty model list.** In `ctx.chat`'s model-change path (`src/engine/queue/scheduler.ts`, the `if (next.length > 0)` after `this.modelsFor(rj)`), an empty new list kept the old `models`. With `no_local_fallback` on, the old list may hold a model on this machine outside the book's list (reachable when the flag goes on between two requests and a registry reload makes the remaining providers unavailable), so the request could still go to it. Fix: when the new list is empty, the job's flag is on and the old list holds such a model, the job is aborted with `'stop'` and goes back to the queue (no attempt counted); the scheduler's `no local fallback: ` blocked reason then says why it waits. Without the flag, or when the old list holds no such model, today's behaviour stays. The on-device test of `bookFallbackChanged` moves into a shared helper `localOutsideBook`.
2. **Stale docs.** `docs/design.md` describing `humanized: N` as the chapter front-matter key where it describes current behaviour: add "(now `humanizer_round`, SCP-61)" or fix the description; history entries stay history.

## Acceptance

- A new `it` in `tests/scheduler.test.ts` (after the SCP-62 mid-request case): a job's first request runs on `acp/a`; between its requests the flag goes on and `acp` becomes unavailable; the job ends back in the queue with `attempts: 0`, its blocked reason starts with `no local fallback: `, and `loc/g` is never called. The test fails without the fix (it times out waiting for the blocked job).
- `grep humanized docs/` shows no current-behaviour description that names `humanized: N` as the key without saying it is now `humanizer_round`.
- `yarn test`, `yarn typecheck`, `yarn lint` pass.
- ROADMAP.md has an SCP-64 entry after SCP-63's.

## Result

- Item 1: built, with the new test (fails without the fix).
- Item 2: no change needed. `grep -rn humanized docs/` on 2026-11-16: the Humanizer Decisions row (`docs/design.md:99`) already describes `humanizer_round` / `humanizer_result` and says the old `humanized: <round>` is still read; the SCP-10 History line (`:806`) already carries "(SCP-61: now `humanizer_round` and `humanizer_result`)"; `:845` is the SCP-61 History entry itself; the other hits (`:808`, `:835`) use "humanized" as a plain word. The description of history files (`ch-NN-rR-humanized.md` only for a rewritten pass) matches `writeChapter` in `src/engine/pipeline/books.ts`.

## Out of scope

- Changing the behaviour without `no_local_fallback`.
- Any other doc rewrite.

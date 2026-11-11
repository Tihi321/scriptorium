# Changelog

## 2026-11-11 SCP-59: ACP context limits, JSON repair after a model switch, token clean-up

Branch `SCP-59_acp-context-and-json-repair` (from master). Uncommitted.

Files (repo):
- `src/engine/models/router.ts`: a model whose `context` is smaller than the estimated prompt is skipped without a request (`too-big` problem, message "prompt is too long for ...", also the last model).
- `src/engine/models/types.ts`: `ModelSwitchedError`.
- `src/engine/queue/scheduler.ts`: `ChatOptions.sameModel` / `fromModel`; `ctx.chat` throws `ModelSwitchedError` before any request when a repair would go to another model; too-big skips are written to the job log.
- `src/engine/pipeline/llm.ts`: `chatJson` restarts from the original messages on the new model (max 2 restarts), repair carries the schema when the first ask had it, whole reply (stripped of reasoning, up to 32,000 chars).
- `seed/config/providers.md`: bullet in "The ACP proxy". `docs/design.md`: Decisions row and History line.
- `tests/models.test.ts` (1 new, 1 extended), `tests/scheduler.test.ts` (2 new).

Data folder (not committed): `C:/Users/Infplane/Scriptorium/config/providers.md`, both `acp/antigravity/*` rows `context: 45000`.
Deleted: `.claude/temp/req0006/` (gitignored). Token search afterwards: no hit.

Deviations: `sameModel` also narrows the job's model list to start at that ref (so a repair after a fallback in the first ask is not rejected); the job log line for a too-big skip is written for every `too-big` problem.

Verification: `yarn test` 742 passed (baseline 739 + 3 new tests); `yarn typecheck` clean. Tests 1, 3, 4 fail on the unfixed code. Not run: the running app / reload of providers.md, real ACP proxy.
Not done by design: token rotation (user's step).

## Polish round 1

- B1: `scheduler.ts` chat(): on a model change during a `sameModel` request the refreshed list's first model is compared with `sameModel` before any narrowing; a difference throws `ModelSwitchedError(models[0].ref)`, so the repair is no longer re-sent to the old model.
- B2: `sameModel`/`fromModel` narrowing is now local to the one request (`use`); the job-wide `models` and `rj.first` keep their pre-SCP-59 meaning. A repair after a fallback in the first ask still runs on the model that wrote the reply.
- B3: the too-big job log line now reads "<ref> too big: ..." (true for the router's skip and for a provider 400). Final newline of `src/engine/pipeline/llm.ts` restored.
- Test: the model-change-during-repair test in `tests/scheduler.test.ts` now asserts attempts 0 and the calls x, x, y with the old model x still in the new list [b/y, a/x]. It fails on the B1-reverted code (attempts 1) and passes after the fix. No B2 test (not cheap).
- Verification: `yarn test` 742 passed, `yarn typecheck` clean.

## Polish round 2

- N1: `scheduler.ts` chat(): a `fromModel` request is narrowed only until its first real model change. When a refreshed list has a different first model than the list the request ran on, `narrowed` turns off and the request uses the new list unnarrowed (new model first); before, it was re-sent to `fromModel` while that model was still in the list. The abort decision in `changeModel` is unchanged: `rj.first` is still the job-wide `models[0]`, which is also what the unnarrowed list is compared with, so a hot reload that keeps the list does not abort (B2) and requests without `sameModel`/`fromModel` are unchanged.
- Test: `tests/scheduler.test.ts` "a model change during a restarted JSON request ..." (providers a/x, b/y, c/z; role [a/x, b/y]; x prose then 500 on repair, restart on y, setModel c/z) asserts calls x:1, x:3, y:1, z:1 and z gets the original messages. Fails on the old code, passes 3 of 3 runs after.
- Verification: `yarn test` 743 passed, `yarn typecheck` clean.

## Polish round 3

- N2: `scheduler.ts` chat(): `sameModel` and `fromModel` now share one rule. A request is narrowed until the refreshed list's first model differs from the list it ran on (`narrowed`); a no-op reload (same first model, e.g. a settings.md save) no longer widens a `sameModel` request to the full list, so the repair stays on its model instead of throwing `ModelSwitchedError` and repeating the first ask. A real switch (B1, N1), `sameModel` leaving the list (`use[0]` check) and requests without these options are unchanged.
- Test: `tests/scheduler.test.ts` "a reload that keeps the model list during a JSON request after a fallback does not restart it" (role [a/x, b/y]; x 500, y prose, `changeModel()` returns 0 mid-stream) asserts calls x:1, y:1, y:3 and attempts 0. Before the fix: x:1, y:1, x:1, y:1, y:3 (fails 3 of 3); after: passes 3 of 3.
- Verification: `yarn test` 744 passed, `yarn typecheck` clean.

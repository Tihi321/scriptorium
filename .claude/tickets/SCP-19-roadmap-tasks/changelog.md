# SCP-19 changelog

## 2026-10-22: SCP-19, Scriptorium's own roadmap items

Every Scriptorium item of `ROADMAP.md` (2026-10-22) is done on one branch, `SCP-19_roadmap-tasks` (from master 15ba2c1), one commit per task. Plan: `plan.md` in this folder. Not pushed and no PR.

T1 and T2 were built in the main checkout. T3 to T8 were built in a temporary worktree and cherry-picked onto the branch in task order. The only conflicts were in `docs/design.md`, where both sides appended rows and History lines; both were kept.

### Commits

| Task | Commit | What |
|---|---|---|
| T0 | df6e986 | Plan |
| T1 | f1f42f6 | Fallbacks as an open list |
| T2 | 8a2800b | `last_resort_model` |
| T3 | b88dac9 | `story_year` in every outline prompt |
| T4 | 927b9b5 | Revise follow-up for the outline, act and thread reviews |
| T5 | a2e5829 | The humanizer adds new places to the bible |
| T6 | 38313dc | Tighten owner-note rewrites |
| T7 | 18e45dd | `length_over` test |
| T8 | 3f83329 | The recovery test runs on its own |
| T9 | none | `yarn test:electron` passed with nothing to fix |
| T10 | (this commit) | Changelog and roadmap |

### What changed, by roadmap item

**T1: fallbacks as an open list**
- **Config.** `config/settings.md` has `fallbacks` and `fallback_shared` in place of `default_paid_model`, `default_strata_model`, `default_lmstudio_model` and `model_order`.
  - `fallbacks` is an ordered list of `provider/model`, at least one.
  - A row's kind comes from its provider: an API provider is `paid`, any other provider is named by its id. No provider id is hard-coded.
- **Aliases.** `paid`, `paid-2`, `strata`, `lmstudio-2`, `client` and so on name the n-th row of a kind.
  - Existing `roles.md` files, agent models and book `role_models` keep working.
  - An alias with no matching row is skipped and logged (`ModelRegistry.unresolvedAliases`, the engine's `warnAliases`).
- **Shared order** (`registry.ts` `roleEntries`). With `fallback_shared`, every role gets every row, top to bottom.
  - A role's own concrete model takes the place of the first free row of its kind, so Strata's `-low` model still serves the checks.
  - Client models still go first.
- **Migration.** `migrateFallbacks` (`store/migrations.ts`) converts the old keys and replaces the body's "## Default models" section with the seed's.
  - The schema still reads the old keys, so a folder loads before it is migrated.
- **UI.** The Models panel has one row per entry: a kind select, a model select, up, down and remove, plus an Add button.
  - Test ids: `fallback-row-<i>`, `fallback-kind-<i>`, `fallback-model-<i>`, `fallback-alias-<i>`, `fallback-up-<i>`, `fallback-down-<i>`, `fallback-remove-<i>`, `fallback-add`. `order-shared` is unchanged.
  - The demo engine, `AgentPanel` text and `Settings.tsx` follow.
- **Protocol.** `SettingsSummary.fallbacks` / `fallbackShared` and `ModelSummary.kind`.

**T2: `last_resort_model`** (settings.md, empty by default, no UI control)
- The scheduler uses it only when every candidate of a role is down or used up for the day. It does not when a candidate is only busy, rate-limited or over budget.
- It goes through the budget check, and its block reason is added when it can't take the job either.
- `factory_status.lastResort` shows it (documented in `docs/mcp.md`). The scheduler got an optional `log` dependency for the log line.

**T3: `story_year` in every outline**
- `outline_nf.md` and `outline_article.md` ask for `story_year`.
- An older outline prompt without the field gets `STORY_YEAR_RULE` (`ensureStoryYearRule` in `handlers.ts`).
- `seedHistory.ts` was regenerated.

**T4: revise follow-up for every review**
- `review_outline`, `act_review` and `thread_check` use `withUsableNotes`, each with its own pass rule.

**T5: the humanizer adds new places**
- `settleScenePlaces` moved to `scriptPlaces.ts` and is shared by the writer and the humanizer. The humanizer now adds unknown `SCENE:` places to the light bible.

**T6: tighten owner-note rewrites**
- A note rewrite gets the tighten retry unless `noteWantsLength(note)` matches ("longer", "expand", "add a scene" and similar).

**T7: `length_over` test**
- A book over the ceiling gets `length_over` / `lengthOver`. A normal book has neither. Test only.

**T8: the recovery test runs on its own**
- `vitest.config.ts` excludes it, and `vitest.recovery.config.ts` runs it alone (`maxWorkers: 1`, 60 s timeout).
- `yarn test` is `vitest run && yarn test:recovery`.

**Docs.** `docs/design.md` has six Decisions rows and History lines, dated 2026-10-22: Fallbacks as an open list, Last resort model, Story year in every outline, Revise follow-up for every review, Humanizer adds new places, Tighten owner-note rewrites. The seed `settings.md` and `roles.md` bodies document the new fields.

### Decisions the implementers made beyond the plan

- **T1:**
  - A provider that `providers.md` lacks counts as kind `paid`.
  - In shared mode, an alias of a row that a role's own model replaced is dropped. It is not appended at the end.
  - A role model that is itself a row keeps that row.
  - In shared mode, `roleEntries` returns concrete refs, so the Role defaults picker shows a model there and not an alias.
  - Saving settings drops entries without `/`. An empty list keeps the old rows.
- **T2:** the last-resort tests are in `tests/scheduler.test.ts`, which has the blocked-provider setup, and not in `blockers.test.ts`.
- **T4:** the tests are in `tests/followup.test.ts`, one pipeline test for all three reviews.
- **T6:** the "note asks for more length" log line is written only when the chapter was over the tighten threshold.
- **T8:** `yarn vitest run tests/recovery.test.ts` no longer finds the test. Use `yarn test:recovery`.

### Verification (combined branch, after the cherry-picks)

| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn lint` | clean |
| `yarn test` | 38 files, 523 tests passed, then recovery 1/1 passed |
| `yarn test:ui` | 5 passed |
| `yarn test:electron` (T9) | 1 passed (8.7 s; build included) |

- **T8 timing.** `yarn test` was run three times in the worktree: about 40 s for the main suite plus 7 to 8 s for recovery, all green.
- **Flaky UI spec.** During T2, `yarn test:ui` failed once at `office.spec.ts:18` and passed 5/5 on a re-run. T2 has no renderer change, and the combined run passed. The cause was not found.
- **Not run:**
  - `yarn test:packaged`. It builds an installer and was not asked for.
  - No live check against the real data folder. The migration of `~/Scriptorium/config/settings.md` happens at the next engine start.

### Follow-ups

- **Antigravity models:** a decision with no work; they go through the ACP proxy (hub HUB-09). It stays in `ROADMAP.md`.
- **First start after merge:** check the migrated `~/Scriptorium/config/settings.md`, and that the Models panel shows the three rows.

### Commit status

Committed on `SCP-19_roadmap-tasks`. Not pushed, no PR.

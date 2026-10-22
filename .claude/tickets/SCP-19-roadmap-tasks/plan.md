# SCP-19: Roadmap tasks (Scriptorium)

Ticket folder: `.claude/tickets/SCP-19-roadmap-tasks/` (this plan, plus a `changelog.md` written at the end). One branch, `SCP-19_roadmap-tasks`, cut from `master` (15ba2c1, clean). **One commit per task**, named `SCP-19: <task id> <summary>` (for example `SCP-19: T1 fallbacks as an open list`). A task never shares a commit with another task. The plan itself and the closing docs go in their own commits (T0 and T10).

The source is `ROADMAP.md` (2026-10-22, master 46e5e8a). SCP-16, SCP-17 and SCP-18 are reserved by the creative hub (HUB-06, HUB-11, HUB-10), so this ticket is SCP-19. "Antigravity models" is a decision with no work (it goes through the ACP proxy, hub HUB-09) and stays in the roadmap as a note. Every other roadmap item becomes a task here, and T10 takes it out of `ROADMAP.md`.

## Ground rules for the implementer

- Read `CLAUDE.md` and the Decisions table in `docs/design.md` first. Each task that changes behaviour adds one Decisions row, dated 2026-10-22 or later, saying "(Ticket SCP-19, branch SCP-19_roadmap-tasks)", plus one History line. When it changes a behaviour that an earlier row describes, it says "Overrides <row> where it differs" and updates the matching body section.
- MCP changes go into `docs/mcp.md`. Seed config bodies (`seed/config/*.md`) document new or changed fields.
- Every new UI control gets a `data-testid`. The demo engine `src/renderer/demo/fake.ts` handles every new command or field the UI sends or reads.
- Tests use vitest with temp data folders (`tests/helpers.ts`). Never touch `~/Scriptorium`.
- **Never start the engine** against the real data folder: no `yarn engine`, `yarn headless`, `yarn dev` or app start. `yarn test:electron` is fine: it uses temp folders (`tests/renderer/app.electron.spec.ts`).
- Node comes only from fnm. Bash: `eval "$(fnm env --shell bash)"; fnm use 24.14.0`. PowerShell: `fnm env --use-on-cd | Out-String | Invoke-Expression`.
- A task that edits any file under `seed/prompts/` or `seed/templates/` runs `yarn seed:hashes` before it commits (a test enforces this).
- Before each commit: `yarn test` passes, plus `yarn typecheck`/`yarn lint` if the repo has them (check `package.json`). A task that touches the renderer also runs `yarn test:ui`.

## Tasks

| Task | Roadmap item | Size | Commit |
|---|---|---|---|
| T0 | (this plan) | - | `SCP-19: T0 plan` |
| T1 | Models: fallbacks as an open list | large | `SCP-19: T1 fallbacks as an open list` |
| T2 | `last_resort_model` is not built | medium | `SCP-19: T2 last resort model` |
| T3 | `story_year` is asked only in `outline.md` and `outline_vn.md` | small | `SCP-19: T3 story year in every outline` |
| T4 | `review_outline`, `act_review`, `thread_check` lack the revise follow-up | small | `SCP-19: T4 revise follow-up for outline, act and thread reviews` |
| T5 | The humanizer may rename places but never adds them to the bible | small | `SCP-19: T5 humanizer adds new places to the bible` |
| T6 | The tighten retry skips a rewrite made from owner notes | small | `SCP-19: T6 tighten owner-note rewrites` |
| T7 | `length_over` has no test of its own | small | `SCP-19: T7 length_over test` |
| T8 | The recovery test "kill the engine mid-job" is not isolated | small | `SCP-19: T8 recovery test runs on its own` |
| T9 | `yarn test:electron` was not run for SCP-14 | run (fixes if any) | `SCP-19: T9 electron tests` (only if something needed fixing) |
| T10 | Docs, changelog, roadmap | - | `SCP-19: T10 changelog and roadmap` |

### Order and parallel work

All tasks share one branch, so the orchestrator commits them one at a time, in table order. Work can still run in parallel where the files are disjoint, as long as each task's changes are committed on their own (stage only that task's files):

- **T1 then T2:** both edit `shared/schemas.ts` (settings), `store/migrations.ts`, `models/registry.ts`, `seed/config/settings.md`, `engine.ts`. T2 starts after T1 is committed.
- **T3, T4, T5, T6, T7, T8** are independent of T1/T2 and of each other, with two overlaps: T3 and T4 both may touch `pipeline/longHandlers.ts` only if T3 needs it (it should not), and T5 and T6 both edit `pipeline/handlers.ts` (T5 only moves `settlePlaces` out; T6 only changes the tighten condition). Run T5 before T6, or run them in one worker that commits twice.
- **T3 edits seed prompts and regenerates `src/engine/store/seedHistory.ts`.** No other task edits seed prompts. If T4 decides it needs a prompt change, it must run after T3 and re-run `yarn seed:hashes`.
- **T9** runs after T1 to T8 are committed (it tests the finished app). **T10** is last.

---

## T1. Fallbacks as an open list

### Today

- `config/settings.md` has three fixed default models: `default_paid_model`, `default_strata_model`, `default_lmstudio_model` (`src/shared/schemas.ts:224-226`), and `model_order: []` (`:228`), an order of the three groups `paid`, `strata`, `lmstudio`.
- The aliases `paid`, `strata`, `lmstudio` in `roles.md` (and in agent `model` fields and book `role_models`) resolve to those three (`models/registry.ts:111-117` `modelDefaultsOf`, `:455-458` `resolve`).
- With a non-empty `model_order`, each role's list is sorted by group, keeping the role's own order inside a group, a client model first (`registry.ts:461-478` `roleEntries`, `:481-486` `groupOf`, which hard-codes `strata` and `lmstudio`).
- UI: `src/renderer/ui/ModelsDialog.tsx:159-200, 236-251`. A checkbox "One fallback order for every role" (`order-shared`) and three fixed rows (`order-<group>`, `set-<key>`, `order-up-<group>`, `order-down-<group>`). `GROUPS` and `DEFAULT_ORDER` at `:22-45`.
- Engine: the settings command writes the four fields (`src/engine/engine.ts:1085-1088`), and the snapshot sends them (`:650-653`). Protocol: `SettingsSummary` (`src/shared/protocol.ts:245-266`, `ModelGroup`, `ModelSettingKey`). Demo: `src/renderer/demo/fake.ts:187`. Also `src/renderer/ui/AgentPanel.tsx:160, 192-193` (`RoleDefaults` text) and `src/renderer/ui/Settings.tsx:22-25` (blank settings).
- Docs: design.md rows "Default models" (line 79) and "Model change now, one fallback order" (line 87), the body bullet at line 207, and the bodies of `seed/config/settings.md` and `seed/config/roles.md`.

### Wanted (user, 2026-10-21)

A list of any length. Each row has a dropdown for its kind (API, Strata, LM Studio, client …) and then its model, with add, remove and up/down. Example: 1. API, 2. API, 3. LM Studio, 4. API. Strata and LM Studio stop being hard-coded groups. roles.md and the aliases get a matching format, and the existing three-row config migrates to it.

### Design (decided here; see Decisions 1 to 4 at the end)

**settings.md format.** Two fields replace the four:

```yaml
fallbacks:
  - deepseek/deepseek-flash
  - strata/qwen3.8-flash-next
  - lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic
fallback_shared: false
```

- `fallbacks`: an ordered list of `provider/model` refs, at least one. A row stores only its model. Its **kind** is derived from the model's provider, so a row can never disagree with its model:
  - a `kind: client` provider: the provider's id (`client`);
  - any other local provider: the provider's id (`strata`, `lmstudio`, `ollama`, …): no provider id is hard-coded;
  - a non-local provider: `paid` (shown as **API**; every API model, free or paid, as today).
- `fallback_shared`: `true` is "One fallback order for every role" (today's non-empty `model_order`).

**Aliases.** A kind name is an alias for the **first row of that kind**, and `<kind>-<n>` for its n-th row: `paid`, `paid-2`, `strata`, `lmstudio`, `lmstudio-2`, `client`. So every existing roles.md, agent `model` and book `role_models` keeps working unchanged: no roles.md migration is needed. An alias with no matching row resolves to nothing, and the model is skipped like any unknown ref (log it once per reload: `roles.md: "<alias>" names no row in the fallback list`).

**Shared order on.** Every role's chain is the list's rows, top to bottom, except that a role's own **concrete** model (not an alias) takes the place of the first not yet used row of the same kind. Then the role's remaining entries follow in its own order, and duplicates are dropped. A client model the role lists still goes first (unchanged rule, design row "Models per book"). Examples with rows `[paid deepseek, paid openrouter/x, lmstudio gemma, paid y]`:
  - editor `[strata, lmstudio, paid]` gets deepseek, x, gemma, y (then `strata` resolves only if a Strata row exists).
  - checker `[strata/qwen3.8-flash-next-low, lmstudio, paid]` gets deepseek, x, gemma, y, then `strata/…-low` (no Strata row: it goes last). With a Strata row, `-low` takes that row's place, as today.
  - humanizer `[deepseek/deepseek-flash, paid]` gets deepseek-flash (in the first API slot), x, gemma, y.

  With the same three rows and order as today, the result is the same as today's group sort for every seed role. One difference: a role now gets every row, including kinds its own list leaves out (the humanizer gains a local fallback). That is what "one order for every role" asks for; the humanizer's guards keep the original on a bad pass. Record this in the Decisions row.

**Shared order off.** Each role uses its roles.md list as today, with the aliases above.

**Migration** (`store/migrations.ts`, new `migrateFallbacks`, called from `store/dataFolder.ts:110-114` like the others; idempotent; one `migrated` line):
- A settings.md that has any of the four old keys and no `fallbacks`: `fallbacks` = the three default models in `model_order` order (groups left out of `model_order` appended in the order paid, strata, lmstudio; `model_order: []` gives paid, strata, lmstudio); `fallback_shared` = `model_order.length > 0`. Remove the four old keys. Keep the body text, but replace its "## Default models" section with the new seed text (only that section; keep anything else the user wrote).
- The schema keeps accepting the old keys (ignored) so a folder that is read before migration still loads. `settingsSchema` defaults: `fallbacks` = the three seed models, `fallback_shared: false`.

**Engine and protocol.**
- `ModelDefaults` (`registry.ts:103-117`): `fallbacks: string[]`, `shared: boolean` instead of `aliases` and `order`. `resolve(ref)` handles `<kind>` and `<kind>-<n>` against the rows using a new `kindOf(ref)` (replaces `groupOf`: client provider id, local provider id, or `paid`). `roleEntries(role)` implements the shared-order rule above (it returns resolved refs or aliases; keep `roleModelRefs` returning resolved refs). Check every caller of `groupOf` and `roleEntries` (grep) and the role-default pickers that show alias names.
- `SettingsSummary`: `fallbacks: string[]`, `fallbackShared: boolean` instead of `defaultPaidModel`, `defaultStrataModel`, `defaultLmstudioModel`, `modelOrder`. Drop `ModelGroup`; update `ModelSettingKey`. `ModelSummary` gets `kind: string` (from `kindOf`), so the UI does not guess kinds.
- The settings command (`engine.ts:1085-1088`) writes `fallbacks` (trimmed, deduped, refs must contain `/`, at least one row, otherwise keep the old list) and `fallback_shared`. The rest of that block (registry reload, `scheduler.changeModel()`, snapshot) stays: running jobs follow at once.
- MCP: grep `docs/mcp.md` and `src/engine/mcp/` for the old field names or aliases. If `factory_status` or a settings tool exposes them, switch to the new fields and document it.

**UI** (`ModelsDialog.tsx`; keep it the only place for this, per the UI decision row):
- Checkbox "One fallback order for every role" (`order-shared`, unchanged id) sets `fallbackShared`.
- One row per entry (`fallback-row-<i>`): its number when shared (as today), the alias it answers to (`paid`, `paid-2`, … in dim text), a kind select (`fallback-kind-<i>`: **API**, then each local provider by id, then each client provider; only kinds that have at least one ticked model, plus the row's current kind), a model select (`fallback-model-<i>`: ticked models of that kind; the current model is kept in the list even if unticked, as today), up (`fallback-up-<i>`), down (`fallback-down-<i>`) and remove (`fallback-remove-<i>`, disabled when it is the only row).
- An "Add" button (`fallback-add`) appends a row of kind API with the first ticked API model (or the first ticked model of any kind).
- Changing a row's kind picks the first ticked model of that kind. Every change saves at once (as today).
- Help text: shared on: "Every role tries these top to bottom… A role's own model of the same kind (Strata's -low for the checks) takes that row's place." Shared off: "Each role keeps the order of its list in roles.md. The rows set what paid, paid-2, strata, lmstudio … stand for."
- `AgentPanel.tsx` `RoleDefaults` text: adapt the sentence about groups. `Settings.tsx` blank settings: new fields. `fake.ts`: new fields, and the demo answers the settings command with them.

**Seed and docs.**
- `seed/config/settings.md`: the new fields and a rewritten "## Default models" section (the kinds, the aliases with `-n`, the shared-order rule, an example of four rows).
- `seed/config/roles.md` body: the alias paragraph and the `model_order` sentence follow the new names.
- design.md: new Decisions row "Fallbacks as an open list", overriding "Default models" and "Model change now, one fallback order" where they differ; update the body bullet at line 207 and the Model layer section; History line.

**Tests** (extend `tests/models.test.ts`, `tests/migrations.test.ts`, `tests/reload.test.ts` as fits):
- Aliases: `paid`, `paid-2`, `lmstudio` against a four-row list; an alias with no row is skipped.
- Shared order: the three examples above; with the old three rows the seed roles give today's chains.
- Migration: the seed-era settings with `model_order: []` and with `[paid, lmstudio, strata]`, an already migrated file left alone, the body section replaced and other text kept.
- The settings command saves rows and the flag, refuses an empty list.
- `tests/renderer/office.spec.ts` (or a new spec): add a row, change its kind, move it, remove it, toggle shared, against the demo engine.

---

## T2. `last_resort_model`

SCP-14 plan, decision 3: a `settings.md` field used only when every model of a role is down or used up for the day. It was left out because a `client` last resort makes the factory's own ideas wait for a Claude session. It is on the roadmap now, so build it, empty by default.

- `settingsSchema`: `last_resort_model: z.string().default('')` (a `provider/model` or an alias from T1). Seed `settings.md`: the field (empty) and a paragraph: when it is used, and that a client model here means jobs wait for a Claude Code session.
- `ModelDefaults` carries it; `ModelRegistry` exposes `lastResort(): ModelInfo | undefined` (resolved, available, has a client, not an embedding model).
- `Scheduler` (`src/engine/queue/scheduler.ts:330-365`): when no model was chosen and **every** candidate was skipped as unusable (down or day-full; not when one was only busy or rate-limited, and not when the budget skipped it), and the last resort exists, is usable, has capacity and is not one of the candidates, launch with `[lastResort]` and log `every model of <role> is unusable (<reasons>): using the last resort <ref>`. If it is busy, the job waits as now, with the last resort's reason added. A paid last resort still goes through the budget check.
- `ModelRouter.candidates` is unchanged (the scheduler owns this choice), so `chat` falls back only within `[lastResort]`.
- `factory_status`: if it lists `blocked`, add `lastResort` (the ref or null). Document in `docs/mcp.md`.
- No UI control (CLAUDE.md: settings that are not in the UI decision row go in config files).
- Tests (`tests/blockers.test.ts` has the blocked-provider setup): all candidates down and a last resort set: the job runs on it; one candidate only busy: the job waits; last resort empty: the job waits as today; last resort also down: waits, reason lists it.
- design.md Decisions row, overriding the SCP-14 blocked-providers row where it differs; History line.

## T3. `story_year` in every outline prompt

Only `seed/prompts/architect/outline.md` (:24, :27) and `outline_vn.md` ask for it. `outline_nf.md` and `outline_article.md` do not. The `outline` handler already reads `story_year` for every variant (`pipeline/handlers.ts:567, 643-644`).

- Add the sentence and the JSON field to `outline_nf.md` ("the year the book's events are set in, or null when it covers many years") and `outline_article.md` ("the year the article is about, normally the current year, or null"). Keep each prompt's wording style.
- An older data folder whose edited outline prompt lacks `"story_year"`: add the engine's own one-line rule, as `ensureProblemsRule` does (`pipeline/reviewNotes.ts:114-116`). Put a small `ensureStoryYearRule` next to the outline handler and call it for every variant.
- `yarn seed:hashes`.
- Tests: an nf or article outline answer with `story_year` sets it in book.md; a prompt without the field gets the rule appended.

## T4. Revise follow-up for outline, act and thread reviews

`withUsableNotes` (`pipeline/reviewNotes.ts:133`) is used by the chapter reviews and `check_chapter` (`pipeline/longHandlers.ts:98-105`), not by `review_outline` (`longHandlers.ts:40-72`, `chatJson` at :60), `act_review` (`longHandlers.ts:~222-280`, `chatJson` at ~:263) and `thread_check` (`longHandlers.ts:~296-355`, `chatJson` at ~:328).

- Wrap each of the three `chatJson` calls the way `check_chapter` does: `effective` uses each handler's own pass rule (`review_outline`: revise with structure score ≥ `revise_below` is a pass; `act_review`: its verdict as written; `thread_check`: the same score rule as at ~:331), `notes`, `problems`, `retryLeft` from attempts, `maxTokens: 6000`.
- No prompt change (`problems` is already in these prompts, and `ensureProblemsRule` covers old ones).
- Tests in `tests/followup.test.ts`: for each of the three, a revise with "three fixes below" and no list is asked again, and the second answer's problems land in the review file.

## T5. The humanizer adds new places to the bible

The humanizer's script branch (`pipeline/humanizerHandlers.ts:300-306`) renames `SCENE:` places to the bible's names but ignores `canon.unknown`. The writer's `settlePlaces` (`pipeline/handlers.ts:307-320`) adds unknown places to the light bible.

- Move `settlePlaces` into `pipeline/scriptPlaces.ts` as an exported `settleScenePlaces(d, slug, n, body, log)` (it needs `d.books.bible`, `d.books.file`, `writeMd`). `handlers.ts` calls it; behaviour unchanged.
- The humanizer calls it instead of its own `canonicalScenes` block. It reads the light bible itself (`d.books.bible(slug)`), not the `bible` text it builds for the prompt, and does nothing for a structured bible (as the writer).
- Log lines say `humanizer:` as now.
- Test in `tests/humanizer.test.ts` (or `tests/script.test.ts`): a humanized script with a new `SCENE:` place adds it to `bible.md` under `## Places` with the chapter number.

## T6. Tighten owner-note rewrites

`handlers.ts:1007-1014`: `if (!isLength && !isNote)` skips the tighten retry for a rewrite from an owner note ("a note of the owner is their choice"). The roadmap lists this as a gap: a note about one scene can still produce a chapter far over its share.

- Decision 5: tighten a note rewrite too, unless the note itself asks for more length. A note asks for length when it matches `/\b(longer|expand|lengthen|more (detail|words|scenes?)|add (a|an|another|more)\b|flesh out)/i`. Put the test in a small exported function (`noteWantsLength(note)`) next to `tighten`, with unit tests.
- Log when a note rewrite is not tightened because of its wording.
- Update the comment at :1007. Test in `tests/lengths.test.ts` or `tests/rewrites.test.ts`: a note rewrite at 1.5× its share gets the tighten request; a note "make this chapter longer" does not.
- design.md: a one-line addition to the SCP-14 word-target row is not allowed (rows are history), so add a short Decisions row; History line.

## T7. `length_over` test

`length_over: true` is written at publish when the book is over the format's ceiling (`handlers.ts:1140-1144`) and summarised as `lengthOver` (`src/engine/summary.ts:125`). No test covers it.

- Add to `tests/lengths.test.ts`: a book whose chapters total more than the format's ceiling is published with `length_over: true` in book.md and `lengthOver: true` in its summary; a book under the ceiling has neither. Reuse the existing pipeline env helpers.
- Test only. No Decisions row.

## T8. The recovery test runs on its own

`tests/recovery.test.ts` spawns two engine processes with real timers, while vitest runs up to 8 workers (`vitest.config.ts`), so on a loaded machine it is the most likely to flake.

- `vitest.config.ts`: exclude `tests/recovery.test.ts` from the default run.
- `package.json`: `test:recovery` runs it alone (`vitest run tests/recovery.test.ts` with that file re-included, for example via a `--config` of its own or `--dir`; check what vitest 3 needs), and `test` runs the main suite then `test:recovery` (`vitest run && yarn test:recovery`, or the equivalent that works on Windows).
- Run `yarn test` three times in a row; all green. Note the timings in the changelog.
- No Decisions row; mention it in the changelog.

## T9. Run the Electron tests

- After T1 to T8 are committed: `yarn test:electron` (it builds first). It uses temp data and user folders.
- If it fails, fix the cause (most likely T1's Models dialog changes if the spec touches it) and commit as `SCP-19: T9 electron tests`. If it passes, no commit; record the result in the changelog.
- Do not run `yarn test:packaged` (it builds an installer; not asked for).

## T10. Changelog and roadmap

- `changelog.md` in this folder, in the SCP-14 format: commits table (task, hash, what) and what changed per roadmap item, test counts (`yarn test`, `yarn test:ui`, `yarn test:electron`).
- `ROADMAP.md`: remove the items done here; keep the Antigravity note; update "Where it stands" (date, master hash after merge is unknown, so say "branch SCP-19_roadmap-tasks"), and add SCP-19 to the list of finished work.
- Check that every Decisions row and History line added by T1 to T6 is present and dated, and that `docs/mcp.md` matches T1 and T2.

## Decisions taken in this plan

1. **Rows store only a model; the kind is derived from its provider** (client id, local provider id, or `paid` for API). No row can disagree with its model, and no provider id is hard-coded.
2. **Aliases are kinds: `paid`, `strata`, `lmstudio` (any local provider id), `client`, plus `<kind>-<n>`.** Existing roles.md, agent models and book `role_models` keep working without a migration.
3. **Shared order gives every role every row**, with a role's concrete model taking the first free row of its kind. Same result as today for the seed roles with the migrated list, except that roles whose list leaves a kind out (the humanizer) now get that kind's rows too.
4. **Migration** turns the four old settings keys into `fallbacks` + `fallback_shared` and keeps the old keys readable until it runs.
5. **Owner-note rewrites are tightened** unless the note asks for more length.
6. **`last_resort_model`** is empty by default, used only when every candidate is down or day-full, never when one is just busy, and has no UI control.

## Status (2026-10-22)

All tasks are done on `SCP-19_roadmap-tasks`. Commits: T0 df6e986, T1 f1f42f6, T2 8a2800b, T3 b88dac9, T4 927b9b5, T5 a2e5829, T6 38313dc, T7 18e45dd, T8 3f83329. T9 has no commit (`yarn test:electron` passed). T10 is the changelog and roadmap commit.

- [x] T1 fallbacks as an open list
- [x] T2 last resort model
- [x] T3 story year in every outline
- [x] T4 revise follow-up for the outline, act and thread reviews
- [x] T5 humanizer adds new places to the bible
- [x] T6 tighten owner-note rewrites
- [x] T7 length_over test
- [x] T8 recovery test runs on its own
- [x] T9 electron tests (1 passed, nothing to fix)
- [x] T10 changelog and roadmap

Verification and deviations are in `changelog.md`.

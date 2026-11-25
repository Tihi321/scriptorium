---
status: done-uncommitted
branch: SCP-72_fewer-comparisons
updated: 2026-11-25
---

# SCP-72: fewer comparisons

Request, word for word: "make a bit less of comparisons in the books".

Reading (one line): the prose has too many similes ("like a ...", "as if", "as though"); fewer, not none. So a quota in the
prompts, not a ban and not a post-hoc filter.

## What changed

One rule, in the voice of each prompt, added to every writer prompt that writes prose and to the humanizers:

- Writer prompts (`seed/prompts/writer/`): `draft_chapter`, `rewrite_chapter` and their `_article`, `_nf`, `_pb`, `_vn`, `_fable` variants (12 files):
  `Use at most one simile ("like a ...", "as if", "as though") per about 400 words. Prefer plain, concrete description, and do not swap a cut simile for a metaphor.`
  (a bullet where the prompt has a rules list, otherwise its own paragraph.)
- Humanizers (`seed/prompts/humanizer/humanize_chapter`, `_article`, `_pb`, `_vn`): the existing "Cut the tics" bullet already named
  "similes that explain themselves" (and, in the base one, invited "a fresher one"), so no second rule: one sentence appended to that bullet:
  `Keep at most one simile ("like a ...", "as if", "as though") per about 400 words: cut the others to plain, concrete description, and do not turn a cut simile into a metaphor.`
- Not touched: `_sp` (cartoon screenplay: action lines, not prose), `research_*`, reviewers.

## How it reaches live data

No new migration. `yarn seed:hashes` regenerated `src/engine/store/seedHistory.ts` (the previous hash of each of the 16 prompts stays in the
history). At every start `migrateSeedPrompts` (called from `initDataFolder`) replaces a live prompt that is an unedited earlier seed version
with the current one, and leaves a prompt the owner edited. So the live copy updates on the next app start (not on a running app).

## Files

16 prompts under `seed/prompts/`, `src/engine/store/seedHistory.ts` (generated), `tests/migrations.test.ts` (one test), `ROADMAP.md`,
this folder.

## Verification

`yarn typecheck` exit 0; `yarn lint` exit 0; `yarn test`: 59 files / 769 tests pass, plus `test:recovery` 1 file / 1 test. Not run: a real
book written with the new prompts (UNTESTED: whether the models obey the quota), the live data folder (not touched).

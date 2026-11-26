---
status: done-uncommitted
branch: SCP-73_simile-counter
updated: 2026-11-26
---

# SCP-73: simile counter

Request, word for word: "simple counter".

Reading: SCP-72 put "at most one simile per about 400 words" in the prompts; a mechanical counter, like the em-dash one, tells the humanizer which chapters broke it.

## Design

- The em-dash counter is a row in `TELLS` in `src/engine/pipeline/humanizerHandlers.ts`; `aiTells(text)` feeds `ticReport`, which fills the `{tics}` fix list of the humanizer prompt. The simile counter sits in the same `aiTells`, so it is reported wherever the em dashes are.
- `SIMILE`: "like a/an/the/some", "as if", "as though". "would/do/did/might/... like a", "I/we/you/they like the", "to like", "'d like" and "like to", "likely", "unlike" are not matched.
- A chapter is reported when its count is above `max(1, words / 400)` (a short chapter may have one). The label carries the rate per 400 words; the text gives up to three examples.
- Screenplay formats: `aiTells`/`ticReport` have no format concept, so both take `{ similes?: boolean }` (default on); the handler passes `similes: !fmt.screenplay`.

## Files

`src/engine/pipeline/humanizerHandlers.ts`, `tests/humanizer.test.ts` (one test), `docs/design.md` (humanizer row, dated line), `ROADMAP.md`.

## Verification

`yarn typecheck`, `yarn lint`, `yarn test`. Not run: a live humanizer pass.

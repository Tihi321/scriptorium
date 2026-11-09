# Changelog SCP-57

## 2026-11-09 SCP-57: humanizer group nouns (REQ-0006 A2)

Outcome: built on branch `SCP-57_humanizer-group-nouns` (from master 86d3c47). Not pushed.

- src/engine/pipeline/humanizerHandlers.ts: `groupNounInContext` is a loop, at most 8 joined words back and only the last 120 characters scanned per step. After a joiner or "of" only a telling ending (-ians, -ists, -ites, -ics, -eans) or a listed group noun counts, so "Evans" is a name there. `GROUP_ADJECTIVES` has the `i` flag. Added romans, spartans, trojans, germans, persians to `GROUP_NOUNS` (they end in -ans).
- tests/humanizerGuards.test.ts: three tests (400 joined items under 100 ms; names after joiner and "of"; "Early Christians").

Results: `yarn vitest run` 58 files, 736 tests pass (was 733 + 3 new; the three new fail on the old code); recovery config 1 test pass; `yarn typecheck` clean; `yarn lint` clean.

## 2026-11-09 SCP-57 polish round 1 (REQ-0006 checker)

- src/engine/pipeline/humanizerHandlers.ts: after a joiner or "of" an "-ans" word that is not "-eans"/"-ians" now counts as a group noun when it is at least 7 letters (`MIN_LONG_ANS`; Anglicans, Americans, Puritans, Etruscans pass, "Evans" with 5 letters stays a name). `MAX_CHAIN` 8 to 64 so an 11-item list is not cut. The MAX_CHAIN/TAIL doc comment now sits above the constants.
- tests/humanizerGuards.test.ts: one table-driven accept test (the ten phrases the checker listed); the refuse tests stay.
- docs/design.md: new Decisions row "Humanizer group nouns, round 2 (SCP-57)" and a History line.
- Not done: the case-insensitive adjective unlocking "the Fellow Evans" (not a one-line fix).

## 2026-11-10 SCP-57 polish round 2 (REQ-0006 checker)

- src/engine/pipeline/humanizerHandlers.ts: each read-back step now cuts the full text (`text.slice(0, text.length - tail.length + m.index)`) instead of the previous 120-character tail, so `MAX_CHAIN` (64 words) is the real bound on a list and the 120 characters only limit where the next joiner/context word is searched. Lists of 12 schools and of 15 to 60 repeated "the Stoics, ... and Epicureans" now pass. Added cubans, mayans, incans, oscans to `GROUP_NOUNS`. Comments updated.
- docs/design.md: SCP-57 Decisions row says "up to 64 words, however long" and lists the new demonyms.
- tests/humanizerGuards.test.ts: six rows added to the existing accept table (12-school list, 20x "the Stoics, " list, Mexicans and Cubans, Romans and Mayans, fate of Cubans, Romans and Oscans). "the Stoics and Evans" and "the friend of Evans" stay refused.
- Timing: 400 joined items about 5 ms, 2000 items about 12 ms (more than 64 words is refused by design).

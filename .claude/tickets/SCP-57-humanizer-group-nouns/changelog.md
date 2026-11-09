# Changelog SCP-57

## 2026-11-09 SCP-57: humanizer group nouns (REQ-0006 A2)

Outcome: built on branch `SCP-57_humanizer-group-nouns` (from master 86d3c47). Not pushed.

- src/engine/pipeline/humanizerHandlers.ts: `groupNounInContext` is a loop, at most 8 joined words back and only the last 120 characters scanned per step. After a joiner or "of" only a telling ending (-ians, -ists, -ites, -ics, -eans) or a listed group noun counts, so "Evans" is a name there. `GROUP_ADJECTIVES` has the `i` flag. Added romans, spartans, trojans, germans, persians to `GROUP_NOUNS` (they end in -ans).
- tests/humanizerGuards.test.ts: three tests (400 joined items under 100 ms; names after joiner and "of"; "Early Christians").

Results: `yarn vitest run` 58 files, 736 tests pass (was 733 + 3 new; the three new fail on the old code); recovery config 1 test pass; `yarn typecheck` clean; `yarn lint` clean.

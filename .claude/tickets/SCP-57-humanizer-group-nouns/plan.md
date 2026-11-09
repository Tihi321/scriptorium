---
status: in-progress
request: REQ-0006
repos: [scriptorium]
branch: SCP-57_humanizer-group-nouns
updated: 2026-11-09
---

# SCP-57: humanizer group nouns

Extracted from `.claude/tickets/REQ-0006-destiny-hr-translation/plan.md`, task A2. Input: `.claude/tickets/SCP-56-req0004-fixes/discoveries.md` items 1-3. Branch from master 86d3c47.

## Output

- Chain scan bounded so 400 joined items take under 100 ms.
- A capitalised name after a joiner or "of" is not accepted ("the Stoics and Evans", "the friend of Evans" refused).
- `GROUP_ADJECTIVES` matches case-insensitively ("Early Christians" accepted).
- One test per rule, in the existing `tests/humanizerGuards.test.ts`.

## Files

`src/engine/pipeline/humanizerHandlers.ts` (`groupNounInContext`), `tests/humanizerGuards.test.ts`.

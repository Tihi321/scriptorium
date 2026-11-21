# Revert: temporary changes for REQ-0004 P2 (Destiny Decides series)

## 1. No-paid guard
File: C:\Users\Infplane\Scriptorium\config\budget.md (frontmatter)
Why: a cap of 0 refuses every paid request (see REQ-0002 config-revert.md).

Before:
monthly_cap_usd: 40
daily_cap_usd: 20

After:
monthly_cap_usd: 0
daily_cap_usd: 0

Undo: set them back to 40 and 20.

## 2. Factory paused while the series and stories are added
File: C:\Users\Infplane\Scriptorium\config\factory.md (frontmatter)
Why: 7 other open ideas exist; the engine must not start them before --only / set_factory_only is in place.

Before: paused: false
After:  paused: true
Undo: paused: false (and remove any `only:` line set by set_factory_only).

## 3. Factory restricted to one idea at a time
File: C:\Users\Infplane\Scriptorium\config\factory.md (frontmatter), written by MCP set_factory_only
Before: no `only:` line
After:  only: what-fate-decides-luck-will (later the-tide-table)
Undo: set_factory_only {idea: null} (removes the line).
Note: factory was unpaused via MCP set_factory_paused after `only` was set, so item 2 is already back to paused: false.

## 4. LM Studio server started and nomic embeddings loaded (not a config change)
Before: LM Studio server not running, no model loaded.
After: server on :1234, text-embedding-nomic-embed-text-v1.5 loaded (the machine's normal state per CLAUDE.md). Left running.

## 5. Hand edit to a book chapter (content, not config; not reverted)
File: C:\Users\Infplane\Scriptorium\books\what-fate-decides-luck-will-and-the-life\chapters\ch-01.md (before publish)
Why: the humanizer refused its version of ch1 ("Greeks" counted as a new name), leaving a wrong last line ("where the word began, with three old women") and an awkward sentence.
Changed: last line -> "We begin with the Greeks, and with three sisters at a spindle."; "The place he worked for is lost to a family emergency." -> "The college place he worked for slips away when his family needs him at home."
Original kept at C:\projects\Personal\scriptorium\.claude\temp\req0004-ch-01.orig.md.

## Reverts done 2026-11-09
- Engine (headless, PID 16920) stopped first, so nothing ran unrestricted.
- budget.md: caps back to 40 / 20.
- factory.md: `only: the-tide-table` line removed; paused: false (as before).
- LM Studio server and nomic model left running (normal machine state).

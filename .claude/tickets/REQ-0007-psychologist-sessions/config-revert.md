# Revert: temporary changes for REQ-0007 T3 (Fifty Minutes of Common Sense run)

Recorded 2026-11-11 before each change was made.

## 1. No-paid guard
File: C:\Users\Infplane\Scriptorium\config\budget.md (frontmatter)
Why: a cap of 0 refuses every paid request (src/engine/budget/spend.ts; REQ-0002 config-revert.md), so nothing in the run can spend money, and paid search (tavily) stays out.

Before:
monthly_cap_usd: 40
daily_cap_usd: 20

After:
monthly_cap_usd: 0
daily_cap_usd: 0

Undo: set them back to 40 and 20.

- [x] reverted 2026-11-11 14:24 (engine pid 38576 stopped first; caps back to 40 / 20)

## 2. Not changed (for the record)
- roles.md: not edited; the pins are the brief's `role_models`.
- factory.md: not edited; the engine runs with `--only fifty-minutes-of-common-sense`.

## 3. Services started for the run (not config)
- ACP proxy (`C:/projects/Personal/api-acp-proxy/release/win-unpacked/ACP Proxy.exe`): was DOWN at preflight; started by T3 (pid 39660).
- LM Studio: server was DOWN at preflight; started by T3 (`lms server start`, port 1234) and `text-embedding-nomic-embed-text-v1.5` loaded (nothing else loaded).
- Strata: down, not started (as planned).

## 4. Not config, recorded for the run
- `set_book_model` on the book (book.md `role_models`, this book only): developmental-editor, line-editor, copy-editor, beta-reader, originality-checker and continuity-checker moved from acp/antigravity/gemini-3.8-flash to client/claude-code after Gemini failed the review JSON (see run-log.md). It stays on this published book only; nothing to revert in config.

## Reverts done 2026-11-11
- [x] Engine (headless, pid 38576) stopped first; no `out/engine/index.js` process left; the dead `index/engine.lock` deleted; MCP port 7341 closed.
- [x] budget.md caps 40 / 20.
- [x] factory.md unchanged (`paused: false`, no `only:` line).
- ACP proxy (pid 39660) and LM Studio (server + nomic) were started by T3 and are left running.

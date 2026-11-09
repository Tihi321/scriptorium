# Revert: temporary no-paid guard (user: "no need for paid")

File: C:\Users\Infplane\Scriptorium\config\budget.md (frontmatter)
Why it works: src/engine/budget/spend.ts check(): a cap of 0 refuses every paid request (day >= 0 / day + est > 0); scheduler.ts:350 skips paid models when isExhausted. 0 = no spend, not unlimited.

Before:
monthly_cap_usd: 40
daily_cap_usd: 20

After:
monthly_cap_usd: 0
daily_cap_usd: 0

Undo: set them back to 40 and 20.
Reverted 2026-11-08: caps back to 40/20.

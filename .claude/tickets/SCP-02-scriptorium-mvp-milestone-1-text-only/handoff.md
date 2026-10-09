# Handoff: SCP-02 Scriptorium MVP (milestone 1, text only)

Updated 2026-10-09. **The implementation is finished.** What is left is manual verification on this machine, plus a commit if the user wants one.

## Where things are

- **Repo:** `C:\projects\Personal\scriptorium`, branch `SCP-02_mvp-text-only` (from `master` db376ec).
- **Commits:** the user's commit `602485a`, pushed to `origin/SCP-02_mvp-text-only`, holds the work up to the Phase 8 checkpoint. Everything since (the Phase 8 gate fixes, Phase 9 and the docs) is **uncommitted**; [changelog.md](changelog.md) has the exact list. Don't commit unless the user asks.
- **Files in this folder:**
  - [plan.md](plan.md): Phases 0-9 are ticked, with evidence for each. Phase 10 is unticked on purpose (see below).
  - [changelog.md](changelog.md): files, behaviour, deviations, checks run versus not run, and follow-ups.
  - [protocol-notes.md](protocol-notes.md): the engine/UI contract, env vars, book stages and files.
  - [spike-sqlite.md](spike-sqlite.md)
  - `checkpoint-p6p7.md`, `checkpoint-p8.md`: hand-overs between agents (history only).

## Checks on the final code (2026-10-09)

All passed:
- typecheck, lint
- vitest 212/212
- build
- Playwright 2/2, `test:electron` 1/1, `test:packaged` 2/2
- `npm run dist`, which built `dist/Scriptorium-Setup-0.0.1.exe`

Real books were made on local LM Studio models at 0 USD:
- a bedtime story
- a novella
- a researched historical short story
- a short non-fiction book with references

## What is not verified (the open Phase 10 gate and the rest)

1. Running the installer and then the installed app from the tray overnight, with a reboot mid-book. The engine should resume from the job files.
2. Any cloud model. To try one:
   - `npm run key:set DEEPSEEK_API_KEY`
   - run one bedtime story
   - compare the `logs/spend/` rows with the DeepSeek dashboard
   - check that the caps stop paid work
3. Tavily (needs a key), a real Kindle email, epubcheck (needs Java), and a 60k+ word novel.
4. Start with Windows; code signing (none yet).

## How to run

- Node is only available through fnm. In PowerShell, run `fnm env --use-on-cd | Out-String | Invoke-Expression` first.
- `npm run dev` opens the app. `npm run engine -- --data <dir>` runs the engine headless.
- The data folder defaults to `~/Scriptorium`. An existing folder keeps its old `templates/cover.html`; copy it from `seed/templates/` to get the new covers.
- LM Studio models must be loaded with a 32k context: `~\.lmstudio\bin\lms.exe load <model> -c 32768 --parallel 1`. The default of 8192 breaks chapter checks.
- Real-run scripts from this ticket are in `.claude/temp/run-p7-real.ts` and `.claude/temp/run-p8-real.ts`, which are not in the repo.

## Known limitations

- Local-model prose is flat (prose scores about 6).
- The fact-checker's verdicts are noisy between rounds.
- Research notes are model summaries of Wikipedia and can be slightly off.
- There's no `ask_researcher` tool; writers use `[RESEARCH: …]` markers.
- Full list: [changelog.md](changelog.md) → Follow-ups.

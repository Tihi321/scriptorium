# Handoff: SCP-02 Scriptorium MVP (milestone 1, text only)

Updated 2026-10-08, end of day. Resume tomorrow from here.

## Where things are

- Repo `C:\projects\Personal\scriptorium`, branch `SCP-02_mvp-text-only` (from `master` db376ec). **Nothing is committed.** Everything is in the working tree. Don't commit unless the user asks.
- Plan (authoritative): `plan.md` in this folder. Phases 0-7 are ticked with evidence. 8, 9 and 10 are unticked.
- Work is run through the global `implement` skill. Opus orchestrates, and `implementer` subagents run on Sonnet. Give each phase a **fresh** agent with a short brief; agent contexts grow huge after one phase.
- Other notes in this folder:
  - `protocol-notes.md`: the engine/UI contract, env vars and book stages.
  - `spike-sqlite.md`: the result of the sqlite-vec spike.
  - `checkpoint-p6p7.md`: the Phase 6 follow-ups and Phase 7 hand-over.
  - `checkpoint-p8.md`: Phase 8 state when the agent was stopped for the day. **Read this first.**

## Phase status

| Phase | State |
|---|---|
| 0-6 | Done. Real runs: a local bedtime story (`.claude/temp/p3-toddler-5/`, score 8.63) and a local novella of 13.5k words (`.claude/temp/p6-novella-3/`, score 7.13). Phase 6 follow-up fixes done: flaky tests, targeted rewrites, expand retry, bible slugs, thread closing, flat stretches |
| 7 Researcher | Done. Checks passed: 176/176 tests ×10, build, Playwright 2/2, Electron 1/1. Real Wikipedia-only run published *The Apprentice of Pudding Lane* (`.claude/temp/p7-real/`, score 7.5, 0 USD), with notes that cite Wikipedia in all four draft jobs |
| 8 Topics + non-fiction | **Code done, gate not closed.** See `checkpoint-p8.md`. Done and mock-tested: 12 new topic rows, the topics overview UI, and the non-fiction variant (research per chapter, fact base, fact-checker that must pass, references chapter in the EPUB and reader). Typecheck, lint, build, Playwright 2/2 and Electron 1/1 pass. Vitest: 186 green in 2 of 3 runs. The third run failed one timing test in `scheduler.test.ts` while a real run loaded the machine, so it needs 5 clean runs on an idle machine. Still to do: the real non-fiction run (stopped after about 12 minutes; data in `.claude/temp/p8-real/`), the plan ticks, and the design.md History and README status |
| 9 Simple images | Not started. Cover pattern from a title hash, chapter ornaments as SVG. Skip if it's more than about a day of work |
| 10 Packaging | Mostly done, but not recorded in the plan. `npm run dist` builds `dist/Scriptorium-Setup-0.0.1.exe` (NSIS, `asar: false`). `npm run test:packaged` passed 2/2. Unverified: the NSIS install, start with Windows, overnight running, resume after a reboot |

## Next steps (tomorrow)

1. Read `checkpoint-p8.md`. Run `npm run typecheck`, `npm run lint` and `npx vitest run` to see the current state.
2. Start a fresh `implementer` (Sonnet) to finish Phase 8 from the checkpoint. Phase 8 covers:
   - the topics panel with tick boxes, sorted emptiest first
   - the non-fiction variant: research required per chapter, `factbase/`, a fact-checker that must pass, and a references section in the EPUB
   - a mock e2e test
   - a real short non-fiction run on local models with Wikipedia research, using `.claude/temp/run-p8-real.ts` (modelled on `.claude/temp/run-p7-real.ts`)
3. Start a fresh agent for Phase 9.
4. Orchestrator wrap-up:
   - Record Phase 10 in the plan.
   - Update `docs/design.md` (History, Decisions), `README.md` and `.claude/tickets/scriptorium-mvp/handoff.md`.
   - Write `changelog.md` in this folder, as the implement skill requires: date, files, deviations, checks run versus not run, follow-ups, commit status.
   - Hand off to the user.

## Environment reminders

- Node is only available through fnm. In PowerShell, run `fnm env --use-on-cd | Out-String | Invoke-Expression` first.
- LM Studio models must be loaded with a 32k context: `~\.lmstudio\bin\lms.exe load <model> -c 32768 --parallel 1`. The default of 8192 breaks chapter checks.
- There is no DeepSeek or Tavily key and no Java, so epubcheck can't run. Real runs are local-only and cost 0 USD.
- Temp files go in `.claude/temp/`. API keys never go in files.

## Known deviations and gaps (for the changelog)

- No `ask_researcher` tool: the model clients have no tool calling, so only `[RESEARCH: ...]` markers work.
- The expand retry applies to long formats only. Research failures never fail a book. Short books rewrite every chapter when a revise doesn't name chapters.
- Wikipedia is weak for specific facts. Research notes are model summaries and can be slightly off.
- After publishing, the P7 run started a second book, `the-glassmaker-s-debt`. This is probably normal factory behaviour, but it hasn't been checked.
- Not verified: DeepSeek or any cloud model, Tavily, a real Kindle email, novels of 60k+ words, overnight running and resume after a reboot, the NSIS install, code signing.

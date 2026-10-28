# SCP-48 changelog

2026-10-27: single-idea run (`only`). Branch SCP-48_single-idea-run.

- schemas.ts: `only` in factory.md. engine.ts: `onlyOverride`, `onlyIdea()`, `jobInScope()`, `setOnly()`. scheduler.ts: `inScope` dep, out-of-scope jobs stay queued. pipeline.ts: with `only`, tick advances only that idea's books, no idea generator, startBooks offers that idea only (no topics). index.ts: `--only <slug>`. mcp/tools.ts: `set_factory_only`, `factory_status.only`. docs/mcp.md, ROADMAP.md.
- Tests: tests/singleIdea.test.ts (4), mcp tool list. Typecheck ok; 706 tests (1 timing flake per full run, different test each, all pass alone), recovery 1, build ok. Lint errors only in untracked release/ output.
- Not run: UI specs, live run (see hub runs/hub09-acp-load-test.md).

## 2026-10-27, checker fixes

- startBooks and the start_book handler in `only` mode count only that idea's pending start jobs and open books (`countInProgress(books, onlyIdea)`), so other ideas' start jobs and open books no longer block it; handler also offers only that idea and no topics.
- `Engine.checkOnly()` warns (log + `engine.warning`) when the idea is missing; `--only` with a missing idea releases the lock and exits 1.
- Tests added: other idea's start job, other open books, setOnly persists/read back/clears, checkOnly warning (8 in tests/singleIdea.test.ts).

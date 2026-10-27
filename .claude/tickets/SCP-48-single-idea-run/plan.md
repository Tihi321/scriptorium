# SCP-48 single-idea run

Goal: run the factory for exactly one idea (story) while other ideas stay open. Default unchanged.

## Design
- `only: <idea slug>` in `config/factory.md` (optional string, default none). Also `--only <slug>` on the engine command line (in-memory override, wins over the file, never written), and MCP `set_factory_only {idea | null}` writes the file.
- `Engine.jobInScope(job)`: no `only` -> true; job.idea === only -> true; job.book whose book.md `idea` === only -> true; else false (generate_ideas, other books, topic starts).
- Scheduler: new dep `inScope?(job)`; queued jobs out of scope are skipped (stay queued).
- Pipeline: with `only` set, `tick` advances only that idea's books, `fillIdeas` does nothing, `startBooks` offers only the idea (no topics).

## Files
src/shared/schemas.ts, src/engine/engine.ts, src/engine/queue/scheduler.ts, src/engine/pipeline/pipeline.ts, src/engine/index.ts, src/engine/mcp/tools.ts, docs/mcp.md, ROADMAP.md, tests/singleIdea.test.ts.

## Verify
yarn typecheck, yarn test, yarn build; tests: other ideas' jobs and book jobs not picked, default unchanged, pipeline starts only the chosen idea.

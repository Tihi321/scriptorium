# SCP-09 Series in Scriptorium + book 1 of a Broken Sword-style mystery series

## Context

The user wants a book in the style of Broken Sword:
- a man and a woman, both amateur detectives, who banter;
- a powerful secret society that believes in an invented deity, with its own dogma and a strange curse;
- the society plans something bad, and the couple works it out clue by clue, with humour.

It is a medium-size book and the first entry of a series. The user wants to watch Scriptorium in its window, not headless.

Scriptorium today only knows topics (genre buckets with a target count) and ideas/stories (one brief, one book). Nothing links books together. `docs/design.md:578,669` lists "series and shared worlds" under "Later". So before writing, we add **series** to Scriptorium: books that continue each other, with shared characters and canon, so later books can carry on from earlier ones.

Decisions made with the user:
- Claude writes. Claude takes the editor-in-chief, architect and writer tasks through the `client` provider. Scriptorium's own reviewers judge the book (small spend, like the-local-patch at about $0.2).
- Setting: present-day Europe, starting in Paris.
- Leads and names: invented by Claude.

Implementation goes through the global `implement` skill with this plan. On start, copy this plan to `C:\projects\Personal\scriptorium\.claude\tickets\SCP-09-series\plan.md`.

## Part A: Series in Scriptorium (repo `C:\projects\Personal\scriptorium`, branch `SCP-09_series` from `master`)

### A1. Data
- New file per series: `~/Scriptorium/series/<slug>.md`, editable by hand like every other file.
  - Frontmatter: `kind: series, title, genre, format, books: [<book slugs in order>], created`.
  - Body: `## Premise` (the series arc), `## Characters` (recurring cast, using the same `### Name` / `Role:` grammar as briefs), `## Setting`, `## Style`, plus any `##` section.
  - Reuse `parseBrief`/`renderBrief` (`src/shared/brief.ts`) for the body.
- New store `src/engine/store/series.ts`, modelled on `store/ideas.ts`, with a zod `seriesSchema` in `src/shared/schemas.ts`. Add `series/` to the data folder layout (`store/dataFolder.ts:6-21`).
- An idea and a book get `series: <slug>` and `series_index: <n>` (`ideaSchema` `schemas.ts:249`, `bookSchema` `:268`). `start_book` (`pipeline/handlers.ts:237-313`) copies them into `book.md` and appends the book slug to the series' `books`.

### A2. Order gate
- `pickNext` (`handlers.ts:94-109`) skips a series idea while an earlier book in the same series is not yet published, so book 2 never starts before book 1 is done. Book 1 is not affected.

### A3. Continuity: give later books the earlier ones
- New `seriesSection(d, slug)` next to `storyBriefSection` (`handlers.ts:943`). It is appended in the same places: pitch, outline, draft, rewrite and outline review. It holds:
  - the series premise, recurring cast, setting and style;
  - for each earlier book in order: the title, the blurb, the act and chapter summaries, the end state of each recurring character from that book's bible, and the threads it left open.
- Outline of book N>1: copy the earlier books' bible entries for the recurring characters and places into the new bible. This works like `withBriefCharacters` (`handlers.ts:952`). The archivist then grows the copied entries.
- Long-book draft context (`memory/context.ts:83-142`): add the series passages to the RAG search through `index.search({books: [...seriesBooks]})` (`memory/index.ts:168`, which already takes `books`).
- Reviewers (continuity-checker especially) get the series section too, so a contradiction of book 1 counts against book 2.
- Book 1 gets the series premise and cast only, which also helps it set up the series.

### A4. MCP (`src/engine/mcp/tools.ts`, `docs/mcp.md`)
- New tools:
  - `list_series`
  - `get_series {series}`: the file plus its books, with stage and score.
  - `add_series {title, premise, characters, setting, style, genre, format}`
  - `update_series {series, ...}`
- `add_story` / `update_story` take `series`. `series_index` is set automatically to the next free number.
- Update the tool list in `tests/mcp.test.ts:73`.

### A5. UI (React, `src/renderer`)
- Protocol (`src/shared/protocol.ts`):
  - commands `addSeries` and `updateSeries`;
  - event `series.updated`;
  - `SeriesSummary` in the snapshot;
  - the command list `COMMAND_TYPE_SET`.
- The engine handles them in `handleCommand` (`engine.ts:740`) and adds them to the snapshot (`:1009`). The store reducer is `store.ts:190`.
- New `ui/Series.tsx` in the Library view next to Topics (`ui/Library.tsx:86`):
  - a list of series, each with its books in order (stage, score);
  - a "New series" form (title, genre, format, premise, recurring characters, setting, style);
  - a "Next book" button that opens the story form with the series selected.
- `ui/StoryForm.tsx`: add a Series select next to Topic.
- Follow the existing classes (`card`, `row`, `stack`) and put a `data-testid` on every control.
- Demo engine: `renderer/demo/fake.ts` handles the new commands.

### A6. Docs and tests
- `docs/design.md`:
  - a Decisions row for Series;
  - add Series to the UI row's list of allowed controls;
  - add `series/` to the folder layout;
  - move "series" out of Later;
  - a History entry.
- Vitest:
  - series store round trip;
  - `pickNext` gate;
  - `seriesSection` in the pitch, outline and draft prompts, and bible carry-over (extend `tests/story.test.ts` and `tests/novel.test.ts`);
  - the MCP tools.
- Playwright renderer spec: create a series and add a next book.
- Checks: `yarn typecheck`, `yarn lint`, `yarn test`, the Playwright renderer tests, then `yarn build`.
- Commit as `SCP-09: ...`. Merge to master only when the user says so. The live run below uses the branch build.

## Part B: Hub (repo `creative-hub`)

- `scripts/hub.ps1`: add a `-Window` switch.
  - For an electron service, it drops `--headless`/`--mcp-only`, adds `--mcp` (so the MCP server still runs), and starts the app visibly.
  - Logs are still redirected. There is no `WindowStyle Hidden`.
  - Usage: `hub.ps1 start scriptorium -Force -Window`.
- `README.md`: the `-Window` usage, and series in the Scriptorium row.
- The skill: a short "Series" note in step 1A (`add_series`, `add_story {series}`, `get_series`).
- `ROADMAP.md`: series is done on `SCP-09_series`. Note any gaps found in the live run.

## Part C: Write book 1

1. `hub.ps1` status. If Scriptorium is up headless, stop it. Run `hub.ps1 build scriptorium`, then `hub.ps1 start scriptorium -Force -Window`.
   - Starting it resumes the factory. It may start some of the open generated ideas with its own models, within the budget cap of $5/day.
   - Right after start: check `factory_status` and `list_stories {status: open}`, and tell the user what else is queued.
2. Ask the user to reconnect `scriptorium` with `/mcp`. Until then, use `hub.ps1 call`.
3. Run log: `runs/<slug>.md` from the template.
4. `add_series`. Working ideas, to be finalised in the brief:
   - **Leads**:
     - Declan "Dec" Hartley, an Irish locksmith who builds escape rooms, in Paris for a job. He is curious, unlucky and talks too much.
     - Inès Varga, a French-Hungarian paintings restorer. She is dry, exact and braver than she admits.
   - **The society**: an old, wealthy, well-connected fraternity, the Brotherhood of the Ninth Hour.
     - It worships an invented god, the Clockless One, whose dogma says time is a debt owed back.
     - Its curse is the "Stopped Hour": victims lose a day and wake with their watches stopped.
     - It plans a large act in Paris at a coming eclipse.
   - **Style**: comic adventure-mystery in the spirit of Broken Sword. There is real danger and real clues: puzzles in manuscripts, clocks, churches and catacombs. The leads banter, and the jokes come from the characters, not from winks at the reader.
   - The series premise covers the long arc: the Brotherhood survives book 1, and its inner circle stays hidden.
5. `add_story` for book 1:
   - `series`;
   - format `novella` (20-50k words, 10-25 chapters), aiming at about 45k words in about 18 chapters, which is the "medium" size;
   - `models: {editor-in-chief, architect, writer: client/claude-code}`. Reviewers stay on Scriptorium's models.
6. Work the client task loop (`list_client_tasks`, `get_client_task`, `submit_client_task`) until published.
   - Chapters can go to parallel subagents, each filtered by role and book. Each must hit the word range, keep the bible's facts and keep the comic voice.
   - Track stages with `scripts/wait-book.ps1 -Story <slug>`.
   - If rejected: `reopen_book {mode: rewrite, chapters}` and rewrite.
7. After publishing:
   - try `set_book_model ... null` (it is refused on published books, which is a known ROADMAP item);
   - check that `get_series` lists the book with its score;
   - update the run log with ids, decisions, costs and checks.

## Verification

- Part A:
  - all checks in A6 pass;
  - in the window, the Library shows the Series panel, and a series and a next book can be made by hand.
  - In a temp data folder test, a second book's pitch, outline and draft prompts contain book 1's summaries and cast, and book 2 waits while book 1 is unpublished.
- Part B: `hub.ps1 start scriptorium -Force -Window` opens the window, and `hub.ps1 check` shows the scriptorium MCP answering.
- Part C:
  - the book is `published`;
  - the EPUB exists at `~/Scriptorium/books/<slug>/out/<slug>.epub`;
  - the series file lists it.
- The production is done only when the user has read the book and rated it (`rate_book`). The run log says what was and was not checked.

## Status

Branches: scriptorium `SCP-09_series` (from origin/master dd7ea80); creative-hub `SCP-09_series-hub` (from origin/master 9c4d547).

- [x] A1 data · [x] A2 gate · [x] A3 continuity · [x] A4 MCP · [x] A5 UI · [x] A6 docs + tests (implementer, Part A). Not committed (orchestrator commits).
  - Verification (2026-10-20, node 24 via fnm): `yarn typecheck` clean; `yarn lint` clean; `yarn test` 21 files, 312 tests passed (was 20 files / 300: new `tests/series.test.ts` 11 tests, `tests/mcp.test.ts` +1 and the tool list). One earlier full run showed 1 failed test (not identified, not reproduced in 5 further full runs, all 312 passing: likely a timing flake). `yarn test:ui` (Playwright renderer, demo harness) 3 passed incl. new `tests/renderer/series.spec.ts`; `yarn build` ok. Electron specs (`test:electron`, `test:packaged`) not run. The Series panel layout was not looked at in a real window (only driven by the Playwright spec).
  - Files: new `src/engine/store/series.ts` (SeriesStore, bookRefs, seriesMembers, nextSeriesIndex, waitingStories), `src/engine/pipeline/series.ts` (seriesSection, withSeriesBible, earlierSeriesBooks), `src/renderer/ui/Series.tsx`. Changed: schemas, brief, protocol, summary, engine, handlers, longHandlers, pipeline, memory/context, ideas, dataFolder, watcher, mcp/tools, renderer store/fake/Library/StoryForm/SideTools/styles, docs/design.md, docs/mcp.md.
  - Deviations / decisions: (1) `StoryBrief` gained `series` and `seriesIndex` (frontmatter `series_index`) so the existing add/update story path carries them; the engine (`addStory`/`updateStory`) validates the series and numbers the story, so UI and MCP share it. (2) The seriesSection is also appended to the review and check_chapter prompts (plan A3 says reviewers), not only the `storyBriefSection` places. (3) Series cast end state is matched by name (all words of the shorter name inside the longer one), per series file `## Characters`; places are carried when their name appears in the series text. (4) Gate also holds a story while an earlier open story of the series has no book yet (plan said earlier book/idea). (5) Series panel sits in a new right column above the Topics list. (6) The seed has no `series/` folder: the store creates it, and `DATA_LAYOUT` has it (existing folders get it at the next start). (7) A hand-made series idea with a non-integer `series_index` fails the idea schema and is skipped by the idea list (same as any bad frontmatter).
- [ ] B hub `-Window`, README, skill, ROADMAP
- [ ] C book 1 (orchestrator, live)

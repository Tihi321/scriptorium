# Humanizer, script writer, newspaper (Scriptorium) + Claude-only Croatian translation (Book Translator)

## Context

The user merged SCP-09 (series) and the hub branch, and now wants five things:
1. **Humanizer**: a new agent role that rewrites books and articles so they don't read as AI-written, and makes them livelier.
2. **Script writer**: a panel that adapts a finished prose book into a visual-novel script that VN Studio can import.
3. **Newspaper**: a section like the Library, where the factory writes researched articles the same way it writes books.
4. **Croatian translation**: translate *The Clockless God* to Croatian with Book Translator, with Claude Code doing all the model work and no outside models. Update Book Translator where that is needed.
5. **Live runs** of all three new features.

Decisions made with the user:
- Newspaper: real, researched articles.
- Humanizer: runs on every book and article. Default model chain = the line editor's; it can be set to the client per book.
- Script writer: the user picks linear or choices for each book.
- Live runs: the humanizer on a short test book, one test article, the adaptation of *The Clockless God* to a visual novel, and the Croatian translation.

Exploration showed three things:
- Articles fit the existing book pipeline as a new non-fiction format with one chapter. A separate pipeline would duplicate about 3k lines.
- The humanizer fits as one extra job per chapter.
- Adaptation needs a new `source_book` idea, threaded through start, pitch, outline, draft, rewrite and review.

Book Translator already runs fully on the client (all four agents on `client/claude-code`; there are no other model calls). Its only risk: an agent that is not set silently falls back to DeepSeek.

Execution: through the global `implement` skill, with this plan copied to `creative-hub/.claude/tickets/SCP-10-12-humanizer-script-writer-newspaper/plan.md`. All Scriptorium work stays in the patterns SCP-08/09 used:
- the `docs/design.md` Decisions table, sections and History;
- `docs/mcp.md`;
- a `data-testid` on every control;
- the demo engine `renderer/demo/fake.ts`;
- vitest and Playwright tests.

The features share handlers, schemas and protocol, so they go on **stacked branches, one implementer at a time**:
1. `SCP-10_humanizer`, from master.
2. `SCP-11_script-writer`, from SCP-10.
3. `SCP-12_newspaper`, from SCP-11.

The user merges them in order. Book Translator `BTT-10_client-only` runs in parallel in its own repo.

## A. SCP-10 Humanizer (scriptorium)

- **Role**:
  - Add `humanizer` to `ROLES` (`src/shared/schemas.ts:385`), `KNOWN_ROLES` (`src/renderer/ui/roles.ts`), `ROLE_SHORT` (`store/model.ts:188`), `ROLE_ROOM` (it goes to `'writers'`, in `office/layout.ts:49`), the demo roster, and the design.md Staff table.
  - Seed: a `seed/config/roles.md` entry with the line editor's chain, and a starter agent `seed/agents/humanizer-<name>.md` with a persona: an editor who makes prose sound human and alive.
- **Migration** (existing data folders never get new seeds):
  - At engine start, if `config/roles.md` has no `humanizer`, append one with the line editor's chain.
  - If `agents/` has no humanizer, copy the seed agent in.
  - Log both. This mirrors how a missing role would otherwise stall the scheduler (`scheduler.ts:357`).
- **Gate**: a format flag `humanize` (default true; schema at `schemas.ts:157-196`) and a book override `humanize: false`. If no humanizer agent is hired, `advance` skips the pass with a log line instead of queuing a job that would never run.
- **Pipeline** (`pipeline/advance.ts`):
  - Long books: a per-chapter job `humanize--chNN--rN`, after the `chk` fix and before memory and index (between `:432` and `:433`).
  - Short books: after the length gate and before the first reviews (`~:325`).
  - In later rounds: rewritten chapters are humanized again before they are reviewed again (after `:330`).
  - It is tracked with a chapter frontmatter field `humanized: <round>` (`ChapterFile`, `books.ts:44-53`, `BookState`, `pipeline.ts:312`). `round` stays unchanged, the same rule `research_fix` follows.
- **Handler**: new file `pipeline/humanizerHandlers.ts`, following `rewrite_chapter` (`handlers.ts:701-780`).
  - Input: the chapter text; the style and voice notes from the bible; and a tic report for this chapter from `analyzeRepetition` (`memory/repetition.ts:53`), run over the chapters so far and filtered to this chapter.
  - Also input: an extended AI-tell list, such as "for a long time/moment", stacked "It was" openers, "did not look/say" negation beats, "a testament to", "tapestry", rows of three, em dashes, ending on a moral.
  - Output: the whole chapter.
  - Guards:
    - stay within ±10% of the word count, otherwise keep the original and log it;
    - keep `[RESEARCH:]` markers;
    - for `_vn`, keep every script line's structure (`SCENE:`, `ON SCREEN:` and the speaker tags counted before and after);
    - leave names unchanged.
  - Prompts: `seed/prompts/humanizer/humanize_chapter.md`, plus `_vn` (keep the grammar, liven the lines) and `_article` (added in SCP-12).
  - It is registered in `pipeline.ts:45-48`.
- **MCP**: `add_story {humanize?}`; `set_book_model {role: humanizer}` works through the role list.
- **Tests**:
  - a pass after drafting in long and short books;
  - a pass again after a round rewrite;
  - skipped when the flag is off or no agent is hired;
  - the length and VN guards;
  - the migration on an old data folder.

## B. SCP-11 Script writer: book → visual novel (scriptorium)

- **Data**: an idea or book gets `source_book: <slug>`, added in:
  - `ideaSchema` and `bookSchema` (`schemas.ts:249-315`);
  - `StoryBrief` and `briefOf` (`shared/brief.ts`);
  - `briefFields` (`store/ideas.ts:32`).
- **Rules**:
  - The source must be `published`.
  - A story waits while its source is not published; this sits beside `waitingStories` (`store/series.ts:166`).
  - `start_book` copies `source_book` into the book and defaults the genre to the source's (`handlers.ts:247-329`).
  - The format is whatever the user picked: `visual-novel` or `choice-visual-novel`.
- **Prompts**: an `adaptSection(d, slug)` in a new file `pipeline/adapt.ts`, beside `seriesSection`. It holds the source pitch, blurb, outline, act and chapter summaries, and the bible digest. It reuses `bibleEntriesOf` from `pipeline/series.ts`, which gets exported.
  - **pitch**: built from the source. The similarity check excludes the source slug (`handlers.ts:360`; `index.ts:219` `notBook`).
  - **research_plan**: skipped. The book reuses the source's research notes.
  - **outline**: told to compress the source into the format's chapter range.
    - Each VN chapter maps to `source_chapters: number[]` (the schema at `:414-434`, saved in outline.md frontmatter).
    - The bible is seeded from the source's characters and places, with looks kept for the art (beside `withBriefCharacters` / `withSeriesBible`, `:473`).
    - With choices: the source's ending stays as one canon path (`_choices.md`).
  - **draft and rewrite**: the full text of the mapped source chapters is added to the context (`:525-541`, `:701-780`).
  - **review**: reviewers get the source excerpt and a line saying this is an authorised adaptation of the owner's own book, so the originality checker does not fail it.
- **UI**: a "Script writer" panel.
  - It opens from a published book's card in the Library: an "Adapt to visual novel" button.
  - The panel has a format select (linear or choices), an optional title, notes for the adapter, and an Adapt button, which creates the story.
  - The Whiteboard and book card show "adapted from <title>".
- **MCP**: `adapt_book {book, format, title?, notes?, models?}`; `get_book` shows `source_book`.
- **Docs and hub**: Scriptorium `docs/visual-novel.md` gets an adaptation note; the hub skill's step 1 gains "adapt an existing book".
- **Tests**:
  - adapt_book validation;
  - the wait-for-source gate;
  - the adapt section in the pitch, outline, draft and review prompts;
  - the pitch similarity check ignoring the source;
  - the bible carried from the source;
  - the `source_chapters` mapping saved and fed to the drafts;
  - a Playwright spec for the panel.

## C. SCP-12 Newspaper (scriptorium)

- **Formats** (`seed/config/formats.md`), added through the data-folder migration as well:
  - `article`: 600-1,800 words;
  - `feature-article`: 1,800-4,000 words.
  - Both: `chapters: [1,1]`, `nonfiction: true`, `article: true`, `humanize: true`, `max_rounds: 1`, reviewers `[fact-checker, line-editor, copy-editor, beta-reader]`.
- **Topics**:
  - A new kind `article`, added to `TOPIC_KINDS` (`store/topics.ts:6`), `ui/Topics.tsx` and the `add_topic` enum (`mcp/tools.ts:679`).
  - A `## Newspaper` section in the seed `topics.md`, also appended by the migration, all inactive: world, europe, science, technology, culture, business, sport, opinion/analysis.
- **Prompts**: `variant()` (`handlers.ts:880`) learns `_article`, with new files for:
  - the pitch: headline, standfirst, angle;
  - the research plan: always, news-aware;
  - the outline: a section plan for the one chapter;
  - the draft and the rewrite;
  - the humanizer;
  - publish: headline, standfirst, tags, with no blurb or cover.

  `generate_ideas.md` gets an article branch. For article topics, the idea job first runs a news search for each section and passes in recent headlines.
- **Research** (`research/web.ts:228-247`):
  - for articles, Tavily is called with `topic: "news"` and a recent time range;
  - article research notes are kept per article and are not reused from the shared library.
- **Publish** (`handlers.ts:783-876`): for `article: true`, skip the cover, the EPUB and Kindle. Write instead:
  - `out/article.html`, a styled single page with headline, standfirst, byline (agent), date, body and numbered references (`publish/xhtml.ts` and the `buildReferences` fact base);
  - `out/article.md`.

  `scanCovers`, `summary.ts:78-106` and the BookCard learn that articles have no cover and no EPUB.
- **Slots**: `max_articles_in_progress` (default 3) in the factory config; articles do not count toward `max_books_in_progress` (`books.ts:33-40`, `pipeline.ts:432`).
- **UI**:
  - a top-level tab, Office | Library | **Newspaper**, in `App.tsx:27` and the view union (`store.ts:54`);
  - `ui/Newspaper.tsx` shows a front page: the latest articles grouped by section and day, headline and standfirst; clicking one opens `article.html` (already served from `books/<slug>/out/`, `main/files.ts:88`);
  - an "Write an article" form: section, subject, angle;
  - articles filtered out of the Library shelves (`store/shelves.ts`);
  - `BookSummary` gets `medium: 'book' | 'article'`.
- **MCP**:
  - `list_articles {section?, since?}`;
  - `add_story` works with `format: article`;
  - `list_books` gets a `medium` filter.
- **Tests**:
  - an article runs end to end on mock providers to `article.html`: no cover, no EPUB, references present;
  - the slot cap is separate from books;
  - topic routing;
  - the idea branch;
  - news search parameters;
  - Playwright: the Newspaper tab and the form.

## D. BTT-10 Client-only projects (book-translator)

- `create_project` / `update_project_settings` take `clientOnly: true`. It sets all four agents (glossary, translator, proofreader, qa) to `["client/claude-code"]`, and the router refuses any other ref for the project, including `retry_chunk {model}` (`runner.ts:311-338`, `service.ts:155-165`).
- `get_project` shows `clientOnly`.
- The seed client provider gets `context: 200000` and `enabled: true` (`seed/config/providers.md:135-143`).
- README and the server instructions are updated.
- Tests: no outside ref is reachable for a client-only project, and merging settings into an existing project keeps the client.
- Hub ROADMAP: BTT-08 and BTT-09 are marked merged.

## E. Live runs (orchestrator)

**Setup:**
1. Build. Restart Scriptorium with `hub.ps1 stop scriptorium` and then `start scriptorium -Force -Window`. The factory resumes; the open generated ideas sit in inactive topics.
2. Start Book Translator. Tell the user to reconnect the MCP servers with `/mcp`; until then, use `hub.ps1 call`.
3. Keep one run log per production in `runs/`.

**Runs:**
1. **Croatian translation** (`runs/the-clockless-god.md`):
   - `create_project {sourcePath: ~/Scriptorium/books/the-clockless-god/out/the-clockless-god.epub, targetLanguage: "hr", clientOnly: true}`, then `start_translation`.
   - Loop `wait_for_progress` and the client tasks. Claude does the glossary, translation, proofreading and QA, with subagents in parallel (concurrency 8), keeping names and the series terms consistent: Bratovština Devetog sata, Bezsatni, Zaustavljeni sat.
   - `export_project` to `runs/the-clockless-god/the-clockless-god.hr.epub`.
2. **Humanizer on a short test book** (`runs/<slug>.md`):
   - a `short-story` with the writer set to the client and the humanizer and reviewers on app models;
   - compare the chapter before and after the humanize pass (`chapters/history/`) and record the tic counts before and after.
3. **One test article** (`runs/<slug>.md`):
   - turn the technology section on for this run only, or use `add_story {format: article, topic: news-technology}`;
   - Claude writes; the app models research, humanize and review;
   - check `article.html` in the Newspaper tab.
4. **Adapt *The Clockless God*** (`runs/the-clockless-god-vn.md`):
   - the user picks linear or choices in the Script writer panel, or I use `adapt_book`;
   - architect and writer on the client, so Claude writes the about 25k-word script; reviewers and humanizer on app models;
   - when it is published, `vno_import` in VN Studio as a check only. The art, music and build are a later production.

The ROADMAP gets anything found. The run logs say what was checked, and the user reads and plays everything last.

## Verification

- **Scriptorium**, on each branch: `yarn typecheck`, `yarn lint`, `yarn test` (a known timing flake on master; compare failures against master), `yarn test:ui`, `yarn build`.
- **Book Translator**: its test suite and `yarn build:engine`.
- **Live**:
  - the humanizer job appears and runs after a draft, and the tic counts drop;
  - an article is published with `article.html` and references, and shows in the Newspaper tab with no cover or EPUB;
  - the adaptation's outline maps the source chapters, and its script passes `vno_import`;
  - the Croatian EPUB exports with every agent on the client, and `get_project` shows no other model used ($0).
- **Not verifiable by Claude**: how the new panels look in the window, and the quality judgement on the books. The user checks those.

## Status

Branches:
- scriptorium `SCP-10_humanizer` from origin/master 1e51cd9; then `SCP-11_script-writer` from SCP-10; then `SCP-12_newspaper` from SCP-11.
- book-translator `BTT-10_client-only` from origin/master 89e837f.

- [x] A SCP-10 humanizer (implemented on `SCP-10_humanizer`, not committed). Verified: `yarn typecheck` and `yarn lint` clean; `yarn test` 335/335 (22 files; 22 tests new in `tests/humanizer.test.ts`, plus a new MCP test) on the passing runs, but with load-dependent flakes in unrelated timing tests (`scheduler`, `features`) on some runs, each passing on rerun; `yarn test:ui` 3/3; `yarn build` ok. Not run: the two Electron specs (`app.electron`, `packaged.electron`), whose starter-agent count was changed 27 to 28. Deviations: (1) the migration runs inside `initDataFolder` (returns `migrated`), not in `Engine.start`, so tests that build an Engine on their own folders are not changed; (2) `makePipelineEnv` removes the seed humanizer unless `humanizer: true`, so old tests run unchanged; (3) a humanized chapter keeps the writer as its `agent`, and the history copy of a humanized version is `ch-NN-rR-humanized.md`; (4) for B/C: `variant()` takes `article?: boolean` (gives `_article`) and `loadPrompt` falls back from `_article` to the plain prompt; no `_article` prompt yet.
- [ ] B SCP-11 script writer
- [ ] C SCP-12 newspaper
- [ ] D BTT-10 client-only
- [ ] E1 Croatian translation · [ ] E2 humanizer test book · [ ] E3 test article · [ ] E4 VN adaptation

# SCP-07: MCP server, headless mode, story briefs

Ticket folder: `.claude/tickets/SCP-07-mcp-server-headless-mode-story-briefs/`. Branch `SCP-07_mcp-headless-story` (created 2026-10-19 from `origin/master` at 1e79dc6). Commits `SCP-07: <summary>`.

## Implementation status

- [x] A. Story briefs (shared brief module, idea store, commands, pipeline, bible merge, snapshot ideas/formats, UI form, demo fake, tests)
  - Verified 2026-10-19: `yarn typecheck` and `yarn lint` exit 0, `yarn test` 19 files / 268 tests passed (incl. new tests/brief.test.ts, tests/story.test.ts), `yarn test:ui` 2 passed (office.spec.ts has the story form case).
  - Deviations: `briefOf` counts the title only when `title_fixed: true` (a label made from the text is not a title); `BookStore.brief()` returns null for ideas with `source: generated`; the bad-format log line uses `d.log` (engine log), not the job log; the pitch gets the brief as `{{idea}}` only, without the "owner's story brief" heading; `review_outline` also gets the brief section; existing `tests/renderer/store.test.ts` snapshot fixture gained `ideas: []` and `formats: []`.
- [x] B. MCP server + headless (SDK dep, config, server, tools, lock, CLI flags, `--headless` app flag, status bar, tests)
  - Verified 2026-10-19: `yarn typecheck`/`yarn lint` exit 0, `yarn test` 20 files / 280 tests (new tests/mcp.test.ts: 12), `yarn test:ui` 2 passed; live smoke on port 7399 (27 tools, `factory_status`, `add_story`, second engine refused with exit 1, stale lock replaced); `yarn dev -- --headless --data .. --mcp-port 7397` served MCP with no window (tray and "Show Scriptorium" not checked by eye).
  - Deviations: `read_book_file` uses its own fixed file names and a slug check, not `resolveInside` (nothing moved to shared); new `mcp.updated` event (plus `mcp` in the snapshot, required field); `--headless` makes the app's engine start with `--mcp`; one `yarn test` run had 1 failure that did not repeat in 4 later runs (not identified).
- [x] C. Docs (design.md rows/sections/history, docs/mcp.md, CLAUDE.md)
  - Done 2026-10-19: docs only, no code run. design.md: three Decisions rows (Story briefs, MCP server, Headless mode), UI row, folder layout (ideas/, brief.md, mcp.md, engine.lock), Technology bullet, Pipeline note, History entry; the Status line was left as it is. New docs/mcp.md. One CLAUDE.md bullet in Machine.

## Context

You want three things:
1. Outside agents (Claude Code, Codex and others) can drive the factory over **MCP**.
2. A **headless mode**, so the factory and MCP run without the UI.
3. A proper **story definition** in place of the one-line idea: a title, a description, a plot, a list of characters you can keep adding to, and any other sections you like. Agents must actually use it.

What the code does today:
- There is no HTTP server. The engine (`src/engine/index.ts`) already runs headless with plain Node, but `StdoutTransport` accepts no commands.
- An idea is one line of text (`AddIdea.tsx` → `addIdea` in `engine.ts:798`). The first line, cut to 70 characters, becomes the label.
- The editor-in-chief always picks the title and the format, and the idea's `format` is ignored.
- Only the pitch step sees the idea text. The outline and the drafts see `pitch.md`, so your characters and plot can get lost.

Your answers: both headless variants; MCP has full control except secrets, settings and Kindle; "chars" means both story characters and no length limit.

## 1. Story briefs

**File format.** A story is still `ideas/<slug>.md`, so it can still be edited by hand. The frontmatter is the existing idea fields plus:
- `title_fixed: true` (set when you give a title)
- an optional `genre`
- `format` and `topic`, which are now honoured

The body is markdown sections:

```
## Premise
## Plot
## Characters
### Mara Quill
Role: lighthouse keeper's daughter, the hero
Free text description...
## Setting
## Style
## <any heading you add>      ← extensible, passed to the agents as is
```

A plain old idea with no headings still works: the whole text counts as the premise.

**`src/shared/brief.ts` (new).** It holds the `StoryBrief` type:
- `title`, `premise`, `plot`
- `characters[{name, role, description}]`
- `setting`, `style`
- `sections[{heading, text}]`
- `format?`, `topic?`, `genre?`

It also has `parseBrief(body)` and `renderBrief(brief)`, which the engine, the UI and MCP all share.

**Commands** (`src/shared/protocol.ts`, plus `COMMAND_TYPE_SET`):
- `addStory { brief }` creates a story.
- `updateStory { idea, brief }` changes an open story only.
- `addIdea` stays for one-liners.

`IdeaStore` (`src/engine/store/ideas.ts`) gets `createStory()` and `updateStory()`, which reuse `slugify` and `writeMd`. The logic lives in Engine methods `addStory()` and `updateStory()`, which return the `IdeaFile`, so MCP can return the slug. `handleCommand` calls those methods.

**Starting a book** (`start_book`, `src/engine/pipeline/handlers.ts:235`):
- The editor-in-chief's `{{source}}` gets the full rendered brief.
- With `title_fixed`, the owner's title is kept instead of the model's.
- A brief `format` that is in `allowed` is used, and the prompt says it is fixed. A format that isn't allowed is ignored, with a log line.
- The idea's frontmatter and body are copied to **`books/<slug>/brief.md`** (`kind: brief`). It belongs to the book from then on, and is read fresh by every job, so a hand edit applies from the next job.
- `BookStore` gets `brief(slug)`. For older books with no `brief.md`, it falls back to the idea body.

**Agents use it:**
- A new `storyBriefSection(d, slug)` sits next to `ownerNotesSection` (`handlers.ts:914`). It says: "The owner described this story: keep its title, characters (names, roles, looks), plot points and setting; build around them. The owner's notes win over the brief."
- It is appended by the engine, as `_choices.md` is, so prompts already in the data folder need no change.
- It is appended in `pitch` (which replaces the idea-only `{{idea}}`), `outline`, `review_outline` (`longHandlers.ts:35`), `draft_chapter` and `rewrite_chapter`.
- After the outline, any brief character the architect left out is added to the bible:
  - the long bible: `d.bible.writeInitial` characters
  - the light bible: the `## Characters` list (`handlers.ts:436-447`)
- Non-fiction books get the brief sections but no character merge.

**UI** (`src/renderer/ui/AddIdea.tsx` becomes `StoryForm.tsx`, still the idea tab in `SideTools.tsx`):
- The quick one-line input stays.
- **Describe a story** opens these fields:
  - Title
  - Format (select, default "Editor chooses")
  - Topic (select, optional)
  - Genre
  - Premise and Plot (textareas)
  - Characters (rows of name, role and description, with **+ Add character**)
  - Setting and Style
  - **+ Add section** (a heading and text)
- Below the form is a **Waiting stories** list of your open stories. Click one to edit it and save it with `updateStory`.
- The snapshot gains:
  - `ideas: IdeaSummary[]`: open user stories plus the last 10 used ones, each with its book
  - `formats: {id, name, kinds}[]`
- An `ideas.updated` event is sent when `ideas/` changes. The watcher already handles that folder; add the kind if it is missing.
- Update the demo fake (`src/renderer/demo/fake.ts`) to match.

## 2. MCP server (inside the engine, so it works with the app open and headless)

**Dependency:** add `@modelcontextprotocol/sdk` (latest). First check that it accepts zod 4.6. If it doesn't, pass it JSON schemas or use `zod/v3`. The engine build keeps dependencies external (`vite.engine.config.ts`) and the SDK ships CJS, so nothing else should be needed. Check that the packaged app's `node_modules` includes it.

**Config:** a new seed file `seed/config/mcp.md` holds `enabled: true`, `host: 127.0.0.1`, `port: 7341` and `token_env: SCRIPTORIUM_MCP_TOKEN`. When that secret is set (env, or Windows credential store via the existing provider-key lookup), `Authorization: Bearer` is required. The token never goes in markdown. CLI flags override the file:
- `--mcp` forces it on
- `--no-mcp` turns it off
- `--mcp-port <n>` sets the port

**`src/engine/mcp/server.ts` (new):**
- A `node:http` server on 127.0.0.1 only, using `StreamableHTTPServerTransport` in stateless mode at `/mcp`.
- Host and Origin are checked (DNS-rebinding protection; only `127.0.0.1:<port>` and `localhost:<port>` are allowed).
- It is started from `src/engine/index.ts` after `engine.start()` and closed in `stop()`.
- If the port is taken, the engine logs it, sends an `engine.warning`, and the factory keeps running.
- The snapshot gets `mcp: { url } | null`, and the status bar shows `MCP :7341`.

**`src/engine/mcp/tools.ts` (new):**
- Tools are zod-typed, with short descriptions written for agents.
- Inputs are checked first (book exists, role known, story still open). This matters because `handleCommand` only logs bad input. A failed check returns an MCP tool error.
- Command tools call `engine.handleCommand(cmd)` and then return fresh data, such as `bookSummary()` from `src/engine/summary.ts`.

The tools:
- **Read:**
  - `factory_status`: paused, spend vs caps, servers, running jobs, books per stage, busy and idle agents
  - `list_books {stage?}`, `get_book {book}` (the summary plus the brief)
  - `read_book_file {book, file: brief|pitch|outline|bible|notes|chapter, chapter?}`. It resolves only inside `books/<slug>/`, using `resolveInside` from main's helpers, moved to `src/shared` if needed.
  - `list_stories {status?}`, `get_story`
  - `list_topics`, `list_agents`, `list_models` (shown models plus role defaults)
- **Stories:** `add_story` (the `StoryBrief` fields, all optional except a premise or a title) and `update_story {story, …fields}`. Fields are merged; `characters` replaces the list, and `add_characters` adds to it.
- **Books:**
  - `add_book_note {book, text, chapter?, rewrite?}`
  - `set_book_paused`, `retry_book`, `rate_book`, `rename_book`, `remake_cover`
- **Factory:** `set_factory_paused`, `ask_researcher`, `add_topic`, `set_topic_active`, `check_servers`.
- **Agents:** `hire_agent`, `fire_agent`, `set_agent_paused`, `assign_agent`, `set_model {agent | role, model}`.
- **Not exposed:** `setSecret`, `saveSettings`, `sendToKindle` (it sends email), and model detection, provider limits and the models list config.

## 3. Headless mode

**Plain Node:**
- A new script `"headless": "yarn build:engine && node out/engine/index.js --mcp"` (same `--data`).
- Update `USAGE` in `src/engine/index.ts`.
- Cover PNGs stay `pending`. Under Electron, `renderPendingCovers` (`pipeline.ts:419`) already draws them at the next app start.

**App:** `Scriptorium.exe --headless` (and `electron . --headless` in dev):
- `src/main/index.ts` skips `createWindow()` and keeps the tray.
- The tray tooltip reads "Scriptorium (headless, MCP :7341)".
- "Open window" in the tray creates the window on first use: `showWindow()` creates it if it is missing.
- Covers still render.

**Single engine per data folder:**
- The engine writes `index/engine.lock` with its pid at start, and removes it at stop. `index/` is rebuildable, so this keeps the rule of no hidden state.
- A second engine whose lock pid is still alive exits with a clear message.
- This stops `yarn headless` and the app from both writing the same folder.

## 4. Docs

`docs/design.md` gets new Decisions rows:
- **Story briefs**: adds to the UI row's controls.
- **MCP server**.
- **Headless mode**: overrides the Technology note "not needed now".

It also gets:
- section updates: Shared files (`ideas/` format, `books/<slug>/brief.md`), Technology and the pipeline
- a History entry

A new `docs/mcp.md` covers client setup (`claude mcp add --transport http scriptorium http://127.0.0.1:7341/mcp`, adding the token header), the tool list and headless usage. Update the CLAUDE.md machine notes with the MCP port.

## Critical files

- `src/shared/protocol.ts`, `src/shared/schemas.ts` (`ideaSchema` gains `title_fixed` and `genre`), `src/shared/brief.ts` (new)
- `src/engine/engine.ts` (`addStory`, `updateStory`, snapshot `ideas`, `formats` and `mcp`), `src/engine/store/ideas.ts`, `src/engine/pipeline/books.ts`
- `src/engine/pipeline/handlers.ts` (start_book, pitch, outline, draft, rewrite), `src/engine/pipeline/longHandlers.ts`
- `src/engine/mcp/server.ts`, `src/engine/mcp/tools.ts` (new), `src/engine/index.ts`, `src/engine/store/dataFolder.ts` (lock)
- `src/main/index.ts` (`--headless`)
- `src/renderer/ui/StoryForm.tsx` (new, replaces `AddIdea.tsx`), `SideTools.tsx`, the status bar, `src/renderer/demo/fake.ts`
- `seed/config/mcp.md`, `package.json`, `docs/design.md`, `docs/mcp.md`

## Verification

1. Run `yarn typecheck`, `yarn lint` and `yarn test` (vitest, with `MockProvider` and the `makeEnv` and `makePipelineEnv` helpers in `tests/helpers.ts`). New tests:
   - `tests/brief.test.ts`: parse and render round trip, a plain old idea, custom sections, characters with `Role:`.
   - `tests/story.test.ts`:
     - a fixed title and format survive `start_book`
     - `brief.md` is copied
     - the pitch, outline and draft prompts contain the brief
     - a character the architect left out is merged into the bible
     - `updateStory` refuses a used story
   - `tests/mcp.test.ts`:
     - an Engine with MCP on port 0 and the SDK `Client` + `StreamableHTTPClientTransport`
     - `listTools`
     - `add_story`, then `list_stories`, `factory_status`, `get_book` and `read_book_file` (including a refused `../` path)
     - a wrong or missing token is refused
     - a foreign `Host` header is refused
   - A lock test: a second engine on the same folder exits.
2. Playwright (`tests/renderer/office.spec.ts`, demo harness): fill in the story form with two characters and a custom section, check the `addStory` command, then edit a waiting story.
3. Live tests:
   - **Plain Node:** start Strata, run `yarn headless`, run `claude mcp add --transport http scriptorium http://127.0.0.1:7341/mcp`, then call `factory_status` and `add_story` (a full brief with characters). Watch it become a book: `book.md` keeps the title and format, and `brief.md`, `pitch.md` and `bible/` contain the characters.
   - **App:** run `yarn dev -- --headless` (then the packaged `Scriptorium.exe --headless`). There should be a tray icon only, the same MCP calls should work, and "Open window" should show the book. Starting `yarn headless` at the same time must refuse to start.

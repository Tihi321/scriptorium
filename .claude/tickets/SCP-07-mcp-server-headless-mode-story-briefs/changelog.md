# SCP-07 changelog

## 2026-10-19: story briefs, MCP server, headless mode

The plan is built: story briefs that agents use, an MCP server inside the engine with 27 tools, plain Node and Electron headless modes, and one engine per data folder. **Uncommitted**, on branch `SCP-07_mcp-headless-story` (from `origin/master` 1e79dc6).

### Files

**Story briefs**
- `src/shared/brief.ts` (new):
  - `StoryBrief` with `parseBrief` and `renderBrief` (they round-trip).
  - `briefPromptText`, `briefLabel`, `briefOf`, `emptyBrief` and `isEmptyBrief`.
  - The body format: `## Premise`, `## Plot`, `## Characters` (a `### Name` block with an optional `Role:` line), `## Setting`, `## Style`, plus any other `## Heading`.
  - A body without headings is read as the premise.
- `src/shared/schemas.ts`: `ideaSchema` gains `title_fixed` and `genre`, and there is a new `mcpSchema`.
- `src/shared/protocol.ts`:
  - New commands `addStory` and `updateStory`.
  - `IdeaSummary` and `FormatSummary`.
  - The snapshot gains `ideas`, `formats` and `mcp`.
  - New events `ideas.updated` and `mcp.updated`.
- `src/engine/store/ideas.ts`: `createStory` and `updateStory`. A given title sets `title_fixed`. `updateStory` refuses a story that is not open.
- `src/engine/engine.ts`:
  - Public `addStory`, `updateStory`, `listIdeaSummaries`, `emitIdeas`, `setMcpUrl`, `warn` and `uptimeMs`.
  - The snapshot carries ideas, formats and the MCP URL.
  - `handleWatch` sends `ideas.updated` when `ideas/` changes.
- `src/engine/summary.ts`: `ideaSummary`, `ideaSummaries` and `formatSummaries`.
- `src/engine/pipeline/books.ts`: `brief(slug)` reads `books/<slug>/brief.md`. Older books fall back to the idea body. A generated idea gives null.
- `src/engine/pipeline/handlers.ts`:
  - **start_book:** the editor-in-chief gets the full brief. An owner's fixed title is kept. A brief format the topic allows is used; one it doesn't allow is logged and ignored. The brief genre wins. The idea is copied to `books/<slug>/brief.md`.
  - **storyBriefSection:** appended to the outline, draft and rewrite prompts. The pitch gets the brief as `{{idea}}`.
  - **withBriefCharacters:** adds the brief characters the outline left out to the long or the light bible. Non-fiction books are skipped.
- `src/engine/pipeline/longHandlers.ts`: `review_outline` gets the brief section too.
- **UI:**
  - `src/renderer/ui/StoryForm.tsx` (new) replaces `src/renderer/ui/AddIdea.tsx`, which is deleted.
  - The form keeps the one-line input. "Describe a story" opens title, format, topic, genre, premise, plot, characters (add and remove), setting, style and extra sections (add and remove).
  - The "Waiting stories" list loads a story into the form for editing.
  - `SideTools.tsx` uses the new form, and `store/store.ts` holds ideas, formats and MCP.

**MCP server and headless mode**
- `package.json`: the `@modelcontextprotocol/sdk ^1.32.1` dependency, and the `headless` script (`yarn build:engine && node out/engine/index.js --mcp`). `yarn.lock` is updated.
- `seed/config/mcp.md` (new): `enabled: true`, `host: 127.0.0.1`, `port: 7341`, `token_env: SCRIPTORIUM_MCP_TOKEN`.
- `src/engine/mcp/server.ts` (new): `loadMcpConfig` (the config file, then the flags `--mcp`, `--no-mcp` and `--mcp-port`) and `startMcpServer`. The server:
  - uses `node:http` with a stateless Streamable HTTP transport at `/mcp`
  - is loopback only (any other host falls back to 127.0.0.1)
  - checks Host and Origin (403 on a mismatch)
  - asks for an optional bearer token, looked up through `resolveKey` (env, then the credential store), and answers 401 without it
  - warns on a taken port, and the factory keeps running
- `src/engine/mcp/tools.ts` (new): 27 tools that check their input first and return fresh state.
  - **Read:** `factory_status`, `list_books`, `get_book`, `read_book_file` (strict slug and fixed file names), `list_stories`, `get_story`, `list_topics`, `list_agents`, `list_models`.
  - **Stories:** `add_story`, `update_story`.
  - **Books:** `add_book_note`, `set_book_paused`, `retry_book`, `rate_book`, `rename_book`, `remake_cover`.
  - **Factory:** `set_factory_paused`, `ask_researcher`, `add_topic`, `set_topic_active`, `check_servers`.
  - **Agents:** `hire_agent`, `fire_agent`, `set_agent_paused`, `assign_agent`, `set_model`.
  - **Not exposed:** secrets, settings, Kindle, model detection and config, provider limits, `stopNow`.
- `src/engine/store/dataFolder.ts`: `acquireEngineLock` writes `index/engine.lock`. A live other pid refuses to start. A dead pid, an unreadable lock, or a lock written before the last boot is replaced. Only our own lock is released.
- `src/engine/index.ts`: takes the lock (the CLI subcommands and `--once` don't), starts MCP after `engine.start()`, closes MCP and releases the lock on stop, and has the new flags in `USAGE`.
- `src/main/index.ts`: `--headless` starts with no window, only the tray. `showWindow()` creates the window on first use. The tooltip is "Scriptorium (headless, MCP :port)". The MCP flags are forwarded to the engine, and `--headless` adds `--mcp`.
- **Status bar:** `src/renderer/ui/StatusBar.tsx` shows an `MCP :<port>` pill, and `src/renderer/demo/fake.ts` provides ideas, formats, the MCP URL, `addStory` and `updateStory`.

**Docs**
- `docs/design.md`:
  - Decisions rows: Story briefs, MCP server, Headless mode.
  - Updated sections: UI row, folder layout, Technology, Pipeline.
  - A History entry.
- `docs/mcp.md` (new): starting it, connecting clients, the token, config, the tools, the brief format, security and troubleshooting.
- `CLAUDE.md`: a machine note on the MCP URL and the engine lock.

**Tests**
- `tests/brief.test.ts` (10 tests, new).
- `tests/story.test.ts` (6 tests, new).
- `tests/mcp.test.ts` (12 tests, new).
- `tests/renderer/office.spec.ts`: the story form case and the MCP pill assertion.
- `tests/renderer/store.test.ts`: fixture fields.

### Deviations from the plan

- `briefOf` treats the title as the owner's only when `title_fixed` is true. A label made from the text is not a fixed title.
- Generated ideas get no brief (`BookStore.brief()` returns null), so their books keep the old idea-text path.
- The pitch gets the brief through `{{idea}}`, without the "owner's story brief" heading.
- `read_book_file` uses a strict slug regex and fixed file names instead of moving `resolveInside` to `src/shared`.
- The new `mcp.updated` event lets the UI and tray learn the URL without a full snapshot.
- `--headless` turns MCP on even when `config/mcp.md` says `enabled: false`. `--no-mcp` still wins.
- The token is read once at server start, so a new token needs an engine restart.
- `GET` and `DELETE` on `/mcp` answer 405, because the server is stateless.
- **Added during review:** a lock written before the last boot counts as stale. Windows reuses pids, so after a reboot a live unrelated process could otherwise block the engine. There is a test for it.

### Verification

**Passed (run 2026-10-19 after all changes):**
- `yarn typecheck`: exit 0.
- `yarn lint`: exit 0.
- `yarn test`: 20 files, 280 tests passed.
- `yarn test:ui`: 2 passed (the story form and the MCP pill).
- `node out/engine/index.js --help` shows the new flags.
- **Live smoke, plain Node** (implementer; `node out/engine/index.js --data .claude/temp/mcp-data --mcp --mcp-port 7399`, SDK client script):
  - `listTools` returned 27 tools.
  - `factory_status` and `add_story` worked, and `ideas/smoke-story.md` was written.
  - A second engine was refused, and a stale lock after a force-kill was replaced.
- **Live smoke, Electron dev headless** (implementer; `yarn dev -- --headless --data .claude/temp/mcp-data2 --mcp-port 7397`): no window, MCP answered with 27 tools, a story was added, and a second engine was refused.

**Not run, or not checked by eye:**
- **Tray (headless):** the icon and its tooltip, and "Show Scriptorium" creating the window.
- **Packaged:** `Scriptorium.exe --headless`, and `yarn dist`, which would check the SDK is in the packaged `node_modules`.
- **Full book run:** a book written with a real model from a brief added through MCP (Strata).
- **SIGTERM lock release:** releasing the lock on a graceful stop is not exercised live on Windows. A dead-pid lock is replaced anyway.
- **One flaky failure:** one `yarn test` run during development failed one test right after `yarn test:ui`. The test wasn't recorded, and it didn't come back in 5 later full runs.

### Follow-ups and known limits

- Under plain Node headless, cover PNGs stay `pending` until the app next runs.
- The MCP port and token are read at engine start only.
- No stdio MCP transport (HTTP only).

### Commit status

Uncommitted.

# Scriptorium over MCP

The engine can serve the factory to outside agents (Claude Code, Codex and others) over MCP. They can read everything and give orders: add stories, add notes to books, pause and retry books, hire agents. They cannot touch API keys, settings or Send to Kindle. The decisions are in `docs/design.md` (rows "Story briefs", "MCP server" and "Headless mode").

The server lives inside the engine, so it runs wherever the engine runs. It listens on `http://127.0.0.1:7341/mcp` (Streamable HTTP, no sessions).

## Starting it

- **The app, as usual.** MCP is on by default (`enabled: true` in `config/mcp.md`). The status bar shows `MCP :7341`.
- **The app without a window.** `Scriptorium.exe --headless` starts only the tray icon and the engine with MCP on. In development: `yarn dev -- --headless`. "Show Scriptorium" in the tray menu (or a click on the icon) makes the window the first time.
- **Plain Node, no Electron.** `yarn headless` builds the engine and runs `node out/engine/index.js --mcp`. Add `--data <dir>` to pick the data folder and `--mcp-port <n>` to pick the port, for example `yarn headless --data D:\Scriptorium --mcp-port 7342`. Cover PNGs need Electron, so under plain Node a published book's cover stays `pending`; the next app start draws it.

Engine flags: `--mcp` forces MCP on, `--no-mcp` turns it off, `--mcp-port <n>` sets the port (0 picks a free one). They override `config/mcp.md`.

## Connecting a client

Claude Code:

```
claude mcp add --transport http scriptorium http://127.0.0.1:7341/mcp
```

With a token:

```
claude mcp add --transport http scriptorium http://127.0.0.1:7341/mcp --header "Authorization: Bearer <token>"
```

Other clients that take a JSON config (the key names differ a little between clients):

```json
{
  "mcpServers": {
    "scriptorium": {
      "type": "http",
      "url": "http://127.0.0.1:7341/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Leave `headers` out when no token is set.

## Setting a token

A token is optional. When it is set, every request needs `Authorization: Bearer <token>`.

1. Store it: `yarn key:set SCRIPTORIUM_MCP_TOKEN` (hidden prompt, saved in the Windows credential store), or set the environment variable `SCRIPTORIUM_MCP_TOKEN`.
2. Restart the engine. The log line `mcp: listening on ... (bearer token needed)` confirms it.

The name `SCRIPTORIUM_MCP_TOKEN` is `token_env` in `config/mcp.md`. The token never goes in the data folder's files.

## config/mcp.md

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` switches the server off |
| `host` | `127.0.0.1` | Loopback only. Any other value is replaced with `127.0.0.1` |
| `port` | `7341` | Port to listen on |
| `token_env` | `SCRIPTORIUM_MCP_TOKEN` | Name of the secret that holds the bearer token |

Changes apply at the next engine start.

## Tools

Reading:
- `factory_status`: `dataDir` (the absolute path of the data folder), paused or not, spend against the caps, local servers, running jobs, books per stage, busy and idle agents, `maxArticlesInProgress` (the separate cap for newspaper articles, `max_articles_in_progress` in `config/factory.md`), `clientTasks {waiting, leased}` (see "Do the model work yourself"), `blocked` (the queued jobs no model can take now, each `{job, role, agent, reason}`: a server down, a day used up with its reset time, a rate limit, every slot busy), `lastResort` (the ref of the model `last_resort_model` in `config/settings.md` names, when it can answer, else null: it takes a job only when every model of the job's role is down or used up for the day, so a `client` model there means those jobs wait for a Claude Code session), `providers [{id, dayFull, resetsAt, down}]` and `embeddings {model, provider, down}` (null when none). A job blocked on every model waits instead of failing: set a book model or `set_model` to a `client` model, or start the server.
- `list_books {stage?, medium?}`: one compact row per book, with `medium` (`book` or `article`) and `folder` (the absolute path of the book's folder). `medium` keeps only books (everything but newspaper articles) or only articles.
- `list_articles {section?, since?, stage?}`: the newspaper, published articles newest first: slug, headline, standfirst, section (and `sectionId`), byline, `publishedAt`, words, score `page` (`books/<slug>/out/article.html`, with `out/article.md` beside it) and `pagePath` (the same, absolute). `section` is a topic id (`news-technology`) or its name; `since` is `YYYY-MM-DD` or an ISO time; `stage` defaults to `published`, `all` includes articles in progress.
- `get_book {book}`: the book in full, plus the story brief it was made from, and `paths {dataDir, folder, epub, coverPng, readerDir, articlePage, articleMarkdown, chapters}`: absolute paths (Windows separators), each null when the file is not there. The older relative fields (`epub`, `coverPng`, `readerDir`, `articlePage`) stay. `lengthGate {status, words, min, max, wordsBefore}` says the length gate ran (rewriting, done, or ok), and `lengthOver: true` that the book was published over the format's ceiling.
- `wait_for_book {slug, timeout_seconds?, stop_on_client_task?, client?}`: a long call. `slug` is a book or a story (a story is waited on until its book starts). It returns when the book is `published`, `rejected` or `failed`, when a model request of the book waits for you (`stop_on_client_task`, default true: `reason: "client-task"`, so you answer it and call again), or after `timeout_seconds` (default 60, 1 to 900: `reason: "timeout"`). The answer is `{done, reason, story, book, title, stage, chaptersWritten, chaptersPlanned, words, targetWords, score, clientTasks {waiting, leased}, folder, epub, articlePage, waitedMs}` with absolute paths, and `reasons` for a rejected or failed book. A story with no book yet also returns on a waiting `start_book` task of the editor-in-chief. It stops early when the call is cancelled.
- `get_screenplay {book, chapter?}`: the parsed screenplay of a short film or cartoon book (a book with `screenplay: true`: formats `short-film`, `cartoon`, `kids-cartoon`; any stage, drafts too) as the JSON of docs/screenplay.md: `aspect` (`16:9`, or `9:16` when the brief or style says vertical), `style`, `runtimeSeconds` and `runtimeRange`, `characters` (looks, a `voice` note) and `places`, `music` cues (`id`, `description`, `from` and `to` shot ids) and for every chapter its `sourceChapters` and `scenes` (id, place, time, background, `shots`: id, framing, move, seconds, continuous, action, cast, sfx, title, lines with `kind` dialogue, voice-over or off-screen). `chapter` gives one chapter. A book that is not a screenplay is refused (a visual novel script with a pointer to `get_script`). `get_script` refuses a screenplay book and names `get_screenplay`.
- `get_script {book, chapter?}`: the parsed script of a visual novel book (a book with `script: true`; any stage, drafts too) as the JSON of docs/visual-novel.md ("A JSON shape for the parsed book"): characters (with their `aliases`) and places with their looks, the style, and for every chapter its `choices`, `ending`, `sourceChapters` and `scenes` (place, time, background, beats). A beat is also a `clue`, `evidence`, `puzzle` or `testimony` for the puzzle lines of a mystery with puzzles (`{type: "clue", puzzle, clue, text}`, `{type: "evidence", key, text}`, `{type: "puzzle", puzzle, kind}`, `{type: "testimony", witness, statements: [{n, speaker, expression, text}]}`; the top level has `puzzles`, the entries of `bible/puzzles.md`, empty for other books), and a `cue` for a `CG:`, `INSERT:`, `SFX:` or `AMBIENCE:` line (`{type: 'cue', cue: 'cg' | 'insert' | 'sfx' | 'ambience', text}`, `text` null for `CG: none`, `END CG` and `AMBIENCE: none`), and a line or cast entry that was written under one of a character's aliases has the bible name and `alias`. `chapter` gives one chapter. A book that is not a script is refused with its format.
- `read_book_file {book, file, chapter?}`: `file` is brief, pitch, outline, bible, notes or chapter (give `chapter`). Only these files inside the book's folder.
- `build_vn_pack {book}`: compiles the language-independent VN pack (HUB-16 contract version 2) of a visual novel book (a book with `script: true`, never a screenplay: that is refused) and writes it: `books/<slug>/vn/pack.json` (the fixed template: `book` metadata with `packHash` and `sourceHash`, `characters` with looks, voice and `aliasKeys`, `places`, chapters/scenes/beats (`cast`, `line` with `speakerKey`, `expression` and optional `aliasKey`, `narration`, `puzzle`) with cue descriptors (`image`, `sfx`, `ambience`), branch `choices`/`isEnding`, and `puzzles` with the core unchanged, `chapter`, `clueAt` and `links`) and `books/<slug>/vn/text/<sourceLang>.json` (the source catalog: title, blurb, chapter and scene titles, choice and ending texts, character and alias names, line/narration text, puzzle names and prose). It also sets `vn_version: 2` in book.md. The chapter files stay the authoring source; an older visual novel gets its pack here (publishing makes one automatically). A speaker line whose label matches no bible character or alias gets a synthetic character (`speaker_1`) and a warning; an unknown place keeps `placeKey: null` and its `placeText`; an `ON SCREEN:` entry that is not a character or alias (a prop, a page, a crowd, a sentence) is dropped with a warning. An empty catalog value refuses the write. Returns `{book, packPath, textPath, lang, packHash, sourceHash, chapters, scenes, beats, characters, places, puzzles, warnings}` with absolute paths. See docs/visual-novel.md "The VN pack (v2)".
- `get_vn_pack {book}`: the pack and its source catalog of a visual novel book as JSON (read-only): `{book, packPath, textPath, packHash, sourceHash, packVersion, lang, stale, problems, warnings, pack, text}`. `stale: true` means the authored script files changed since the pack was made (the `sourceHash` of `outline.md`, `bible/bible.md`, `bible/puzzles.md`, `cover-brief.md` and `chapters/*.md` no longer matches; `book.md` is not part of the hash): run `build_vn_pack` again and re-translate. `problems` lists a `packHash` that does not match the contents and catalog keys that are missing, extra or empty, or carry a script label or a scene/beat id. Refused for a book that is not a visual novel script, has no pack or is a screenplay.
- `read_book_file {book, file, chapter?}`: `file` is brief, pitch, outline, bible, notes or chapter (give `chapter`). Only these files inside the book's folder.
- `list_stories {status?, source?}`: `status` open (default), used or all; `source` user, generated or all.
- `get_story {story}`: one story with its whole brief.
- `list_series`: one compact row per series with its books in order (slug, title, index, `kind` book or story, stage, score).
- `get_series {series}`: the series file (premise, recurring characters, setting, style, extra sections) and its books in order with stage and score. A story no book has started yet is listed with `kind: story`.
- `list_topics {active?}`, `list_agents`, `list_models` (the models the pickers offer, and each role's default).

Stories:
- `add_story {title?, premise?, plot?, characters?, setting?, style?, sections?, format?, topic?, genre?, series?, humanize?, puzzles?, models?}`: needs a title or some text. `puzzles` is for a mystery with puzzles (format `mystery-puzzle-visual-novel`, which only a story that fixes it gets): the puzzles as VN Studio makes them with `vno_puzzle_generate`, each `{key, kind, title?, core, names, text, testimony?}` (docs/visual-novel.md "Puzzles"); they are kept as `bible/puzzles.md`, never put into the text of the story. Returns the slug. `models` is role -> `provider/model`, kept for the book made from the story (see `set_book_model`; `humanizer` is a role like any other). `format: article` or `feature-article` writes a researched newspaper article: the title is the headline, the premise the subject and angle, and `topic` is a newspaper section (kind `article`, e.g. `news-technology`). A topic of kind `article` only takes an article format and an article format only takes such a topic; anything else is refused (a story with only an article format is an article of no section; an article cannot be adapted into a visual novel). An article has no cover and no EPUB and shows in `list_articles`. `humanize: false` keeps the humanizer from rewriting this book's chapters (frontmatter `humanize: false`, copied to book.md); left out, the format decides (default: every chapter is humanized when a humanizer is hired). `format` must be an enabled format id, `topic` an id from `list_topics`.
- `update_story {story, ...same fields, add_characters?}` (`models` replaces the story's models, `{}` clears them; `humanize: false` switches the humanizer off for the book, `true` clears that): only a story no book has started. Only the fields you give change. `characters` replaces the whole list, `add_characters` adds to it (a character with a name already there is replaced), `sections` replaces the extra sections, and an empty string clears a text field, `format`, `topic`, `genre` or `series`. `series` (on both tools) is a series slug from `list_series`: the story becomes the next book of that series (`series_index` is the next free number among the series' books and open stories, and keeps its number on later edits; moving a story to another series numbers it again). An unknown series is a tool error.

Script writer (see docs/visual-novel.md, "Adapting a book"):
- `adapt_book {book, format, title?, notes?, models?}`: adapts a published book into a visual novel script, or into a screenplay for a short film or cartoon. `book` must exist and be `published`; `format` must be an enabled script format (`visual-novel` for a linear story, `choice-visual-novel` for a story with choices, in which the book's own ending stays one canon path, or a screenplay format: `short-film`, `cartoon` or `kids-cartoon`, which compress the book into the format's runtime; the book is then read with `get_screenplay`). Any other format is refused with the two lists of ids. `title` defaults to the book's title, `notes` (what to keep, cut or change) go to every agent as a section of the brief, `models` is role -> `provider/model` as in `add_story`. A second open adaptation of the same book in the same format is refused. Creates a story with `source_book` set, which the factory starts a book from at once (the source is published). Returns the story slug. `get_book` and `list_books` show `sourceBook` (slug and title in `get_book`) for the book made from it.

Series (see "Series"):
- `add_series {title, premise?, plot?, characters?, setting?, style?, sections?, genre?, format?}`: creates `series/<slug>.md`. `premise` is the arc of the whole series, `characters` the recurring cast. Returns the slug and the series with its books.
- `update_series {series, title?, ...same fields, add_characters?}`: only the fields you give change. `characters` replaces the cast, `add_characters` adds to it (a name already there is replaced), `sections` replaces the extra sections, an empty string clears a text field. The books of the series stay.

Books:
- `add_book_note {book, text, chapter?, rewrite?}`: an owner note the writers follow from the next job. With `chapter` it is about that chapter, and with `rewrite` as well the chapter is rewritten now.
- `retry_book {book}` continues a **failed** book: its failed jobs go back in the queue. `reopen_book {book, mode, chapters?}` gives a **rejected** or **published** book one more round (see below). Neither works on the other kinds of book.
- `refresh_factbase {book}`: merges the research notes a non-fiction book or article has gathered since its fact base was made into the fact base now, at any stage (a published book too). Returns `{queued, unmerged}`: the id of the archivist job, or null when nothing is unmerged. The published text and references do not change: `reopen_book` the book to have the writers use the new facts. A fiction book is refused.
- `set_book_paused {book, paused}`, `rate_book {book, rating, note?}`, `rename_book {book, title}` and `remake_cover {book}` (published books).

- `reopen_book {book, mode: "rewrite" | "review", chapters?}`: for a rejected or a published book (anything else is refused with the stage it is in). `rewrite` rewrites the chapters you give, or the ones the last round's reviews name (for a rejected book the weakest few when they name none, the whole book when nothing is scored; a published book without `chapters` and with none named is refused, so a whole published book is never rewritten by accident), then reviews the book again. `review` reviews it again with no rewrite. It adds one round to the book's limit (`extra_rounds` in book.md), so after this round the publisher decides again: publish, or reject. A published book keeps its EPUB or article page in `out/` until it is published again (`reopened_from: published` and `published_before` in book.md); if the publisher rejects the reopened round the book is `rejected` like any other and can be reopened again. The book counts toward `max_books_in_progress` again. Agents assigned to it were freed when it was rejected or published: assign them again with `assign_agent`.

Factory:
- `set_factory_paused {paused}`, `ask_researcher {question, book?}`, `add_topic {name, kind, target?}` (`kind` also takes `video` and `juvenile-video`, the topics of the screenplay formats), `set_topic_active {id, active}`, `check_servers`.

- `set_book_model {book, role, model | null}`: the model one book uses for a role (see "Do the model work yourself"). The role must exist, the model must be in the registry and its provider available. It works at any stage, so a model can be set on a failed or published book before `retry_book` or `reopen_book`; `model: null` always works.

Agents:
- `hire_agent {role, name?, model?}`, `fire_agent {agent, now?}`, `set_agent_paused {agent, paused}`, `assign_agent {agent, book, exclusive?}` (book null frees it; `exclusive` makes the agent the only one that takes the book's jobs: they wait for it, even while it is busy or paused; without it the assigned agent only prefers the book and the other agents of the role still help), `set_model {model, agent | role}` (one agent, or a role's default; give exactly one of them).

Model work (see "Do the model work yourself"):
- `list_client_tasks {client?}`: `{waiting, leased, tasks}`, the requests waiting for you, oldest first, with their ages and the `client` each is for. Without `client` every named client's tasks are listed.
- `get_client_task {client?, role?, book?, task?}`: takes the oldest matching waiting request of your named client (`client`, default `claude-code`; Antigravity passes `client: "antigravity"`, see "Antigravity CLI as a client") and holds it for 30 minutes. Returns `{taskId, meta, system, user, schema?, maxTokens?, output, leaseMinutes}`, or `{none: true, waiting}`. `system` holds the instructions and `user` the turn to answer; the prompt is sent once. `messages` (the conversation without the system turns) is there only when there is more than one turn, for example a repair round: then `user` is the last turn and `messages` has all of them.
- `submit_client_task {taskId, text}`: answers it. With a schema the text is checked first: `{accepted: false, problems}` leaves the task yours to fix and resubmit. A task that is gone (aborted, answered, or the engine restarted) is refused.
- `release_client_task {taskId}`: gives it back, `{released}`.

Not available: secrets, settings, model detection, provider limits, the model list, Send to Kindle and stop-now.

A tool that gets bad input (unknown book, unknown role, a story already used) returns an MCP tool error with a message that says what to fix.

## Do the model work yourself

Claude Code can be the model. A provider of `kind: client` (`client/claude-code`, in `config/providers.md`, switched off in the seed: set `enabled: true`) does not call a server. Each request of a job that uses it waits in the engine until you answer it, then the book carries on as if a model had. Nothing is spent. The provider is local and free, has no key and is never marked down.

1. **Choose what you do.** For one book (recommended), put the book itself on Claude: `add_story {..., models: {"writer": "client/claude-code", ...}}` when you give the story, or `set_book_model {book, role, model}` for a book that is already running (`model` null removes it; it works at any stage, so you can set it on a failed or published book before `retry_book` or `reopen_book`). A book model is kept in book.md (`role_models`). Its jobs of that role try it first, before the agent's own model, and any agent of the role may take them, so no other writer can slip in with its own model. Running jobs of the book switch at once, and the role's list stays the fallback. Other books and the factory's own ideas keep using their models. Or switch a whole role with `set_model {role, model: "client/claude-code"}`. Another way is to `hire_agent` a writer on `client/claude-code` and `assign_agent {exclusive: true}` it to the book: then only the agents assigned that way take the book's jobs. Without `exclusive` the pin only makes that agent prefer the book's jobs and other writers still help; the pin is freed when the book is published or rejected. `add_story {models}` also covers the start of the book: the editor-in-chief's `start_book` request is a client task when the story's models name one (`wait_for_book` returns on it).
2. **The loop.** `list_client_tasks`, then `get_client_task`, write the answer, `submit_client_task`, until `get_client_task` returns `{none: true}`. A structured task (`schema` in the answer) wants one JSON object and nothing else; a prose task wants the text only. Fix and resubmit when `accepted` is false: that costs nothing, while a bad answer that gets through spends a repair round.
3. **In parallel.** Each task is leased to one caller, so several sessions or subagents can each take one at a time. A lease lasts 30 minutes; after that the task is waiting again. `release_client_task` gives one back at once.
4. **Stopping and restarting.** Stopping a job or changing its model drops its task (a later submit says "task not found"), and the job goes back to the queue without an attempt. Tasks live in memory: if the engine restarts, the running job is requeued and makes a new task.
5. **Switch back when done.** There is no timeout, so a role left on `client` with nobody answering stalls every book that needs it. `factory_status` shows `clientTasks` so you can see it.

Long prompts: a review of a whole book sends the whole book. That is fine for a short story, but a long novel can be 150,000 words, so keep `client` runs to short formats unless you need it.

## Antigravity CLI as a client

The `client` provider has one model per named client: `client/claude-code` and `client/antigravity`. A task carries the client of the model its job asked for, and `get_client_task` only gives a client its own tasks: without `client` it means `claude-code`, so Claude Code never takes Antigravity's jobs, and Antigravity CLI never takes Claude Code's. (Web searches are `claude-code`'s.) Another client is added with "Add a model by its id" on the `client` provider in the Models panel, then it passes its own name.

1. **Connect it.** Add the MCP address to Antigravity CLI's MCP config, the way the "Connecting a client" part shows for other clients: the URL `http://127.0.0.1:7341/mcp` and, when a token is set (see "Setting a token"), the header `Authorization: Bearer <token>`. Use Antigravity's own MCP settings (its config file or its `mcp add` command, whichever your version has); the server name is up to you. Logging Antigravity in is your own part: nothing in Scriptorium does it.
2. **Put the jobs on it.** Enable the `client` provider (`enabled: true` in `config/providers.md`), then point a book or role at `client/antigravity` exactly as for Claude Code: `add_story {models: {"writer": "client/antigravity"}}`, `set_book_model {book, role, model: "client/antigravity"}` or `set_model`.
3. **The loop it runs.** Tell Antigravity, for example: "Use the scriptorium MCP server. Call `get_client_task` with `client: "antigravity"`. Answer the task as its `output` says: one JSON object matching `schema` when there is one, otherwise the text only. Send the answer with `submit_client_task`. If it says `accepted: false`, fix the problems and submit again. Repeat until `get_client_task` returns `{none: true}`, then call `list_client_tasks {client: "antigravity"}` and wait a minute before asking again." `wait_for_book {slug, client: "antigravity"}` stops when a task of that client waits for you.
4. **Both at once.** Claude Code and Antigravity can work in parallel on different books or roles: each only sees its own tasks. A task for a client nobody runs waits for ever, like any client task: `list_client_tasks` shows it and `factory_status.clientTasks` counts every client's.

## Do the web research yourself

The researcher needs web search. Without a Tavily key it only had Wikipedia, and a newspaper article could not be sourced. The `client-search` entry of `config/providers.md` (`kind: search`, `engine: client`, enabled in the seed, after `tavily` and before `wikipedia` in `search_order`) hands each web search to you. Nothing is spent and no key is needed.

1. **The tasks.** A search is a client task with role `searcher` and task `web_search`; the unit is the query and the book is the one the research is for. `list_client_tasks` shows them, `factory_status.clientTasks` counts them with the other tasks, and `get_client_task {role: "searcher"}` takes only those.
2. **What you do.** Search the web yourself with your own web search and fetch tools, read the pages, prefer primary, official and recent sources (a news search says how many days back). Answer with `{"results": [{"title": "...", "url": "https://...", "content": "...", "published": "2026-10-14"}]}`: `content` is a verbatim excerpt of the page (at most 1500 characters, with numbers and names exactly as the page has them), `url` is a page you really read, up to `limit` results (the task says how many). Never invent a URL. An empty list is fine when nothing is found. `submit_client_task` checks the shape (title, an http(s) url and content on every result) and refuses a bad answer without costing anything: fix it and submit again.
3. **Nobody answering.** A task that no session has taken within `wait_minutes` (default 10, set on the provider) is dropped and the search finds nothing (the log says so); the researcher then falls to the next provider (Wikipedia). So books never stall for want of a session, but they research thinly: keep a session answering `searcher` tasks while a newspaper article or a non-fiction book is being researched. Once you have taken a task, the engine waits for the answer; a lease that runs out puts it back to waiting and the wait starts again.
4. **Switching it off.** `enabled: false` on `client-search`, or take it out of `search_order`.

## The story brief file

A story is `ideas/<slug>.md` in the data folder. You can write one by hand; the engine picks it up. `add_story` and the **Describe a story** form write the same format.

```markdown
---
kind: idea
title: The Lighthouse Keeper's Daughter
title_fixed: true
status: open
source: user
format: short-story
genre: Gothic mystery
---

## Premise

A storm leaves a lighthouse keeper's daughter alone with a stranger who knows her father's secret.

## Plot

- The storm cuts the island off.
- The stranger asks about the missing logbook.
- She finds the logbook, and her father's name in it.

## Characters

### Mara Quill
Role: lighthouse keeper's daughter, the hero
Sixteen, stubborn, knows every stair of the tower.

### Mr Voss
Role: the stranger
Soft voice, wet coat, never sits down.

## Setting

A rock off the north coast, 1890s.

## Style

Close third person, short chapters, a slow build of dread.

## Rules of the world

Any other heading is passed to the agents as it is.
```

- `title_fixed: true` makes the book keep this title. Without it the editor-in-chief picks one.
- `format` is used when it is enabled and the topic allows it; otherwise the editor-in-chief picks, and the engine log says why.
- `topic` (an id from `list_topics`, optional) and `genre` are used for the book.
- A body with no `##` headings is the premise.
- When the factory starts the book, the file is copied to `books/<slug>/brief.md`. Edit that copy to change what the agents see: it applies from the next job. Pitch, outline, outline review, drafts and rewrites all read it, and brief characters missing from the outline are added to the bible.

## Series

A series is books that continue each other, with the same recurring characters, setting and style, and with what happened in the earlier books carried into the later ones. Make one with `add_series`, then give its books with `add_story {series}` (the UI: **New series** in the library, and **Next book**, which opens the story form with the series chosen). The series is `series/<slug>.md` in the data folder:

```markdown
---
kind: series
title: The Ninth Hour
genre: Comic mystery
format: novella
books: [case-one, case-two]
created: 2026-10-20T10:00:00.000Z
---

## Premise

The arc of the whole series.

## Characters

### Dec Hartley
Role: Irish locksmith
Curious, unlucky, talks too much.

## Setting

## Style
```

- The body is a story brief without the title (`## Premise`, `## Plot`, `## Characters` with `### Name` blocks, `## Setting`, `## Style`, any other `##` heading). `books` lists the books' slugs in the order they were started; the engine fills it in.
- A story and its book carry `series: <slug>` and `series_index: <n>` in their frontmatter (`ideas/<slug>.md`, `brief.md`, `book.md`).
- **Order.** A story of a series is not started while an earlier book of the series (a lower `series_index`) is not published yet, or while an earlier story of it has no book yet. A rejected or failed book 1 therefore holds book 2 back until you reopen it and it is published. Other stories and topics go on meanwhile.
- **Prompts.** The pitch, outline, outline review, chapter draft, chapter rewrite, reviewers and continuity checks of a book of a series get a "The series this book belongs to" section: the series premise, cast, setting and style, and, for each earlier book in order, its title, blurb, act and chapter summaries, the end state of the recurring characters from that book's bible (the cast members of the series file; matched by name) and the threads it left open. Each earlier book is cut to about 7,000 characters and all of them to about 28,000, so a long series does not swamp the prompt. Book 1 gets the series header only.
- **Bible.** The bible of book N>1 starts with the earlier books' entries for the recurring characters, and for places named in the series text, so the archivist grows what book 1 left. The long-book draft context also searches the earlier books' chapters and summaries.
- The series file is watched like ideas: edit it by hand and the UI follows.

## Security

- The server listens on loopback only. It is never offered to the network.
- Each request's `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, and any `Origin` must be one of those too. A web page in your browser cannot talk to it.
- Set a token if other programs or users share the machine. Without a token, anything on the machine that can reach the port can control the factory (and spend your API budget).
- The token is read from an environment variable or the Windows credential store, never from the data folder.

## Troubleshooting

- **"the MCP port 7341 is already in use".** Another engine, or another program, has the port. The factory keeps running without MCP. Stop the other one, or choose a port with `--mcp-port <n>` or in `config/mcp.md`, and restart the engine.
- **"another Scriptorium engine (pid ...) already runs on ...".** Only one engine runs per data folder (`index/engine.lock`), so the app and `yarn headless` cannot work on the same folder at once. Stop the other one, or use another `--data` folder.
- **A lock left behind.** A lock whose process is gone is replaced at the next start, and so is a lock written before the last reboot. If the engine still refuses and you are sure nothing runs, delete `index/engine.lock` in the data folder.
- **401 or 403 from the client.** 401: the token is missing or wrong (the client needs the `Authorization: Bearer` header). 403: the `Host` or `Origin` is not loopback, for example when the URL uses another host name.
- **A new token is ignored.** The engine reads it at start. Restart it.

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
- `factory_status`: paused or not, spend against the caps, local servers, running jobs, books per stage, busy and idle agents, `maxArticlesInProgress` (the separate cap for newspaper articles, `max_articles_in_progress` in `config/factory.md`) and `clientTasks {waiting, leased}` (see "Do the model work yourself").
- `list_books {stage?, medium?}`: one compact row per book, with `medium` (`book` or `article`). `medium` keeps only books (everything but newspaper articles) or only articles.
- `list_articles {section?, since?, stage?}`: the newspaper, published articles newest first: slug, headline, standfirst, section (and `sectionId`), byline, `publishedAt`, words, score and `page` (`books/<slug>/out/article.html`, with `out/article.md` beside it). `section` is a topic id (`news-technology`) or its name; `since` is `YYYY-MM-DD` or an ISO time; `stage` defaults to `published`, `all` includes articles in progress.
- `get_book {book}`: the book in full, plus the story brief it was made from.
- `read_book_file {book, file, chapter?}`: `file` is brief, pitch, outline, bible, notes or chapter (give `chapter`). Only these files inside the book's folder.
- `list_stories {status?, source?}`: `status` open (default), used or all; `source` user, generated or all.
- `get_story {story}`: one story with its whole brief.
- `list_series`: one compact row per series with its books in order (slug, title, index, `kind` book or story, stage, score).
- `get_series {series}`: the series file (premise, recurring characters, setting, style, extra sections) and its books in order with stage and score. A story no book has started yet is listed with `kind: story`.
- `list_topics {active?}`, `list_agents`, `list_models` (the models the pickers offer, and each role's default).

Stories:
- `add_story {title?, premise?, plot?, characters?, setting?, style?, sections?, format?, topic?, genre?, series?, humanize?, models?}`: needs a title or some text. Returns the slug. `models` is role -> `provider/model`, kept for the book made from the story (see `set_book_model`; `humanizer` is a role like any other). `format: article` or `feature-article` writes a researched newspaper article: the title is the headline, the premise the subject and angle, and `topic` is a newspaper section (kind `article`, e.g. `news-technology`). A topic of kind `article` only takes an article format and an article format only takes such a topic; anything else is refused (a story with only an article format is an article of no section; an article cannot be adapted into a visual novel). An article has no cover and no EPUB and shows in `list_articles`. `humanize: false` keeps the humanizer from rewriting this book's chapters (frontmatter `humanize: false`, copied to book.md); left out, the format decides (default: every chapter is humanized when a humanizer is hired). `format` must be an enabled format id, `topic` an id from `list_topics`.
- `update_story {story, ...same fields, add_characters?}` (`models` replaces the story's models, `{}` clears them; `humanize: false` switches the humanizer off for the book, `true` clears that): only a story no book has started. Only the fields you give change. `characters` replaces the whole list, `add_characters` adds to it (a character with a name already there is replaced), `sections` replaces the extra sections, and an empty string clears a text field, `format`, `topic`, `genre` or `series`. `series` (on both tools) is a series slug from `list_series`: the story becomes the next book of that series (`series_index` is the next free number among the series' books and open stories, and keeps its number on later edits; moving a story to another series numbers it again). An unknown series is a tool error.

Script writer (see docs/visual-novel.md, "Adapting a book"):
- `adapt_book {book, format, title?, notes?, models?}`: adapts a published book into a visual novel script. `book` must exist and be `published`; `format` must be an enabled visual novel format (`visual-novel` for a linear story, `choice-visual-novel` for a story with choices, in which the book's own ending stays one canon path). `title` defaults to the book's title, `notes` (what to keep, cut or change) go to every agent as a section of the brief, `models` is role -> `provider/model` as in `add_story`. A second open adaptation of the same book in the same format is refused. Creates a story with `source_book` set, which the factory starts a book from at once (the source is published). Returns the story slug. `get_book` and `list_books` show `sourceBook` (slug and title in `get_book`) for the book made from it.

Series (see "Series"):
- `add_series {title, premise?, plot?, characters?, setting?, style?, sections?, genre?, format?}`: creates `series/<slug>.md`. `premise` is the arc of the whole series, `characters` the recurring cast. Returns the slug and the series with its books.
- `update_series {series, title?, ...same fields, add_characters?}`: only the fields you give change. `characters` replaces the cast, `add_characters` adds to it (a name already there is replaced), `sections` replaces the extra sections, an empty string clears a text field. The books of the series stay.

Books:
- `add_book_note {book, text, chapter?, rewrite?}`: an owner note the writers follow from the next job. With `chapter` it is about that chapter, and with `rewrite` as well the chapter is rewritten now.
- `retry_book {book}` continues a **failed** book: its failed jobs go back in the queue. `reopen_book {book, mode, chapters?}` gives a **rejected** book one more round (see below). Neither works on the other kind of book.
- `set_book_paused {book, paused}`, `rate_book {book, rating, note?}`, `rename_book {book, title}` and `remake_cover {book}` (published books).

- `reopen_book {book, mode: "rewrite" | "review", chapters?}`: for a rejected book only (anything else is refused with the stage it is in). `rewrite` rewrites the chapters you give, or the ones the last round's reviews name (the weakest few when they name none, the whole book when nothing is scored), then reviews the book again. `review` reviews it again with no rewrite. It adds one round to the book's limit (`extra_rounds` in book.md), so after this round the publisher decides again: publish, or reject. The book counts toward `max_books_in_progress` again. Agents assigned to it were freed when it was rejected: assign them again with `assign_agent`.

Factory:
- `set_factory_paused {paused}`, `ask_researcher {question, book?}`, `add_topic {name, kind, target?}`, `set_topic_active {id, active}`, `check_servers`.

- `set_book_model {book, role, model | null}`: the model one book uses for a role (see "Do the model work yourself"). The role must exist, the model must be in the registry and its provider available. Refused for published and failed books; fine for books in progress and rejected ones.

Agents:
- `hire_agent {role, name?, model?}`, `fire_agent {agent, now?}`, `set_agent_paused {agent, paused}`, `assign_agent {agent, book}` (book null frees it), `set_model {model, agent | role}` (one agent, or a role's default; give exactly one of them).

Model work (see "Do the model work yourself"):
- `list_client_tasks`: `{waiting, leased, tasks}`, the requests waiting for you, oldest first, with their ages.
- `get_client_task {role?, book?, task?}`: takes the oldest matching waiting request and holds it for 30 minutes. Returns `{taskId, meta, system, user, schema?, maxTokens?, output, leaseMinutes}` (and `messages` when there are several), or `{none: true, waiting}`.
- `submit_client_task {taskId, text}`: answers it. With a schema the text is checked first: `{accepted: false, problems}` leaves the task yours to fix and resubmit. A task that is gone (aborted, answered, or the engine restarted) is refused.
- `release_client_task {taskId}`: gives it back, `{released}`.

Not available: secrets, settings, model detection, provider limits, the model list, Send to Kindle and stop-now.

A tool that gets bad input (unknown book, unknown role, a story already used) returns an MCP tool error with a message that says what to fix.

## Do the model work yourself

Claude Code can be the model. A provider of `kind: client` (`client/claude-code`, in `config/providers.md`, switched off in the seed: set `enabled: true`) does not call a server. Each request of a job that uses it waits in the engine until you answer it, then the book carries on as if a model had. Nothing is spent. The provider is local and free, has no key and is never marked down.

1. **Choose what you do.** For one book (recommended), put the book itself on Claude: `add_story {..., models: {"writer": "client/claude-code", ...}}` when you give the story, or `set_book_model {book, role, model}` for a book that is already running (`model` null removes it; it also works on a rejected book, so you can set it before `reopen_book`). A book model is kept in book.md (`role_models`). Its jobs of that role try it first, before the agent's own model, and any agent of the role may take them, so no other writer can slip in with its own model. Running jobs of the book switch at once, and the role's list stays the fallback. Other books and the factory's own ideas keep using their models. Or switch a whole role with `set_model {role, model: "client/claude-code"}`. A weaker alternative is to `hire_agent` a writer on `client/claude-code` and `assign_agent` it to the book: the pin only makes that agent prefer the book's jobs, other writers can still take them after 20 seconds, and the pin is freed when the book is rejected.
2. **The loop.** `list_client_tasks`, then `get_client_task`, write the answer, `submit_client_task`, until `get_client_task` returns `{none: true}`. A structured task (`schema` in the answer) wants one JSON object and nothing else; a prose task wants the text only. Fix and resubmit when `accepted` is false: that costs nothing, while a bad answer that gets through spends a repair round.
3. **In parallel.** Each task is leased to one caller, so several sessions or subagents can each take one at a time. A lease lasts 30 minutes; after that the task is waiting again. `release_client_task` gives one back at once.
4. **Stopping and restarting.** Stopping a job or changing its model drops its task (a later submit says "task not found"), and the job goes back to the queue without an attempt. Tasks live in memory: if the engine restarts, the running job is requeued and makes a new task.
5. **Switch back when done.** There is no timeout, so a role left on `client` with nobody answering stalls every book that needs it. `factory_status` shows `clientTasks` so you can see it.

Long prompts: a review of a whole book sends the whole book. That is fine for a short story, but a long novel can be 150,000 words, so keep `client` runs to short formats unless you need it.

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

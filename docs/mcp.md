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
- `factory_status`: paused or not, spend against the caps, local servers, running jobs, books per stage, busy and idle agents.
- `list_books {stage?}`: one compact row per book.
- `get_book {book}`: the book in full, plus the story brief it was made from.
- `read_book_file {book, file, chapter?}`: `file` is brief, pitch, outline, bible, notes or chapter (give `chapter`). Only these files inside the book's folder.
- `list_stories {status?, source?}`: `status` open (default), used or all; `source` user, generated or all.
- `get_story {story}`: one story with its whole brief.
- `list_topics {active?}`, `list_agents`, `list_models` (the models the pickers offer, and each role's default).

Stories:
- `add_story {title?, premise?, plot?, characters?, setting?, style?, sections?, format?, topic?, genre?}`: needs a title or some text. Returns the slug. `format` must be an enabled format id, `topic` an id from `list_topics`.
- `update_story {story, ...same fields, add_characters?}`: only a story no book has started. Only the fields you give change. `characters` replaces the whole list, `add_characters` adds to it (a character with a name already there is replaced), `sections` replaces the extra sections, and an empty string clears a text field, `format`, `topic` or `genre`.

Books:
- `add_book_note {book, text, chapter?, rewrite?}`: an owner note the writers follow from the next job. With `chapter` it is about that chapter, and with `rewrite` as well the chapter is rewritten now.
- `set_book_paused {book, paused}`, `retry_book {book}` (failed books), `rate_book {book, rating, note?}`, `rename_book {book, title}` and `remake_cover {book}` (published books).

Factory:
- `set_factory_paused {paused}`, `ask_researcher {question, book?}`, `add_topic {name, kind, target?}`, `set_topic_active {id, active}`, `check_servers`.

Agents:
- `hire_agent {role, name?, model?}`, `fire_agent {agent, now?}`, `set_agent_paused {agent, paused}`, `assign_agent {agent, book}` (book null frees it), `set_model {model, agent | role}` (one agent, or a role's default; give exactly one of them).

Not available: secrets, settings, model detection, provider limits, the model list, Send to Kindle and stop-now.

A tool that gets bad input (unknown book, unknown role, a story already used) returns an MCP tool error with a message that says what to fix.

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

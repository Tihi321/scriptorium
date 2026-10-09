# Scriptorium

A Windows desktop app where AI agents run a small publishing house: they pick topics, research, outline, write, review, rewrite and publish books, gradually filling a library across every genre, fiction and non-fiction, children's books included. You watch them at work in a pixel-art office and click into any agent to see its full live log.

Status: MVP built on branch `SCP-02_mvp-text-only` (not committed yet). Phases 0 to 9 are done and verified: app scaffold, data folder, model layer with budget caps, the job queue with agents and a scheduler, the book pipeline from bedtime stories to novels with book memory, the pixel-art office and library, the on-demand researcher (Wikipedia and Tavily search, notes with sources), topics in full, the non-fiction variant (fact-checker, references), and code-drawn cover patterns and chapter ornaments. Real books were made on local LM Studio models for 0 USD. Packaging (phase 10) works (`npm run dist`), but an overnight run, reboot resume and cloud models are not verified yet. See `.claude/tickets/SCP-02-scriptorium-mvp-milestone-1-text-only/` (plan, changelog, handoff).

- Design and every decision so far: [docs/design.md](docs/design.md)
- Current handoff for the next session: [.claude/tickets/scriptorium-mvp/handoff.md](.claude/tickets/scriptorium-mvp/handoff.md)

## In short

- **Models:** cloud APIs (DeepSeek, OpenAI, Anthropic, Gemini, Mistral, Kimi, Qwen, GLM, OpenRouter) and local ones (LM Studio, Ollama). A default model per agent type, an override per agent.
- **Agents:** editor-in-chief, idea generator, architect, writers, an on-demand researcher, continuity checker, fact-checker, editors, child-safety and read-aloud reviewers, publisher. Many work in parallel.
- **Shared state:** plain markdown files on disk. Agents, jobs, bibles, research, reviews and logs are all files.
- **Books:** up to 150k words, written scene by scene from a book memory (outline, story bible, summaries, RAG, research notes). Output is EPUB with a template cover.
- **Budget:** a spend counter, caps (40 USD a month, 5 USD a day), and pause and stop buttons.
- **Library:** inside the app for now. Read, open the folder, send to Kindle, rate. A public side comes later.
- **Stack:** Electron, TypeScript, Phaser 3, markdown files, and SQLite with sqlite-vec as a rebuildable search index.

## Development

Windows 11. Node is only available through fnm (v24). In PowerShell, in every new shell:

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
npm install
```

- `npm run dev`: builds the engine, then opens the Electron app. The window shows the engine heartbeat.
- `npm run engine -- --data <dir>`: runs the engine headless with plain Node, no Electron. It builds `out/engine/index.js` first, creates the data folder from `seed/` (existing files are never overwritten), and keeps running with a heartbeat on stdout. Add `--once` to create the folder and exit. Press Ctrl+C to stop.
- `npm run engine -- probe [--model provider/model]`: streams one short reply from LM Studio (and DeepSeek when a key is set), embeds one string, and writes a spend row.
- `npm run engine -- reindex --data <dir>`: rebuilds the search index (`index/library.sqlite`, a cache) from the markdown files, using the embedding model. `npm run engine -- rebuild-reader --data <dir>`: writes the in-app reader folder (`books/<slug>/out/reader/`) for books published earlier.
- `npm run key:set <ENV_NAME>`: stores an API key in the Windows credential store (hidden prompt). The engine looks at the environment variable first, then the store.
- To make a book: switch a topic on (`active: yes` in `topics.md` in the data folder) or drop an idea file into `ideas/`, then run the engine. Formats: bedtime story (toddler and 3-6), short story, chapter book, and the long ones (middle grade, novella, novel) that use the book memory. Finished books are in `books/<slug>/out/<slug>.epub`.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Data folder: `--data <dir>`, else the `SCRIPTORIUM_DATA` environment variable, else `~/Scriptorium`.

If `npm run dev` says "Electron uninstall", the Electron binary wasn't downloaded: run `node node_modules/electron/install.js`.

The SQLite spike (`node:sqlite` + `sqlite-vec`) can be rerun with `node scripts/spike-sqlite.mjs` and `npx electron scripts/spike-electron.cjs`.

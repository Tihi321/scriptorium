# Scriptorium

A Windows desktop app where AI agents run a small publishing house: they pick topics, research, outline, write, review, rewrite and publish books, gradually filling a library across every genre, fiction and non-fiction, children's books included. You watch them at work in a pixel-art office and click into any agent to see its full live log.

Status: design done, implementation not started.

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

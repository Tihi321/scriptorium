# Handoff: Scriptorium MVP

Updated 2026-10-08.

## What this is

Scriptorium is a Windows desktop app where AI agents work as a publishing house and gradually fill a library with books (fiction, non-fiction, children's). You watch them in a pixel-art office. The full design and every decision are in `docs/design.md`. It was worked out with the user over two sessions (2026-10-07 and 2026-10-08) in `C:\projects\Cowork\Computer\ideas\` and moved here when the repository was created.

**No code exists yet.** The MVP plan is in `.claude/tickets/SCP-02-scriptorium-mvp-milestone-1-text-only/plan.md`.

## Repository state

- Path `C:\projects\Personal\scriptorium`, remote `git@github.com:Tihi321/scriptorium.git`, branch `master`, HEAD `fc9fe7a Initial commit`. That commit holds only a one-line README.
- Uncommitted changes (made in the design session and not committed, because the user didn't ask for a commit):
  - `README.md`: modified. Project overview pointing to the design doc and this handoff.
  - `docs/design.md`: new. The full design document, about 640 lines.
  - `CLAUDE.md`: new. Project rules and machine facts for agents.
  - `.gitignore`: new. Ignores `.claude/temp/`.
  - `.claude/tickets/scriptorium-mvp/handoff.md`: new. This file.
- Nothing has been built, tested or run.

## Key decisions (details in `docs/design.md` → Decisions)

- **App:** Windows desktop app built with Electron and TypeScript. The engine runs as a separate background process, so closing the window doesn't stop work. It runs from the tray and resumes after a restart. No agent framework: plain code with a job queue.
- **Office UI:** Phaser 3, simple top-down pixel art like AIOffice (https://www.christianfjung.com/aioffice; open source, Phaser 3 + TypeScript). The UI is mainly for watching:
  - Agent states and task bubbles.
  - Counts by role and provider, provider and model badges, book tags.
  - Lines showing who asked whom.
  - Click an agent for a read-only live terminal log. There is also a log per book.
  - On-screen controls only: add, remove, pause, stop, pause all, stop now, the model picker, and the "Ask researcher" box.
- **Shared state is plain markdown files with YAML frontmatter.** Agents, jobs (in folders `queued`, `running`, `done`, `failed`; moving the file is the status change), bibles, research, reviews, logs, topics, ideas and config are all files. SQLite with sqlite-vec is only a search index that can be rebuilt from the files. The proposed data-folder layout is in the design doc under "Shared files". The data folder is kept outside the code repository.
- **Providers:**
  - All the OpenAI-compatible ones (DeepSeek, OpenAI, Mistral, Kimi, Qwen, GLM, OpenRouter, LM Studio, Ollama) go through one client. Anthropic and Gemini get native adapters.
  - A default model per role, with an override per agent, selectable in the UI and changeable mid-book (applies from the agent's next job).
  - A fallback list per role. Reviewers should use a different model family from the writer.
- **Budget:** a spend counter (per provider, book, role, day and month). Caps of 40 USD a month and 5 USD a day. At a cap, no new paid jobs start and running ones finish. Pause all and stop now.
- **Pipeline:** idea → pitch → (research, if needed) → outline + bible → scene-by-scene drafting with per-chapter reviews → act and whole-book reviews → score threshold → publish or reject. Fully automated; the user only adds ideas, chooses topics and rates books.
- **Long books:** up to 150k words. Each request is built from the book memory (outline, bible, summaries, RAG, research notes) at about 15–25k tokens. Embeddings use the local `nomic-embed-text-v1.5` in LM Studio.
- **Researcher:** on demand only. It can be asked by the architect at the start (if the book needs it), by the user, by a writer before or during a scene, or by a reviewer.
  - Search APIs: Tavily, Brave, SerpApi, SERPHouse and DuckDuckGo, in a configurable order. DuckDuckGo has no official full search API.
  - Plus Wikipedia.
  - Notes are shared across the library.
- **Topics:** the full BISAC list, fiction and non-fiction, all switched off by default. The user switches on the ones to write. Counts are kept per topic. Non-fiction gets its own pipeline variant: required research, a fact base, the fact-checker must pass, and references.
- **Library:** inside the app for now (no public side). Shelves per topic. A book card has Read (HTML preview), Open folder, Send to Kindle (the user enters the addresses), and Rate.
- **Covers and images:** an HTML template cover (title, writer agent's name, genre, year), saved as PNG by Electron. Simple images drawn by code from data, only if easy. No picture books, ComfyUI or image models in the MVP.
- English only.

## Unresolved

- The MVP implementation plan is written (see the SCP-02 ticket folder). Next: implement it.
- Small choices that can be made during implementation:
  - The search API order (proposal: Tavily, then Brave).
  - Starting default models (proposal: DeepSeek for writing and editing, the local `nail-qwen3.6-35b-a3b-mtp` for summaries and checks, nomic for embeddings).
  - Whether AIOffice's licence allows reusing its code.
- None of the LM Studio models have been tested for prose. The first guesses are in the design doc under "Model layer".
- The token and cost estimates in the design doc are unmeasured.

## Machine facts that matter here

- Node is only available through fnm. Verified on 2026-10-08: in PowerShell, `fnm env --use-on-cd | Out-String | Invoke-Expression` gives Node v24.14.0 and npm 11.9.0.
- `gh` is not installed. Git 2.55 with `core.autocrlf=true`. Python 3.13 is available.
- LM Studio is installed (`~\.lmstudio\bin\lms.exe`, with 6 models found by `lms ls`). Ollama is not installed.
- 128 GB unified memory, about 96 GB available to models.
- The user has a DeepSeek API key. An earlier DeepSeek CLI config in `~\.dsh` used the model `deepseek-v4-flash`. Don't read `~\.dsh\.credentials.yaml`. The key should be entered by the user.

## Next steps

1. Read `docs/design.md`, especially Decisions, Shared files, Technology, Pipeline, Book memory and "Milestones → MVP".
2. Ask the user whether to commit the moved files first. They're still uncommitted.
3. Write the MVP implementation plan in `.claude/tickets/scriptorium-mvp/plan.md`, in plan mode. Suggested phases, following the build order in the design doc:
   1. Scaffold the Electron, TypeScript and Phaser app, and the data-folder layout.
   2. Provider registry and the LLM client, with the spend counter and caps.
   3. File-based job queue and agents as files.
   4. A short-book pipeline end to end, with reviewers and EPUB plus template cover output.
   5. Office view and terminal.
   6. Library room.
   7. Researcher and search APIs.
   8. Topics.
   9. Book memory and the long-book pipeline.
   10. The non-fiction variant.
   11. Simple images, if easy.
4. Implement the plan with the global `implement` skill, as the user's CLAUDE.md requires.

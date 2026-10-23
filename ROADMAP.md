# Roadmap

What Scriptorium still lacks on its own. Work that needs the other tools or a production run (live checks, VN lines for VN Studio, the screenplay → video chain, puzzle mysteries) is planned in the creative hub (`C:\projects\Personal\creative-hub\ROADMAP.md`, tickets `HUB-NN` in its `.claude/tickets/`). Most important first. Finished work is in `.claude/tickets/` (SCP-08 client provider, SCP-09 series, SCP-10 to SCP-13 humanizer, script writer, newspaper and client search, SCP-14 the hub roadmap fixes, SCP-16 VN media lines, SCP-17 the screenplay writer, SCP-18 mystery puzzles, SCP-19 this roadmap's own items, SCP-20 to SCP-25 the fixes for the HUB-04 live check) and in `docs/design.md`. Fix items on a ticket branch (`SCP-NN_<what>`) cut from `master`.

## Where it stands (2026-10-23)

- **Merged:** SCP-08 to SCP-19 (SCP-16 to SCP-18 in PR #10; master 5801f09). The HUB-04 live check ran on a8cf243 (SCP-14, SCP-19).
- **SCP-16 to SCP-18 (merged, PR #10):** SCP-16 (VN media lines and aliases), SCP-17 (the screenplay writer) and SCP-18 (mystery with puzzles); the details are in `.claude/tickets/SCP-16-vn-media-lines/`, `SCP-17-screenplay-writer/` and `SCP-18-mystery-puzzles/` (each `changelog.md`).
- **SCP-20 to SCP-25 (done in code, not merged):** the fixes for the findings of the HUB-04 live check, one commit each on `SCP-20-25_fixes` (below; plan in `.claude/tickets/SCP-20-25-hub-fixes/plan.md`).
- **SCP-19 (merged):** every item this roadmap listed then.
  - Fallbacks as an open list, and `last_resort_model`.
  - `story_year` in every outline, and the revise follow-up for the outline, act and thread reviews.
  - The humanizer adds new places, owner-note rewrites are tightened, and `length_over` has a test.
  - The recovery test runs on its own, and `yarn test:electron` passed.
  - Tests: 523 tests, 1 recovery test, 5 UI specs and 1 Electron spec pass.
  - Details are in `.claude/tickets/SCP-19-roadmap-tasks/changelog.md`.
- **Verified live:** full book runs over MCP with Claude as the client writer, the series gate and carry-over (Hartley & Varga book 2), a short story, an article with client web research, and linear and choice VN adaptations that VN Studio built and the user played.
- **Hub tasks that change this repo:**
  - HUB-04 (SCP-14 live check).
  - HUB-06 (VN media lines, `SCP-16`): **done in code** (2026-10-22), merged (PR #10): the VN prompts, the outline `aliases`, the cue lines in `get_script`, EPUB and the humanizer guard (details in `.claude/tickets/SCP-16-vn-media-lines/changelog.md`). Open: the live run with VN Studio (hub step H2), which the user plays.
  - HUB-10 (puzzle mysteries, `SCP-18`): **done in code** (2026-10-22), merged (PR #10): the format `mystery-puzzle-visual-novel`, the puzzle lines, `bible/puzzles.md`, `add_story {puzzles}`, the planting check and the `get_script` beats (contract in `docs/visual-novel.md` "Puzzles", details in `.claude/tickets/SCP-18-mystery-puzzles/changelog.md`). Open: VN Studio's importer (VNO-15), the hub skill and the first production (HUB-10 phases 4 and 5), and a book written by a real model.
  - HUB-11 (screenplay writer, `SCP-17`): **done in code** (2026-10-22), merged (PR #10): the formats `short-film`, `cartoon` and `kids-cartoon`, the `_sp` prompts, `get_screenplay`, `adapt_book` into a screenplay (contract in `docs/screenplay.md`, details in `.claude/tickets/SCP-17-screenplay-writer/changelog.md`). Open: the first screenplay written by a real model, and the video production in the hub (phases 2 and 3).

## Done: findings of the hub's HUB-04 live check (2026-10-22)

A book (`the-umbrella-conductor`, a short story) was written over MCP on the master build a8cf243 (SCP-14 and SCP-19). It published; these are what it found. All six are fixed on `SCP-20-25_fixes` (2026-10-23), one commit per ticket, with tests; not merged yet. The live behaviour is not re-run (no real model, no Electron start).

- **SCP-20 (done): the title changed although the story fixed it.** The publish job takes the book's title when the story brief says `title_fixed` (and tells the publisher); without it the publisher's title still wins.
- **SCP-21 (done): the story year was guessed from a date in the text.** `story_year: null` (the architect's "no fixed year", now written to `book.md`) means no year: nothing is guessed. A book with no `story_year` at all (older books) still gets the year its texts name most, now worded as a guess.
- **SCP-22 (done): `log.md` interleaved parallel calls.** Each job writes through a session: one call at a time streams into a log file, the others hold their text until it is their turn. Cost: a call's text reaches `log.md` and the agent log only when the call before it on that file has ended.
- **SCP-23 (done): the pitch limit.** A pitch over 300 words by more than 3 percent gets one tighten request; whatever comes back is accepted (the shorter answer, else the first).
- **SCP-24 (done): research for a bedtime story.** The format flag `research: false` (set on `bedtime-toddler` and `bedtime-story`; a `bedtime-*` format without the line counts as false, so older data folders behave the same) skips `research_plan` and `research_prep`.
- **SCP-25 (done): a second instance quit silently.** It now writes "another Scriptorium is running (engine pid N, data folder X); this start was not needed" to stderr and `logs/app.log`, and says the running one must have MCP on when this start asked for it. The message code is unit-tested; the quit path was not run (it needs a second Electron start).

## Models

- **Antigravity models** (user decision, 2026-10-22): no Antigravity login of Scriptorium's own. If they are wanted, they come through the ACP proxy (hub ticket HUB-09).

## After SCP-19 is merged

- At the first engine start, check that `~/Scriptorium/config/settings.md` was migrated to `fallbacks` and `fallback_shared`, and that the Models panel shows the three rows.

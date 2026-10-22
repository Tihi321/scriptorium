# Roadmap

What Scriptorium still lacks on its own. Work that needs the other tools or a production run (live checks, VN lines for VN Studio, the screenplay → video chain, puzzle mysteries) is planned in the creative hub (`C:\projects\Personal\creative-hub\ROADMAP.md`, tickets `HUB-NN` in its `.claude/tickets/`). Most important first. Finished work is in `.claude/tickets/` (SCP-08 client provider, SCP-09 series, SCP-10 to SCP-13 humanizer, script writer, newspaper and client search, SCP-14 the hub roadmap fixes, SCP-19 this roadmap's own items) and in `docs/design.md`. Fix items on a ticket branch (`SCP-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, branch SCP-19_roadmap-tasks)

- **Merged:** SCP-08 to SCP-15.
- **Done on `SCP-19_roadmap-tasks`, not merged yet:** every item this roadmap listed.
  - Fallbacks as an open list, and `last_resort_model`.
  - `story_year` in every outline, and the revise follow-up for the outline, act and thread reviews.
  - The humanizer adds new places, owner-note rewrites are tightened, and `length_over` has a test.
  - The recovery test runs on its own, and `yarn test:electron` passed.
  - Tests: 523 tests, 1 recovery test, 5 UI specs and 1 Electron spec pass.
  - Details are in `.claude/tickets/SCP-19-roadmap-tasks/changelog.md`.
- **Verified live:** full book runs over MCP with Claude as the client writer, the series gate and carry-over (Hartley & Varga book 2), a short story, an article with client web research, and linear and choice VN adaptations that VN Studio built and the user played.
- **Hub tasks that change this repo:**
  - HUB-04 (SCP-14 live check).
  - HUB-06 (VN media lines, `SCP-16`).
  - HUB-10 (puzzle-mystery format, later phase, `SCP-18`).
  - HUB-11 (screenplay writer, `SCP-17`).

## Models

- **Antigravity models** (user decision, 2026-10-22): no Antigravity login of Scriptorium's own. If they are wanted, they come through the ACP proxy (hub ticket HUB-09).

## After SCP-19 is merged

- At the first engine start, check that `~/Scriptorium/config/settings.md` was migrated to `fallbacks` and `fallback_shared`, and that the Models panel shows the three rows.

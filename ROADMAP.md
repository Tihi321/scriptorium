# Roadmap

What Scriptorium still lacks on its own. Work that needs the other tools or a production run (live checks, VN lines for VN Studio, the screenplay → video chain, puzzle mysteries) is planned in the creative hub (`C:\projects\Personal\creative-hub\ROADMAP.md`, tickets `HUB-NN` in its `.claude/tickets/`). Most important first. Finished work is in `.claude/tickets/` (SCP-08 client provider, SCP-09 series, SCP-10 to SCP-13 humanizer, script writer, newspaper and client search, SCP-14 the hub roadmap fixes) and in `docs/design.md`. Fix items on a ticket branch (`SCP-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 46e5e8a)

- **Merged:** SCP-08 to SCP-14. SCP-14 closed every Scriptorium item of the hub roadmap. 501 tests and 5 UI specs pass.
- **Verified live:** full book runs over MCP with Claude as the client writer, the series gate and carry-over (Hartley & Varga book 2), a short story, an article with client web research, and linear and choice VN adaptations that VN Studio built and the user played.
- **Hub tasks that change this repo:** HUB-04 (SCP-14 live check), HUB-06 (VN media lines, `SCP-16`), HUB-10 (puzzle-mystery format, later phase), HUB-11 (screenplay writer, `SCP-17`).

## Models

- **Fallbacks as an open list** (user, 2026-10-21). Settings → Models → "One fallback order for every role" has three fixed rows: 1. API, 2. Strata, 3. LM Studio (the aliases `paid`, `strata`, `lmstudio` in roles.md). Wanted: a list of any length, where each row has a dropdown for its kind (API, Strata, LM Studio, client …) and then its model, with add, remove and up/down. For example 1. API, 2. API, 3. LM Studio, 4. API. Strata and LM Studio stop being hard-coded groups. roles.md and the aliases need a matching format, and the existing three-row config migrates to it.
- **Antigravity models** (user decision, 2026-10-22): no Antigravity login of Scriptorium's own. If they are wanted, they come through the ACP proxy (hub ticket HUB-09).

## Smaller follow-ups from SCP-14

- `story_year` is asked for only in `outline.md` and `outline_vn.md`.
- `review_outline`, `act_review` and `thread_check` get `problems` and the calendar, but not the follow-up question for a `revise` with no usable notes.
- The humanizer may rename places but never adds them to the bible.
- The tighten retry skips a rewrite made from owner notes.
- `last_resort_model` is not built (SCP-14 plan, decision 3).
- `length_over` has no test of its own.

## Tests

- `yarn test:electron` was not run for SCP-14.
- The recovery test "kill the engine mid-job" was not isolated and is the most likely to flake.

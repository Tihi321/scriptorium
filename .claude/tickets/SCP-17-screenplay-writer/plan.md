# SCP-17: the screenplay writer

Scriptorium's part (phase 1) of the hub ticket HUB-11 "Screenplay to video" (full plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-11-screenplay-to-video\plan.md`, sections "The screenplay format" and "Phase 1"). Branch: `SCP-16-18_hub-roadmap` (shared with SCP-16 and SCP-18; the hub plan's `SCP-17_screenplay-writer` is not used). Written 2026-10-22.

## Goal

A story idea or a published book becomes a screenplay for a short film or cartoon (shots, voice-over, dialogue, music cues), which the hub's `make-video` skill reads with `get_screenplay` and turns into a video. Scriptorium writes the text only.

## Decisions (from the hub plan; open questions answered with the recommendation, approved by the user)

- D2/Q1: no new role. The architect, writer and line editor use `_sp` prompts.
- D3: screenplay formats carry `script: true` and a new `screenplay: true`; `script` gives them the places block, the tighten text, adaptation, the script layout.
- D4: `get_screenplay` is a sibling tool; `get_script` refuses screenplay books.
- D5: the humanizer is off for the screenplay formats (`humanize: false`).
- D6: screenplay formats are never picked for a topic-less story, only when the story fixes the format or a topic of kind `video` / `juvenile-video` has it. The `## Videos` topics are all off.
- Q2: three formats: `short-film`, `cartoon`, `kids-cartoon`. Aspect 16:9, 9:16 when the brief or style says vertical.
- Q3: dialogue is dubbed (that is the video tool's job; the screenplay only marks `dialogue`, `voice-over` and `off-screen`).
- The SCP-16 cue grammar must not collide: a screenplay does not use `CG:`, `INSERT:`, `AMBIENCE:` (action there); `SFX:` means a sound in both; `SHOT`, `MUSIC`, `TITLE` are not VN cue words.

## Steps

- [x] Format flags: `screenplay`, `runtime` in `src/shared/schemas.ts`; `screenplay: true` in book frontmatter.
- [x] Formats in `seed/config/formats.md` (+ body text), topic kinds `video` / `juvenile-video` (`topics.ts`, `Topics.tsx`, `add_topic`), `## Videos` in `seed/topics.md`.
- [x] `migrateScreenplay` wired into `initDataFolder`; `migrateNewspaper` copies only its own section.
- [x] `formatsForKind(null)` leaves out screenplay formats; `start_book` allows a fixed screenplay format without a topic and says "screenplay" for an adaptation.
- [x] `variant()` `_sp`; `loadPrompt` `_sp` falls back to the plain prompt.
- [x] Prompts `outline_sp`, `draft_chapter_sp`, `rewrite_chapter_sp`, `review_sp`; `yarn seed:hashes`; runtime variables (`runtime_min`, `runtime_max`, `chapter_runtime`).
- [x] Tighten text and reviewer note for a screenplay.
- [x] Adaptation: `adaptBook` accepts any enabled script format; `adapt.ts` names the medium; `adapt_book` description and error text.
- [x] Parser `src/engine/publish/screenplay.ts`; `placeAndTime` and `castOf` exported from `script.ts`.
- [x] Layout: `scriptToXhtml` / `markdownToXhtml` with `screenplay`; EPUB, reader, `books.ts`.
- [x] MCP: `get_screenplay`; `get_script` refusal.
- [x] UI: "Adapt to script", the Script writer panel lists the screenplay formats; demo engine; Playwright spec.
- [x] Docs: `docs/screenplay.md`, `docs/mcp.md`, `docs/visual-novel.md`, `docs/design.md`, `ROADMAP.md`.
- [x] Tests: `tests/screenplay.test.ts` (parser, formats, prompts, migration, layout, end to end on mock models), `mcp.test.ts`, `adapt.test.ts`, `newspaper.test.ts`, `pipeline.test.ts`, `tests/renderer/scriptwriter.spec.ts`.
- [x] `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:ui`.
- [ ] Not in this ticket: `yarn build` (the hub builds the main checkout), a live screenplay written by a real model, the video production (HUB-11 phases 2 and 3).

## Deviations

- Branch `SCP-16-18_hub-roadmap`.
- `yarn build` was not run (it would write the worktree's `out/`; typecheck, lint and the UI specs cover the code).
- The runtime is told to the writers (`runtime_min`, `runtime_max`, `chapter_runtime`) but not enforced; the chapter word target and tighten step stay as they are.

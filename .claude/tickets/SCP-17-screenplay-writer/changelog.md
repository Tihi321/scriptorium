# SCP-17 changelog

## 2026-10-22: SCP-17, the screenplay writer

Scriptorium can write a screenplay for a short film or cartoon, from a story idea or from a published book, and `get_screenplay` returns it as JSON for the hub's `make-video` skill (HUB-11 phase 1). Plan: `plan.md` in this folder (the hub's plan is `creative-hub\.claude\tickets\HUB-11-screenplay-to-video\plan.md`). Branch `SCP-16-18_hub-roadmap` (shared with SCP-16 and SCP-18). Not pushed, no PR. Contract: `docs/screenplay.md`.

### Commits

| Commit | What |
|---|---|
| 1c3a288 | SCP-17: the screenplay writer: formats, prompts, parser, `get_screenplay`, adaptation, migration, UI, tests |
| the commit after it | SCP-17: docs, roadmap, plan and changelog |

### What changed

**Formats and topics**
- `screenplay: true` and `runtime: [min, max]` seconds in a format entry (`src/shared/schemas.ts`); book frontmatter gets `screenplay: true` beside `script: true`.
- Seed formats `short-film`, `cartoon` (topic kind `video`) and `kids-cartoon` (`juvenile-video`): `script`, `screenplay`, `humanize: false`, `max_rounds: 1`, `chapters` 1 to 3 (kids 1 to 2), words 400 to 2,000 (kids 300 to 1,200), runtime 60 to 180 s (kids 45 to 120), reviewers continuity, developmental, line, beta reader (+ child safety for kids). `seed/config/formats.md` explains `screenplay` and `runtime`.
- Topic kinds `video` and `juvenile-video` in `TOPIC_KINDS`, the Topics panel and `add_topic`; a `## Videos` section in `seed/topics.md` (3 topics, all off).
- `migrateScreenplay` (`store/migrations.ts`, wired into `initDataFolder`) adds the three formats and the Videos section to an older data folder, keeps line endings, and does nothing the second time. `migrateNewspaper` now copies only its own section from the seed (the Videos section follows it).

**Choosing and prompting**
- `formatsForKind(formats, null)` leaves out screenplay formats; `start_book` lets a topic-less story that fixes one use it, and tells the editor-in-chief "a screenplay for a short film" for an adaptation.
- `variant()` returns `_sp` (before `_vn`); `loadPrompt` falls an `_sp` task back to the plain prompt, never to the `_vn` one.
- New seed prompts `architect/outline_sp.md`, `writer/draft_chapter_sp.md`, `writer/rewrite_chapter_sp.md`, `line-editor/review_sp.md`; `seedHistory.ts` regenerated. New prompt variables `runtime_min`, `runtime_max` (`formatVars`) and `chapter_runtime` (draft and rewrite).
- The tighten request of a screenplay keeps every SCENE, SHOT, ON SCREEN, MUSIC, SFX and TITLE line; every reviewer of a screenplay gets `SCREENPLAY_CUES_NOTE` (a visual novel still gets the SCP-16 note).

**Adaptation**
- `Engine.adaptBook` takes any enabled script format (the error lists the visual novel and the screenplay ids); the story premise says "screenplay"; `adapt.ts` has screenplay intros (pitch, outline with the runtime, draft, rewrite, review) chosen from the book's own `screenplay` flag. The `adapt_book` description and `format` text list the screenplay formats.

**Parser, layout, tool**
- `src/engine/publish/screenplay.ts`: `parseScreenplay(body, bibleNames, chapter)`, `musicCues`, `runtimeOf`, `parseShotSpec`, `defaultSeconds`. `placeAndTime` and `castOf` are exported from `script.ts`; the cue regexes `SHOT`, `MUSIC`, `SP_SFX`, `TITLE` are in `xhtml.ts`.
- `scriptToXhtml(md, {screenplay})` and `markdownToXhtml` render the cue lines as `vn-cue` notes; a screenplay reads `CG:`, `INSERT:`, `AMBIENCE:` and `END CG` as narration (no collision with the SCP-16 grammar). The flag goes through `books.ts`, the EPUB and the reader.
- `get_screenplay {book, chapter?}` (`mcp/tools.ts`); `get_script` refuses a screenplay book and names it; `get_screenplay` refuses other books.

**UI**: the book card button is "Adapt to script", the Script writer panel lists the screenplay formats with a hint; the demo engine has `short-film` and `cartoon`.

**Docs**: `docs/screenplay.md` (new), `docs/mcp.md`, `docs/visual-novel.md`, `docs/design.md` (Decisions row and History), `ROADMAP.md`.

### Tests

New `tests/screenplay.test.ts` (14 tests: the example gives 1 scene, 3 shots, music cue m1 sh01 to sh03, 16 s; cue lines never speakers; V.O., O.S. and delivery; default lengths; implicit shot and background; bible names and VN cue lines as action; cast and music carry; layout; seed formats; `formatsForKind`; `_sp` prompts and fallback; migration with LF and CRLF; an end-to-end mock-model run where a topic-less `short-film` story is published and parsed). Extended: `mcp.test.ts` (`get_screenplay`, the `get_script` refusal, vertical aspect, `adapt_book` short-film, the tool list), `adapt.test.ts` (adaptBook short-film, the new error text), `newspaper.test.ts` (the old-folder fixture keeps the screenplay formats), `pipeline.test.ts` (topic kinds), `tests/renderer/scriptwriter.spec.ts`.

### Verification

Run in `C:\projects\Personal\scriptorium-wt` (fnm Node):

| Check | Result |
|---|---|
| `yarn vitest run` | 40 files, 555 tests passed (SCP-16 ended at 39 files, 540) |
| `yarn test:recovery` | 1 test passed |
| `yarn typecheck`, `yarn lint` | clean |
| `yarn test:ui` | 5 specs, 4 passed in the full run; `office.spec.ts` "the office renders..." timed out on an agent count once under load and passed alone (2 of 2) |
| `yarn seed:hashes` | run after the last seed edit; a second run changes no content |

### Not run

- `yarn build`, `yarn test:electron` (no change to the Electron shell; the build writes the worktree `out/`).
- The engine was never started and `~/Scriptorium` was not touched. No real model has written a screenplay with the `_sp` prompts: whether it writes valid shots, keeps the runtime and fits words to shots is open until the live run (HUB-11 phase 3, which needs the Scriptorium restart).
- The flow-music-mcp side (FMM-12 `flow_assemble` timeline) was read only: `clips` as `{file, from, to}` or `{image, seconds}` and `music_cues {file, at, until}` fit a shot `seconds` and the music cues' shot ranges; the planner script (HUB-11 phase 2b) does the conversion.

### Deviations

- Branch `SCP-16-18_hub-roadmap` instead of `SCP-17_screenplay-writer`.
- The `_sp` draft prompt says "The chapter should be about N words" (the wording the test helpers read) and gives the runtime in seconds next to it.
- The runtime is told to the writers and reported by `get_screenplay` (`runtimeSeconds`, `runtimeRange`), not enforced.
- The parser does not raise a given shot length to fit its lines (the hub planner does); only a shot with no length gets 4, 6, 8 or 10 seconds from its lines.
- `migrateScreenplay` repeats the format-block logic of `migrateNewspaper` instead of refactoring it (the newspaper migration only got the section-end fix).

### What the hub skill (`make-video`) needs from `get_screenplay`

See the last section of `docs/screenplay.md`. In short: per shot `id`, `seconds`, `framing`, `move`, `action`, `cast` (name and look in this shot), `sfx`, `continuous`, `title`, `lines` (`speaker`, `text`, `delivery`, `kind`); per film `aspect`, `style`, `runtimeSeconds` against `runtimeRange`, `characters` (`looks`, a `voice` note for casting one voice each), `places`, and `music` (`description`, `from` and `to` shot ids). Treat `seconds` as a minimum (raise it to 4, 6, 8 or 10 to fit the lines); a `title` shot is a 3 s still; `voice-over` lines are not seen speaking.

### Follow-ups

- HUB-11 phase 2b (planner, skill) and phase 3 (first production, the Scriptorium restart with the user's go-ahead).
- After the live run: tune the `_sp` prompts (shot lengths, words per shot), consider an engine-side check of the runtime, and revisit `humanize` for screenplays.

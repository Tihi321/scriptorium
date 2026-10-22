# SCP-16: Scriptorium writes VN Studio's media lines and bible aliases

Scriptorium's part of the hub ticket HUB-06 (full plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-06-scriptorium-vn-media-lines\plan.md`). Branch: `SCP-16-18_hub-roadmap` (one branch for SCP-16, SCP-17 and SCP-18; the hub plan's `SCP-16_vn-media-lines` is not used). Written 2026-10-22.

## Goal

A visual novel script carries the lines VN Studio (VNO-08) reads: `CG:`, `INSERT:`, `SFX:`, `AMBIENCE:` and `END CG`. Each bible character entry gets an `Aliases:` sentence. `ON SCREEN:` names only characters. VN Studio then builds a game with CGs, inserts, sound effects and ambience from a Scriptorium book with no hand edits.

## Decisions already made

1. The line syntax is fixed by VN Studio's importer (`src/engine/vn/script.ts`, master 7ff8a2d). Scriptorium copies its regexes verbatim.
2. Aliases are an `Aliases:` sentence in the character's bible entry.
3. `ON SCREEN:` is for characters only; props go to `INSERT:` or narration.
4. Starting Scriptorium needs the user's go-ahead (hub step H2, not this ticket).
5. VN Studio merges two bible entries into one person only when one names the other, so one bullet per person.

## Decisions inferred (accepted by the user)

1. Limits per chapter, said in the prompts: at most 2 `CG:`, 2 `INSERT:`, 4 `SFX:`; `AMBIENCE:` once per scene.
2. Aliases come from the outline JSON (`characters[].aliases`); the engine writes the sentence.
3. The `Aliases:` sentence goes before `Voice:`.
4. Alias cleanup in the engine: no full stops inside an alias, not the own name, not another character's name or alias, deduped, at most 5, each at most 40 characters.
5. No second `Aliases:` sentence when the description already has one.
6. `get_script` gets a `cue` beat `{ type: 'cue', cue, text: string | null }`; one script line, one beat.
7. Cue lines do not end a scene's `background`.
8. EPUB and reader show a cue as a small italic note (`Picture:`, `Close-up:`, `Sound:`, `Ambience:`); stop lines are not shown.
9. Humanizer guard: cue kinds and order are kept, text is not compared.
10. VN Studio's regex is copied verbatim, Croatian keywords too.

## Steps

### Phase 0: baseline
- [x] `yarn test`, `yarn typecheck`, `yarn lint`: 38 files, 523 tests (+1 recovery test); typecheck and lint clean. `tests/lengths.test.ts` "a note rewrite far over its share..." failed once in the full run and passes alone and on the next full runs (timing under load).

### Phase 1: one cue grammar, read everywhere
- [x] `xhtml.ts`: `CUE`, `END_CG`, `cueOf`; `scriptToXhtml` renders `vn-cue`; CSS in `epub.ts` (the reader uses the same book CSS).
- [x] `script.ts`: `cue` beat, cue not a speaker and not ending `background`, `parseLightBible` aliases, `parseScript(body, names, characters)` alias mapping (`alias` on lines and cast entries).
- [x] `series.ts`: `aliasesOf`, `lightBibleEntries` fills aliases.
- [x] `humanizerHandlers.ts`: `scriptStructure().cues`, refusal on changed cues, `fragmentShare` leaves cue lines out.
- [x] `scriptPlaces.ts`: no logic change, test added.
- [x] Tests: `script.test.ts`, new `xhtml.test.ts`, `humanizer.test.ts`, `series.test.ts`, `rewrites.test.ts`.

### Phase 2: aliases in the bible
- [x] Outline schema `aliases`; `aliases?` on the three `OutlineCharacter` types.
- [x] `scriptBible.ts`: `cleanAliases`, `cleanCastAliases`, `scriptBibleLine`.
- [x] Light bible line for `fmt.script`; `withSourceBible` merges the source's aliases.
- [x] Tests: `adapt.test.ts` (seed + pipeline), `xhtml.test.ts` (cleanAliases, scriptBibleLine).

### Phase 3: prompts and engine notes
- [x] `outline_vn.md`, `draft_chapter_vn.md`, `rewrite_chapter_vn.md`, `humanize_chapter_vn.md`, `review_vn.md`.
- [x] `adapt.ts` intros (outline, draft, rewrite); `tighten` keeps the cue lines; `SCRIPT_CUES_NOTE` for every reviewer of a script book.
- [x] `yarn seed:hashes`.
- [x] Tests: `adapt.test.ts`, `lengths.test.ts`, `leak.test.ts`, `humanizer.test.ts`.

### Phase 4: MCP and docs
- [x] `get_script` description and the alias argument of `parseScript`; `docs/visual-novel.md`, `docs/mcp.md`, `docs/design.md`; `ROADMAP.md`; `changelog.md`.

### Phase 5: verify and hand over
- [x] `yarn test`, `yarn typecheck`, `yarn lint`, `yarn seed:hashes` (no diff) - see `changelog.md`.
- [ ] Not in this ticket: starting the engine on `~/Scriptorium`, the live run with VN Studio (hub step H2).

## Deviations

- Branch: `SCP-16-18_hub-roadmap`, not `SCP-16_vn-media-lines`.
- The humanizer test for the cue guard is a unit test of `humanizeProblem` and `scriptStructure`, not a pipeline run with a cue line in the mocked chapter (the default mock draft has no cue lines).
- No negative test that a prose book's review prompt lacks the cue note (the gate is `fmt.script`).

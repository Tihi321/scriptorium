# SCP-45 — language-independent VN book packs (Scriptorium slice)

Repo branch: `SCP-45_vn-pack` (already checked out; never switch/commit). Hub ticket: HUB-16
(`C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\{plan,contract}.md` — read-only here).
The hub contract is authoritative; a local copy is in `contract.md` when the Lead copies it.

## Scope (from the hub plan, "Scriptorium — SCP-45")

1. `src/engine/publish/vnPack.ts`: compiler from `book.md`, `outline.md`, `bible/bible.md`,
   `bible/puzzles.md`, `cover-brief.md`, `chapters/*.md` to `vn/pack.json` (template) and
   `vn/text/<sourceLang>.json` (catalog), exactly per contract: canonical JSON `packHash`
   (`sha256:` over pack without `packHash`), `sourceHash` (authored files, `relpath\0bytes\0`, fixed
   order), atomic writes, pretty 2-space pack.
2. IDs: `vnKey` = VN Studio `slugKey` (transliteration table + hash suffix), collisions `_2`/`_3`
   in bible order + warning, aliases `<charKey>#<n>`, scenes `ch01.s01` (only scenes with beats),
   beats `ch01.s01.b001` (only cast/line/narration/puzzle), choices `${n}:${i}`, endings `${n}`.
3. Beats: `cast|line|narration|puzzle`; `CG`/`INSERT`/`SFX`/`AMBIENCE`/`END CG` become cue
   descriptors on the next beat; `CLUE` → narration + `clueAt`; `EVIDENCE` → narration + insert
   cue `{display:"insert", key}`; `TESTIMONY` statements → line beats; `PUZZLE` → puzzle beat;
   `---` → `breakBefore` on the next scene. No display text in the template, no structure in
   the catalog. Unknown speakers/places → synthetic `speaker_N`/`place_N` + warning.
4. Reuse `parseScript`, `parseLightBible`, `settleScenePlaces`/`moveTrailingCues`,
   `checkBranches`, `puzzleProblems`; do not add a second script grammar.
5. Publish hook in `pipeline/handlers.ts` for every visual-novel `script: true` book
   (screenplays excluded); `vn_version: 2` in `book.md`.
6. MCP `build_vn_pack {book}` and `get_vn_pack {book}`; `get_script` unchanged.
7. Parser hardening (`publish/script.ts`, `publish/xhtml.ts`): `N:`/`NARRATION:`/`NARRATOR:` as
   narration; `C<n>` / bible-key speaker tokens → character; cue/puzzle keywords never speakers.
   No writer/seed prompt migration.
8. Docs: `docs/visual-novel.md` "The VN pack (v2)", `docs/mcp.md` tools.
9. Tests (`tests/vnPack.test.ts` + fixtures): soother, choice, mystery-puzzle; ID stability and
   `slugKey` test vectors; cue attachment/trailing cue; aliases; unknown speaker/place;
   choices/endings; puzzles; template has no display text; catalog has no structure/asset ids;
   MCP shapes. Fixtures under `tests/fixtures/vn-pack/{soother,choice,mystery-puzzle}/` with the
   generated `vn/pack.json` + `vn/text/en.json`, copied to
   `C:\projects\Personal\creative-hub\.claude\temp\hub16-fixtures\`.
10. Verification: `yarn test` (includes `test:recovery`), `yarn typecheck`, `yarn lint`.

## Checklist

- [x] Read implementer role, hub plan, contract
- [x] Claim shared task-1
- [x] Ticket folder + plan/notes
- [x] `src/engine/publish/vnKey.ts` (vnKey + shared test vectors) + `translit.ts` copied from VN Studio
- [x] `src/engine/publish/vnPack.ts` (compiler, hashes, atomic write)
- [x] Publish hook + `vn_version: 2`
- [x] MCP `build_vn_pack` / `get_vn_pack`
- [x] Parser hardening (`N:`/`NARRATION:`/`NARRATOR:`, `C<n>`/key/alias-key speaker tokens, reserved labels, stage directions)
- [x] Cast/place rules: `ON SCREEN:` casts a bible character or alias only (props dropped with a warning); an unknown place keeps
  `placeKey: null` + `placeText`; synthetic `speaker_N` only for a real speaker line
- [x] `line.expression` inheritance: no bracket = the speaker's last expression in the scene (neutral only when none yet)
- [x] `SCENE:` parsing as VN Studio's `parseSceneLine`: first full stop splits the description, last comma is a time only for a
  ≤4-word known time word; pack `time` stays as written; `##` heading keeps the plain rule
- [x] Fixtures + generated packs, copied to hub temp; Lead confirmed the shape changes (`aliasKey`, `sourceHash` without book.md)
- [x] `tests/vnPack.test.ts` (+ MCP assertions)
- [x] Docs `docs/visual-novel.md` "The VN pack (v2)" and `docs/mcp.md`
- [x] yarn test (679 + recovery), yarn typecheck, yarn lint
- [x] Real-book compile check (soother: 9 characters incl. 4 synthetic speakers, 7 places, 430 beats, 17 warnings)
- [x] P4 hand-off pack at `.claude/temp/real-soother/` (packHash `cf4b8ed7…`, live book untouched)

Result: see `notes.md`. No deviation from the updated contract; `expressions` is omitted (optional), line beats carry an
optional `aliasKey`, expressions are inherited per scene, `SCENE:` is read as VN Studio's `parseSceneLine` (time as written),
`sourceHash` excludes `book.md`, unknown places keep a null key, ON SCREEN props are dropped. See notes.md "Verification" for
the exact runs.

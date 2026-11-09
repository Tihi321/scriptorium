# Changelog SCP-56

## 2026-11-09 SCP-56: fixes from the REQ-0004 run (REQ-0005 P3)

Outcome: items 1-8 built on branch `SCP-56_req0004-fixes` (from master 0fa42ff). Not pushed.

- seed/topics.md: two philosophy rows.
- src/engine/pipeline/handlers.ts: `publishKeywords` (4-8 keywords, top-up from subjects/topic/genre), used by the article and book publish paths.
- src/engine/pipeline/humanizerHandlers.ts: new-name check accepts singular/plural forms, group-noun endings and a demonym list; refusals also go to the engine log.
- src/engine/mcp/server.ts: `: keepalive` SSE comment every `keepAliveMs` (default 15 s).
- seed/config/providers.md, src/engine/store/migrations.ts, src/renderer/ui/ModelsDialog.tsx: acp port 8787; `migrateAcpProvider` rewrites a switched-off entry with exactly the old 7461 URL.
- src/engine/research/notes.ts, researchHandlers.ts, nonfiction.ts: page excerpts section (fact checker only), excerpt fallback, source-excerpt cap 500.
- src/engine/research/clientSearch.ts: same-URL merge. researchHandlers.ts `gatherPages`: seen key url+excerpt, honest log line.
- docs/design.md, docs/mcp.md, ROADMAP.md.

Deviations: items 3, 4, 5 share files, so they are one commit. Two existing tests in tests/research.test.ts changed (they asserted the old from_knowledge fallback and a note without page text). The dropped D4 live-folder edit was not done (other piece). Docs say the hub uses 8787 (user decision D2).

Verification: `yarn vitest run` 58 files / 733 tests pass; `yarn typecheck`, `yarn lint` clean. T4 reproduction test failed before the fix (idle timeout 500 ms). Not run: the real app, a live wait_for_book client, a live search.

Commit status: committed on the branch, not pushed.

## Polish round 1 (REQ-0005)

- M1: the extraction fallback (`researchHandlers.ts`, 3a) writes no fact lines and no `## Source excerpts`; the pages go only under `## Page excerpts`, and `NoteStore.write` takes the note's sources from those pages when there are no facts and no source excerpts. `candidateFacts` finds no line, `formatNote` leaves the section out, so verbatim page text reaches neither a key fact nor a writer prompt; the fact checker sees it (later research goes through `formatNote`, which leaves it out). Test: `tests/researchFigures.test.ts` (fallback test, with an injection string in the page).
- L1: `factCheckNotes` wraps the page excerpts in `<<<PAGE_EXCERPTS>>>` / `<<<END_PAGE_EXCERPTS>>>`; the body is cut to the room left after the label and markers, and `<<`/`>>` runs in it are removed.
- L2: `GROUP_ENDING` counts only after "the", "these", "those", "many", "most", "some", "all" or "of" (`groupNounInContext`); "then Evans came in" is a name again. Rows added in `tests/humanizerGuards.test.ts`.
- L3: moot, the fallback no longer writes source excerpts (only the hidden page excerpts), so the NOTE_CHARS comment is true again.
- L4: `migrations.ts` doc comment names the port rewrite.
- L6, M2: `docs/design.md` (SCP-44 row, SCP-56 row with the M1 rule, research notes section, publishKeywords note).

## Polish round 2 (REQ-0005)

- Humanizer group nouns (`humanizerHandlers.ts`, `groupNounInContext`): a group-ending word is also accepted after "and", "or" or a comma when the word before is a demonym or an accepted group-ending word ("the Greeks and Romans", "the Stoics and Epicureans"), and after a lower-case adjective (early, ancient, modern, later, first, many, devout, pious, pagan, medieval, classical, contemporary, fellow, other). "then Evans came in" and "Captain Evans" are still names. Rows added in `tests/humanizerGuards.test.ts`.
- `docs/design.md`: the SCP-56 Decisions row describes the rule as built; the REQ-0005 polish rule is its own sentence after the extraction fallback and the ACP sentence is whole again; the History line mentions the rule.
- `tests/researchFigures.test.ts`: the `unmergedNotes` result is asserted to contain the fallback note before `candidateFacts` is checked.
- This changelog: the polish round 1 M1 line corrected; `plan.md` acceptance row 5 notes the heading change.

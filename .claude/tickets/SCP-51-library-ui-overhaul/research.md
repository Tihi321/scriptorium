# SCP-51 research: library "Other" shelf, book types, UI architecture

## Question
Why do so many books land on the "Other" shelf, which book types exist for a library filter, how is the renderer built and tested, and which design rules bind a UI overhaul?

## Answer
- **Root cause (confirmed):** `buildShelves` groups published books by `book.topic.id` only. Any book whose `book.md` has `topic: null` goes to the synthetic `_other` shelf named "Other" (`src/renderer/store/shelves.ts:49-52, 66`). Nothing else (format, genre, source_book, series) is consulted. The data folder has 20 such books of 33.
- **Why topic is null (confirmed in data and code):** a book gets its topic only from its story (`topic: topic?.id ?? null`, `src/engine/pipeline/handlers.ts:526`). All 20 come from owner stories saved with `topic: null`: 11 adaptations (`adaptBook` makes a story with "no topic", design.md line 100), 2 series books, 2 short stories, 2 picture books, 1 bedtime story, 2 mystery-puzzle VNs (that format has `kinds: []`, so no topic can carry it).
- **Duplicates are not duplicate records:** the same title is a source book plus its adaptations (VN, choice VN, short film), each its own book (slugs `-2`, `-3`, `-vn`, `source_book` set). The original may sit on a topic shelf, the adaptation sits in Other. The whiteboard shows title only plus a per-slug colour dot (`bookColor(slug)`), so same titles look like repeats.
- **Book types:** 22 formats (list below). A filter by format can run entirely in the renderer from the snapshot (`BookSummary.format`). The "with choices" flag is not in the snapshot (see section 2).

## Path through the code

### 1. Shelves and "Other"
- `src/renderer/ui/Library.tsx:36-41` collects summaries with `medium !== 'article'`, calls `buildShelves(topics, books)`.
- `shelves.ts:47-68` (confirmed): published non-article books bucketed by `b.topic?.id ?? '_other'` (`:51`); a shelf per topic in topics.md that is `active` or has books (`:62`); article-kind topics skipped (`:57`); leftover buckets appended with `topic: null`, named "Other" for `_other`, else the book's own `topic.name` (`:66`). Shelf header: `"N of T done"` from the topic row, or `"N books"` when `topic` is null (`Library.tsx:60`). Rejected books sit in a collapsed "Rejected" shelf (`Library.tsx:71`).
- `src/engine/summary.ts:94` (confirmed): `topic` = `d.topic ? {id, name: d.topic_name ?? topic row name ?? id} : null`; `kind: topic?.kind ?? null` (`:95`); `sourceBook` (`:99`). `series` is NOT in `BookSummary`.

### Real data (confirmed). Data folder `C:\Users\Infplane\Scriptorium` = `~/Scriptorium` (`resolveDataDir`: `--data`, else `SCRIPTORIUM_DATA`, else home `Scriptorium`, `src/engine/store/dataFolder.ts:42-46`)
33 books, all `published`; all have `cover_png: done` and `out/cover.png` except the one article. Counts from `books/*/book.md` frontmatter:

| count | format | topic |
|---|---|---|
| 11 | novella | fic-action-and-adventure |
| 8 | visual-novel | null (all adaptations) |
| 2 | novella | null (the-clockless-god, the-hour-that-happens-twice: series the-hartley-varga-mysteries, index 1 and 2) |
| 2 | short-story | null (the-lighthouse-that-kept-lists, the-local-patch) |
| 2 | short-film | null (adaptations of those two) |
| 2 | kids-picture-book | null (the-bell-and-the-bicycle, the-snail-and-the-salad) |
| 2 | mystery-puzzle-visual-novel | null (trap-room-at-the-lanterna, winter-garden-clock) |
| 1 | choice-visual-novel | null (the-clockless-god-2, adaptation) |
| 1 | bedtime-story | null (the-umbrella-conductor) |
| 1 | kids-choice-visual-story | `my-after-petra-...` (the soother book) |
| 1 | article | news-technology (kept out of the Library) |

Other = 20 = 11 adaptations (8 VN + 1 choice VN + 2 short-film: circuit-breaker-2, echoes-in-the-deep-2, silent-signal-2, silent-summit-2, salt-line-2, clockless-god-2 and -3, lighthouse-...-2 and -vn, local-patch-2 and -3; their `genre` still says e.g. "Action & Adventure") + 2 series novellas + 2 short stories + 2 picture books + 2 mystery VNs + 1 bedtime story. The field that sends each there: `topic: null`; for the 11, `source_book` explains the null (their ideas have `topic: null`, e.g. `ideas/circuit-breaker-2.md`).
- Hypotheses: no topic = yes, the only cause. Series books: yes, 2 of them (topic null in their idea). Free-text topic: only the soother. Duplicate records or version copies: no (no repeated slug; every repeat is a different format).
- The repeated titles on the A&A shelf: the 5 originals (circuit-breaker, echoes, salt-line, silent-signal, silent-summit) are novellas on topic `fic-action-and-adventure`; their VN adaptations are in Other.

### The long-prompt shelf and "11 of 5 done"
- Soother book: topic `my-after-petra-thrown-soother-over-the-mountains-it-went-into-l`, `topic_name` = the whole prompt (`books/the-soother-.../book.md:8-9`); `topics.md:637` has the row under `## My topics` (kind juvenile-visual-novel, active yes, target 1, done 1). Created through `addTopic` (`src/engine/engine.ts:1212`, `src/engine/store/topics.ts:194-208`: id `my-` plus slug of the name), from the Topics panel (`Topics.tsx:29`) or MCP `add_topic` (`src/engine/mcp/tools.ts:1053`). Which one was used is inferred-unknown (no idea file remains for it). The shelf name is just that topic name.
- "11 of 5 done": `~/Scriptorium/topics.md:22` is `fic-action-and-adventure | no | 5 | 11`. `done` is a stored counter in topics.md adjusted by the engine (`topics.ts:122,149-175`), shown as `done`/`target` (`Library.tsx:60`). 11 real books carry that topic (confirmed). Why it passed 5 is inferred: `hasRoom` (`handlers.ts:170`) gates only factory-picked starts; owner-story starts skip it (`handlers.ts:153-160`), and the topic is now switched off (`no`).
- The yellow banner is `pipeline.ts:539` (`warnOnce`), shown as the last warning only (`App.tsx:47`, `.warnbar`).

### 2. Book types
- Formats (seed `seed/config/formats.md`; live `~/Scriptorium/config/formats.md` has the same 22, all `enabled: true`): bedtime-toddler, bedtime-story, short-story, chapter-book, middle-grade, novella, novel, visual-novel, choice-visual-novel, gamebook, kids-visual-story, kids-choice-visual-story, kids-choice-book, nonfiction-short, nonfiction-kids, article, feature-article, short-film, cartoon, kids-cartoon, mystery-puzzle-visual-novel, kids-picture-book.
- Flags (zod, `src/shared/schemas.ts:~221-225` for `choices`): `script: true` = visual-novel, choice-visual-novel, kids-visual-story, kids-choice-visual-story, short-film, cartoon, kids-cartoon, mystery-puzzle-visual-novel, kids-picture-book. `choices: true` = choice-visual-novel, gamebook, kids-choice-visual-story, kids-choice-book. `screenplay: true` = short-film, cartoon, kids-cartoon. `puzzles: true` = mystery-puzzle-VN. `juvenile: true`, `nonfiction: true`, `article: true` as named.
- In the renderer snapshot (`src/shared/protocol.ts:132-191`): `BookSummary` has `format` (id), `kind` (topic kind; null when topic null), `medium` (book or article), `sourceBook`, optional `gamebook` (true when branch data exists, `summary.ts:126`), stage, rating, score, words, cover fields. It does not have series, script, choices, juvenile or the format's display name. `SnapshotEvent.formats` is `FormatSummary {id, name, kinds}` (`protocol.ts:254-259, 294`), enabled formats only.
- So a type filter is renderer-only if it uses `format` ids (names from `s.formats`, falling back to the id for a disabled format). "With choices" needs `FormatSummary`/`BookSummary` extended (engine snapshot builder, `protocol.ts`, `demo/fake.ts`) or a hard-coded id set; `gamebook === true` is only "has branch data".

### 3. UI architecture (confirmed)
- React 19 with a small store (`src/renderer/store/store.ts`, 499 lines, `officeStore`, `useOffice` hook); Phaser 3 only in the Office tab (`office/scene.ts` 28 KB). All other screens are plain React panels. One global stylesheet `src/renderer/styles.css` (921 lines; no CSS modules or framework). Entry `main.tsx`, `App.tsx` (75 lines). Dev-only fake engine (`demo/fake.ts` 35 KB, `demo/library.ts` 9.6 KB), enabled by `?demo` or no `window.scriptorium` (`main.tsx:12`).
- CSS: dark theme, variables only `--bg #12161e --panel --panel2 --line --text --dim --accent #7df3ff --warn --bad --good` (`styles.css:1-11`). Fonts: Segoe UI (`:12`), Consolas for logs (`:211,357`), Georgia once (`:845`). Hex colours are also hard-coded in `StatusBar.tsx` and `store/model.ts` (`bookColor`, `providerColor`).
- Layout: `.app` grid rows auto / 1fr / auto (`:72`); `.topbar` (`:76`) = brand, `StatusBar`, tabs (Office, Library, Newspaper), Models, Settings, Hire, `Controls` (Pause all, STOP NOW) (`App.tsx:27-50`); `.middle` = `.stage` plus `.sidebar` 310px (`:151`) with Whiteboard, AgentPanel, SideTools; Terminal, BookCard, DraftReader, Settings, Models are overlays.
- Header crowding: `ui/StatusBar.tsx:58-99` prints engine pill, Servers, MCP, working/waiting/idle, the per-provider breakdown and one `role w/w/i` entry per role (`.breakdown.roles`) in a single line.
- Library: `ui/Library.tsx` (94 lines). `.library` grid `minmax(0,1fr) 260px` (`styles.css:444`): `.shelves` (header + `.shelf-row` of `BookOnShelf`, 84px covers, `:454-515`) and `.library-side` = `Series.tsx` (158) + `Topics.tsx` (134). Pure helpers in `store/shelves.ts` (126): `buildShelves`, `groupTopics`, `emptiestFirst`, `frontPage`.
- Whiteboard: `ui/Whiteboard.tsx` (152). Columns from `STAGE_COLUMNS` (`model.ts:171`); each chip shows `b.title` and a swatch `bookColor(slug)` (`model.ts:167`, hash of slug to HSL). Format and topic appear only in the info block when a book is highlighted (`Whiteboard.tsx` "Format" row, "Adapted from" row).
- Cards: `ui/BookCard.tsx` (257): `kind, format` (`:136`), adapted-from (`:138-141`), Script writer button only for non-adaptations outside visual-novel/video kinds (`:211`).
- Covers: `CoverImage` (`Library.tsx:11-23`) shows the real `out/cover.png` (`bookUrl`, `?v=coverVersion`), else a `.cover-fallback` tile coloured by `bookColor(slug)` with the title. The beige covers are the real PNGs: one template `seed/templates/cover.html` for every book (I viewed `books/the-clockless-god-2/out/cover.png`: beige wave pattern, brown frame, genre line, title, author, "AI-written 2026"). It carries no format or adaptation marker, so novel, VN and film of one title look the same. Coloured tiles appear only when the PNG is missing or fails to load (inferred; in the data every book has a PNG, so the user's colour tiles are unexplained, not reproduced).
- Main process: `src/main/index.ts` (BrowserWindow, tray, headless), `cover.ts`, `files.ts`, `engineClient.ts`; preload `src/preload/index.ts`; the engine is a separate process (`vite.engine.config.ts`).

### 4. Tests and build (confirmed from `package.json` and configs)
- `yarn test` = `vitest run` (`tests/**/*.test.ts`, node env) plus `yarn test:recovery`. Renderer logic: `tests/renderer/store.test.ts` covers `buildShelves` (`:416`), `groupTopics` (`:430-443`). `yarn typecheck`, `yarn lint`.
- `yarn test:ui` = Playwright against the Vite dev harness (fake engine, port 5199, 1500x950, `playwright.config.ts`): `tests/renderer/office.spec.ts` (shelves and "Empty shelf" `:152-186`, topic overview, filter, whiteboard text, `tab-library`, `shelf-<topic>`, `shelf-book-<slug>`, `topic-filter`, `topic-active-only`, `topic-count-*`), `newspaper.spec.ts` (`:33-36`), `series.spec.ts`, `scriptwriter.spec.ts`. A re-layout must keep these `data-testid`s and texts.
- `yarn test:electron` (build, then `app.electron.spec.ts`: statusbar text "engine", whiteboard, library shelf, topic filter, card, reader, screenshot `.claude/temp/p5-electron-library.png`). `yarn test:packaged` = `dist:dir` then `packaged.electron.spec.ts`.
- Windows exe: `yarn dist` (NSIS plus portable, then `scripts/verify-package.mjs`), `dist:installer`, `dist:portable`, `dist:dir` (unpacked), output `release/`. Node via `fnm exec --using default yarn ...`.
- Screenshots: `yarn dev:ui` (`vite --config vite.ui.config.ts --open /?demo`) uses the fake engine and needs no data folder; `demo/library.ts` would need adaptation books and topic-less books to reproduce Other. For real data, never point the app at `~/Scriptorium` (the engine writes there: migrations, jobs, logs, index, `engine.lock`, and may start spending). A safe way is a copy under `.claude/temp/` started with `--data <copy>` / `SCRIPTORIUM_DATA`, with the factory paused or no providers; not verified that it starts quietly.

## 5. Constraints
- CLAUDE.md: UI is for watching; keep on-screen controls to those in the UI decision row; everything else in markdown config.
- UI row (`docs/design.md:52`, 2026-10-08) lists the controls. Rows that say they add to it: Own topics (`:73`), Story briefs (`:92`), Series (`:98`), Script writer (`:100`), Newspaper (`:101`), Custom providers (`:136`); related control rows: Failed books/Retry (`:77`), Book info/Read draft/Pause book (`:80`), Local servers/Check now (`:82`), Assign to a book (`:83`), Models dialog (`:85`).
- Recording pattern: a new Decisions row (ticket, branch, what and where, "Adds to the on-screen controls in the UI row"), the UI row's list extended, the relevant section edited, and a dated line in the History at the bottom (last entries 2026-10-24). A filter is a new control, so it needs the row. Filter state should stay UI-only (not written to files).
- Design lines that a regrouping touches: "library shelves are the topics" (`design.md:327`) and the Library row (`:56`).
- ROADMAP.md: nothing about UI or Library layout; last tickets SCP-49/50 (SCP-51 free).

## What the plan needs
1. Choose the grouping for topic-less books (renderer-only preferred). Options: (a) shelves by type for Other (Visual novels, Short films, Picture books, Series ...); (b) place an adaptation next to its `sourceBook` (both are in the snapshot); (c) add `series` to `BookSummary` and shelve by series; (d) engine side: give adaptations the source topic (contradicts the Script writer "no topic" decision, changes counters; not recommended).
2. Type filter in `Library.tsx` (UI state); buckets from `format` ids, optionally extend `FormatSummary` with `script`, `choices`, `juvenile`, `screenplay` (touches `protocol.ts`, snapshot builder, `demo/fake.ts`).
3. Format badge and "adapted from" cue on shelf books and whiteboard chips, so same titles are told apart; a type marker on the fallback tile.
4. Header: fold the role breakdown into a popover or a summary, group Pause all/STOP NOW; keep the `data-testid`s `statusbar`, `count-*`, `server-*`, `servers-check`, `mcp-status`, `tab-*`, `models-open`, `settings-open`, `hire-open`.
5. Long shelf names: CSS ellipsis plus `title`.
6. Styling: more variables (spacing, radius, type scale, shadows), split `styles.css` by section; the Phaser office is out of scope.
7. Docs: Decisions row, UI row mention, History line. No seed prompt or template change is needed (else `yarn seed:hashes`).
8. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:ui`, `yarn test:electron`; screenshots from demo data.

## Risks
- `data-testid` and text assertions in office.spec, newspaper.spec and app.electron.spec.
- Whiteboard and Library counts must still show every book (33 published, adaptations included).
- New `BookSummary`/`FormatSummary` fields touch the engine snapshot, the fake engine and the Electron spec.
- A disabled format has no `FormatSummary`: filter needs an id fallback.
- Running the real app on the real data folder is unsafe.

## Open questions
- Where the user's coloured cover tiles come from, since every book has `cover.png` (app not run, no screenshot taken).
- Which entry created the long-prompt topic (Add-a-topic line vs MCP `add_topic`).
- Exactly how 11 books passed target 5 (counter history is not in the data).
- Whether adaptations should be grouped under their source or by type.
- Whether the engine can start quietly on a data-folder copy for a screenshot.

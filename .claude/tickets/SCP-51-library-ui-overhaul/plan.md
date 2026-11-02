# SCP-51: Library and header overhaul (plan)

Request (user): "make ui far better for both scriptorium and vn studio, add to library filter as well so i can filter then by choices book or other types, not sure as well why so many books is in other ... make these apps far more userfriendly and nicer to look at".
Companion plan: `C:\projects\Personal\visual-novels-orchestrator\.claude\tickets\VNO-57-library-ui-overhaul\plan.md` (same type taxonomy, same badge hues).
Research: `research.md` in this folder. Reading: the full one (filter, shelves, header, whiteboard, tokens), not a CSS-only refresh.

## Scope
1. **"Other" fix, display only.** A book's shelf is its topic; else its source book's topic (an adaptation sits next to its source); else a shelf named after its type group. No data migration: adaptations are created with `topic: null` on purpose (design.md, Script writer row, line ~100) so they never count toward a topic's `done`/`target`. Writing a topic into their `book.md` would change the topic counters and the factory's topic picking. Only the renderer's grouping changes.
2. **One type taxonomy** (`src/renderer/store/bookTypes.ts`), shared in meaning and hues with VN Studio.
3. **Library:** type chips with counts, a "With choices" toggle, title search, a Group by Topic/Type switch, cover badges, "from <source>" lines, adaptations shelved right after their source, long shelf names cut with the full name on hover, a side column with Topics/Series tabs that you can collapse.
4. **Header:** two rows. The primary row holds the brand, the view tabs, Models/Settings/Hire, Pause all and STOP NOW. The status strip holds the service health, the work counts and a **Team** popover with the role counters. The warning banner becomes a one-line strip you can dismiss.
5. **Whiteboard:** a type badge on each chip, a title that says "adapted from", and the Published column capped at 6 with a Show all toggle.
6. **Tokens:** colour, type scale, spacing, radius, focus. Bundled display font. Applied to the shell and the Library; other screens pick up the tokens through aliased variables.
7. **Docs:** a Decisions row, the UI row, the Library row, the "library shelves are the topics" line (~327) and a History line.

## Out of scope
- Any engine, protocol or `book.md`/`topics.md` change. No migration. `FormatSummary`/`BookSummary` stay as they are (see Task 3 for the reason).
- The Office tab's Phaser scene, the newspaper front page, the BookCard, the Models, Settings, Hire, Terminal and DraftReader dialogs, AgentPanel and SideTools beyond picking up tokens.
- The cover template (`seed/templates/cover.html`). The teal covers are real PNGs: the template takes its palette from the genre (verified with `books/circuit-breaker/out/cover.png`, teal with a gold frame). The beige ones are a different genre palette. The research's "fallback tile" theory is wrong; nothing to fix.
- "11 of 5 done": a true stored counter (`topics.md:22`, `fic-action-and-adventure | no | 5 | 11`; owner-story starts skip `hasRoom`). Explained in the report, not changed.
- Renaming the long prompt-named topic: it is the owner's data. Display fix only (ellipsis plus a `title`).

## Design direction: "lamplit scriptorium"
The subject is a copying room run at night. Ink-dark lapis surfaces, vellum-coloured text, gilt for what is primary, and rubric red only for STOP NOW and errors, as in the red initials of manuscripts. The one bold element is the **shelf ledge**: books stand on a thin gilt rule with a soft shadow beneath, so the Library reads as a real bookcase. Everything else stays quiet.

Palette tokens (`styles/tokens.css`, `:root`):
| token | hex | use |
|---|---|---|
| `--ink-0` | `#0f121a` | app background |
| `--ink-1` | `#161a25` | panels, header row 1 |
| `--ink-2` | `#1e2331` | raised: popovers, chips, inputs |
| `--ink-3` | `#0b0d13` | status strip, shelf floor |
| `--rule` | `#2c3344` | borders, dividers |
| `--vellum` | `#e9e2d0` | text |
| `--vellum-dim` | `#a29b89` | secondary text |
| `--gilt` | `#d6b05a` | primary accent: active tab, shelf ledge, selected chip |
| `--lapis` | `#7590ff` | focus ring, links, info |
| `--rubric` | `#d8523d` | STOP NOW, errors, "off" servers |
| `--verdigris` | `#4fb48c` | ok, working |
| `--ochre` | `#e3a63b` | warnings, waiting |
Type-badge hues (the same in VN Studio): `--t-vn #b49cff`, `--t-choices #ff8fb3`, `--t-picture #7fd0e6`, `--t-scripts #6fd3b0`, `--t-puzzle #f0c06a`, `--t-nonfiction #9fb4cc`, `--t-stories #c9b791`.
Old variables are aliased so every other screen follows: `--bg: var(--ink-0)`, `--panel: var(--ink-1)`, `--panel2: var(--ink-2)`, `--line: var(--rule)`, `--text: var(--vellum)`, `--dim: var(--vellum-dim)`, `--accent: var(--gilt)`, `--warn: var(--ochre)`, `--bad: var(--rubric)`, `--good: var(--verdigris)`.

Type: display **Alegreya** (bundled with `@fontsource/alegreya`, weights 500 and 700, plus `@fontsource/alegreya-sc` 500 for the brand only). Body stays `'Segoe UI Variable', 'Segoe UI', system-ui` (the family VN Studio shares). Scale (`--fs-*`): 11, 12, 13 (base), 15, 18, 22, 28 px. Display uses: brand 18 SC, page title 22, shelf name 17, empty states 15 italic. No all-caps labels and no letter-spaced eyebrows. Meta text uses commas, not middle dots.
Spacing `--sp-1..6`: 4, 8, 12, 16, 24, 32. Radius: `--r-xs 2px` (book covers: books have near-square corners), `--r-sm 4px` (chips, badges, inputs), `--r-md 8px` (panels), `--r-lg 12px` (popovers). Shadow `--shadow-pop: 0 8px 24px rgb(0 0 0 / .45)`; shelf shadow `0 6px 10px -6px rgb(0 0 0 / .7)`. Focus: `:focus-visible { outline: 2px solid var(--lapis); outline-offset: 2px }` everywhere. Motion: only the popover and drawer open (120 ms), disabled under `prefers-reduced-motion`.

Header anatomy (row 1 is 44 px on `--ink-1`; row 2 is 26 px on `--ink-3`):
```
Scriptorium   Office  Library  Newspaper          Models  Settings  Hire   [Pause all] [STOP NOW]
─────────────── gilt underline under the active tab ───────────────────────────────────────────────
● engine  ● LM Studio off [Check now]  ● Strata ×4  ● MCP :7341 | ● working 3  ● waiting 1  ● idle 24 | DeepSeek 0/0/28 | Team ▾
⚠ Pipeline: the cover renderer is not available, covers stay pending                          [×]
```
- Row 1: the brand in Alegreya SC gilt; view tabs as text with a 2px gilt underline when active; Models/Settings/Hire as quiet ghost buttons; `Controls` pinned right (Pause all as an outlined button, STOP NOW filled `--rubric`).
- Row 2: `StatusBar`, one line, `overflow: hidden`. The provider breakdown keeps the provider colours. Team ▾ opens `TeamPopover`: a two-column list of roles with `working/waiting/idle`, roles with any working or waiting first (by working desc), then idle roles dimmed. At most 420 px wide, closes on Esc or an outside click.
- Warn strip: one line with an ellipsis; a click expands the full text; × hides it until a different warning arrives.

Library anatomy:
```
Library                              32 published, N shelves      [Search titles…      ]  Group by [Topic|Type]  [◧ Topics & series]
[All 32] [Novels & stories 15] [Visual novels 10] [Picture & bedtime 3] [Scripts & film 2] [Puzzle 2]  |  [◇ With choices 2]
┌──────────────────────────────────────────────────────────────────────────────────┐ ┌ Topics | Series ┐
│ Action & Adventure                       16 books, 11 of 5 for the topic          │ │ (TopicOverview  │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                                             │ │  or SeriesPanel)│
│ │cover│ │VN  │ │cover│ │VN  │ │Film│   <- badge on the cover's top-left corner  │ │                 │
│ └────┘ └────┘ └────┘ └────┘ └────┘                                             │ │                 │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ gilt ledge + shadow ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ │                 │
│ Circuit   Circuit  Echoes in  Echoes ...                                         │ └─────────────────┘
│ Breaker   Breaker  the Deep   from Echoes in the Deep  <- dim italic "from" line │
│ Visual novels                            4 books                                 │
```
Book on shelf: cover 104×156 (2:3, `--r-xs`), a type badge on the cover (top-left, 11 px, hue from the group, dark text) for every group except plain prose novels (`typeBadge` returns null for them). Below: title clamped to 2 lines (13 px), then for adaptations `from <source title>` (12 px, dim, italic, 1 line), then the stars. Shelf names over about 48ch get an ellipsis with `title={full name}`.

## Files and modules to touch
- New: `src/renderer/styles/tokens.css`, `styles/shell.css`, `styles/library.css`, `styles/board.css`; `src/renderer/store/bookTypes.ts`; `src/renderer/ui/TeamPopover.tsx`, `ui/WarnStrip.tsx`, `ui/LibraryToolbar.tsx`; `tests/renderer/bookTypes.test.ts`.
- Edited: `src/renderer/main.tsx` (CSS imports), `styles.css` (`:root` aliases; dead rules removed in Task 6), `App.tsx`, `ui/StatusBar.tsx`, `ui/Controls.tsx` (class names only), `ui/Library.tsx`, `ui/Whiteboard.tsx`, `store/shelves.ts`, `store/store.ts` (library view state), `demo/library.ts` (demo books), `tests/renderer/store.test.ts`, `tests/renderer/office.spec.ts`, `tests/renderer/series.spec.ts`, `tests/renderer/app.electron.spec.ts` (only if a selector moves), `package.json` (fonts), `docs/design.md`.

## Tasks for workers
Order: Task 1 first (small). Then Tasks 2, 3 and 5 in parallel; Task 4 can start with them against the Task 3 contract. Task 6 last. Workers do not commit. Run Node as `fnm exec --using default yarn <script>`. A new rule goes in your own new CSS file with new class names. Do not edit `styles.css` rules other than those your task names; Task 6 removes dead rules.

### Task 1: Tokens and fonts
- Inputs: the Design direction above.
- Do: `yarn add @fontsource/alegreya @fontsource/alegreya-sc`. Create `styles/tokens.css` with every token above plus the font-face imports (`@import '@fontsource/alegreya/500.css'` and the others), the global `:focus-visible` and the reduced-motion rule. In `main.tsx`, import `tokens.css` before `styles.css` and the other three files after it, creating empty `shell.css`, `library.css` and `board.css` stubs. In `styles.css` `:root` (lines 1-16), replace the hex values with the aliases listed above and set the body font to the Segoe UI Variable stack.
- Outputs and contract: the token names above, exactly. CSP: fonts come from `'self'` (`default-src 'self'` in `src/renderer/index.html`), so nothing changes there; confirm the fonts load in `yarn dev:ui`.
- Check: `yarn typecheck`, `yarn dev:ui` renders with the new colours and no console CSP errors.

### Task 2: Header and warning strip
- Files: `App.tsx` (only the `.topbar` block and the `warnbar` line), `ui/StatusBar.tsx`, `ui/Controls.tsx` (class names), new `ui/TeamPopover.tsx`, new `ui/WarnStrip.tsx`, `styles/shell.css`.
- Do: restructure into `<header className="masthead">` with `.masthead-main` (row 1) and `.masthead-status` (row 2, holds `<StatusBar/>`). Move the role breakdown (`.breakdown.roles`) out of `StatusBar` into `<TeamPopover byRole={...}/>`, opened by a button `data-testid="team-open"` labelled `Team` plus the number of roles with working>0, for example "Team 3". The popover has `data-testid="team-popover"` and one row per role, `data-testid="team-role-<role>"`, text `<roleShort> w/w/i`, sorted active first. Replace the hard-coded dot hexes in `StatusBar.tsx` with `var(--verdigris)`, `var(--ochre)`, `var(--vellum-dim)`, `var(--rubric)` and `var(--lapis)`, but keep `providerColor`. `WarnStrip({ text })`: local state `dismissed: string | null`, shown when `text && text !== dismissed`, `data-testid="warn-strip"`, a dismiss button `data-testid="warn-dismiss"` and `aria-label="Dismiss warning"`.
- Keep the testids `statusbar`, `count-working|waiting|idle` (texts "working N" etc.), `server-*`, `servers-check`, `mcp-status` (text `MCP :7341`), `tab-office|library|newspaper`, `models-open`, `settings-open`, `hire-open`, `pause-all`, `stop-now`, `stop-confirm`, `stop-confirm-yes`. Nothing may become unreachable: the role counters stay one click away.
- Narrow window (below 1200 px): row 2 hides the provider breakdown first (`@container` or a media query); Team stays.

**Status (Task 2): DONE (checked in screenshots S1 by the orchestrator).** `yarn typecheck` passes; `yarn lint` shows errors only in `release/` build output (pre-existing). Playwright not run (orchestrator). The outer wrapper `<div>` became `<header className="masthead">`; `WarnStrip` sits inside it. StatusBar root class is now `status-line` (testid `statusbar` kept). Ghost buttons use class `ghost`; narrow rule is a media query (max-width 1199px). Old classes now unused in styles.css: `.topbar`, `.topbar .brand`, `.statusbar`, `.breakdown.roles`, `.warnbar`, `.tabs button.on` (two copies; check `.tabs` use elsewhere first). Still used: `.pill`, `.dot`, `.breakdown`, `.controls`, `.stop-now`, `.confirm`, `button.small`.

### Task 3: Type taxonomy and shelf grouping (pure, tested)
- Files: new `store/bookTypes.ts`, `store/shelves.ts`, `tests/renderer/bookTypes.test.ts`, `tests/renderer/store.test.ts` (extend the existing `buildShelves` test only), `demo/library.ts`.
- Contract (`bookTypes.ts`):
```ts
export type TypeGroup = 'stories' | 'nonfiction' | 'vn' | 'picture' | 'scripts' | 'puzzle' | 'other'
export const TYPE_GROUPS: { id: TypeGroup; label: string }[]  // display order: stories "Novels & stories", vn "Visual novels",
  // picture "Picture & bedtime", scripts "Scripts & film", puzzle "Puzzle", nonfiction "Non-fiction", other "Other"
export function typeGroupOf(format: string): TypeGroup
export function hasChoices(format: string): boolean
export function typeBadge(format: string): { text: string; group: TypeGroup; choices: boolean } | null
export interface LibraryFilter { group: TypeGroup | 'all'; choices: boolean; query: string }
export function filterBooks(books: BookSummary[], f: LibraryFilter): BookSummary[]
export function typeCounts(books: BookSummary[], f: LibraryFilter): { all: number; choices: number } & Record<TypeGroup, number>
```
- Mapping table (a `Record<string, { group; choices? }>` keyed by the 22 seed ids):
  - stories: short-story, chapter-book, middle-grade, novella, novel, gamebook (choices), kids-choice-book (choices)
  - picture: bedtime-toddler, bedtime-story, kids-picture-book
  - vn: visual-novel, choice-visual-novel (choices), kids-visual-story, kids-choice-visual-story (choices)
  - scripts: short-film, cartoon, kids-cartoon
  - puzzle: mystery-puzzle-visual-novel
  - nonfiction: nonfiction-short, nonfiction-kids, article, feature-article
  - An unknown id falls back by pattern: `/choice|gamebook/` sets choices; `/film|cartoon|screenplay/` gives scripts; `/puzzle/` puzzle; `/visual|vn/` vn; `/picture|bedtime/` picture; `/nonfiction|article/` nonfiction; anything else is `other`.
- **Why no protocol change:** the format ids are fixed seed data. A disabled format has no `FormatSummary`, so the renderer needs an id table in any case. The VN Studio side uses the same ids. A test that reads `seed/config/formats.md` and checks that every id is mapped, and that `choices: true` matches `hasChoices`, catches a new or changed format. Adding `choices`/`script` to `FormatSummary` would touch the engine snapshot, the protocol, `demo/fake.ts` and the Electron spec, and would still not cover disabled formats.
- **"With choices" is a toggle, not a group.** It is ANDed with the group chip, so "Visual novels" plus "With choices" gives the choice VNs. The group chips are mutually exclusive, and every book is in exactly one group.
- `typeBadge` texts: vn "VN", vn+choices "Choice VN", stories+choices "Choices", picture "Picture book" (kids-picture-book) or "Bedtime", scripts "Film" (short-film) or "Cartoon", puzzle "Puzzle", nonfiction "Non-fiction", other: the format id. Plain stories return `null`.
- `filterBooks`: group (all or equal), the choices toggle, and the query. Every lower-cased word must appear in `title + author + sourceBook.title`. `typeCounts` counts per group after the query and the choices toggle but ignoring `group`. `choices` counts after the query and the group.
- `shelves.ts`: `buildShelves(topics, books, opts: { groupBy?: 'topic' | 'type'; sources?: BookSummary[]; hideEmpty?: boolean } = {})`. Existing calls keep working.
  - groupBy topic: key = `b.topic?.id`, else the topic of its source (looked up by slug in `opts.sources ?? books`; follow `sourceBook` up to 5 hops and stop on a loop), else `type:<group>`. Topic shelves as today. Leftover keys that are not types (a topic missing from topics.md) keep today's rule (named after the book's topic name). Type shelves come last in `TYPE_GROUPS` order with `id: 'type-<group>'` and `name: label`; there is no `_other` id any more.
  - groupBy type: one shelf per non-empty group, `id: 'type-<group>'`, in `TYPE_GROUPS` order.
  - Inside every shelf, order by family: sort by `(sourceRootTitle, isAdaptation, title)` so an adaptation follows its source.
  - `hideEmpty` drops shelves with no books. The Library sets it while any filter or search is active.
  - `Shelf` gains `group?: TypeGroup` on type shelves.
- Demo data (`demo/library.ts`): add one published VN adaptation of a demo book (`source` set, so its topic is null; this path already exists at `:90-95`), one topic-less picture book and one choice book. That needs `FakeBook.topic: number | null`; `bookSummary` and `topicSummaries` handle null. Keep every book and title the specs assert (The Moon's Blanket, The Grey Lighthouse, The Lantern and the Fox, moon-bakery-bedtime) and the topic counts (`topic-summary` "6 of 12 on", `topic-count-*`).
- Tests (test-discipline: 3 cases in total): (1) `bookTypes.test.ts` "maps every seed format": read `seed/config/formats.md`, every id has a mapping that is not `other`, and `hasChoices` equals the seed `choices` flag; (2) `bookTypes.test.ts` "filters and counts": 5 books, group plus choices plus query, and the counts; (3) extend the existing `buildShelves` test in `store.test.ts` with an adaptation that lands on its source's topic, a topic-less picture book on `type-picture`, and no `_other` shelf.

**Status (Task 3): DONE.** `store/bookTypes.ts` (also exports `NO_FILTER` and `filterActive`), `buildShelves` options, demo data (3 new published books: `blanket-moon-vn`, `night-train-picture`, `maze-of-the-lost-key`, all with `topic: null`; dated 2026-10-01 so the 4 original published books stay the newest), 3 test cases. Evidence: `yarn typecheck` clean; `vitest run` 58 files, 719 tests passed (one earlier full run showed 1 transient failure that did not repeat in two later full runs). Deviations: none; `FakeBook` also gained optional `format` and `publishedAt`.

### Task 4: Library view
- Files: `ui/Library.tsx`, new `ui/LibraryToolbar.tsx`, `styles/library.css`, `store/store.ts` (state only), `tests/renderer/office.spec.ts` and `series.spec.ts` (Library parts only).
- Store: add `libraryFilter: LibraryFilter` (default `{group:'all', choices:false, query:''}`), `libraryGroupBy: 'topic' | 'type'` (default topic), and setters `setLibraryFilter(patch)` and `setLibraryGroupBy(v)`. The state is UI-only (never written to files) and survives tab switches.
- `LibraryToolbar`: the title, the published and shelf counts, a search `input type="search"` `data-testid="library-search"` (placeholder "Search titles, authors"), a Group by segmented control `data-testid="group-by-topic|group-by-type"`, the side-column toggle `data-testid="library-side-toggle"`, and the chip row: `data-testid="type-chip-<group|all>"` with `aria-pressed`, text `<label> <count>`. A chip with count 0 is hidden, except the selected chip and All. A divider, then `data-testid="choices-toggle"` "With choices <n>", hidden when n is 0 and the toggle is off.
- Shelves: `buildShelves(topics, filterBooks(books, f), { groupBy, sources: books, hideEmpty: filterActive })`. The header shows the name (ellipsis plus `title`) and on the right `N books`, followed by `, D of T for the topic` and `, P in progress` for topic shelves. While a filter is active and nothing matches, show "No books match. Clear the filters" with a button `data-testid="library-clear"`.
- `BookOnShelf`: the badge from `typeBadge(b.format)` (`.badge t-<group>`, `title` = format name from `s.formats`, falling back to the id), the title, `from <sourceBook.title>` (`data-testid="from-<slug>"`), and the stars. Keep `shelf-book-<slug>`, `.shelf-title` and `CoverImage` (exported; BookCard uses it).
- Side column: a single `.library-side` panel 300 px wide with tabs `data-testid="library-side-tab-topics|library-side-tab-series"` (default Topics), rendering `TopicOverview` or `SeriesPanel` unchanged. It collapses to nothing with the toolbar toggle. The open state and the tab are kept in `localStorage` key `scriptorium.librarySide` (try/catch; the default is open on Topics). Keep testids `series-panel`, `topic-*`, `topic-filter`, `topic-active-only`.
- Rejected section: unchanged behaviour and `toggle-rejected`; restyled.
- Spec updates: `series.spec.ts` clicks `library-side-tab-series` before asserting `series-panel`. In `office.spec.ts`, add to the existing library test: click `type-chip-vn`, expect the demo VN adaptation's `shelf-book-*` visible and `shelf-book-the-moons-blanket` hidden, then `library-clear`.

**Status (Task 4): DONE (not looked at in a real window).** `LibraryToolbar.tsx`, `Library.tsx`, `styles/library.css`, store state (`libraryFilter`, `libraryGroupBy`, setters), specs updated. Evidence: `yarn typecheck` clean; eslint on `src tests` clean; `yarn test:ui` 5 of 5 passed. Deviations: new class names (`lib-*`) instead of restyling the old ones, so old `styles.css` rules do not fight the new ones; `.shelf-title` is kept (spec uses it). The gilt ledge sits under the whole shelf row (titles stay above it), not between covers and titles as in the sketch. Added a small inline "Clear filters" link in the chip row. Unrun: screenshots and the Electron spec.

### Task 5: Whiteboard
- Files: `ui/Whiteboard.tsx`, `styles/board.css`.
- Each chip shows the swatch, the title, a small badge from `typeBadge(b.summary.format)` (when a summary and a badge exist) and the existing right-hand text. Chip `title`: `"<title>, <format name>, adapted from <source> (<stage>). Click to highlight its agents."` (the "adapted from" part only for adaptations).
- The `published` column shows the 6 newest (by `summary.publishedAt` desc) and a button `data-testid="board-more-published"` "Show all N" or "Show fewer". The other columns are unchanged. A highlighted book is always shown even when it falls outside the 6.
- Keep `whiteboard`, `book-<slug>`, `book-info`, `read-draft`, `pause-book` and `retry-book`. Check `office.spec.ts:27` and `app.electron.spec.ts:65`: their asserted titles must still be visible (move them into the first 6 or click Show all in the spec).
- Status (Task 5, DONE, committed): `Whiteboard.tsx` and `board.css` implemented (badge, chip title, cap 6 sorted by publishedAt desc, `board-more-published`, highlighted book pinned). Card gets class `whiteboard`. Spec titles need no edit: "The Lantern and the Fox" is a drafting book, and the electron data has one published book. Typecheck: only error was `tests/renderer/store.test.ts(457)` (another task mid-edit); eslint clean on Whiteboard.tsx; `yarn lint` errors exist only under `release/` (pre-existing). Playwright not run.

### Task 6: Integration, docs and verification
- Remove the `styles.css` rules that no longer match any class (`.topbar`, `.statusbar`, `.breakdown*`, `.warnbar`, old `.library`/`.shelf*` if they were replaced). Grep each class in `src/renderer` before deleting it.
- `docs/design.md`: add a Decisions row "Library filter and layout (SCP-51)" with branch, date and content: type chips with counts, the With choices toggle, title search, the Group by switch, the Topics/Series side tabs and their collapse, the Team popover, the warning dismiss and the whiteboard Show all, ending "Adds to the on-screen controls in the UI row". Extend the UI row's control list with "the Library filter bar and the Team popover, see the Library filter row". Edit the Library row and line ~327 ("library shelves are the topics") to say that a book without a topic stands on its source book's topic shelf, else on a shelf per type, and that its data keeps `topic: null`. Add a History line dated on the day of the work.
- Run every check in the acceptance list and take the screenshots.

**Status (Task 6): DONE.** Removed the unused `styles.css` rules (`.topbar`, `.topbar .brand`, `.statusbar`, `.breakdown.roles`, `.warnbar`, `.shelf`, `.shelf header`, `.shelf-row`, `.shelf-empty`, `.empty-slot`, `.shelf-book`, `.shelf-book:hover`, `.shelf-cover`); kept `.library`/`.shelves` (Newspaper uses them) and `.tabs button.on` (Terminal and SideTools use `.tabs`). design.md: Decisions row, UI row, Library row, topics line and History. Orchestrator fixes after the first screenshots: the Team popover is `position: fixed` (the status line clipped it) and shelf rows align to the top. `eslint.config.mjs` ignores `release/` (lint failed on build output). All checks green; screenshots S1 to S5 in `.claude/temp/scp51/`; S3 from a data copy with the factory paused and a mock-only providers.md (spend stayed $0.000), copy deleted.

## Acceptance criteria
| # | Criterion | Proof |
|---|---|---|
| 1 | With the real data (32 library books, the article excluded), no "Other" shelf; the 11 adaptations stand on their source's shelf or a type shelf; picture books on "Picture & bedtime"; the mystery VNs on "Puzzle" | `bookTypes`/`store` tests; screenshot S3 from the data copy |
| 2 | Chips filter by type with counts, 0-count chips hidden, With choices combines with a group, search filters titles | `bookTypes.test.ts`; `office.spec.ts` library step; screenshot S2 |
| 3 | Adaptations show "from <source>" and a badge; whiteboard chips have a badge | specs; screenshots S2, S4 |
| 4 | Header has two rows; role counters only in Team; every old testid still passes | `yarn test:ui` (office.spec header asserts), `yarn test:electron`; screenshot S1 with the Team popover open |
| 5 | Warning strip shows one line and dismisses | manual in `yarn dev:ui` (the fake engine emits warnings) plus screenshot S1 |
| 6 | Long shelf name has an ellipsis and its full text on hover | screenshot S3 (the soother shelf) |
| 7 | Tokens applied; other screens still readable (Models, Settings, BookCard, Newspaper) | screenshot S5 of each, visual check for contrast |
| 8 | Static checks and tests | `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:ui`, `yarn test:electron` all green |
| 9 | Windows build | `yarn dist` succeeds (NSIS plus portable in `release/`, `verify-package` passes); start `release/win-unpacked/Scriptorium.exe` with `--data <copy>` and see the new header |
| 10 | Docs | the design.md row, UI row, Library row, line ~327 and History are present |

Screenshots (save under `.claude/temp/scp51/`):
- S1 to S2 and S4 to S5: `yarn dev:ui` (fake engine, no data folder), at 1500×950 and at 1100×800, taken with a small Playwright script in `.claude/temp/` (as `playwright.config.ts` does). S1: header with Team open. S2: Library with the `vn` chip on. S4: whiteboard. S5: Models, Settings and BookCard.
- S3 (real shelves): **never against `~/Scriptorium`.** Copy it: `robocopy %USERPROFILE%\Scriptorium <repo>\.claude\temp\scp51-data /E /XD index` (the index holds `engine.lock` and is rebuilt). In the copy, set `paused: true` in `config/factory.md` so no job starts. Run `SCRIPTORIUM_DATA=<copy> yarn dev`, or the unpacked exe with `--data <copy>`, open the Library, and capture the window. Delete the copy afterwards.

## Open questions (with the recommended default)
1. The director's chip "Picture books" also holds the two bedtime formats, which are text read-alouds. Label it "Picture & bedtime"? **Default: yes, "Picture & bedtime".**
2. Group adaptations under their source's topic shelf (default), or always on a type shelf ("Visual novels")? **Default: the source's shelf, right after the source**; Group by Type gives the other view.
3. Should the Published column of the whiteboard cap at 6? **Default: yes, with Show all.**
4. Should the "11 of 5 done" topic be set to its real count, or its target raised? That is a data edit by the owner, not this ticket. **Default: leave it; the header now leads with "16 books".**

# SCP-51 changelog

## 2026-11-02: Library and header overhaul

Outcome: the Library has a type filter bar, cover badges and no "Other" shelf; the header has two rows with a Team popover; the whiteboard has badges and a capped Published column; new design tokens and the Alegreya display font. All on `master` (user decision: no ticket branch), not pushed.

### scriptorium (branch `master`)
- `.gitignore`: ignores `.claude/director/`.
- `package.json`, `yarn.lock`: `@fontsource/alegreya` and `@fontsource/alegreya-sc` (dev dependencies, bundled into the renderer).
- `src/renderer/styles/tokens.css` (new): palette, type-badge hues, type scale, spacing, radius, shadows, focus ring, reduced motion; imports the Latin subsets of Alegreya 500/700 and Alegreya SC 500.
- `src/renderer/main.tsx`: imports tokens.css, styles.css, shell.css, library.css, board.css in that order.
- `src/renderer/styles.css`: `:root` colours are aliases of the tokens, body font is the Segoe UI Variable stack; the old top bar, status bar, role breakdown, warning bar and wooden shelf rules are removed.
- `src/renderer/App.tsx`, `ui/StatusBar.tsx`, `ui/TeamPopover.tsx` (new), `ui/WarnStrip.tsx` (new), `styles/shell.css`: two-row masthead; role counters move into the Team popover (busy roles first, idle dimmed, Esc and outside click close it); dot colours use tokens; the provider breakdown hides below 1200 px; the warning is a one-line strip that expands on click and hides until a different warning arrives. All old test ids kept.
- `src/renderer/store/bookTypes.ts` (new): the 22 seed formats mapped to seven type groups, choice flags, pattern fallback, `typeBadge`, `filterBooks`, `typeCounts`, `NO_FILTER`, `filterActive`.
- `src/renderer/store/shelves.ts`: `buildShelves(topics, books, { groupBy, sources, hideEmpty })`; a topic-less book stands on its source's topic shelf (up to 5 hops, loop-safe), else on a `type-<group>` shelf; adaptations follow their source; no `_other` shelf. Display only.
- `src/renderer/store/store.ts`: `libraryFilter`, `libraryGroupBy` and setters (UI state only).
- `src/renderer/ui/Library.tsx`, `ui/LibraryToolbar.tsx` (new), `styles/library.css`: search, type chips with counts (0 hidden), With choices toggle, Clear filters, Group by Topic/Type, collapsible Topics/Series side column (`localStorage` `scriptorium.librarySide`), cover badges, "from <source>" lines, shelf names cut with the full name on hover, gilt ledge, "No books match" state.
- `src/renderer/ui/Whiteboard.tsx`, `styles/board.css`: type badge per chip, chip title with format and "adapted from", Published shows the 6 newest with Show all / Show fewer, a highlighted book stays visible.
- `src/renderer/demo/library.ts`: a VN adaptation, a topic-less picture book and a gamebook (all `topic: null`).
- `tests/renderer/bookTypes.test.ts` (new, 2 cases), `tests/renderer/store.test.ts` (buildShelves case extended), `tests/renderer/office.spec.ts` (library chip, from-line, search and clear), `tests/renderer/series.spec.ts` (opens the Series tab first).
- `eslint.config.mjs`: ignores `release/`.
- `docs/design.md`: Decisions row "Library filter and layout (SCP-51)", UI and Library rows, the topics line, History.

### Deviations
- Fonts import the Latin subsets (`latin-500.css` etc.) instead of the all-subset files: book content is English only, and it keeps the bundle small.
- Library classes are new (`lib-*`), the side panel is `.lib-side` (the Newspaper still uses `.library-side`); the gilt ledge runs under the whole shelf row rather than between covers and titles; an extra inline "Clear filters" link in the chip row.
- The header narrow rule is a media query, not `@container`. The Team popover is `position: fixed` because the one-line status row clips overflow.
- `eslint.config.mjs` change (not in the plan): `yarn lint` failed on the `release/` build output.

### Verification
- `yarn typecheck`: exit 0. `yarn lint`: exit 0.
- `yarn test`: 58 files, 719 tests passed. One run had a transient failure in `tests/adapt.test.ts` (engine, ENOENT on a book file it was waiting for, untouched by this ticket); two reruns green.
- `yarn test:ui`: 5 passed (one earlier run had the office spec's agent-count poll after Hire time out; reruns green).
- `yarn test:electron`: 1 passed.
- `yarn dist`: NSIS installer and portable exe in `release/`, `verify-package passed`.
- Screenshots in `.claude/temp/scp51/`: S1 to S2, S4 to S5 from `yarn dev:ui` at 1500x950 and 1100x800; S3 from `release/win-unpacked/Scriptorium.exe --data <copy>` (copy of the data folder without `index`, factory paused, providers.md replaced by a mock provider; spend today stayed $0.000; MCP port 7341 was taken by the user's running app, so the copy ran without MCP; the copy was deleted).
- Not checked: the native hover tooltip on the long shelf name (the `title` attribute was read instead); the installer was not installed.

### Follow-ups
- "11 of 5 for the topic" is a real stored counter (topics.md); left as the owner's data.
- The Topics panel heading and the whiteboard heading still use the old all-caps letter-spaced style.

Commit status: committed on `master`, not pushed.

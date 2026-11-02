# SCP-50 Gamebook PDF in Scriptorium (text only)

From hub ticket HUB-25 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-25-book-export-kindle-pdf\plan.md`). Branch `SCP-50_gamebook-pdf`, stacked on `SCP-49_gamebook-epub` (whose work is uncommitted in the same tree). Not committed.

## Task block (copied from the hub plan)

- Repo `scriptorium/`. Uses the same library and font VNO-54's spike chose, so both PDFs look alike. NEW `src/engine/publish/pdf.ts`: one section per page start, big number, text, link annotations for "turn to section N", footer; `package.json` dependency. Attaching the PDF to the Kindle mail only if it is a one-line change in `kindle.ts`, else a follow-up.
- Tests: `tests/gamebook-pdf.test.ts` (page count, a link per choice, Croatian text intact). Done: tests; the user opens a real PDF (live check 4a).
- Spike result (VNO-54, `creative-hub/.claude/temp/hub25/spike-result.md`): pdfkit ^0.20, font Lora (SIL OFL). Gotchas: with `continued: true` the `goTo` option leaks onto the next fragment (end it with `goTo: null`); `outline.addItem` targets the current page (add it while on section 1's page).

## Decisions

- Font: `resources/fonts/Lora-Regular.ttf`, `Lora-Bold.ttf`, `OFL.txt` (copied from `visual-novels-orchestrator/themes/parchment/fonts/`). `electron-builder.config.cjs` `files` gets `resources/fonts/**/*`, so a packaged app has `<app>/resources/fonts` next to `<app>/out/engine/index.js` (asar is off). `fontDir()` in `pdf.ts` walks up from `__dirname` (max 8 levels) to the first `resources/fonts/Lora-Regular.ttf`; `SCRIPTORIUM_FONTS` overrides; `buildGamebookPdf({ fontDir })` overrides per call. Works in dev (src), vitest, and the bundled engine (out/engine). Not tried in a packaged build.
- Licence note in `ATTRIBUTION.md` (OFL 1.1, Lora by Cyreal).
- Pure writer `buildGamebookPdf(book: GamebookPdfBook): Promise<Uint8Array>` (`publish/pdf.ts`), store method `BookStore.buildGamebookPdf(slug, { seed?, order?, renumber?, lang?, compress?, note? }): Promise<string | null>` writes `out/<slug>-gamebook.pdf` (null + note for a book without choices; stale `gamebook.json` throws like the EPUB). It reads `planSections` itself; `buildEpubFile` was not refactored (kept untouched).
- Engine command `buildGamebookPdf { book, renumber?, seed?, lang? }` next to `buildGamebook` (`protocol.ts`, `engine.ts`). No MCP tool, no UI.
- Layout: A5; sections in number order, each on a new page; Lora-Bold 46 pt number; Lora 11.5 pt text; choice paragraphs `{text}{sep}turn to section N.` with "section N" (hr "odlomak N") a `goTo` link to named destination `s<N>` (added at the top of the section's first page); ending "The End." + restart link to `s1`; footer = section number of that page (never "page"); outline has only "Start: section 1"; metadata Title, Author (if known), Lang, DisplayDocTitle.
- Kindle mail: NOT changed. `kindle.ts` hardcodes the attachment name `<slug>.epub` and the EPUB content type, so attaching a PDF is more than one line; follow-up.

## Checklist

- [x] Font files + OFL in `resources/fonts/`, config `files`, ATTRIBUTION note.
- [x] `pdfkit` (dependency) and `@types/pdfkit` (dev) added with yarn.
- [x] `src/engine/publish/pdf.ts`.
- [x] `BookStore.buildGamebookPdf`, engine command `buildGamebookPdf`.
- [x] `tests/gamebook-pdf.test.ts` (2 tests).
- [x] Real data PDFs (en and hr) from the `the-clockless-god-2` copy.
- [x] ROADMAP entry, `docs/design.md` row.

## Verification (2026-11-02)

- `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json`: clean (run through `npx`; `yarn` only used for `add`).
- `eslint . --ignore-pattern "release/**"`: clean. Plain `eslint .`: 5,249 errors, all in the untracked pre-existing `release/win-unpacked` build output.
- `vitest run`: 57 files, 717 tests passed (the `adaptBook` timing flake did not recur); `vitest --config vitest.recovery.config.ts`: 1 passed.
- Real data (a copy, read-only source): `.claude/temp/scp49-real/books/the-clockless-god-2/out/the-clockless-god-2-gamebook.pdf` (English phrases) and `...-gamebook-hr.pdf` (Croatian phrases, same numbers from the stored `gamebook.json`): 96 pages, 16 destinations, 21 link annotations (checked in the raw bytes). Made by `.claude/temp/scp50-real.ts`.

## Deviations

- Tests read the raw bytes (pdfkit has no parser; `compress: false` for the writer test) instead of adding `pdf-lib`: link annotations `/S /GoTo /D (sN)`, the `/Dests` name tree with one page per section, `/FontFile2`, and the ToUnicode map containing the code points of Č Ć Đ Š Ž č ć đ š ž.
- Not opened in PdfCraft or any viewer (no PDF tool was available in this session); text flow, footer position and look are UNTESTED.
- `kindle.ts` unchanged (see Decisions).

## Result list

- DONE: pdfkit writer with Lora, `BookStore.buildGamebookPdf`, `buildGamebookPdf` engine command, font shipping config and licence note, tests (2), real PDFs, ROADMAP and design entries.
- NOT DONE: PDF as a Kindle mail attachment (follow-up), a UI button, an MCP tool (deliberately none).
- UNTESTED: how the PDF looks and whether the links jump in a real viewer (hub live check 4a/4, the user's); a packaged build finding the fonts; PdfCraft `text_extract`/`link_list` on the real files.

## Orchestrator corrections (2026-11-02, after a PdfCraft check of the real PDFs)

- The centred restart line overprinted (pdfkit `continued` + `align: 'center'`); fixed in `jump` by placing a one-line jump by hand. Same fix as VN Studio's VNO-54.
- The footer now reads "section N" / "odlomak N" (was the bare number), as in VN Studio's PDF and the hub plan ("the text says section, never page").
- PdfCraft on the real clockless-god-2 hr PDF: 95 pages, 21 link annotations each to an existing page, bookmark "Početak: odlomak 1" on page 1, "idi na odlomak" found 19 times, diacritics intact, restart line clean, footer "odlomak 8".

# SCP-49 Gamebook mode in Scriptorium's EPUB (text only; existing mode unchanged)

From hub ticket HUB-25 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-25-book-export-kindle-pdf\plan.md`). Branch `SCP-49_gamebook-epub`. Not committed.

## Task block (copied from the hub plan)

- Repo `scriptorium/`. `src/engine/publish/epub.ts` `buildEpub` gets an option `gamebook?: { sections: number[]; lang }` (absent = today's output unchanged for the same input). `src/engine/publish/xhtml.ts` gets `gamebookChoicesHtml` next to `choicesHtml` (do not edit `choicesHtml`). NEW `src/engine/publish/sections.ts` (the shared algorithm and golden vector). Section files are written in number order, `section-NNN.xhtml` with `id="s<N>"`, big number heading, chapter text, then the "turn to section N" links; nav lists numbers only (no chapter titles, spoilers); no images except the existing cover.
- `src/engine/pipeline/books.ts` `choiceLinks` maps outline chapter numbers to positions: reuse it for `to`, then map to section numbers. Only books with choices can use the option; others ignore it with a message.
- Entry point: a `gamebook` flag on the publish call that `kindle.ts` and the app's EPUB build share; record which one. Send to Kindle is not on MCP (`docs/mcp.md:3,119`); do not add it. Stored map: `~/Scriptorium/books/<slug>/gamebook.json` (sibling file; chapter files and `outline.md` untouched).
- Tests: `tests/gamebook.test.ts` (golden vector; links resolve; the default-mode EPUB for a fixture is unchanged, compared with a hash taken before the change); `tests/pipeline.test.ts`, `tests/art.test.ts`, `tests/rewrites.test.ts` stay green.
- Done: tests; a fixture choice book exports in gamebook mode; the default EPUB is identical; ROADMAP row. Never start Scriptorium.

Shared section algorithm, phrase table and the user's answers (Croatian jump text "idi na odlomak N", e.g. "Ako ..., idi na odlomak 56.") are in the hub plan.

## Entry points changed (decision recorded)

- `BookStore.buildEpubFile(slug, opts?: BuildEpubOptions)` in `src/engine/pipeline/books.ts`: `opts.gamebook?: true | { seed?, order?, renumber?, lang? }`, `opts.note?(msg)`. Default (no opts) is the old path. Gamebook output: `out/<slug>-gamebook.epub`; `out/<slug>.epub` and the reader are not touched; the book's EPUB uuid is derived (`sha256(uuid:gamebook)`) so a reader sees a second book.
- Engine command `buildGamebook { book, renumber?, seed?, lang? }` (`src/shared/protocol.ts`, `Engine.buildGamebook`): the app-side trigger; logs the result path. No UI button, no MCP tool (plan: button is a follow-up; MCP stays without Send to Kindle).
- Engine command `sendToKindle { book, gamebook?: boolean }`: `gamebook: true` mails `out/<slug>-gamebook.epub` (error "build it first" if missing). `kindle.ts` is unchanged: it already takes an `epubPath`; the engine passes the file and an attachment name `<slug>-gamebook.epub`.
- `buildEpub(book)` option `gamebook?: { sections: number[]; lang }` (`epub.ts`); `gamebookChoicesHtml(c, lang)` + `sectionFile(no)` (`xhtml.ts`); `xhtmlPage` got an optional `lang` (default `'en'`, output identical).
- Language: `opts.gamebook.lang`, else `language` / `lang` of `book.md`, else `en`. Phrases: en, hr; others fall back to en.
- Stored map `books/<slug>/gamebook.json` (`planSections` in `sections.ts`): reused when the chapter set matches (and is a valid bijection with chapter 1 = section 1); different set = stale, the build throws "... are for other chapters; export the gamebook with renumber"; `renumber: true` recomputes (seed default: stored seed, else the slug).

## Checklist

- [x] `src/engine/publish/sections.ts`: shared core copied verbatim from `creative-hub/.claude/temp/hub25/sections-core.ts`, plus stored map, phrase table.
- [x] `epub.ts` / `xhtml.ts` gamebook mode; `choicesHtml` untouched.
- [x] `books.ts` / `protocol.ts` / `engine.ts` entry points.
- [x] `tests/gamebook.test.ts` (5 tests: golden vector, links resolve, stored map reuse/stale/renumber, hr phrases, default-mode hash).
- [x] ROADMAP.md entry, `docs/design.md` decision row.

## Default-mode hash (taken BEFORE touching epub.ts/xhtml.ts)

`buildEpub` of the fixed 4-chapter `EpubBook` in `tests/gamebook.test.ts` (fixed uuid and `modified`, choices and endings, no cover), unzipped; SHA-256 over the sorted entry names and each entry's bytes:

`56bff2b4d489620d9a4626cfb1825eeb2b5441d9ee0479f81672c9d950dc78ae`

Why entries and not the zip bytes: JSZip stamps each entry with the current time, so the archive bytes differ between runs; the scratch script (`.claude/temp/default-hash.ts`) gave the same hash twice before the change, and the test passes after it.

## Verification (2026-11-02)

- `tsc --noEmit` for `tsconfig.node.json` and `tsconfig.web.json`: clean (run directly, `yarn` is not on PATH here).
- `eslint . --ignore-pattern "release/**"`: clean. (Plain `eslint .` reports about 5,000 errors in the untracked, pre-existing `release/win-unpacked` build output; not related.)
- `vitest run`: 56 files, 715 tests passed (second run; the first run had one failure in an existing adaptBook test with a timing `waitFor`, it passed on the rerun); `vitest --config vitest.recovery.config.ts`: 1 passed. `tests/pipeline.test.ts`, `art.test.ts`, `rewrites.test.ts` are in that run.
- Real data, read-only: a copy of `~/Scriptorium/books/the-clockless-god-2` (16 chapters) exported in gamebook mode from a scratch script (`.claude/temp/scp49-real.ts`) into `.claude/temp/scp49-real/books/the-clockless-god-2/out/the-clockless-god-2-gamebook.epub`; 16 section files, 58 links, 0 broken, only `images/cover.png`; second export reused the stored `gamebook.json`. Nothing was written to the real books folder.

## Deviations

- `buildSections` core: two non-null assertions in the swap (`nums[j]!`, `nums[i]!`) because this repo compiles with `noUncheckedIndexedAccess`; the values are identical. VN Studio's copy should check whether it needs the same.
- The three shared functions are followed in the same file by Scriptorium-only code (imports `node:fs` and `atomicWrite`); the header comment is the shared one.
- The stale-map case throws (the build fails) rather than returning a flagged result, because an export must not silently pick numbers.
- The Croatian ending wording ("Kraj." / "Idi na odlomak 1 za novi početak.") is inferred; only "idi na odlomak N" was given by the user.
- Entry point: the plan said "a flag on the publish call shared by `kindle.ts` and the app's EPUB build"; `kindle.ts` only mails a path, so the flag lives on `buildEpubFile` and on the two engine commands.

## Result list

- DONE: gamebook mode in `buildEpub`; `gamebookChoicesHtml`; shared `sections.ts` with stored map and phrases; `buildEpubFile` option; `buildGamebook` command and `sendToKindle` flag; tests; ROADMAP and design entries; default-output hash unchanged.
- NOT DONE: PDF (SCP-50); a UI button; an MCP tool for the gamebook (deliberately none).
- UNTESTED: a real app run (Scriptorium never started); a send to a real Kindle and whether its internal "turn to section N" links work (hub live check 4a, the user's).

## Orchestrator correction (2026-11-02)

Aligned with VN Studio's export (HUB-25 "same style"): the link text is "section N" / "odlomak N" (not the bare number), and the Croatian separator is ", " (`{choice text}, idi na odlomak N.`, from the user's "Ako ..., idi na odlomak 56."); English keeps " - ". `GamebookPhrases.sep` added; `tests/gamebook.test.ts` updated; 5/5 pass.

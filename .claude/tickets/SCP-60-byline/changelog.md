# SCP-60 changelog

## 2026-11-14 SCP-60: byline (branch `SCP-60_byline`, from master e6b139e; not pushed, not merged)

- `src/shared/byline.ts` (new): `displayAuthor`. `book.md` `author` stays the writer agent's pen name; `byline` is shown instead when set.
- Setting and story: `byline` in `settingsSchema` / `seed/config/settings.md`, `ideaSchema`, `bookSchema`, `StoryBrief` (`briefOf`, `briefFields`, `updateStory` strip list). `start_book` (`handlers.ts`) copies story byline, else the settings default, into `book.md`. `getByline` on `PipelineDeps`, wired in `engine.ts`.
- Display: cover (`handlers.ts` publish, `pipeline.ts` `remakeCover`), EPUB `dc:creator` and title page, reader, draft reader, PDF (`books.ts`), Kindle mail, VN pack author (`vnPack.ts`), MCP `get_script`, `get_screenplay`, article byline, book rows (`summary.ts`). The credits line "Written by an AI writer (<agent>)" uses the new `writer` field of `EpubBook` / `ReaderBook` (the pen name). The cover keeps its "AI-written" mark.
- MCP: `add_story {byline}`, `update_story {byline}` (empty clears), `set_book_byline {book, byline}` (command `setBookByline`, `engine.ts`): writes book.md, a published book goes through `remakeCover` (cover.html, EPUB, reader, cover PNG request). That republish path already existed (`rename_book`, `remake_cover`).
- UI: Byline input in `StoryForm.tsx`.
- Docs: `docs/mcp.md`, `docs/design.md` History, `ROADMAP.md`, seed settings.
- Tests: `tests/mcp.test.ts` (story byline, `set_book_byline`, EPUB creator and writer credit), `tests/pipeline.test.ts` (settings default copied, EPUB, cover).

Not done: a byline editor on the book card (the tool and the story form cover it); books that already started keep the byline they have (a changed settings default does not touch them; use `set_book_byline`); existing books such as `the-rooster` were not changed (read-only for this ticket).

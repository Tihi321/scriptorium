# SCP-60: the byline is the writer persona

Branch `SCP-60_byline` from `master`. Source: ROADMAP.md "Open: found by the hub's The Rooster run".

## Problem

The cover, `book.md` `author` and the EPUB show the writer agent's pen name ("Culo") as the author of a book whose idea and brief came from the owner.

## Plan

- `byline` field: `config/settings.md` (default, empty = today), story frontmatter (`add_story`, `update_story`, story form), `book.md` (copied by `start_book`).
- `author` in `book.md` stays the pen name of the writer agent (the engine sets it; the credits line needs it). New helper `displayAuthor(data)` = byline, else author. Every reader of `author` for display uses it: cover, EPUB `dc:creator` and title page, reader, draft reader, PDF, article byline, VN pack, Kindle mail, `get_script`, `get_screenplay`, book rows. The EPUB and reader get `writer` for the credits line "Written by an AI writer (<agent>)".
- `set_book_byline {book, byline}` (command `setBookByline`): writes `book.md`; a published book goes through `remakeCover` (cover.html, EPUB, reader, cover PNG request), the existing republish path.
- Story form: one input.
- Tests: MCP (story byline stored, `set_book_byline` remakes cover/EPUB, writer credit kept) and one pipeline run (settings default copied, EPUB creator, credits line).
- Docs: `docs/mcp.md`, `seed/config/settings.md`, `docs/design.md` History, ROADMAP.

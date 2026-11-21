- 2026-11-11 implement: the engine's 'exported N block(s)' log event does not reach the project log.md on the CLI export route (C:/projects/Personal/book-translator/src/engine/service.ts:547) - suggested: check whether the CLI should persist log events like the app does

## Checker (2026-11-11)
- Low, test gap: tests/epub.test.ts:197-208 never asserts the output declares xmlns:epub; add expect(page).toContain('xmlns:epub=').
- Low, edge: src/engine/formats/epub.ts:370 reads getAttribute('epub:type') by literal prefix; a source binding OPS to another prefix would get a duplicate attribute. Use getAttributeNS(OPS,'type').
- Info: a title page made from a raster cover page keeps the source <head><title> (e.g. "Cover").

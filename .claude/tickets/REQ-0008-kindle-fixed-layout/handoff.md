# REQ-0008 handoff (Task 2 results)

Updated 2026-11-11 by implement.

## State

- book-translator branch `BTT-29_kindle-svg-cover`, commit `9bc4e7b` (Task 1 writer fix) plus a ticket-files commit. Not merged to master, not pushed.
- The three hr EPUBs were re-exported from that branch build with the default cover (`yarn.cmd engine export <id> --data C:/Users/Infplane/BookTranslator`, CLI route; `engine.lock` absent before and after).
- Ticket status `in-progress`; the director's checker decides done.

## Task 2 results

| Project | Source sha256 = project.json | Backup | epubcheck 5.2.1 | Script `verify_reexport.py` | Chapter bytes vs backup |
|---|---|---|---|---|---|
| `the-tide-table-hr-fc6ee3` | match (`fc6ee3ed...`) | `output/the-tide-table.hr.pre-req0008.epub` | 0 fatal / 1 error (OPF-096 nav only) / 0 warnings | PASS (11/11) | equal; only `translated-cover.svg` and `translated-cover.xhtml` removed, OPF changed |
| `what-fate-decides-luck-will-and-the-life-hr-54a317` | match (`54a317b2...`) | `output/what-fate-decides-luck-will-and-the-life.hr.pre-req0008.epub` | 0 / 1 (OPF-096 only) / 0 | PASS (11/11) | equal; same two removed |
| `the-one-way-street-why-time-only-runs-hr-30e47a` | match (`30e47a3f...`) | `output/the-one-way-street-why-time-only-runs.hr.pre-req0008.epub` | 0 / 1 (OPF-096 only) / 0 | PASS (11/11) | equal; same two removed |

New file sha256: tide-table `6353fb6e...`, what-fate `69b14494...`, one-way-street `7288c938...`.

Script checks (`py -I -X utf8 C:/projects/Personal/scriptorium/.claude/temp/req0008/verify_reexport.py <new> <backup> <english source>`): no `image/svg+xml` + `cover-image` item; no `translated-cover.*` entry; first itemref `cover`; manifest ids and spine order equal the English source; `dc:language` `hr`; the cover page `h1` equals the backup's (translated title kept); every zip entry other than the OPF is byte-equal to the backup; no new entries; only the two `translated-cover.*` files removed.

Note: each OPF still lists `images/ornament.svg` (`image/svg+xml`, no `cover-image`). It comes from the English source, which reflows on Kindle; not a cover.

`log.md` of each project got one line (the engine's `exported N block(s)` event is emitted but does not reach `log.md` on the CLI route).

## Open

- A7 UNTESTED: the user deletes the old copies from the Kindle library and sends the three new files, then reports whether they reflow.
- Merge `BTT-29_kindle-svg-cover` to master needs the user's approval.

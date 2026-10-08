---
kind: factory
paused: false
max_books_in_progress: 3
idea_low_water_mark: 5
research_limit_per_book: 10
research_limit_nonfiction: 40
research_prep_genres: [historical, history, thriller, crime, mystery, detective, war, spy, medical, legal, science, biography]
max_attempts: 3
---
# Factory

Factory-wide limits.

- `paused`: the saved state of "pause all". While true, no new jobs start. The engine writes this when you press pause all or stop now, and clears it on resume.
- `max_books_in_progress`: how many books are worked on at the same time. `idea_low_water_mark`: the idea generator refills `ideas/` when fewer ideas than this are open.
- `research_limit_per_book`: how many research questions one book may ask in total (the architect's, the writer's, the reviewers'). Further questions are skipped with a warning. `0` switches research off for books.
- `research_limit_nonfiction`: the same limit for non-fiction books, which research every chapter and ask the researcher again when the fact-checker finds a claim without a source.
- `research_prep_genres`: books whose genre or topic contains one of these words (any case) get the writer's research prep before every chapter. A format can also switch it on (`research_prep: true` in `config/formats.md`).
- `max_attempts`: how many times a job may fail before it moves to `jobs/failed/`.

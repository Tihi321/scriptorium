---
kind: quality
threshold: 7.0
max_rounds: 2
revise_below: 7
pitch_similarity_max: 0.9
must_pass: [child-safety-reviewer, originality-checker, fact-checker]
weights:
  structure: 1
  prose: 1.5
  continuity: 1
  genre_fit: 1
  age_fit: 1.5
  originality: 1
  read_aloud: 1
  mechanics: 0.5
  enjoyment: 1
  threads: 1
  accuracy: 1.5
---
# Quality

How the publisher decides.

- Every reviewer returns a verdict (`pass` or `revise`) and scores from 1 to 10 for its own dimensions.
- If any reviewer says `revise` and fewer than `max_rounds` rewrite rounds have happened, the notes are merged into one request and the writer rewrites the affected chapters. Then all reviewers read it again.
- A `revise` from a reviewer that is not in `must_pass` only counts when one of its scores is below `revise_below`. Reviewers that say "revise" with only good scores are treated as "pass". Must-pass reviewers always count.
- A new pitch that is more similar than `pitch_similarity_max` (cosine) to a pitch or blurb already in the library is written again (up to two more tries), so the factory doesn't repeat its plots.
- After the last round the publisher decides. A reviewer in `must_pass` that still says `revise` means the book is rejected. Otherwise the weighted average of all scores must reach `threshold`.
- `weights` say how much each dimension counts. A dimension that isn't listed counts 1.
- The fact-checker reviews non-fiction books only, and must pass: a claim without a source number, or one the notes contradict, sends the chapter back for a rewrite with the claims listed. After the last round a fact-checker that still says `revise` rejects the book.
- A rejected book stays in `books/` with `stage: rejected` and the reasons in its `book.md`.

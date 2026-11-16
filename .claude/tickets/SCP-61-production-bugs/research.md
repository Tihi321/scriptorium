# SCP-61 research: four production bugs from the Ash & Brass run

Notes by the researcher, 2026-11-15. Read-only: Scriptorium was running; nothing was started, built or test-run. Evidence: hub `runs/ash-and-brass.md`, books `the-cold-furnace`, `the-automaton-who-confessed`, `the-perfect-alibi` in `~\Scriptorium\books\`.

Ticket id: the highest id in ROADMAP.md and in the branch names is SCP-60 (`SCP-60_byline`, `SCP-60_byline-fix`; folders are `.claude/tickets/SCP-NN-name`, branches `SCP-NN_name`). **Next free: SCP-61.** Proposed branch `SCP-61_production-bugs`.

## Question

For four bugs seen in the live run: root cause with file:line, where the fix goes, risk, and the tests that prove it.

## Answer (short)

1. **Humanizer guard.** `newNames` (`src/engine/pipeline/humanizerHandlers.ts:184-202`) flags three different things that are not names: (a) "God" is a capitalised word mid-sentence that the original never had in any case; (b) "I've" is matched by `NAME_WORD` (`I` plus an apostrophe tail) and the original had "I have"; (c) "These" follows `.*` (the end of an italic span), and `*` is missing from the sentence-start character class on line 190. Fix: strip emphasis marks before the sentence-start test, skip the pronoun "I" with a contraction tail, and skip capitalised ordinary words (a small religious-word list plus the existing `ENGLISH_WORDS` set).
2. **Quiet downgrade to gemma.** Not a hardcoded fallback and not a missing context check. The chain is config: the live `~\Scriptorium\config\settings.md` has `fallback_shared: true`, so every role gets the global rows `deepseek, strata, lmstudio gemma` after the book's own model (`registry.ts:639-672`, `router.ts:125-157`). With the budget cap at 0 and Strata down, the only usable fallback is the free local gemma. The router does skip a too-long prompt without a request (`router.ts:177-184`, it logged "too big"), but then goes on to gemma and the job succeeds with no warning. Two causes on top: the book's `role_models` takes one model, with no way to name a second acp model; and a Codex usage limit is not recognised, so it is retried 3 times and then falls through like any error. Also found: the publisher sends the whole book (`handlers.ts:1256`, `fullText`) with no window check, and `contextTokens(role)` ignores the book's own model (`engine.ts:202`).
3. **Outline vs brief.** The outline review sees the brief but its prompt only asks structure questions, and it gets no owner notes. Fit: the `review_outline` prompt plus `ownerNotesSection` in the handler (cheap, certain), and an optional code pre-check of named brief/series characters against the outline text.
4. **`humanized: N`.** Written in one place (`humanizerHandlers.ts:402`), read in two (`books.ts:332`, `books.ts:346`), consumed as "key is present" only (`pipeline.ts:390`, `advance.ts:449,458,572`). It is also written when the pass was refused, so it is not "was rewritten". Propose `humanizer_round` plus `humanizer_result`, read-compatible with the old key.

## 1. The new-name guard

### Path (confirmed)

- Called from `humanizeProblem` at `humanizerHandlers.ts:311-312`: `newNames(revised, original + '\n' + bible)`; any hit returns "it brought in a name that is not in the chapter or the bible (...)", and `humanize_chapter` keeps the original (`:384-390`) and still writes `humanized: <round>` (`:394-403`).
- `newNames` (`:184-202`): `have` = every word of original+bible, lower-cased, apostrophes kept (`:185`). For each match of `NAME_WORD = /\p{Lu}[\p{L}\p{M}'’-]*/gu` (`:109`) it skips sentence starts using `lead` (`:190`): `before === ''` or `before` ends in one of `\n . ! ? … : ; " “ ” ‘ ' ’ ( [ — -`. Then it skips `I` (length < 2), units, numbers, words whose key or its singular/plural form is in `have`, and group nouns.

### Why each word matches (evidence from the logs)

| Word | Where | Why it passes the guard |
|---|---|---|
| "God" | the-cold-furnace ch05: "...and wished to God he hadn't now." (job log, line 1686 result). the-perfect-alibi ch12 (log line 3928) | Mid-sentence capital. The original chapter has no "god" in any case (`grep God` on `chapters/history/ch-12-r0.md` = 0), so it is not in `have`. No allowlist for ordinary capitalised words (God, Lord, Heaven). **Confirmed** for the text and the result line; the rule is **read from code**. |
| "I've" | the-cold-furnace ch09, both rounds. The rewrite has "I've had", "I've learned"; the original has "I have" | `NAME_WORD` takes `I` plus `'ve` as one token "I've" (`'` is in the class). The `w.length < 2` test (`:193`) only skips a bare "I". key = `i've`; `have` has `i` and `have` but not `i've`. So any rewrite that contracts "I have" is refused. Any "I'm", "I'll", "I'd" does the same. **Confirmed** (the rewrite text is in the job log; the original lacks the contraction) |
| "These" | the-perfect-alibi ch13: `*Instruction not found in current spool. Request exceeds authorized function.* These were dead words` | The sentence ends with `.*` (italic closing). `before` ends in `*`, which is not in the `lead` class (`:190`), so "These" is not seen as a sentence start. "these" is not in `have` only if the original had no "these", which it plausibly lacks in that spot; the capital alone is what trips it. **Confirmed** text in the log; mechanism **inferred** from `:190` (the same sentence in the original is not in the history file because the kept version overwrote nothing, so I did not diff). |

Related existing tickets: SCP-39 in ROADMAP.md (weekdays and months count as names) is the same family and is open; SCP-57 added group nouns. A fix here should cover SCP-39 in the same place (calendar words) if the planner wants one pass over `newNames`.

### Proposed fix (options, in order of preference)

In `newNames`:

1. **Emphasis marks.** Compute `before` with trailing `*` and `_` removed before the `lead` test: `text.slice(0, at).replace(/[ \t*_]+$/, '')`. "the *Engine*" still yields `before = "the"` (not a start); `.* These` yields `.` (a start). Add `)` `]` `”` handling is already there for quotes; also consider `)` after a period ("...end.) These").
2. **Contractions of "I".** Skip a match whose stem is "I": `/^I['’](?:m|ve|ll|d)$/`. More general: strip a contraction tail (`['’](?:ve|ll|re|d|m|s|t)$`) before the length test and the lookup, so "She'd", "Don't" at odd places are judged by their stem.
3. **Capitalised ordinary words.** (a) A small list of words that are capitalised by convention and are not names: `god, gods, lord, heaven, heavens, hell, christ, devil, mother, father` (only the ones the run showed plus the obvious: keep it short). (b) Skip a word whose lower-case form is in the module's own `ENGLISH_WORDS` (`:263`), which already holds "these", "there", "the". Risk of (b): "The"-led proper names such as "The Engine" are still judged by their second word "Engine".
4. (Optional, SCP-39) calendar words from `calendar.ts` never count.

Do not weaken the guard by dropping the check: its purpose (SCP-13, `:293`) is to stop invented characters.

Alternative to consider: when the only hits are in a stoplist, accept; when others remain, keep refusing. Not needed if 1-3 are done.

### Reproduction

Not run (no test-run while the app is live). Reproduced by reading code against the log texts. The three results are in the job logs: `the-cold-furnace/log.md:1686` (God), `:2957` (I've), `the-perfect-alibi/log.md:3928` (God), `:4283` (These).

### Tests that must fail before and pass after

Put them in `tests/humanizerGuards.test.ts` (it already has `newNames` cases at `:74-78`) and one `humanizeProblem` case:

1. `newNames('He turned back, wishing to God he had not.', 'He turned back, wishing he had not.')` returns `[]` (fails now: `['God']`).
2. `newNames("She said I've learned it.", 'She said I have learned it.')` returns `[]`; same with "I'm", "I'll", "I'd", and with the curly apostrophe `I’ve` (fails now).
3. `newNames('*Request refused.* These were dead words.', 'Request refused. The words were dead.')` returns `[]`; same with `_..._` (fails now: `['These']`).
4. Still caught (guards must not go slack): `newNames('Then Captain Rourke came in.', 'Then he came in.')` returns `['Captain', 'Rourke']`; `newNames('She asked *Rourke* about it.', 'She asked about it.')` returns `['Rourke']` (an italic name mid-sentence); `newNames("Rourke's dog", 'dog')` stays flagged.
5. One `humanizeProblem` case with a contraction and "God" expects `null` (a valid rewrite is accepted).

Risk: low; it is a pure function with one caller (`humanizeProblem`; also used by the script path through the same call). The risk is a looser guard letting a real invented name through that equals a stop word ("Lord Ashdown": "Ashdown" is still checked; a bare "Lord" is not a name).

## 2. The quiet downgrade to LM Studio gemma

### Path (confirmed unless marked)

1. **Candidate list.** `scheduler.ts:345` calls `router.candidates(role, { agentModel, avoidFamily, bookModel })`. `router.ts:125-157`: `refs = [bookModel, agentModel, ...registry.roleModelRefs(role)]`, keeping only models whose provider is available and has a client; providers that are down are dropped while another is left.
2. **Where the fallback comes from.** `registry.ts:617` `roleModelRefs` -> `roleEntries` (`:639-672`). With `fallback_shared: true` it returns **every row of `fallbacks`** in order, plus the role's own list after them. The live config (`~\Scriptorium\config\settings.md`) has `fallbacks: deepseek/deepseek-flash, strata/default, lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic` and `fallback_shared: true`, `last_resort_model: ""`. The seed default is the same list (`seed/config/settings.md:10-13`), with `fallback_shared: false`, where each role keeps its own list (`seed/config/roles.md`: publisher = paid, strata, lmstudio; the humanizer deliberately has no LM Studio step, but `fallback_shared` gives it every row anyway: `registry.ts` doc comment "A role gets every row, even for a kind its own list leaves out"). So the fallback is **configuration, not hardcoded**.
3. **Which rows are usable.** deepseek is paid and `budget.md` `daily_cap_usd: 0` during the run (hub log 12:30), so the scheduler and router skip it (`scheduler.ts:~350`, `router.ts:189-196`). Strata is down (`router.ts:172`). The free local gemma is always usable. So book-model failure -> gemma, silently. **Inferred** for the exact skip reasons (budget cap value is from the hub run log; Strata state is not in the book logs), consistent with the log showing `lmstudio/gemma-4-e4b` directly after the acp model.
4. **The book's `role_models` is one model per role** (`shared/schemas.ts:349,416` `z.record(z.string(), z.string())`; `book.md` `role_models:`), so there is no way to say "argon, then claude-sonnet-5".

### Trigger A: the Codex usage limit (the-cold-furnace log.md:8825-8845)

- The proxy streamed the agent's message ("You've hit your usage limit ... try again at Nov 29th, 2026 11:07 AM") and the log shows three `acp/codex/gpt-5.6-terra` attempts (`(fallback or retry)` twice) and then `lmstudio/gemma...`. Three attempts = `retries: 2` in `router.ts:87,185`. **Confirmed** from the log.
- The proxy writes an SSE error envelope after the text (`api-acp-proxy/src/server.ts:200-205`), which `openaiCompat.ts:104` turns into `ProviderError("provider error: {...}", undefined, true)` (retryable). **Inferred** (I did not see the wire bytes; consistent with 3 retries and the text appearing as deltas).
- Nothing recognises it: `isDailyLimitError` (`router.ts:335`) needs status 429 and "per day/daily"; the other classifiers need a status. So there is no "set this model aside" step like `retired` (`:264`) or `refused` (`:274`). Every job pays 3 attempts per call on a model that cannot answer until Nov 29, then gets gemma.
- Also: a limit reply on a *successful* stream could be parsed as the review JSON; it was not, here, because the error envelope fires.

### Trigger B: prompt longer than the context (the-automaton-who-confessed publish job, log.md:8003-8012)

- The check **exists and worked**: `router.ts:177-184` skips a model whose `context` is below the estimated prompt tokens, with a `too-big` problem and no request; the log shows `_acp/antigravity/gemini-4-argon too big: prompt is too long ... about 45538 tokens, its context is 45000_`. The context value comes from `~\Scriptorium\config\providers.md` (45000 for the three antigravity models, 200000 for claude-sonnet-5). Existing test: `tests/models.test.ts:420-442`.
- After skipping, the next model in the list was gemma (same chain as above), and it answered. The job result is "success"; the only trace is the `too big` line plus `_model lmstudio/... _`.
- **Root cause B2: the publisher prompt is not sized for its model.** `handlers.ts:1256` sends `book_text: await d.books.fullText(slug)` (the whole book: 32,363 words about 45k tokens). Other builders size to a window (`memoryContext`, `handlers.ts:282-283`; `otherChapters`, `:1150`), but the window they use is `contextTokens: (role) => this.router.candidates(role)[0]?.context` (`engine.ts:202`), which passes **no `bookModel` or `agentModel`**, so it reports the role default's window, not the model the book actually uses. For a book whose publisher is argon (45k) it reports the role's first row (DeepSeek, 1M). So the prompt is never shrunk for argon.

### Proposed fix (options)

A. **Never quietly downgrade (must).** Pick one:
  1. *Book list.* Let `role_models` accept an ordered list (`argon, claude-sonnet-5`), and a book flag `fallback: own` (default `shared` for old books) meaning the candidate list is only the book's own list (no global rows). Then the failure goes to the next capable model of the *book's* list; when the list is exhausted the job fails with `all models failed. ...` (already assembled by `router.ts:300`). Touches `shared/schemas.ts` (book and story `role_models`), `brief.ts`, `engine.ts:672-720` (`getBookModel` returns a list), `scheduler.ts:345` and `router.ts:125` (`bookModel` -> list). Largest change, the exact thing the user asked.
  2. *Policy by tier.* A setting `fallback_never_to: [lmstudio]` (or `fallback_min_tier`), applied in `router.candidates`, so a book whose first model is an acp or paid model never falls to a local small model. Smaller change; the user's library of old books keeps working. Add `local` fallbacks only when the first model is itself local.
  3. *Loud, not blocking.* Whatever the chain, when a job runs on a model that is not the book's own model for the role, write a `DEVIATION` line to the book log, `d.log`, emit an event and show a problem in `factory_status`; optionally pause the book. Cheap and complementary to 1 or 2. (Hub's `waitbook.sh` already stops on a "fallback" line, so a stable marker text matters.)
  Recommended: 2 (or 1) plus 3.
B. **Recognise a usage limit.** New `isUsageLimitError` (`/usage limit|try again at|quota exceeded|credit balance/i`, any status). In `router.chat`, set the model aside until the parsed time (cap, say, 24 h; default 1 h if no time) in a per-model map like `refused`, call a new `onModelLimited`, and leave it out of `candidates` (`router.ts:141-145` already does this for `retired` and `refused`). No retries on it. Do not use `markDayFull` (`limiter`): that blocks the whole `acp` provider, and Claude and Antigravity still work. Surface it in `blockReason`/`factory_status`.
C. **Size the publisher prompt to the real model.** (1) Make `contextTokens` take the job's actual first model (the scheduler knows it at `scheduler.ts:345`; pass `models[0].context` into the `JobContext`, or let `contextTokens(role, book)` call `candidates(role, { bookModel })`). (2) In the publish handler, when `fullText` plus the template exceeds ~70% of the window, send the chapter summaries (`summaries/`) plus the first and last chapters, as long-book formats do.

### Risk

- A: changing the chain is the highest-risk change in this ticket: it is shared by every role and every book, the Models panel (`ModelsDialog.tsx` fallback rows), `seed/config/*`, and the seed hash/migrations (`seedHistory.ts`). A strict list can leave a book stuck (the job fails, the book fails after `max_attempts`): that is the requested behaviour, but the factory must show it (status, not only the log).
- B: parsing the "try again at" time; wrong parse must fall back to a fixed hold-off. A wrongly set-aside model hides a working one (mitigate: expiry, and the Models panel shows it).
- C: summaries lose detail the publisher uses for the blurb; limit to over-window books only.

### Reproduction

Not run. Both triggers are visible in the logs above. Smallest repro in code (to be written, using the `registryWith` and `mock` helpers of `tests/models.test.ts:420-442`):

### Tests

In `tests/models.test.ts` (router/registry) and `tests/scheduler.test.ts`:

1. **Too long falls to the next *book* model, not gemma.** Registry with `acp/a` (context 100), `acp/b` (context 100000), `lmstudio/g`, `fallback_shared: true`, book model list `[acp/a, acp/b]`: a long prompt must call only `b` (fails now: the book model cannot be a list, and gemma gets the call).
2. **Never quietly downgrade.** Same registry with both acp models too small and book strict: `router.chat` rejects with `all models failed ... too long` and the mock for `lmstudio/g` records zero calls (fails now: gemma answers).
3. **Usage limit.** Mock `acp/codex` throws `ProviderError('provider error: {"message":"You’ve hit your usage limit ... try again at Nov 29th, 2026 11:07 AM"}', undefined, true)`: expect exactly one request to codex (not three), the next call of any job leaves codex out of `candidates()` until the parsed time (injected `now`), and `acp/claude` remains usable. Fails now: 3 attempts, then fallthrough.
4. **Loud deviation.** When a job's `usedModels` last entry is not the book's model for the role, the job log has the marker line and an event is emitted (scheduler test).
5. **Window follows the book's model.** A unit test that `contextTokens` (or the new call) with `bookModel = acp/antigravity/gemini-4-argon` returns 45000, and a publish handler test with a long book that asserts the built prompt is under the window.

## 3. Outline not checked against the brief or notes

### Path (confirmed)

- The outline job (`handlers.ts:~690-702`, `outline`) appends `storyBriefSection`, `puzzlesOutlineSection`, `seriesSection`, `adaptSection` and `ownerNotesSection`. So the architect saw the brief and the owner notes.
- The review job (`longHandlers.ts:40-81`, `review_outline`, role developmental-editor) builds its prompt from `seed/prompts/developmental-editor/review_outline.md` (title, pitch, outline, bible digest) and appends `storyBriefSection` and `seriesSection` (`:57-58`). It does **not** call `ownerNotesSection`.
- The prompt text asks only structure questions (middle, subplots, flat stretches, goals). Nothing asks "does the outline contain what the brief requires". Verdict: the review of the-perfect-alibi passed with structure 9 (`reviews/outline-review.md`), although brief.md `## Plot` says "Absalom (the Orrery) and Vesper (the Mainspring) appear at least lightly and more clearly than in book 2" and `outline.md` has 0 mentions of either.
- Book 2 shows the mechanism works when it is asked for: a `add_book_note` was added, the architect (which does read notes) was told, and the first review said "revise: omits mandatory series-brief elements" (the-automaton-who-confessed log.md:86). In book 2 the note reached the review only because the outline was rewritten and re-reviewed with the note in the architect's prompt; the reviewer itself reads no notes.

### Where a check fits (options)

1. **Prompt (certain, cheap).** Add a paragraph to `review_outline.md`: "Check the outline against the owner's brief and notes below: every named character, plot point and setting item the brief or a note asks for must appear in some chapter. Name each missing item as a problem with the chapter where it should go. A missing required item is a 'revise' whatever the structure score." Add `appendToPrompt(messages, await ownerNotesSection(d, slug))` in `longHandlers.ts:58`. Changing the seed prompt changes its hash: add the old hash to `store/seedHistory.ts` (line 34 holds the review_outline hashes) so untouched data folders upgrade; live data folders with edited prompts keep theirs (same pitfall as `ensureProblemsRule`, which appends rules in code: this one can be appended in code as well, see `ensureProblemsRule` in the same handler, so it applies to edited prompts too).
2. **Code pre-check (precise).** Before the review, collect names from the brief's characters (`brief.characters`, parsed in `shared/brief.ts`) and the series cast (`series.ts` `seriesSection`), plus capitalised words of the brief `## Plot` section that are names; check each against the outline text (titles and summaries, with aliases as `mergeBriefCast` does, `briefCast.ts`). Append "Not in the outline: Absalom, Vesper" to the review prompt as a fact for the reviewer, and also to `outline-review.md`. Do not auto-fail: "appear at least lightly" in a brief is soft, a series cast of nine does not all belong in each book. Precedent: `withBriefCharacters` (`handlers.ts:1499-1506`) already finds brief characters the outline dropped (it adds them to the bible, with a log line); the same function's `merged.added` is the list to reuse for the check. Note that here Absalom and Vesper were not in `brief.characters` (the brief has Premise/Plot/Style sections only; they were in the series cast), so the pre-check must read the series cast too, or the Plot text.
3. Recommended: 1 now (a few lines, covers the notes too), 2 as a follow-up. The check belongs at the outline review, not later: after the outline is accepted the chapters are written against it.

### Tests

- `tests/` prompt test (how the other handlers test prompts: `tests/longbooks.test.ts` or similar; find with `grep review_outline tests`): the `review_outline` prompt sent to a mock model contains the owner notes text and the brief-compliance paragraph (fails now: no notes).
- If option 2: a pure-function test `missingFromOutline(briefNames, outlineText)`: brief names `Absalom, Vesper, Ada`, outline mentions only Ada -> `['Absalom','Vesper']`; alias and surname match; empty brief -> `[]`.
- A scenario test is not practical with live models; prove the prompt text, not the model's judgement.

### Risk

Low for the prompt; the reviewer may over-call "revise" and spend a rewrite round (outline rounds are cheap). The code check can be noisy for soft briefs, hence "fact for the reviewer", not a failure.

## 4. The `humanized: N` field

### Where it is written and read (confirmed)

| File:line | What |
|---|---|
| `humanizerHandlers.ts:402` | **Only writer.** `humanized: ctx.job.round` is passed to `writeChapter`, also when `problem` is set (the pass was refused; the comment at `:393` says so on purpose: "so it is not asked again"). The writer's own `writeChapter` calls do not pass it, so a rewritten chapter loses the field. |
| `books.ts:70,339,352` | `ChapterFile.humanized?: number`; `writeChapter` writes it to the front matter (an `undefined` is left out). |
| `books.ts:332` | Reader: `Number.isInteger(doc.data.humanized)` -> `humanized: Number(...)`. |
| `books.ts:346` | History: the previous version is saved as `ch-NN-r<round>[-humanized].md`, the suffix when the *old* file had an integer `humanized`. So a chapter whose pass was refused is also saved as "-humanized". |
| `pipeline.ts:390` | Builds `humanized: Map<chapter, round>`. |
| `advance.ts:123,449,458,572` | Uses `humanized?.has(n)` only (presence), never the value; the round in the value is not read anywhere. |
| `tests/humanizer.test.ts:82-83,103-111,240` | Build maps `[[1, 0]]` and assert `{ round: 0, humanized: 0 }`. |
| `docs/design.md:99,802` | Documents it as the round. |

Confusion confirmed: the hub run log first read `humanized: 0` as "not humanized" (14:01 entry, corrected at 15:05). Also `the-perfect-alibi/chapters/ch-12.md` has `humanized: 0` and the original body (the pass was refused for "God"), so the field is neither "was rewritten" nor "was accepted".

### Proposal

Write two clear fields and keep reading the old one:

```
humanizer_round: 0          # the book round the pass ran in
humanizer_result: rewritten # or: kept (the guard refused it)
humanizer_note: ...         # optional: the refusal reason, short
```

- **Reader** (`books.ts:332`): take `humanizer_round` if it is an integer, else the old `humanized` (so every existing chapter, and the unit tests that build `[[1, 0]]`, keep working). Keep `ChapterFile.humanized` (number) as the in-memory name, or rename it with a deprecated alias. Add `humanizerResult?: 'rewritten' | 'kept'`.
- **Writer** (`humanizerHandlers.ts:394-403`): pass the new fields; stop writing `humanized`. Update `writeMd` call in `books.ts:352`.
- **History suffix** (`books.ts:346`): test `humanizer_result === 'rewritten'` (or the old integer key) so a refused pass is not labelled "-humanized"; keep the suffix text so old history files still match anything that parses them.
- **No data migration is required** (reader falls back). If a migration is wanted, add one in `store/migrations.ts` that rewrites `humanized: N` to `humanizer_round: N` and sets `humanizer_result: kept` only when the history has no `-humanized` file (cannot be told otherwise: the old files do not say). Probably skip; a data folder with old files is read correctly.
- **Compatibility**: older engine versions reading a new file ignore the unknown key and then treat the chapter as not humanized, so a downgraded engine would humanize again (one extra rewrite of each chapter). Keep writing `humanized` too for one release if downgrades matter (the user runs a packaged app; low concern).
- Other consumers: nothing in `src/renderer` or `src/shared` reads it (grep). Book Translator and VN Studio read chapters? **Not checked** (other repos; if they parse chapter front matter they will ignore unknown keys).

### Tests

1. `tests/humanizer.test.ts` (`:235-240`): a refused pass writes `humanizer_result: kept` and `humanizer_round`; an accepted one `rewritten`; `chapters()` reads both new and old files (a fixture with only `humanized: 0` still yields a done mark).
2. History suffix: the old version of a refused chapter is not saved as `-humanized` (fails now).
3. `advance` tests unchanged (presence-based); they must pass with the map built from either key.

## What the plan needs

- Files: `src/engine/pipeline/humanizerHandlers.ts` (1, 4), `src/engine/pipeline/books.ts` (4), `src/engine/models/router.ts`, `registry.ts`, `src/engine/engine.ts`, `src/engine/queue/scheduler.ts`, `src/shared/schemas.ts`, `src/shared/brief.ts` (2), `src/engine/pipeline/handlers.ts` (publish, 2), `src/engine/pipeline/longHandlers.ts`, `seed/prompts/developmental-editor/review_outline.md`, `src/engine/store/seedHistory.ts` (3), docs `docs/design.md`, seed `config/settings.md` and `roles.md` text if the fallback policy changes.
- Existing tests in the area: `tests/humanizerGuards.test.ts`, `tests/humanizer.test.ts`, `tests/clientsearch.test.ts:288-291` (`newNames`), `tests/models.test.ts:420-442` (too-big skip, with `registryWith` and `mock`), `tests/scheduler.test.ts`.
- Order suggestion: bug 1 first (small, pure, must-fix), then 2B and 2C, then 2A (needs a design decision: book list or tier policy), then 3 (prompt), then 4.
- Dependent live state: the user's data folder `~\Scriptorium\config\` keeps its own `settings.md` and `prompts`; code appended rules (as `ensureProblemsRule` does) reach edited folders, seed edits only reach untouched ones.

## Risks

- Shared fallback code touches every role and book (2A).
- A looser `newNames` may let a rare real invented name through; the tests above pin the cases.
- The seed hash must change for the prompt (3) and the old hash must be added to `seedHistory.ts`.
- Do not test-run while the live production is running; unit tests of pure functions are fine, but the scheduler/engine tests may touch `~\Scriptorium` (check before running).

## Open questions

1. What exactly did the budget cap and Strata state look like at 14:33 and 16:56? (Inferred from the hub run log: cap 0, Strata not running.) Whether DeepSeek was skipped for budget or because its key is absent is not in the book logs.
2. Wire format of the Codex limit: text then an SSE error, or text with a normal finish (then the 3 attempts would come from elsewhere)? Read from the proxy source; not seen live.
3. Which option the user wants for 2A (book list, tier policy, or only the loud marker). The run log says "client only as a logged fallback" was the intent: that is a book-level list with a named last entry, which favours option 1.
4. Whether to treat SCP-39 (weekdays/months as names, open in ROADMAP.md) in the same change as bug 1.
5. Whether Book Translator or VN Studio read the `humanized` key (other repos, not checked).
6. For "These": the original chapter text was not available in `history` (the kept chapter overwrote nothing), so I did not diff the original around that sentence.

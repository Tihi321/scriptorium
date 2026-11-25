---
status: done
request: REQ-0033
repos: [C:/projects/Personal/scriptorium]
branch: SCP-71_idea-fable
updated: 2026-11-25
---

# SCP-71: the `idea-fable` format (Scriptorium half of hub HUB-45)

Hub plan (cross-tool scope, the pilot production): `C:/projects/Personal/creative-hub/.claude/tickets/HUB-45-idea-fable-pilots/plan.md`.
Research with file:line findings: `C:/projects/Personal/creative-hub/.claude/tickets/HUB-45-idea-fable-pilots/research.md`.
Pattern copied: SCP-46 picture books (`.claude/tickets/SCP-46-picture-books/plan.md`): a format flag, its own prompt suffix with a
plain-prompt fallback, never picked at random, one append migration, one test file.

SCP-71 is the next free number (highest ticket folder and branch is SCP-70). Ticket folders in this repo are named
`SCP-NN-<name>` (hyphen); branches `SCP-NN_<name>` (underscore). Cut the branch from `master`.

Build reading (one line, per the global scope rule): **the full reading** - a `fable` flag with its own writer prompts, the back
matter kept out of the length gate and the humanizer, the sources, the Go deeper list and the fixed line written by the engine
from the brief, and a mechanical check of the quiz; not a config-only format entry.

## Scope

An **idea fable** is one original English fiction story in one chapter, 1,500-2,000 words, humanized, in which an invented character
lives through ONE non-fiction idea; it is followed in the same chapter by back matter: a "What just happened" debrief (the idea in
plain words, where it showed up, how to use it tomorrow, sources), a 3-question multiple-choice quiz with answers and explanations,
a "Go deeper" list of 2-3 real books and a fixed disclaimer line. The idea arrives as a concept card in the owner's story brief
(`add_story {sections}`).

What this ticket adds:

1. A format flag `fable: boolean` (default false) and a seed format `idea-fable` with it.
2. Prompt suffix `_fable` (`variant()`), two new writer prompts, and a `_fable` -> plain fallback in `loadPrompt`.
3. A small module `src/engine/pipeline/fable.ts`: split story / back matter, read the card from the brief, assemble the engine-owned
   parts of the back matter, check the back matter, the reviewer note, the disclaimer constant.
4. Engine guards, all only for `fmt.fable` (except the story-only word count, see Task 3):
   - the chapter's recorded `words` counts only the story (so the length gate, `get_book.lengthGate`, the publisher's ceiling check
     and the rewrite targets measure the story);
   - the length gate window is the format's range exactly (no 15 % slack) for a fable;
   - tighten (the "cut to target" retry) runs on the story only;
   - the humanizer gets only the story and the back matter is re-attached unchanged;
   - the writer's back matter is checked; one repair request when it is malformed;
   - `**Sources**`, `## Go deeper` and the disclaimer are written by the engine from the brief, never by the model;
   - `[RESEARCH: ...]` markers are stripped, never turned into research jobs;
   - reviewers get the owner's brief (so they can see the card) and a fixed note about the back matter.
5. A migration `migrateIdeaFables` that appends the seed entry to an existing `config/formats.md` (live `~/Scriptorium`), like
   `migratePictureBooks`. The two new prompt files reach the live `prompts/` folder by the existing seed copy at start (`copyTree`
   never overwrites, and these files are new).
6. Tests (one new file plus one case in an existing file) and docs.

### Out of scope

- Audio, story packs, story-kit, Supabase, the Taleidea app, translation, a concept-bank store.
- Any change to another repo (VN Studio's twin `bookTypes.ts` included, so Scriptorium's `src/renderer/store/bookTypes.ts` is not
  touched either: an unknown format id falls back to its regex badge, which is cosmetic, research Q1).
- A separate post-story job or stage (research option D), a fact base or `nonfiction: true` for fables, the fact-checker.
- New `_fable` prompts for the humanizer, reviewers, architect, editor-in-chief or publisher (they use their plain prompts through
  the fallback; the humanizer never sees the back matter).
- Any change to the live data folder by hand, any engine start, any live model call. The live folder is changed only by the
  migration when the hub's production task starts the engine (HUB-45 task group 2).
- An `-Only` option for `hub.ps1` (hub scope, not needed: `paused`/`only` in `factory.md` do the job).

## Files and modules to touch

| Area | File |
|---|---|
| Flag + doc comment | `src/shared/schemas.ts` (`formatEntrySchema`, next to `picture_book` at about line 244) |
| New module | `src/engine/pipeline/fable.ts` (new) |
| `variant`, `formatsForKind`, start_book override, draft / rewrite / review handlers | `src/engine/pipeline/handlers.ts` (lines about 156-160, 546-547, 860-990, 1029-1047, 1190-1262, 1417-1420) |
| `_fable` fallback | `src/engine/pipeline/prompts.ts` (`loadPrompt`, about line 30) |
| Humanizer: story only | `src/engine/pipeline/humanizerHandlers.ts` (`humanize_chapter`, about lines 351-418) |
| Story-only `words` | `src/engine/pipeline/books.ts` (`writeChapter`, line 362) |
| Strict gate window | `src/engine/pipeline/advance.ts` (short-book gate, line 399) |
| Seed format entry + flag docs | `seed/config/formats.md` (append the entry as the last item of `formats:`; flag line in the docs below the frontmatter) |
| New prompts | `seed/prompts/writer/draft_chapter_fable.md`, `seed/prompts/writer/rewrite_chapter_fable.md` |
| Seed history | `src/engine/store/seedHistory.ts` (regenerated by `yarn seed:hashes`, never by hand) |
| Migration | `src/engine/store/migrations.ts` (`IDEA_FABLE_FORMAT_IDS`, `migrateIdeaFables`), `src/engine/store/dataFolder.ts` (register after `migratePictureBooks`, line 115) |
| Tests | `tests/fable.test.ts` (new), `tests/lengths.test.ts` (one case) |
| Docs | `docs/mcp.md` (`add_story`: the idea-fable brief layout), `docs/design.md` (Decisions row + History line), `ROADMAP.md` (SCP-71 bullet) |

## Contracts (the interfaces every task relies on)

### C1. The flag

`src/shared/schemas.ts`, inside `formatEntrySchema`, after `picture_book`:

```ts
  /**
   * An idea fable (prose fiction, not a script): one chapter that holds a story in which a character lives through one idea from the
   * owner's Concept card, then back matter from the line `## What just happened` on (debrief, quiz). The engine counts only the story's
   * words, humanizes only the story, writes the sources, the Go deeper list and the closing line from the brief, and checks the quiz.
   * Writer prompts `_fable`. Never picked by a topic: only a story that fixes the format gets it (src/engine/pipeline/fable.ts).
   */
  fable: z.boolean().default(false),
```

### C2. The seed format entry (exact text; append as the last item of the `formats:` list in `seed/config/formats.md`)

```yaml
  - id: idea-fable
    name: Idea fable (one idea, lived)
    enabled: true
    fable: true
    kinds: [idea-fable]
    juvenile: false
    age_band: null
    words: [1500, 2000]
    chapters: [1, 1]
    read_aloud: false
    research: false
    humanize: true
    max_rounds: 1
    reviewers: [developmental-editor, line-editor, copy-editor, beta-reader, originality-checker]
    guidance: |
      An original short story for adult readers in which one invented character lives through one idea from non-fiction, the idea of
      the owner's Concept card. The story is 1,500 to 2,000 words in plain, warm, concrete English, in one scene or a few. The character
      meets the idea as a problem in an ordinary life, first acts on the common misconception, and changes when the idea starts to work
      for them, so the reader feels the idea before anyone names it. Inside the story never name the idea, a researcher, a study or a
      book, and never lecture. Invent every person, place and example: no real person, no real company and no scene, anecdote or example
      from the books of the brief. Every real-world fact the story leans on is one of the card's key facts. After the story comes the back
      matter (What just happened, then the quiz) as the writer prompt lays it out; the engine adds the sources, the Go deeper list and
      the closing line. Write no [RESEARCH: ...] markers.
```

Why these keys: `kinds: [idea-fable]` matches no topic; `research: false` means no research plan and no writer prep
(`advance.ts:17-19`); `juvenile`/`read_aloud` false keep the child-safety and read-aloud reviewers out; the reviewer list drops the
continuity checker (one chapter); `max_rounds: 1` (one rewrite round) keeps a pilot short; `humanize: true` because the REQ wants the
story humanized.

### C3. Prompt suffix

- `variant()` (`handlers.ts:1417-1420`): extend the `Pick` type with `fable?: boolean` and return `${task}_fable` when `fmt.fable`,
  checked right after `article` and before `nonfiction`:
  `fmt.article ? _article : fmt.fable ? _fable : fmt.nonfiction ? _nf : ...`.
- `loadPrompt` (`prompts.ts`): **the existing fallback regex cannot simply take `fable`**: it drops the last three characters
  (`task.slice(0, -3)`), and `_fable` is six. Add a separate branch before the regex:
  `if (task.endsWith('_fable')) return loadPrompt(dataDir, role, task.slice(0, -6))`, and extend the comment. Every role or task
  without a `_fable` file (pitch, outline, review, humanize_chapter, publish, start_book is not variant-selected) then uses its plain
  prompt.
- New prompt files (frontmatter like `draft_chapter_pb.md`): `seed/prompts/writer/draft_chapter_fable.md` (`kind: prompt`,
  `role: writer`, `task: draft_chapter`) and `seed/prompts/writer/rewrite_chapter_fable.md` (`task: rewrite_chapter`). Text in Task 4.
- **Leak rule for the prompt author** (`src/engine/pipeline/leak.ts`): every fixed sentence of 40 or more characters in a prompt
  template is an "instruction line", and an answer that ends with such lines is cut. So the layout the prompts show must consist of
  short labels only (`## What just happened`, `**The idea.**`, `### Answers`, `A)` ...), with no long example sentence the model would
  copy, and the disclaimer text must **not** appear in any prompt (the engine adds it).

### C4. The back matter markup (what the chapter body holds after the story)

The writer writes the story, then exactly this layout (everything from the `## What just happened` line on is "the back matter"):

```
<story paragraphs; --- between scenes allowed>

## What just happened

**The idea.** <2-4 plain sentences: what the idea is, with its key-fact numbers like [1]>

**Where it showed up.** <2-4 sentences naming the moments of this story where the idea worked, by what the character did>

**How to use it tomorrow.** <2-3 sentences: one concrete thing a reader can try>

## Quiz

**1. <question>**
A) <option>
B) <option>
C) <option>
D) <option>

**2. <question>**
A) ...
B) ...
C) ...
D) ...

**3. <question>**
A) ...
B) ...
C) ...
D) ...

### Answers

1. <letter>. <one sentence: why it is right, tied to the story or a key fact>

2. <letter>. <...>

3. <letter>. <...>
```

The engine then makes the final back matter with `assembleFableBack` (C5): it inserts, as the last paragraph of the debrief (right
before `## Quiz`),

```
**Sources**
1. <the brief's Sources line 1>
2. <...>
```

and appends at the end

```
## Go deeper

<the brief's Go deeper line 1>
<line 2>
<line 3 (optional)>

This story is original fiction. It is not a summary of these books and is not affiliated with or endorsed by their authors or publishers.
```

Rendering (`src/engine/publish/xhtml.ts:203-224`, used by EPUB, reader and PDF): a one-line `## x` block is `<h3>`, `### x` is
`<h4>` (the chapter title is h2); a multi-line block is one `<p>` with `<br/>` between lines; `**x**` and `*x*` are bold and italic.
There are no lists, so the markup above never relies on list syntax: every question block and the Sources and Go deeper blocks are
single paragraphs with line breaks, every answer is its own paragraph. Answers sit after all three questions so a reader is not
shown the answer under its question. No renderer change is needed.

### C5. `src/engine/pipeline/fable.ts` (new, pure functions, no I/O)

```ts
import type { StoryBrief } from '../../shared/brief'

/** The line that starts the back matter of an idea fable. */
export const FABLE_BACK_HEADING = '## What just happened'
/** The fixed closing line (REQ-0033, word for word). Written by the engine only; never put it in a prompt. */
export const FABLE_DISCLAIMER = 'This story is original fiction. It is not a summary of these books and is not affiliated with or endorsed by their authors or publishers.'

/** The story and the back matter of a chapter: split at the first line that is exactly `## What just happened` (trailing spaces allowed). `back` is '' when there is none; it starts with the heading. Both trimmed. */
export function splitFable(body: string): { story: string; back: string }
/** The story part (the whole text when there is no back matter). */
export const storyPart = (body: string): string => splitFable(body).story
/** Story + back matter, one blank line between. */
export function joinFable(story: string, back: string): string

/** The card of the owner's brief: the lines of the sections named (case-insensitive) "Key facts", "Sources" and "Go deeper" (non-empty lines, trimmed, list numbering "1. " kept as written); `card` is the text of the "Concept card" section. Missing sections give empty arrays / ''. */
export function fableCard(brief: StoryBrief | null): { card: string; keyFacts: string[]; sources: string[]; books: string[] }

/** The back matter as published: the model's part (from the heading through the quiz answers) with any `**Sources**` paragraph, any `## Go deeper` section and anything after it, and any line equal to FABLE_DISCLAIMER removed; then the Sources paragraph inserted before `## Quiz` and the Go deeper section plus FABLE_DISCLAIMER appended, both from the card. Idempotent: assembling an assembled back matter gives the same text. With no back matter returns ''. With an empty `sources` or `books` the matching block is left out (the disclaimer is always added when there is back matter). */
export function assembleFableBack(back: string, card: ReturnType<typeof fableCard>): string

/** What is wrong with a back matter (the model's part; engine-owned blocks are ignored), as short English lines; [] when it is fine. */
export function fableBackProblems(back: string, card: ReturnType<typeof fableCard>): string[]

/** Appended to every reviewer prompt of a fable. */
export const FABLE_REVIEW_NOTE: string
```

`fableBackProblems` checks, each failure one line:

1. `back` is empty or does not start with `## What just happened` -> "no back matter (## What just happened)".
2. The debrief has the three lead-ins `**The idea.**`, `**Where it showed up.**`, `**How to use it tomorrow.**` in this order.
3. Key-fact references: at least one `[n]` in the debrief, and every `[n]` in the whole back matter has `1 <= n <= keyFacts.length`
   ("[5] is not a key fact of the card (it has 4)"). When `keyFacts` is empty: "the brief has no Key facts section".
4. `## Quiz` exists after the debrief; exactly 3 question blocks whose first line matches `^\*\*[1-3]\. .+\*\*$` (numbers 1, 2, 3 in
   order), each followed by exactly four lines `^[A-D]\) .+` in the order A, B, C, D.
5. `### Answers` exists after the questions with exactly 3 paragraphs matching `^([1-3])\. ([A-D])\. .+`, each number once.

`FABLE_REVIEW_NOTE` (exact text):

```
This book is an idea fable. Its chapter is a story, then back matter from the heading "What just happened" on: a short debrief, a
three-question quiz with answers, the sources, a Go deeper list of real books and a fixed closing line. The back matter belongs to
the format: do not ask to remove, shorten or merge it into the story, and do not count the books it names as imitation. Judge the
story for your area. In the back matter flag only a fact that is not one of the key facts of the owner's Concept card (the owner's
story brief below has them), a quiz answer marked wrong, or a debrief that describes a moment the story does not have.
```

### C6. Engine changes (where each `fable.ts` function is used)

| Place | Change (only when `fmt.fable`, unless said) |
|---|---|
| `books.ts` `writeChapter` (line 362) | `words: countWords(storyPart(ch.body))` for **every** chapter (format-agnostic: a body with no `## What just happened` line counts as before; no other format writes that heading line). This one line makes the gate, `lengthGate`, `chapterWords`, the publisher's ceiling check and the rewrite's `current.words` story-only. |
| `advance.ts` short-book gate (line 399) | `const slack = s.format.fable ? 0 : 0.15` and use `min * (1 - slack)` / `max * (1 + slack)`; the target band stays. |
| `handlers.ts` `formatsForKind` (157-160) | add `&& !f.fable` to both filters; extend the doc comment. |
| `handlers.ts` start_book (after 547) | `if (idea?.data.format && formats.some((f) => f.enabled && f.fable && f.id === idea.data.format)) allowed = formats.filter((f) => f.id === idea.data.format)` with the same comment style as the picture-book line. |
| `handlers.ts` draft_chapter (after `chapterAnswer`, 932-987) | `const card = fableCard(await d.books.brief(slug))`; split the answer; if `fableBackProblems(back, card)` is not empty, **one** repair request (`run.chat` with `[...messages, {assistant: body}, {user: repair}]`, where `repair` = "The back matter after the story has these problems: <lines>. Write only the back matter again, from the line ## What just happened to the last quiz answer, in the layout of the task. Do not write the story again."); take the new back matter (`splitFable` of the reply, or the reply itself if it starts with the heading) when it has fewer problems; log what is left (`ctx.log('fable back matter: ...')`). Tighten: call `tighten` with the **story** only and keep `splitFable(out.body).story`. Skip the `findMarkers` loop and `stripMarkers` the story. Then `body = joinFable(story, assembleFableBack(back, card))`. The result line names the story words. |
| `handlers.ts` rewrite_chapter (1235-1262) | split the reply; if the new back matter is empty or has more problems than the current chapter's back matter, keep the current one (log it); tighten the story only (as in draft); strip markers; `body = joinFable(story, assembleFableBack(back, card))`. |
| `handlers.ts` review (1040-1047) | `if (fmt.fable) { appendToPrompt(messages, FABLE_REVIEW_NOTE); appendToPrompt(messages, await storyBriefSection(d, slug)) }`. Note: reviewers do **not** get the brief today (the research inferred they do; the review handler appends no brief section), so this is needed for the card check. |
| `humanizerHandlers.ts` humanize_chapter (351-418) | `const { story, back } = fmt.fable ? splitFable(current.body) : { story: current.body, back: '' }`; `chapter_text: story`, `chapter_words: countWords(story)`, `maxTokens` from the story words; `humanizeProblem(story, revised, ...)`; `body = problem ? current.body : (fmt.fable ? joinFable(revised, back) : revised)`. The log lines count the story. |
| `prompts.ts` `loadPrompt` | the `_fable` branch (C3). |

### C7. The brief layout a fable expects (consumed by `fableCard`; written by the hub's pilots)

`add_story` with `format: "idea-fable"` and these `sections` (headings exact, order free):

| heading | text |
|---|---|
| `Concept card` | `Idea: <name>` / `Definition: ...` / `Mechanism: ...` / `Misconception: ...` / `Rules: ...` (one field per line; free prose) |
| `Key facts` | `1. <fact>` one per line, numbered from 1; the only facts the debrief may state |
| `Sources` | `1. <source of key fact 1>` with the same numbers as Key facts |
| `Go deeper` | one book per line, e.g. `*Seven Brief Lessons on Physics*, Carlo Rovelli (Riverhead, ISBN 9780399184413)` |

The hub plan gives the three filled-in calls. `docs/mcp.md` documents this table.

## Tasks for workers

Worker rules: work only in `C:/projects/Personal/scriptorium` on branch `SCP-71_idea-fable` (cut from `master`). No engine start, no
`yarn headless`, no app start, no live model call, no edit of `~/Scriptorium`. Node only through fnm (see Acceptance). After any
edit under `seed/prompts`, run `yarn seed:hashes`; new prompt files must be tracked (`git add -N`) before it, because
`scripts/seed-hashes.mjs` reads tracked files only (SCP-46 deviation 4). No commit unless the `implement` skill's flow says so.

### Task 1: flag, format entry, selection (schemas, seed formats, handlers selection, prompts fallback)

- Inputs: C1, C2, C3.
- Do: add the flag (C1); append the format entry (C2) to `seed/config/formats.md` and add a `fable` line to the flag docs under the
  frontmatter (one sentence, same style as `picture_book`); `variant()` and its type (C3); `loadPrompt` `_fable` branch (C3);
  `formatsForKind` exclusion and the start_book override (C6 rows 3-4).
- Outputs: `variant({fable:true,...}, 'draft_chapter') === 'draft_chapter_fable'`; `formatsForKind(formats, null)` and
  `formatsForKind(formats, 'idea-fable')` never contain `idea-fable`; a story with `format: 'idea-fable'` starts a book of that format.
- Contract with others: Task 3 and Task 4 rely on `fmt.fable` and the `_fable` task names.

### Task 2: `fable.ts`

- Inputs: C4, C5, C7. `StoryBrief` is in `src/shared/brief.ts:24-52` (`sections: {heading, text}[]`).
- Do: implement the module exactly as C5 (signatures, constants, the five checks, the note text). Pure functions, no imports from the
  engine other than types.
- Outputs: the exports of C5. Contract: Task 3 calls only these exports; Task 5's unit test calls them directly.

### Task 3: engine guards (books, advance, handlers draft/rewrite/review, humanizer)

- Inputs: C6, the exports of Task 2, `fmt.fable` from Task 1.
- Do: each row of C6. Keep every non-fable path byte-for-byte unchanged in behaviour (the only format-agnostic change is the
  `writeChapter` word count, which is identical for bodies without the heading line).
- Outputs: a fable chapter file whose front matter `words` is the story's words, whose body ends with the assembled back matter;
  the humanizer's request holds no back matter; the gate rewrites a fable outside 1,500-2,000 story words once.

### Task 4: the two writer prompts

- Inputs: C3 (leak rule), C4 (layout), the plain `seed/prompts/writer/draft_chapter.md` and `rewrite_chapter.md` (variables:
  `{{chapter_n}} {{chapter_count}} {{title}} {{format_name}} {{age_band}} {{target_words}} {{chapter_words}} {{guidance}}
  {{story_so_far}} {{chapter_title}} {{chapter_summary}}` for the draft; `{{bible}} {{notes}} {{research}} {{other_chapters}}
  {{chapter_text}}` and the shared ones for the rewrite).
- `draft_chapter_fable.md` must say, in plain short sentences (wording is the worker's, under the leak rule):
  1. Write "{{title}}", an idea fable: first the story of about {{chapter_words}} words (the story alone; the back matter comes on
     top), then the back matter. Format guidance `{{guidance}}`, then `{{story_so_far}}` and the chapter summary as in the plain prompt.
  2. The story: as the guidance; plain prose paragraphs, no title or heading, `---` between scenes if needed; no `[RESEARCH: ...]`
     markers; the idea is never named in the story.
  3. Then a line `## What just happened` and the layout of C4 (debrief with the three bold lead-ins, `## Quiz` with three questions
     of four options A-D, `### Answers` with one paragraph per answer: number, letter, one sentence), shown as a short skeleton with
     placeholders in angle brackets.
  4. Fact rule: every factual sentence of the debrief states one key fact of the owner's brief (section "Key facts") in plain
     words and ends with its number in square brackets, like [2]; no fact, number, date, name or quote that the Key facts do not
     give; no fact from memory or from the books. "Where it showed up" names moments of this story only. Quiz questions test the
     idea through the story and the key facts; exactly one option is right; the wrong options are plausible.
  5. Do not write sources, a book list, a reading list or a closing line: the engine adds them. Do not summarize the story in the
     debrief beyond the moments the idea showed up.
- `rewrite_chapter_fable.md`: the plain rewrite prompt's structure plus: the chapter has a story and back matter; fix what the notes
  point out in either part; keep the story at about {{chapter_words}} words; return the whole chapter (story, then the back matter in
  the same layout); keep the key-fact numbers; do not write sources, the book list or a closing line.
- Then `git add -N` both files and `yarn seed:hashes`.
- Outputs: the two files; `src/engine/store/seedHistory.ts` regenerated.

### Task 5: migration

- Inputs: `appendSeedFormats` and `migratePictureBooks` (`src/engine/store/migrations.ts:144-185`), registration list
  (`src/engine/store/dataFolder.ts:110-122`).
- Do: `export const IDEA_FABLE_FORMAT_IDS = ['idea-fable']` and
  `export async function migrateIdeaFables(dataDir, seedDir)` returning
  `{ changes: added.length ? ['config/formats.md: added the idea-fable format (idea-fable)'] : [] }`; register it right after
  `migratePictureBooks` in `initDataFolder`.
- Outputs: on the next engine start the live `~/Scriptorium/config/formats.md` gets the entry once, CRLF kept, the user's own
  entries untouched (the existing helper does this).

### Task 6: tests

Follow the `test-discipline` skill: only these, no near-duplicates. Reuse `tests/helpers.ts` (`seedDir`, `makePipelineEnv`,
`waitFor`) and the `tests/pictureBook.test.ts` structure.

`tests/fable.test.ts` (new), four tests:

1. **"the idea-fable format: in the seed with its flags, never picked at random, `_fable` prompts with a plain fallback"** - parse
   the seed `formats.md`: entry has `fable: true`, `words [1500, 2000]`, `chapters [1, 1]`, `research: false`; `formatsForKind(f, null)`
   and `formatsForKind(f, 'idea-fable')` lack it; `variant` gives `draft_chapter_fable`; `loadPrompt(seedDir-based data dir,
   'humanizer', 'humanize_chapter_fable')` returns the plain `humanize_chapter.md`; both `_fable` writer files exist with
   `task: draft_chapter` / `rewrite_chapter`; neither prompt contains `FABLE_DISCLAIMER`.
2. **"fable back matter: story words only, engine-owned blocks, the quiz check"** - a fixture chapter string (story of ~60 words +
   a correct back matter); assert `countWords(storyPart(x))` equals the story's count; `assembleFableBack` adds Sources before
   `## Quiz`, Go deeper and the disclaimer exactly once, and is idempotent (assembling twice equals once) and removes a model-written
   disclaimer or book list; `fableBackProblems` is `[]` for the fixture and names the problem for (a) a quiz with two questions,
   (b) `[5]` with a 4-fact card, (c) a missing `### Answers`. One `it`, three bad variants in a small table.
3. **"an idea fable in the factory: starts from a story that fixes the format; the humanizer sees only the story"** - with
   `makePipelineEnv` (mock models, as `pictureBook.test.ts:137`): `addStory({... format: 'idea-fable', sections: [Key facts, Sources,
   Go deeper] })`; the mock writer returns story + back matter; wait (with `waitFor` on `book.md`, the SCP-70 pattern) for chapter 1;
   assert the book's format, that `chapters/ch-01.md` front matter `words` equals the story's word count, that the body ends with the
   disclaimer, and that the recorded humanizer request text (whatever the mock env exposes for request bodies; if it exposes none, a
   direct call of the handler is acceptable) contains no `## What just happened`. If the mock env cannot drive a humanizer pass in
   reasonable time, split the humanizer assertion into a direct handler test, still one `it`.
4. **"migrateIdeaFables appends the seed entry once and keeps CRLF"** - copy of the picture-book migration test (`:202`), one `it`.

`tests/lengths.test.ts`: add one case next to the short-book gate cases (`:55-82`): a `fable` format at 2,100 story words goes to
`length-fix`, while the same total for a non-fable format with the same `words` stays `ok` (inside the 15 % slack).

Existing tests that must stay green unchanged: `tests/pictureBook.test.ts`, `tests/nonfiction.test.ts` (its pinned list of
non-fiction ids is untouched, a fable is fiction), `tests/humanizer.test.ts`, `tests/humanizerGuards.test.ts`,
`tests/migrations.test.ts` (seed-history check), `tests/mcp.test.ts`.

### Task 7: docs and roadmap

- `docs/mcp.md`, `add_story`: one paragraph "Idea fables" with the C7 table and a pointer to `seed/config/formats.md`.
- `docs/design.md`: a Decisions row "SCP-71 idea fable: `fable` flag, story + engine-checked back matter in one chapter, story-only
  word count and humanizer, engine-written sources, Go deeper and disclaimer" and a History line (2026-11-24).
- `ROADMAP.md`: append under the latest open section, in the existing line format:
  `- **SCP-71 (branch `SCP-71_idea-fable`; plan in `.claude/tickets/SCP-71-idea-fable/`; hub HUB-45, REQ-0033): the idea-fable format.** A `fable` flag and the `idea-fable` seed format (1,500-2,000-word story, then a debrief and a three-question quiz); `_fable` writer prompts; the back matter is checked, kept out of the length gate and the humanizer, and its sources, Go deeper list and disclaimer come from the brief; migration `migrateIdeaFables`. Not done: the live pilots (HUB-45).`

## Acceptance criteria and the tests that prove them

| # | Criterion | Proof |
|---|---|---|
| A1 | An `idea-fable` format exists (seed) and reaches an existing data folder once | fable test 1, fable test 4 |
| A2 | A story fixing `format: "idea-fable"` with a concept card in `sections` starts a book of that format; the format is never picked at random | fable tests 1 and 3 |
| A3 | Only the story counts toward the gate, and the gate keeps the story inside 1,500-2,000 | fable test 2 (story count), fable test 3 (`words` in the chapter file), lengths case |
| A4 | The humanizer does not touch the back matter | fable test 3 |
| A5 | The sources, Go deeper list and disclaimer come from the brief, exactly once; a malformed quiz is detected | fable test 2 |
| A6 | Debrief facts are bound to the card | prompt rule (Task 4) + `[n]` range check (fable test 2) + reviewers see the card (C6); the semantic trace is checked per pilot in HUB-45 task group 2 |
| A7 | Quiz and lists render in EPUB/reader | by construction (C4 uses only markup `markdownToXhtml` renders); checked on a real book in HUB-45 |
| A8 | Nothing else changed | full `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build` pass |

Run from `C:\projects\Personal\scriptorium` in PowerShell (Node is not on PATH in non-interactive shells):

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
yarn seed:hashes
npx vitest run tests/fable.test.ts tests/lengths.test.ts tests/pictureBook.test.ts tests/migrations.test.ts tests/humanizer.test.ts tests/humanizerGuards.test.ts
yarn typecheck
yarn lint
yarn test
yarn build
```

If `fnm env` does not put Node on PATH in that shell, use `fnm exec --using default cmd /c "npx vitest run tests/fable.test.ts"`
(and the same wrapper for the other commands); the machine memory notes that `fnm exec yarn` alone fails, so wrap it in
`cmd /c "..."` or put the fnm default alias dir on PATH. Never leave a test unrun because Node was missing. `yarn build` is needed
because `hub.ps1 start scriptorium` runs the built `out/`.

## Risks / alternatives

- **Config-only route (research option A) rejected**: the plain draft prompt ends "no notes or summary", the humanizer would pass
  over the quiz, the gate would count the back matter, and nothing would check the quiz. The code route is about 6 source files plus
  one new module, the SCP-46 size.
- **Story-only count vs a wider word range**: chosen story-only, because the REQ's acceptance is "1,500-2,000 words within the
  format's gate" for the story, and a whole-chapter range (e.g. `[1800, 2600]`) would let a 1,300-word story with a long debrief
  pass and would let tighten cut the debrief. Cost: one format-agnostic line in `writeChapter` (safe: the heading line is unique to
  this format) and the story split in tighten.
- **Strict gate window for fables** (no 15 % slack): one line; without it a 2,250-word story passes the gate. The gate still runs
  once; a rewrite can land outside again, which the hub's pilot check catches (one retry rule there).
- **Engine-written Sources / Go deeper / disclaimer**: removes three model failure modes (a dropped or reworded disclaimer, an invented
  book, an invented source). Alternative (the model writes them, the engine checks): more retries for the same result.
- **Fact binding is partly mechanical**: the engine checks that the debrief cites only existing key-fact numbers; it cannot check
  that a sentence says what fact [n] says. The reviewers get the card and are told to flag it, and the hub's pilot checks trace each
  claim by hand. A real per-claim checker would be a new job (option D), out of scope.
- **Repair retry cost**: one extra request at most per draft; free on ACP models.
- **Reviewers may still dislike the back matter**: mitigated by `FABLE_REVIEW_NOTE` and the guidance (which every review prompt
  renders); `max_rounds: 1` limits the damage. If a pilot is rejected for the back matter, tune the note, not the reviewers' prompts.
- **Leak cutter**: a prompt sentence of 40+ characters echoed in the back matter would be cut as a leak (`leak.ts`); C3 forbids long
  literal sentences in the layout. The repair request's text is not in `forbid` (it is not part of the template).
- **`_fable` vs a two-letter suffix (`_fb`)**: `_fable` follows the director's naming; it needs its own `loadPrompt` branch. `_fb`
  would fit the regex but is cryptic. Kept `_fable`.
- **Seed prompt upgrades**: `migrateSeedPrompts` upgrades untouched live prompts whose seed hash changed; this ticket changes no
  existing seed prompt, so only the two new files are copied.

## Open questions for the user

None that block the code. (The hub plan holds the production questions.)

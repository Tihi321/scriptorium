# Visual novels: the book format

This document describes how Scriptorium writes a visual novel and what the files look like, so a separate app can turn a finished book into a playable visual novel: pictures for every scene (from ComfyUI, or drawn by a model with a pixel-art tool) with the text shown on top.

A film is not a visual novel: books of the screenplay formats (`short-film`, `cartoon`, `kids-cartoon`, `screenplay: true`) are written as shots and read with `get_screenplay` (see [screenplay.md](screenplay.md)); `get_script` refuses them, and VN Studio never lists them.

Scriptorium only writes the text. It never makes images for a visual novel. Everything below is plain markdown in the data folder, so the other app reads the files and needs nothing from the engine.

## What kind of visual novel

- **Linear or with choices.** Format `visual-novel` is one story from start to end (a "kinetic" visual novel). Format `choice-visual-novel` branches: at the end of some chapters the player picks what happens next, and the story has several endings (see [Choices](#choices)).
- **For children too.** Topics of kind `juvenile-visual-novel` (seed section "Visual Stories for Children") get `kids-visual-story` (linear) or `kids-choice-visual-story` (with choices, happy endings only), for ages six to nine: simple words, bright places, gentle stories.
- **A script, not prose.** Every chapter is a list of scenes. A scene says where and when it is, what the reader sees, who is on screen and how they look, and then who says what, one short line at a time.
- **Any genre.** The topic sets the genre: the seed has a "Visual Novels" section in `topics.md` (romance, mystery, fantasy, science fiction, slice of life, school life, horror, comedy), and any topic of kind `visual-novel` is written this way. You can add your own with "Add a topic" (kind: Visual novel).
- **Size.** Linear: 8,000 to 25,000 words in 4 to 10 chapters, three to six scenes per chapter. With choices: 10,000 to 30,000 words in 8 to 16 chapters over all paths. For children: 2,000 to 6,000 words in 3 to 6 chapters, or 3,000 to 8,000 in 6 to 10 with choices (`config/formats.md`).

## Where the files are

A book is a folder `books/<slug>/` in the data folder (default `~/Scriptorium`).

| File | What it holds | Use in the app |
| --- | --- | --- |
| `book.md` | Frontmatter: `title`, `author`, `genre`, `format: visual-novel`, `script: true`, `stage` (`published` when finished), `blurb`, `topic`, `topic_name` | Pick books with `script: true` and `stage: published`; title screen |
| `bible/bible.md` | The art reference: `## Setting`, `## Characters` (one bullet per character: `- **Name**: looks, then who they are. Aliases: ... Voice: ...`; one bullet per person), `## Places` (one bullet per place: how it looks), `## Style` | Character sprites and backgrounds, the same in every scene |
| `chapters/ch-01.md` ... | Frontmatter `n`, `title`, `words`; the body is the script | The scenes and the text |
| `outline.md` | Chapter titles and summaries; for a book with choices also the chapter map (`choices`, `ending`) | Chapter select, scene summaries, the branches |
| `cover-brief.md` | One paragraph describing a cover picture | Title-screen image |
| `vn/pack.json` | The language-independent VN pack (template): keys, looks, scene and cue descriptions, branch targets, puzzle cores, `packHash`, `sourceHash` (`vn_version: 2` in `book.md`) | The structure VN Studio imports; never translated, never hand-edited |
| `vn/text/<lang>.json` | The source catalog: the only translatable text (title, titles, names, line and narration text, puzzle prose) | Book Translator's input; VN Studio's source edition |
| `out/<slug>.epub` | The same script laid out for reading | Not needed by the app |

`bible/bible.md` example:

```markdown
## Characters
- **Mara**: Seventeen, small and wiry, sun-browned skin, dark curly hair tied back with a red scarf, grey eyes, a yellow oilskin raincoat over a patched blue jumper. The lighthouse keeper's daughter, stubborn and brave. Voice: short sentences, dry jokes, never says sorry.
- **Kessler**: Sixty, bald and broad, a grey coat and a pipe. The lighthouse's old engineer. Aliases: the bald man, Brother Kessler. Voice: slow, low, answers a question with a question.
- **Tomas**: ...

## Places
- **Harbour wall**: A long stone pier at dusk, wet black stones, a rusted iron rail, fishing boats bobbing on grey water, the lighthouse beam sweeping across a purple sky.
```

One bullet per person. `Aliases:` lists the other names the script uses for the same person (a description the narration uses before the name is known, a title, a nickname), separated by commas, ending at the first full stop (so an alias has none: `Dr Vey`, not `Dr. Vey`), and it comes **before** `Voice:` (a reader that splits the entry at `Voice:` would otherwise take the aliases for the voice). An alias is never another character's name. A speaker label or an `ON SCREEN:` name that is an alias means that character, and the app may show the alias as the name tag.

## The script grammar

A chapter body is read **line by line**. Empty lines mean nothing. Each line is exactly one of these (checked in this order):

| Line | Pattern | Meaning |
| --- | --- | --- |
| Scene break | `---` (or `***`, `___`) | A transition inside the chapter (fade to black) |
| Scene | `SCENE: <place>, <time>. <description>` | A new scene: a new background. The text is split at the **first full stop**: what follows is the scene's description. In the head before it, the **last comma** starts the time only when that tail is at most four words and names a known time (`morning`, `midday`, `late afternoon`, `dusk`, `night`, Croatian `jutro`, `podne`, `navečer` …); otherwise the whole head is the place. Also accepted: a markdown heading `## <place>` (its last comma still splits place and time) |
| Picture | `CG: <description>` | A picture over the whole screen (a key moment). It stays until `CG: none`, `END CG` or the next `SCENE` |
| Close-up | `INSERT: <description>` | A thing or a page shown up close (a letter, a sign, an object). Same rules as `CG:` |
| Sound effect | `SFX: <description>` (also `SOUND:`) | One sound, played once |
| Ambience | `AMBIENCE: <description>` | A background sound that loops until the next `AMBIENCE:` or `AMBIENCE: none`; it plays on into the next scenes of the chapter |
| Stop | `CG: none`, `END CG`, `AMBIENCE: none` | Hides the picture, stops the sound |
| Clue | `CLUE: <puzzle>/<clue>: <prose>` | A clue of a puzzle is found here (a puzzle book, see [Puzzles](#puzzles-mystery-with-puzzles)) |
| Evidence | `EVIDENCE: <key>: <prose>` | An item goes into the court record (an `insert` image `cg_<key>`) |
| Puzzle | `PUZZLE: <key>` or `PUZZLE: <key> (<kind>)` | The player solves puzzle `<key>` here |
| Testimony | `TESTIMONY: <witness>`, speaker lines, `END TESTIMONY` | The statements of a cross-examination |
| On screen | `ON SCREEN: Name (look), Name (look), ...` | Who is visible from now on, each with how they look right now (the bracket is optional). Only characters: a thing, a page or a crowd goes to `INSERT:` or narration |
| Speaker line | `NAME: words` or `NAME (expression): words` | A text box with a name tag. NAME is in capitals |
| Narrator | `NARRATION: words`, `NARRATOR (calm): words`, `N: words` | A narrator text box (no name tag). The label is not part of the text. (In a screenplay `NARRATOR:` is a voice-over speaker instead.) |
| Speaker token | `C1: words`, `petra: words`, `petra#1 (worried): words` | A line whose speaker is the first bible character (`C<n>`), a character's key, or one of its alias keys. For a script written with stable keys instead of names; the label is never shown |
| Narration | anything else | A narrator text box (no name tag): what the reader sees, actions, glances. Present tense |

The patterns the renderer uses (`src/engine/publish/xhtml.ts`, JavaScript regular expressions):

```js
const SCENE = /^\**\s*scene\s*:\s*\**\s*(.+?)\s*\**$/i
const CAST  = /^\**\s*on screen\s*:\s*\**\s*(.+?)\s*\**$/i
const LINE  = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
const NARRATION = /^\**\s*(?:n|narration|narrator|narracja|pripovjeda[čc])\s*\**(?:\s*\([^)]*\))?\s*:\**\s*(.*)$/iu
const SPEAKER_TOKEN = /^\**\s*(C\d+|[a-z][a-z0-9_]*(?:#[1-9]\d*)?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
// copied from VN Studio (src/engine/vn/script.ts), which reads the same lines; Croatian keywords too
const CUE     = /^\**\s*(CG|SLIKA|INSERT|SFX|SOUND|ZVUK|AMBIENCE|ATMOSFERA)\s*:\s*\**\s*(.*?)\s*\**$/iu
const END_CG  = /^\**\s*(?:END\s+CG|KRAJ\s+SLIKE)\s*\**$/iu
```

The cue lines are checked right after `SCENE` and before `ON SCREEN` and the speaker lines, so `CG:` is never a speaker called "CG". `CG: none`, `INSERT: none`, `AMBIENCE: none` (also `ništa`, `nista`) and `END CG` mean "stop". A cue with no text is ignored. A speaker token only counts when it names a bible character: an unknown lower-case key stays narration. No cue, puzzle or narrator keyword is ever a speaker, even when its line does not fit the pattern (`CLUE: no slash` is narration). A stage direction that looks like a speaker label (`SMASH CUT TO: ...`, `FADE TO BLACK: ...`, `INT. KITCHEN: ...`) is narration too, never a character.

The four puzzle lines (`CLUE`, `EVIDENCE`, `PUZZLE`, `TESTIMONY` and `END TESTIMONY`) are checked straight after the cue lines above and before `ON SCREEN` and the speaker lines, so `CLUE:` is never a speaker called "CLUE". Their regular expressions are in [Puzzles](#puzzles-mystery-with-puzzles). No puzzle keyword is a picture or sound keyword, and none is a screenplay line (`SHOT`, `MUSIC`, `SFX`, `TITLE`; [screenplay.md](screenplay.md)): a screenplay does not read the puzzle lines, and a visual novel does not read `SHOT`, `MUSIC` or `TITLE`.

Inside any text, `*word*` or `_word_` is emphasis and `**word**` is strong, as in markdown.

A short example of a chapter:

```text
SCENE: The harbour wall, dusk
AMBIENCE: waves on stone, a far foghorn
Rain needles the grey water. The lighthouse beam sweeps over the boats.
ON SCREEN: Mara (soaked raincoat, worried)
MARA (worried): He said he'd be back before the lamp was lit.
SFX: running boots on wet stone
Footsteps on the wet stones. Someone is running.
ON SCREEN: Mara (startled), Tomas (out of breath, grinning)
TOMAS (grinning): Did you miss me?
MARA (annoyed): You're *late*.
INSERT: a torn page, a hand-drawn map
TOMAS: I found this in the boat.
CG: Mara and Tomas at the pier's end
MARA (whispering): Then it is true.
END CG
---
SCENE: The lighthouse kitchen, night
A low room with a black iron stove and a single oil lamp. Wet coats drip by the door.
ON SCREEN: Mara (drying her hair), Tomas (sitting by the stove)
TOMAS: I found something on the rocks.
```

### Reading it as a player

Keep a state while walking the lines:

- **Background** = the last `SCENE`. To draw it, use the scene's place and time, the narration lines right after it (until the first speaker line), and the matching place in `## Places` of the bible (match on the name, case-insensitive, or on the first words of the SCENE line).
- **Sprites** = the last `ON SCREEN` list. Each name matches a character in `## Characters` of the bible (case-insensitive). The bracket is the character's current look or pose. The bible gives the fixed look (face, hair, clothes, colours).
- **Expression** = the bracket of a speaker line (`MARA (annoyed)`). Show that character's sprite with that expression while the line is shown. Without a bracket, keep the last one.
- **Pictures and sounds**: a `CG:` or `INSERT:` goes on the next beat of its scene and stays until `CG: none`, `END CG` or the next `SCENE`. An `AMBIENCE:` loops until the next `AMBIENCE:` or `AMBIENCE: none`, through the following scenes, and stops at the end of the chapter. An `SFX:` plays once when the next beat starts. A cue with no beat after it in its scene has nothing to go with: VN Studio drops it with a warning, so the writer is asked never to end a scene with one. The same picture shown twice needs the same opening words (VN Studio keys a picture by its first four content words), two different pictures need different ones.
- **Text box** = each speaker line (name tag + words) and each narration line (no name tag). One click per line.
- A speaker who is not in the `ON SCREEN` list speaks off screen (a voice from the dark, a phone call): show the text box without a sprite, or add them to the screen. Your choice.
- A chapter starts with an empty screen. `---` clears the screen (sprites and background) until the next `SCENE`.

### What is guaranteed and what is not

The writer is a language model following a prompt, so the app must be lenient:

- Guaranteed by the engine: the files and folders above, `script: true` in `book.md`, the chapter order, plain UTF-8 markdown.
- Asked of the model, usually followed, not guaranteed: every scene starts with `SCENE:`, `ON SCREEN:` after every change, names in capitals and the same every time, names that match the bible, the bracket on speaker lines, the picture and sound lines (at most two `CG:`, two `INSERT:` and four `SFX:` per chapter, `AMBIENCE:` once per scene, none of them last in a scene), `ON SCREEN:` naming only characters, and `Aliases:` in the bible's entries (the engine writes that sentence from the outline's `aliases`, cleaned: no full stops, no own name, no other character's name, at most five). The line editor checks the script form in its review, and a book with real problems gets rewritten before it is published, but small slips get through.
- So: a speaker line without a matching character is still a text box; a scene without `SCENE` keeps the last background; an unknown place is drawn from the SCENE text alone; a line that matches nothing is narration.

## Puzzles (mystery with puzzles)

The format `mystery-puzzle-visual-novel` (`script: true`, `puzzles: true`) is a visual novel with logic puzzles between its scenes. The player reads, finds clues, solves a puzzle (who did it, with what, where), and the story goes on. **Code makes the puzzle, the writer only dresses it**: VN Studio makes the puzzle core with `vno_puzzle_generate` (the solution and the structured clues, proved unique and solvable by deduction), the hub hands it to Scriptorium in the story brief (`add_story {puzzles}`), Scriptorium keeps it as `bible/puzzles.md`, the architect places each puzzle in a chapter, and the writers plant its clues in the story and put the `PUZZLE:` line where the player solves it. Scriptorium has no solver. VN Studio imports the book (VNO-15), reads the lines below, and checks that the prose of every clue still means the constraint of the core.

### The four lines

```text
CLUE: dinner/c2: The rope was either in the kitchen or the garden, Hartley noted.
EVIDENCE: pocket_watch: A pocket watch, stopped at 9:10, its glass cracked.
PUZZLE: dinner (murdle)
TESTIMONY: Miss Cole
MISS COLE (calm): I was in the garden all evening.
MISS COLE: I never touched the poison.
END TESTIMONY
```

| Line | Pattern | Meaning |
| --- | --- | --- |
| Clue | `CLUE: <puzzle>/<clue>: <prose>` | Clue `<clue>` of puzzle `<puzzle>` is found here. `<prose>` is the clue as the story tells it, in the story's own words (names as in the bible), saying exactly what the core's clue says. One line per clue, before the puzzle's `PUZZLE:` line. It is shown as a line of text |
| Evidence | `EVIDENCE: <key>: <prose>` | An item the player picks up (a letter, a watch, a photo): it goes into the court record. `<prose>` describes it. It is an `insert` image with the key `cg_<key>` |
| Puzzle | `PUZZLE: <key>` or `PUZZLE: <key> (<kind>)` | Puzzle `<key>` is played here. `<kind>` is the puzzle's `kind` in `bible/puzzles.md` (`murdle` now; `knights`, `testimony` and `grid` are planned) and may be left out |
| Testimony | `TESTIMONY: <witness>` | Opens a cross-examination of `<witness>` (a character name or alias of the bible) |
| (statements) | `NAME: words` or `NAME (expression): words` | The statements of the testimony, in order, as normal speaker lines. Statement 1 is the first speaker line after `TESTIMONY:`. The block lasts until `END TESTIMONY`, or until any line that is not a speaker line |
| End | `END TESTIMONY` | Closes the testimony |

Ids: `<puzzle>`, `<clue>` and `<key>` are made of `A-Z a-z 0-9 _ -`, no spaces. A clue id is the id of the core (`c1`, `c2`, ...; `murder` is the id of the core's murder note). Which statement breaks, and with which evidence, is never in the text: it is in `bible/puzzles.md` (below).

The regular expressions (`src/engine/publish/xhtml.ts`, JavaScript; Croatian keywords as for the picture and sound lines, so translated books from Book Translator keep working: `TRAG`, `DOKAZ`, `ZAGONETKA`, `SVJEDOČENJE`, `KRAJ SVJEDOČENJA`):

```js
const CLUE_RE         = /^\**\s*(CLUE|TRAG)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*\/\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
const EVIDENCE_RE     = /^\**\s*(EVIDENCE|DOKAZ)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*:\s*\**\s*(.*?)\s*\**$/iu
const PUZZLE_RE       = /^\**\s*(PUZZLE|ZAGONETKA)\s*:\s*\**\s*([A-Za-z0-9_-]+)\s*(?:\(\s*([A-Za-z0-9_-]+)\s*\))?\s*\**$/iu
const TESTIMONY_RE    = /^\**\s*(TESTIMONY|SVJEDOČENJE)\s*:\s*\**\s*(.+?)\s*\**$/iu
const END_TESTIMONY_RE = /^\**\s*(?:END\s+TESTIMONY|KRAJ\s+SVJEDOČENJA)\s*\**$/iu
```

They are checked after `SCENE` and the picture and sound lines (`CUE`, `END_CG`), and before `ON SCREEN` and the speaker line. A line of these keywords that does not fit its pattern (for example `CLUE: no slash`), is not a puzzle line: it falls through to the speaker rule and is read as a speaker line (`CLUE`), as any unknown line is. The prompts never ask for such a line.

How a reader plays them (VN Studio, VNO-15):

- `CLUE:` is shown as a line of text (narration, no name tag). The clue id is recorded as found at that beat (`clueAt`); the puzzle screen lists the clues found so far. A clue that is never found is a book fault (see "What is checked").
- `EVIDENCE:` is shown as a line of text and adds the item to the court record, with an `insert` picture `cg_<key>` drawn from the prose.
- `PUZZLE:` is the puzzle beat; the puzzle comes from `bible/puzzles.md` by key.
- `TESTIMONY:` ... `END TESTIMONY` is one cross-examination beat with its statements.
- Like a picture cue, none of these lines should be the last line of a scene: there is nothing for it to go with.

### `bible/puzzles.md`

Markdown with YAML frontmatter, written by Scriptorium when the outline is made, from the `puzzles` of the story brief. Every puzzle of the book is one entry:

```yaml
---
kind: puzzles
puzzles:
  - key: dinner                 # the <puzzle> of the lines
    kind: murdle                # murdle now; knights, testimony, grid later
    title: The Dinner Party     # optional
    chapter: 2                  # the chapter with the PUZZLE: line (set by the outline)
    core: { ... }               # the puzzle core of VN Studio, as vno_puzzle_generate returns it (format 1): categories, solution, clues, murder, difficulty, steps
    names: { s1: Colonel Ash, w1: rope, p1: library }   # item id -> the name in the story
    text:                       # canonical English sentence of each clue and of the murder note
      c1: Doctor Birch did not have the rope.
      murder: The body was found in the library.
    clueAt: { c1: 1, c2: 1, c3: 2 }   # the chapter planned to plant each clue (by the engine)
  - key: courtroom
    kind: testimony
    chapter: 4
    testimony:
      witness: Miss Cole
      breaks: [{ statement: 2, evidence: pocket_watch }]   # statement n (1-based) is broken by presenting evidence <key>
      evidence: [{ key: pocket_watch, description: A pocket watch, stopped at 9:10 }]
---
(the same, as a readable list: the solution in words, the clues with their ids)
```

`core`, `names`, `text` and `testimony` are the hub's data and are kept exactly as given; `chapter` and `clueAt` are the engine's placement. A reader trusts the `core` for the logic and the lines only for the story: it never decides which clue is true from the prose (VN Studio's read-back check does that).

### What the writer is asked, and what is checked

Asked of the model (in the outline, draft and rewrite prompts of a puzzle book): every puzzle is placed in one chapter; every clue of the core is planted as a `CLUE:` line, in the story, before the puzzle's `PUZZLE:` line, in words that say exactly what the canonical sentence says (no more, no less: a changed name, a dropped option or an added hint changes the puzzle); the names are the core's names; evidence that a testimony needs is planted (`EVIDENCE:`) before it; the story's facts (culprit, weapon, place, who lies) are the core's solution, never contradicted and never stated outright before the puzzle.

For a knights puzzle (no `clues` in the core: the `intro` and the statements `t1`, `t2` ...), all of them are planted in the puzzle's own chapter, never before it, so a keeper's statement is not placed before the keeper appears; the writer is told who is a knight and who a knave (a knave lies in every line) and not to reveal it before the `PUZZLE:` line, and the chapters after the puzzle are told the answer as settled fact (every puzzle kind). The reviewers are told the `CLUE:` lines are fixed: the continuity review drops a problem that asks to change one or calls it a contradiction (an either/or clue and a clash between two clues are the deduction).

Checked by the engine (`puzzleProblems`, in the continuity review of every round): each puzzle of `bible/puzzles.md` has exactly one `PUZZLE:` line; every clue id of its core is in a `CLUE:` line of that chapter or an earlier one, before the `PUZZLE:` line; no `CLUE:` names a clue the core does not have; every evidence key a testimony needs (`bible/puzzles.md`) is planted as an `EVIDENCE:` line before the puzzle's `PUZZLE:` line, and a testimony puzzle has its `TESTIMONY:` block. A problem makes the review say revise and names the chapter; the writer rewrites. The humanizer is off for the format, and its guard (when an owner switches it on) refuses a version in which a puzzle line changed in any word. **Not checked by Scriptorium**: that the prose of a clue means the core's clue (VN Studio does it at import and the hub sends a rewrite note back), and the puzzle logic.

### In the JSON of `get_script`

The beats (one script line is one beat, like `cue`):

```json
{ "type": "clue", "puzzle": "dinner", "clue": "c2", "text": "The rope was either in the kitchen or the garden, Hartley noted." }
{ "type": "evidence", "key": "pocket_watch", "text": "A pocket watch, stopped at 9:10, its glass cracked." }
{ "type": "puzzle", "puzzle": "dinner", "kind": "murdle" }
{ "type": "testimony", "witness": "Miss Cole", "statements": [
    { "n": 1, "speaker": "Miss Cole", "expression": "calm", "text": "I was in the garden all evening." },
    { "n": 2, "speaker": "Miss Cole", "expression": "", "text": "I never touched the poison." } ] }
```

`kind` is `null` when the line has none. The `testimony` beat holds its statements (speaker names are written as the bible has them, with `alias` when written under an alias, as for a `line`); there is no separate beat for `END TESTIMONY`. A clue, evidence or puzzle line does not end a scene's `background`. The top level of the JSON gets `puzzles`: the entries of `bible/puzzles.md` as above (empty for a book with none).


A suggested pipeline for the app. None of it exists yet.

1. **Parse** every chapter into scenes (see the JSON below).
2. **Collect the assets** the book needs:
   - one **background** per distinct place and time (the harbour at dusk and the harbour at noon are two pictures), described by the bible place + the SCENE line + the scene's first narration lines;
   - one **character sheet** per character from the bible looks, then one **sprite** per character and expression used in the script (`MARA (annoyed)`, `MARA (worried)` ...). Keep a small set of expressions (neutral, happy, sad, angry, surprised, worried) and map free words to the nearest one, or the number of images explodes.
3. **Generate**:
   - **ComfyUI**: one prompt per asset, made of a style prefix (from `## Style` and the genre), the description, and fixed negatives. For the same face in every sprite, make the character sheet first and use it as the reference for the sprites (an image-reference node such as IP-Adapter, or a LoRA trained on the sheet). Sprites need a plain or transparent background so they sit over the scene.
   - **Pixel-drawing tool**: the same descriptions go to a model that draws with the tool's commands (a small palette, a fixed canvas size such as 320x180 for backgrounds and 64x96 for sprites). The descriptions are concrete on purpose (colours, objects in view), which suits drawing step by step.
4. **Assemble**: for every line, the background + the sprites on screen + the text box. Save as a project for a visual novel engine (for example Ren'Py, which reads a script very like this one), or play it in the app itself.

## The VN pack (v2)

Since SCP-45 a published visual novel also ships a **language-independent pack**: two files that structure and text kept apart, made by Scriptorium from the same authored folder. The chapter files stay the human authoring and review format; nobody edits the pack by hand.

```text
books/<slug>/
  vn/pack.json                  # template: structure, IDs, art fields. Never translated.
  vn/text/<sourceLang>.json     # source catalog: display text only. The only translatable document.
```

- **`vn/pack.json`** is the template: `format: "vn-pack"`, `version: 2`, `packHash`, and `book` (`slug`, `format`, `kind` `linear`/`choice`, `primaryLang`, `genre`, `style`, `author`, `coverBrief`, `sourceHash`), `characters` (`key`, `looks`, `voice`, `aliasKeys`), `places` (`key`, `name` as a bible reference, `looks`), `chapters` (`n`, `isEnding`, `choices` with `index` and `to`, `scenes`) and `puzzles`. A scene has `id`, `placeKey`, `placeText`, `time`, `description` (the background prompt: the `SCENE:` line's rest after its first full stop, the narration right after `SCENE:` and the place looks), `breakBefore` and `beats`. A beat is exactly `cast`, `line` (`speakerKey`, `expression`, an optional `aliasKey`), `narration` or `puzzle`; a line without a bracket carries the speaker's last expression in the scene (`neutral` when the speaker has none there yet), exactly as the reader keeps it; `CG`/`INSERT`/`SFX`/`AMBIENCE`/`END CG` are not beats: they attach to the next beat as descriptors (`image {display, text, key?}`, `sfx {text}`, `ambience {text}`, or `null` to hide/stop), and `---` sets `breakBefore` on the next scene. There is no display text in it: a line's words, a chapter or scene title, a name, a choice or an ending live in the catalog.
- **`vn/text/<lang>.json`** is the catalog: `format: "vn-text"`, `version: 2`, `lang`, `packHash`, `title`, `blurb`, `chapterTitles`, `sceneTitles`, `choiceTexts` (`"1:0"`), `endings` (`"4"`), `characterNames` (character and alias keys to display names), `beats` (line and narration beat id to text) and `puzzles` (`names`, `text`). Every value is one non-empty line; keys are opaque; it carries no structure and no asset id.
- **IDs are fixed and engine-owned** (never model-written): characters and places by VN Studio's key rule (`Petra` → `petra`, `Šime` → `sime`, `Petra's House` → `petra_s_house`, a collision gets `_2` in bible order with a warning); aliases `<charKey>#<n>` in the bible's `Aliases:` order; scenes `ch01.s01` and beats `ch01.s01.b001`, numbered only over the scenes that have a beat; choices `"<chapter>:<index>"`; endings `"<chapter>"`; puzzles and clue/evidence/testimony ids exactly as in `bible/puzzles.md`. `NARRATION:`/`NARRATOR:`/`N:` lines and narration are beats; a line spoken under an alias keeps `aliasKey` (`petra#1`) so VN Studio shows the alias as the name tag, without a name entering the template.
- **Unknown names never fail a published book**: a speaker line whose label matches no bible character or alias gets a synthetic character (`speaker_1`, `speaker_2`, … in first-seen order, with empty looks); an unknown place keeps `placeKey: null` and its `placeText` (VN Studio draws the background from the text) and no place is invented; an `ON SCREEN:` entry that is not a bible character or alias (a prop, a page, a crowd, a whole sentence) is not a cast entry and is dropped, never made into a synthetic character. All of these are warnings.
- **Hashes**: `packHash` is the SHA-256 of the canonical JSON of the pack without the `packHash` key (object keys sorted at every depth). `sourceHash` is the SHA-256 over `outline.md`, `bible/bible.md`, `bible/puzzles.md` (when present), `cover-brief.md` (when present) and `chapters/*.md` sorted by the first number in the file name, each as `relpath\0bytes\0`. `book.md` is not hashed: the publisher writes cover fields into it after the pack is made. The pack file is pretty-printed for diffs; the hash always uses canonical JSON.
- **Staleness**: a pack whose `sourceHash` no longer matches the authored files is stale (a chapter, outline, bible or puzzle edited since it was made). `get_vn_pack` reports `stale: true` and warns; run `build_vn_pack` again and re-translate. A translated edition whose `packHash` does not match the pack is rejected by VN Studio.
- **What it is not**: the game's UI strings (VN Studio's own), asset ids and files (`backgroundId`, `cg_`/`sfx_`/`amb_` keys and the prompts are VN Studio's, derived from this untranslated template), and the EPUB (a reader artifact).

Publishing any visual novel (a book with `script: true`, not a screenplay) compiles the pack and writes `vn_version: 2` into `book.md`; an older book gets one with `build_vn_pack {book}`. `get_vn_pack {book}` returns the pack and catalog with both hashes and the stale check. The book's own `get_script` JSON is unchanged.

## Choices

A book with choices (`format: choice-visual-novel` or `kids-choice-visual-story`) is a map of chapters instead of a line. The map is in the frontmatter of `outline.md`, never in the chapter text:

```yaml
chapters:
  - n: 1
    title: The Late Boat
    summary: ...
    choices:
      - { text: Wait at the harbour wall, to: 2 }
      - { text: Row out to find him, to: 3 }
  - n: 2
    title: ...
    choices:
      - { text: Open the letter, to: 4 }
  - n: 3
    title: ...
    ending: "bittersweet: the boat is found, empty"
```

- Every reader starts at chapter 1. A chapter with `choices` ends with a choice menu: each `text` is a button, `to` is the chapter it jumps to. A chapter without `choices` is an ending; `ending` says how it ends in a few words.
- A choice always goes forward (`to` is higher than `n`), and two choices may lead into the same chapter (paths meet). Every chapter can be reached from chapter 1, and there are at least two endings: the engine checks this before any chapter is written.
- The chapter text ends at the moment of decision and never contains the choices themselves. Show the menu after the last line of the chapter. On an ending, show "The End" and offer to start again.
- The EPUB and the in-app reader do the same with links: a list of choices after the chapter, or "The End" with a link back to chapter 1.
- The same map is used by choose-your-path books in prose (formats `gamebook` and `kids-choice-book`), which an app could also turn into a visual novel, using the prose as narration.

### A JSON shape for the parsed book

Suggested, so the parser and the image steps agree on one structure:

```json
{
  "slug": "the-lighthouse-letters",
  "title": "The Lighthouse Letters",
  "author": "Mara Quill",
  "genre": "Mystery",
  "style": "Moody, rain-soaked, warm interiors against cold exteriors.",
  "characters": [{ "name": "Mara", "looks": "Seventeen, small and wiry, ...", "voice": "short sentences, dry jokes", "aliases": ["the keeper's girl"] }],
  "places": [{ "name": "Harbour wall", "looks": "A long stone pier at dusk, ..." }],
  "chapters": [
    {
      "n": 1,
      "title": "The Late Boat",
      "choices": [{ "text": "Wait at the harbour wall", "to": 2 }, { "text": "Row out to find him", "to": 3 }],
      "ending": null,
      "scenes": [
        {
          "place": "The harbour wall",
          "time": "dusk",
          "background": "Rain needles the grey water. The lighthouse beam sweeps over the boats.",
          "beats": [
            { "type": "cue", "cue": "ambience", "text": "waves on stone, a far foghorn" },
            { "type": "cast", "cast": [{ "name": "Mara", "look": "soaked raincoat, worried" }] },
            { "type": "line", "speaker": "Mara", "expression": "worried", "text": "He said he'd be back before the lamp was lit." },
            { "type": "narration", "text": "Footsteps on the wet stones. Someone is running." }
          ]
        }
      ]
    }
  ]
}
```

`SCENE: <place>, <time>. <description>`: the text is split at the first full stop; what follows is the scene's description (it starts the `background`). In the head, the last comma starts the time only when that tail is at most four words and names a known time (English or Croatian); otherwise the whole head is the place and `time` is empty. The time stays as written (`midday`, `late afternoon`, `ujutro`): VN Studio canonicalises it. `## heading` scenes keep the plain last-comma rule.

The MCP tool `get_script {book, chapter?}` returns this JSON for a script book at any stage (`parseScript` and `parseLightBible` in `src/engine/publish/script.ts`). A `## heading` also opens a scene, the narration right after a `SCENE:` line up to the first cast or speaker line is the scene's `background`, a `---` is a `break` beat, and speaker names are written as the bible has them when one matches (else as they were written, in capitals).

A picture or sound line is a `cue` beat, one per line: `{ "type": "cue", "cue": "cg" | "insert" | "sfx" | "ambience", "text": "..." }`, with `text: null` for `CG: none`, `END CG` and `AMBIENCE: none` (an empty cue is left out). A cue does not end a scene's `background`, so an `AMBIENCE:` right after `SCENE:` is fine. A speaker or cast name that is one of a character's aliases is given as the character's bible name, and the line or cast entry has `alias` (the alias as the bible writes it), so the app can show it as the name tag: `{ "type": "line", "speaker": "Kessler", "alias": "the bald man", ... }`. `characters[].aliases` lists them.

## Adapting a book

Scriptorium can turn a published prose book into a visual novel script (the script writer). In the library, open a published book's card and press **Adapt to visual novel**; the Script writer panel asks for the kind (linear, or with choices), an optional title and notes for the adapter. The same from MCP: `adapt_book {book, format, title?, notes?, models?}`. The owner picks linear or choices for every book.

- The story gets `source_book: <slug>` in its frontmatter, and the book made from it too. The factory starts it at once, because the source is published; a story whose source is not published waits.
- It is an authorised adaptation of the owner's own book: the pitch, outline, drafts, rewrites and every review say so, so the originality checker does not fail the likeness to the source.
- No research of its own: the facts are in the source text.
- The architect compresses the source into the format's chapter range (4 to 10 chapters) and gives each script chapter `source_chapters` in the frontmatter of `outline.md`, the numbers of the source chapters it is made from. Every source chapter should be in at least one script chapter; the engine logs the ones that are not.
- The bible is seeded from the source's characters (at most 20) and places (at most 15), with their looks kept: the looks are what an artist draws from.
- The writer gets the full text of the source chapters of the chapter it writes (cut from the middle when it would not fit the model's window), and writes it as script scenes: the events, order, names and places stay, inner monologue and long description go.
- With choices, the source's ending stays as one canon path through the map (`prompts/_choices.md`, section `adapt`); the other paths branch off it.
- The humanizer runs on the script like on any visual novel. The book card and the whiteboard show "Adapted from <title>".
- **Length:** the book's `target_words` is the source's words (all its chapters) times 1.7 (`ADAPT_WORD_FACTOR`: a script has a line per speaker and its scene and cue lines, the hub's 5,900-word story came out at 10,212), within the format's word range; `book.md` keeps the source's words as `target_from_source_words`. A screenplay is held to its runtime and keeps the format's middle as target.
- **Trailing cue:** a `CG:`, `INSERT:`, `SFX:` or `AMBIENCE:` line that would be the last line of its scene is moved before the scene's last beat after every draft, rewrite and humanizer pass (VN Studio drops a cue with no beat after it). In `SCENE: Place, Weekday, time` the weekday is part of the time and survives the place fixer.
- `SCENE:` places use the bible's names: the writer is given the bible's places, a place written differently is renamed to the bible's name after the answer, and a new place is added to the bible's `## Places` (with the first narration line of its scene), so every scene maps to a place at import.

## In Scriptorium

- Formats: `visual-novel` and `choice-visual-novel` for topics of kind `visual-novel`, `kids-visual-story` and `kids-choice-visual-story` for kind `juvenile-visual-novel`, all with `script: true`; the choice formats also have `choices: true`. The editor-in-chief picks one of the formats of the topic's kind; set `enabled: false` on a format to stop it being picked.
- Choices: `prompts/_choices.md` holds the extra instructions for planning, writing and reviewing a story with choices.
- Prompts: `architect/outline_vn.md` (looks of characters and places for the bible), `writer/draft_chapter_vn.md` and `writer/rewrite_chapter_vn.md` (the script grammar), `line-editor/review_vn.md` (dialogue, voices and the script form), `humanizer/humanize_chapter_vn.md` (livelier lines and narration with the `SCENE:`, `ON SCREEN:`, speaker and picture and sound lines kept one for one; the engine keeps the original chapter if their number or order changes, or the kinds and order of the cue lines; the cue text is asked to stay word for word, but only reworded text is let through). Other roles use their usual prompts with the format guidance. Edit them in the data folder's `prompts/` to change the style of the scripts.
- The prompts ask for the picture and sound lines (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`, `END CG`, with the limits above), for `ON SCREEN:` with characters only, and, in the outline, for `aliases` per character. The outline handler writes the `Aliases:` sentence before `Voice:` (`scriptBible.ts`: `cleanAliases`, `scriptBibleLine`); an adaptation's aliases from the source book are merged in. Every reviewer of a script book gets a note that the cue lines are picture and sound cues, not prose; the line editor checks their form only. The tighten request of a script keeps them.
- The EPUB and the in-app reader show the script with scene headings, an "On screen" line, bold speaker names, italic narration and the picture and sound lines as small grey italic notes (`Picture:`, `Close-up:`, `Sound:`, `Ambience:`; `END CG`, `CG: none` and `AMBIENCE: none` are not shown). A `NARRATION:`/`NARRATOR:`/`N:` line is shown as narration without the label, and a `C1:`/`petra:`/`petra#1:` speaker token as the character's name (`publish/xhtml.ts` gets the bible names).
- The VN pack (see "The VN pack (v2)") is written by the publisher for every visual-novel book (`pipeline/handlers.ts`, `publish/vnPack.ts`; a failure is a warning and the book still publishes), and on demand with `build_vn_pack {book}`; `get_vn_pack {book}` reads it back with the hashes and the stale check. A failed pack (an empty catalog value, a puzzle clue with no prose) leaves the book published without a pack; fix the chapter or `bible/puzzles.md` and run the tool again.

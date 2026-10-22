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
| Scene | `SCENE: <place>, <time>` | A new scene: a new background. Also accepted: a markdown heading `## <place>` |
| Picture | `CG: <description>` | A picture over the whole screen (a key moment). It stays until `CG: none`, `END CG` or the next `SCENE` |
| Close-up | `INSERT: <description>` | A thing or a page shown up close (a letter, a sign, an object). Same rules as `CG:` |
| Sound effect | `SFX: <description>` (also `SOUND:`) | One sound, played once |
| Ambience | `AMBIENCE: <description>` | A background sound that loops until the next `AMBIENCE:` or `AMBIENCE: none`; it plays on into the next scenes of the chapter |
| Stop | `CG: none`, `END CG`, `AMBIENCE: none` | Hides the picture, stops the sound |
| On screen | `ON SCREEN: Name (look), Name (look), ...` | Who is visible from now on, each with how they look right now (the bracket is optional). Only characters: a thing, a page or a crowd goes to `INSERT:` or narration |
| Speaker line | `NAME: words` or `NAME (expression): words` | A text box with a name tag. NAME is in capitals |
| Narration | anything else | A narrator text box (no name tag): what the reader sees, actions, glances. Present tense |

The patterns the renderer uses (`src/engine/publish/xhtml.ts`, JavaScript regular expressions):

```js
const SCENE = /^\**\s*scene\s*:\s*\**\s*(.+?)\s*\**$/i
const CAST  = /^\**\s*on screen\s*:\s*\**\s*(.+?)\s*\**$/i
const LINE  = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
// copied from VN Studio (src/engine/vn/script.ts), which reads the same lines; Croatian keywords too
const CUE     = /^\**\s*(CG|SLIKA|INSERT|SFX|SOUND|ZVUK|AMBIENCE|ATMOSFERA)\s*:\s*\**\s*(.*?)\s*\**$/iu
const END_CG  = /^\**\s*(?:END\s+CG|KRAJ\s+SLIKE)\s*\**$/iu
```

The cue lines are checked right after `SCENE` and before `ON SCREEN` and the speaker lines, so `CG:` is never a speaker called "CG". `CG: none`, `INSERT: none`, `AMBIENCE: none` (also `ništa`, `nista`) and `END CG` mean "stop". A cue with no text is ignored.

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

## Making the pictures

A suggested pipeline for the app. None of it exists yet.

1. **Parse** every chapter into scenes (see the JSON below).
2. **Collect the assets** the book needs:
   - one **background** per distinct place and time (the harbour at dusk and the harbour at noon are two pictures), described by the bible place + the SCENE line + the scene's first narration lines;
   - one **character sheet** per character from the bible looks, then one **sprite** per character and expression used in the script (`MARA (annoyed)`, `MARA (worried)` ...). Keep a small set of expressions (neutral, happy, sad, angry, surprised, worried) and map free words to the nearest one, or the number of images explodes.
3. **Generate**:
   - **ComfyUI**: one prompt per asset, made of a style prefix (from `## Style` and the genre), the description, and fixed negatives. For the same face in every sprite, make the character sheet first and use it as the reference for the sprites (an image-reference node such as IP-Adapter, or a LoRA trained on the sheet). Sprites need a plain or transparent background so they sit over the scene.
   - **Pixel-drawing tool**: the same descriptions go to a model that draws with the tool's commands (a small palette, a fixed canvas size such as 320x180 for backgrounds and 64x96 for sprites). The descriptions are concrete on purpose (colours, objects in view), which suits drawing step by step.
4. **Assemble**: for every line, the background + the sprites on screen + the text box. Save as a project for a visual novel engine (for example Ren'Py, which reads a script very like this one), or play it in the app itself.

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

`SCENE: <place>, <time>`: the text before the last comma is the place, the rest the time. If there is no comma, the whole text is the place.

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
- `SCENE:` places use the bible's names: the writer is given the bible's places, a place written differently is renamed to the bible's name after the answer, and a new place is added to the bible's `## Places` (with the first narration line of its scene), so every scene maps to a place at import.

## In Scriptorium

- Formats: `visual-novel` and `choice-visual-novel` for topics of kind `visual-novel`, `kids-visual-story` and `kids-choice-visual-story` for kind `juvenile-visual-novel`, all with `script: true`; the choice formats also have `choices: true`. The editor-in-chief picks one of the formats of the topic's kind; set `enabled: false` on a format to stop it being picked.
- Choices: `prompts/_choices.md` holds the extra instructions for planning, writing and reviewing a story with choices.
- Prompts: `architect/outline_vn.md` (looks of characters and places for the bible), `writer/draft_chapter_vn.md` and `writer/rewrite_chapter_vn.md` (the script grammar), `line-editor/review_vn.md` (dialogue, voices and the script form), `humanizer/humanize_chapter_vn.md` (livelier lines and narration with the `SCENE:`, `ON SCREEN:`, speaker and picture and sound lines kept one for one; the engine keeps the original chapter if their number or order changes, or the kinds and order of the cue lines; the cue text is asked to stay word for word, but only reworded text is let through). Other roles use their usual prompts with the format guidance. Edit them in the data folder's `prompts/` to change the style of the scripts.
- The prompts ask for the picture and sound lines (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`, `END CG`, with the limits above), for `ON SCREEN:` with characters only, and, in the outline, for `aliases` per character. The outline handler writes the `Aliases:` sentence before `Voice:` (`scriptBible.ts`: `cleanAliases`, `scriptBibleLine`); an adaptation's aliases from the source book are merged in. Every reviewer of a script book gets a note that the cue lines are picture and sound cues, not prose; the line editor checks their form only. The tighten request of a script keeps them.
- The EPUB and the in-app reader show the script with scene headings, an "On screen" line, bold speaker names, italic narration and the picture and sound lines as small grey italic notes (`Picture:`, `Close-up:`, `Sound:`, `Ambience:`; `END CG`, `CG: none` and `AMBIENCE: none` are not shown).

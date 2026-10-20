# Visual novels: the book format

This document describes how Scriptorium writes a visual novel and what the files look like, so a separate app can turn a finished book into a playable visual novel: pictures for every scene (from ComfyUI, or drawn by a model with a pixel-art tool) with the text shown on top.

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
| `bible/bible.md` | The art reference: `## Setting`, `## Characters` (one bullet per character: `- **Name**: looks, then who they are. Voice: ...`), `## Places` (one bullet per place: how it looks), `## Style` | Character sprites and backgrounds, the same in every scene |
| `chapters/ch-01.md` ... | Frontmatter `n`, `title`, `words`; the body is the script | The scenes and the text |
| `outline.md` | Chapter titles and summaries; for a book with choices also the chapter map (`choices`, `ending`) | Chapter select, scene summaries, the branches |
| `cover-brief.md` | One paragraph describing a cover picture | Title-screen image |
| `out/<slug>.epub` | The same script laid out for reading | Not needed by the app |

`bible/bible.md` example:

```markdown
## Characters
- **Mara**: Seventeen, small and wiry, sun-browned skin, dark curly hair tied back with a red scarf, grey eyes, a yellow oilskin raincoat over a patched blue jumper. The lighthouse keeper's daughter, stubborn and brave. Voice: short sentences, dry jokes, never says sorry.
- **Tomas**: ...

## Places
- **Harbour wall**: A long stone pier at dusk, wet black stones, a rusted iron rail, fishing boats bobbing on grey water, the lighthouse beam sweeping across a purple sky.
```

## The script grammar

A chapter body is read **line by line**. Empty lines mean nothing. Each line is exactly one of these (checked in this order):

| Line | Pattern | Meaning |
| --- | --- | --- |
| Scene break | `---` (or `***`, `___`) | A transition inside the chapter (fade to black) |
| Scene | `SCENE: <place>, <time>` | A new scene: a new background. Also accepted: a markdown heading `## <place>` |
| On screen | `ON SCREEN: Name (look), Name (look), ...` | Who is visible from now on, each with how they look right now (the bracket is optional) |
| Speaker line | `NAME: words` or `NAME (expression): words` | A text box with a name tag. NAME is in capitals |
| Narration | anything else | A narrator text box (no name tag): what the reader sees, actions, glances. Present tense |

The patterns the renderer uses (`src/engine/publish/xhtml.ts`, JavaScript regular expressions):

```js
const SCENE = /^\**\s*scene\s*:\s*\**\s*(.+?)\s*\**$/i
const CAST  = /^\**\s*on screen\s*:\s*\**\s*(.+?)\s*\**$/i
const LINE  = /^\**([\p{Lu}][\p{Lu}\p{N}'’ .-]{0,40}?)\**(?:\s*\(([^)]{1,120})\))?\s*:\**\s+(.+)$/u
```

Inside any text, `*word*` or `_word_` is emphasis and `**word**` is strong, as in markdown.

A short example of a chapter:

```text
SCENE: The harbour wall, dusk
Rain needles the grey water. The lighthouse beam sweeps over the boats.
ON SCREEN: Mara (soaked raincoat, worried)
MARA (worried): He said he'd be back before the lamp was lit.
Footsteps on the wet stones. Someone is running.
ON SCREEN: Mara (startled), Tomas (out of breath, grinning)
TOMAS (grinning): Did you miss me?
MARA (annoyed): You're *late*.
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
- **Text box** = each speaker line (name tag + words) and each narration line (no name tag). One click per line.
- A speaker who is not in the `ON SCREEN` list speaks off screen (a voice from the dark, a phone call): show the text box without a sprite, or add them to the screen. Your choice.
- A chapter starts with an empty screen. `---` clears the screen (sprites and background) until the next `SCENE`.

### What is guaranteed and what is not

The writer is a language model following a prompt, so the app must be lenient:

- Guaranteed by the engine: the files and folders above, `script: true` in `book.md`, the chapter order, plain UTF-8 markdown.
- Asked of the model, usually followed, not guaranteed: every scene starts with `SCENE:`, `ON SCREEN:` after every change, names in capitals and the same every time, names that match the bible, the bracket on speaker lines. The line editor checks the script form in its review, and a book with real problems gets rewritten before it is published, but small slips get through.
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
  "characters": [{ "name": "Mara", "looks": "Seventeen, small and wiry, ...", "voice": "short sentences, dry jokes" }],
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

## In Scriptorium

- Formats: `visual-novel` and `choice-visual-novel` for topics of kind `visual-novel`, `kids-visual-story` and `kids-choice-visual-story` for kind `juvenile-visual-novel`, all with `script: true`; the choice formats also have `choices: true`. The editor-in-chief picks one of the formats of the topic's kind; set `enabled: false` on a format to stop it being picked.
- Choices: `prompts/_choices.md` holds the extra instructions for planning, writing and reviewing a story with choices.
- Prompts: `architect/outline_vn.md` (looks of characters and places for the bible), `writer/draft_chapter_vn.md` and `writer/rewrite_chapter_vn.md` (the script grammar), `line-editor/review_vn.md` (dialogue, voices and the script form), `humanizer/humanize_chapter_vn.md` (livelier lines and narration with the `SCENE:`, `ON SCREEN:` and speaker lines kept one for one; the engine keeps the original chapter if their number or order changes). Other roles use their usual prompts with the format guidance. Edit them in the data folder's `prompts/` to change the style of the scripts.
- The EPUB and the in-app reader show the script with scene headings, an "On screen" line, bold speaker names and italic narration.

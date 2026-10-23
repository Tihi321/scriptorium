# Screenplays: the short film and cartoon format

This document is the contract of the screenplay writer (SCP-17, hub ticket HUB-11): how Scriptorium writes a screenplay for a short film or cartoon, what the files look like, and the JSON `get_screenplay` returns, so that a separate tool (the hub's `make-video` skill) can turn a finished book into a video: a picture for every shot, a voice for every spoken line, music cues, one assembled film.

Scriptorium only writes the text. It never makes pictures, voices or video. Everything below is plain markdown in the data folder.

A screenplay book is **not** a visual novel. It has `script: true` (it shares the script machinery with visual novels, see [visual-novel.md](visual-novel.md)) and `screenplay: true`. VN Studio lists only its own visual novel formats and never offers a screenplay book, and `get_script` refuses a screenplay book and names `get_screenplay`.

## The formats

| Format | Kind of topic | Length | For |
| --- | --- | --- | --- |
| `short-film` | `video` | 60 to 180 seconds, 1 to 3 chapters, 400 to 2,000 words | A live-action look |
| `cartoon` | `video` | 60 to 180 seconds, 1 to 3 chapters, 400 to 2,000 words | An animated look |
| `kids-cartoon` | `juvenile-video` | 45 to 120 seconds, 1 to 2 chapters, 300 to 1,200 words, ages 3 to 8 | Gentle, child-safe |

- Flags in `config/formats.md`: `script: true`, `screenplay: true`, `humanize: false` (the humanizer is off for screenplays: shot lines are technical and its guard counts script lines in a way that would refuse cue edits), `max_rounds: 1`, and `runtime: [min, max]` seconds. Reviewers: continuity checker, developmental editor, line editor, beta reader (and the child-safety reviewer for `kids-cartoon`).
- **Never picked for a story with no topic.** `formatsForKind(formats, null)` leaves screenplay formats out, like the article formats. A screenplay is written when a story fixes the format (`add_story {format: "short-film"}`, `adapt_book {format: "short-film"}`) or for a topic of kind `video` or `juvenile-video`. The seed's `## Videos` topics (`vid-short-film`, `vid-cartoon`, `vid-kids-cartoon`) are all switched off.
- A data folder from before this gets the three formats and the `## Videos` section added at the next start (`migrateScreenplay`); nothing else in `formats.md` or `topics.md` changes.
- **Agents and prompts.** No new role: the architect, writer and line editor use the `_sp` prompts (`architect/outline_sp.md`, `writer/draft_chapter_sp.md`, `writer/rewrite_chapter_sp.md`, `line-editor/review_sp.md`). A role without an `_sp` prompt uses its plain one, never the `_vn` one. The prompts are migrated into data folders whose prompt files were never edited, like all seed prompts. Per-book `models` (`adapt_book {models}`) work as for any book.

## Where the files are

A book folder `books/<slug>/`, like a visual novel: `book.md` (`script: true`, `screenplay: true`, `format`), `outline.md` (chapters are **sequences** of the film; for an adaptation each has `source_chapters`), `bible/bible.md` (`## Characters` with looks and `Voice:`, `## Places`, `## Style`; the bible's `Voice:` is a few words on age, pitch and manner, which a voice-casting step reads), `chapters/ch-NN.md` (the script of a sequence), `out/<slug>.epub` (the screenplay laid out for reading: cue lines as small grey notes).

## The screenplay grammar

A chapter body is read **line by line**. Empty lines mean nothing. Each line is exactly one of these (checked in this order):

| Line | Pattern | Meaning |
| --- | --- | --- |
| Break | `---` | Fade to black between scenes; clears who is in frame |
| Scene | `SCENE: <place>, <time>` (or `## <place>, <time>`) | A new scene. The place is a name from the bible's `## Places` |
| Shot | `SHOT (<spec>): <what we see>` | A new shot, one camera take. `spec` is a comma list: framing (`extreme wide`, `wide`, `medium`, `two-shot`, `close-up`, `extreme close-up`, `over-the-shoulder`, `pov`, `insert`; `medium two-shot` and the like are fine), camera move (`static`, `pan`, `tilt`, `push-in`, `pull-out`, `tracking`, `handheld`, `orbit`, other words allowed), length `Ns` (4 to 10), and the flag `continuous` (picks up exactly where the last shot ended) |
| On screen | `ON SCREEN: Name (look), ...` | Who is in frame, from this shot on, until the next `ON SCREEN:`. Characters only |
| Music | `MUSIC: <mood, instruments, tempo>` / `MUSIC: stop` | A music cue starts at the shot it is in (or the next shot) and runs until `MUSIC: stop` (after the shot it is in), the next cue, or the end |
| Sound | `SFX: <sound>` | A sound heard in the current shot (goes into the clip prompt) |
| Title | `TITLE: <text>` | A title card: its own 3 second shot |
| Voice-over | `NARRATOR: words` or `NAME (V.O.): words` | Voice-over, not seen speaking |
| Line | `NAME (delivery): words` (`(O.S.)` = off screen) | Dialogue; the bracket may hold a delivery (`worried`) and `V.O.` / `O.S.` as a comma list (`O.S., shouting`) |
| Action | anything else | Added to the current shot's description. Before the first shot of a scene it is the scene's background |

The regular expressions live in `src/engine/publish/xhtml.ts` (`SHOT`, `MUSIC`, `SP_SFX`, `TITLE`, with the visual novel `SCENE`, `CAST` and `LINE`); the parser is `src/engine/publish/screenplay.ts`. The cue keywords are tested before `LINE`, which would read `SHOT (wide): ...` as a speaker.

**Not the visual novel cues.** A screenplay does not use `CG:`, `INSERT:`, `AMBIENCE:` or `END CG` (VN Studio's picture and sound lines, [visual-novel.md](visual-novel.md)): the parser reads them as action, and the layout shows them as narration. `SFX:` means the same in both grammars (a sound). `MUSIC`, `SHOT` and `TITLE` are not VN cue words, so a visual novel script that uses them keeps reading them as speakers.

Rules the writer is given: every scene has at least one `SHOT`; a shot is one continuous camera take of 4 to 10 seconds that one picture can show; one to three short spoken lines per shot; the spoken words fit the shot (about 2.5 words a second); present tense; one name per character everywhere; at most two `MUSIC:` cues in the whole film.

Example:

```text
SCENE: The harbour wall, dusk
Rain needles the grey water. The lighthouse beam sweeps over the boats.
MUSIC: slow solo piano, melancholic, sparse
SHOT (extreme wide, static, 6s): The pier at dusk, a small figure at its far end, the beam passing over her.
NARRATOR: Every evening, Mara waited for the last boat.
SHOT (medium, slow push-in, 4s): Mara grips the rusted rail, rain running off her hood.
ON SCREEN: Mara (soaked yellow raincoat, worried)
SFX: wind, rain on oilskin
MARA (worried): He said he'd be back before the lamp was lit.
SHOT (medium two-shot, static, 6s): Tomas skids to a stop beside her, out of breath, grinning.
ON SCREEN: Mara (startled), Tomas (out of breath, grinning)
TOMAS (grinning): Did you miss me?
MARA (annoyed): You're *late*.
MUSIC: stop
```

## `get_screenplay`

MCP tool `get_screenplay {book, chapter?}` (any stage, drafts too; refused for a book that is not a screenplay). It returns:

```json
{
  "slug": "...", "title": "...", "author": "...", "genre": "...", "format": "short-film",
  "aspect": "16:9", "style": "...", "runtimeSeconds": 16, "runtimeRange": [60, 180],
  "characters": [{ "name": "Mara", "looks": "...", "voice": "...", "aliases": [] }],
  "places": [{ "name": "Harbour wall", "looks": "..." }],
  "music": [{ "id": "m1", "description": "slow solo piano, melancholic, sparse", "from": "ch01.s01.sh01", "to": "ch01.s01.sh03" }],
  "chapters": [{ "n": 1, "title": "...", "sourceChapters": [1, 2], "scenes": [{
    "id": "ch01.s01", "place": "The harbour wall", "time": "dusk", "background": "Rain needles ...",
    "shots": [{
      "id": "ch01.s01.sh02", "framing": "medium", "move": "slow push-in", "seconds": 4, "continuous": false,
      "action": "Mara grips the rusted rail, rain running off her hood.",
      "cast": [{ "name": "Mara", "look": "soaked yellow raincoat, worried" }],
      "sfx": ["wind, rain on oilskin"], "title": null,
      "lines": [{ "speaker": "Mara", "delivery": "worried", "text": "He said he'd be back before the lamp was lit.", "kind": "dialogue" }]
    }]
  }] }]
}
```

- `aspect` is `9:16` when the brief or the style says vertical (`vertical`, `portrait`, `9:16`, `tiktok`, `reels`, `shorts`), else `16:9`. `runtimeRange` is the format's `runtime` (absent when the format has none). `runtimeSeconds` is the sum of the shot lengths.
- Ids: scene `ch01.s01`, shot `ch01.s01.sh02` (chapter, scene, shot, all two digits). With `chapter`, only that chapter is returned and `music` covers only it.
- `kind` of a line: `dialogue`, `voice-over` (`NARRATOR`, `(V.O.)`; the narrator's `speaker` is `Narrator`) or `off-screen` (`(O.S.)`). `delivery` is the rest of the bracket.
- A title card is a shot with `framing: "title"`, `title` set, 3 seconds and no cast.
- `seconds`: the given length clamped to 4 to 10. A shot with none gets 4, or the next of 6, 8 and 10 that its lines need (2.5 words a second and half a second of air). The tool does not raise a length the writer gave: whether the lines fit is for the reader of the JSON (the hub's planner raises a shot to the next of 4, 6, 8 and 10 seconds).
- A spoken line before any `SHOT` in a scene opens a `medium` shot. `cast` is carried from the last `ON SCREEN:` of the scene to the following shots (a new scene starts empty).
- `music` cues run from the shot with `MUSIC:` to the shot with `MUSIC: stop`, or to the shot before the next cue, or to the film's last shot. The shots themselves do not carry the music fields.
- Speaker and cast names are written as the bible has them when one matches (`sameName`). There is no alias grammar here.
- The parser is lenient like the visual novel one: an unknown line is action, and it never fails.

## What is guaranteed and what is not

The writer is a language model following a prompt, so a reader must be lenient:

- Guaranteed by the engine: the files, `script: true` and `screenplay: true` in `book.md`, the chapter order, the `SCENE:` places written as the bible's names (a new place is added to the bible), the JSON shape above.
- Asked of the model, usually followed, not guaranteed: at least one `SHOT` per scene, shot lengths of 4 to 10 seconds, spoken words that fit the shot, at most two `MUSIC:` cues, the runtime of the format. The line editor checks the form in its review; the runtime is not enforced. A screenplay's length is its runtime (the seconds of its shots), never its words, which are mostly cue lines (SCP-29): the length gate rewrites the chapters when the film is more than 15% outside the runtime range (a film inside its range gets none, however many words it has; the request says seconds and shots), and a chapter over 120% of its share of the runtime (the middle of the range over the chapters) is cut once by a request that keeps every `SCENE`, `ON SCREEN`, `MUSIC`, `SFX` and `TITLE` line. The word target does not apply.
- So a shot may be longer than its lines allow, a scene may have no shot (the parser opens one when it finds a spoken line), and the runtime may be outside the format's range: check `runtimeSeconds` against `runtimeRange`.

## Adapting a book

`adapt_book {book, format: "short-film" | "cartoon" | "kids-cartoon", title?, notes?, models?}` (and the Script writer panel of a published book's card: "Adapt to script", then the kind of script) works as for a visual novel ([visual-novel.md](visual-novel.md), "Adapting a book"), with these differences: the prompts say "screenplay" and "short film", the architect compresses the source into the format's runtime (a chapter of the screenplay is a sequence made from one or more chapters of the source, `source_chapters` in `outline.md`), the writer turns the source into shots and a short voice-over, and the reviewers get a note that the cue lines are shot and sound cues, not prose.

## In Scriptorium

- Code: `src/engine/publish/screenplay.ts` (`parseScreenplay`, `musicCues`, `runtimeOf`), the cue regexes in `src/engine/publish/xhtml.ts`, `get_screenplay` in `src/engine/mcp/tools.ts`, `migrateScreenplay` in `src/engine/store/migrations.ts`, `variant()` (`_sp`) in `src/engine/pipeline/handlers.ts`.
- The EPUB and the in-app reader show the screenplay with scene headings, bold speaker names, italic action and the cue lines as small grey italic notes (`Shot (wide, 6s):`, `Music:`, `Sound:`, `Title:`).

## What a video tool needs from `get_screenplay`

The hub's `make-video` skill and its planner read this JSON and need, per shot: `id`, `seconds`, `framing`, `move`, `action`, `cast` (the characters in frame, with the look in this shot), `sfx`, `continuous`, `title`, `lines` (speaker, text, delivery, kind); per film: `aspect`, `style`, `characters` (looks and a voice note, for one fixed voice per character), `places` (looks, for backgrounds and keyframes), `music` (description and the shot range). It should treat a shot's `seconds` as the minimum (raise it to fit the lines), fall back to the nearest paid clip length, and read `runtimeSeconds` against `runtimeRange` before spending anything.

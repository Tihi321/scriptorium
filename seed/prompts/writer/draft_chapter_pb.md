---
kind: prompt
role: writer
task: draft_chapter
---
Write chapter {{chapter_n}} of {{chapter_count}} of "{{title}}", a children's picture book.

Format: {{format_name}}. Age band: {{age_band}}. The whole book is about {{target_words}} words, and this chapter about {{chapter_words}} words.

Format guidance:
{{guidance}}

{{story_so_far}}

Now write chapter {{chapter_n}}: "{{chapter_title}}". What happens in it: {{chapter_summary}}

A picture book is told page by page: one page is one scene, with one picture and one to three short sentences under it. Write 12 to 16 pages in this chapter. Each page is exactly three things:

SCENE: the place and the time, in a few words. The second sentence describes the picture: who is in it, what they do and what is around them, so an illustrator can draw it.
ON SCREEN: who is in the picture, each with a few words on how they look on this page, for example: Petra (yellow raincoat, grinning), Tomas (red boots).
The words under the picture: one to three short narration sentences, in the present tense, saying what happens, how it feels or what a character does. Simple words a child of three to six knows, read aloud by an adult.

Rules:
- One page is one scene: exactly one SCENE: line and exactly one ON SCREEN: line per page, and nothing else on those lines.
- Separate the people on an ON SCREEN: line with commas (a semicolon is fine too): Lana (yellow dress), Mama (apron, bun).
- Never write speaker lines. Nobody speaks with a NAME: label in this format: put what is said into the narration (Petra whispers to the duck.) or leave it to the picture.
- Never write CG:, INSERT:, SFX:, AMBIENCE: or END CG lines, and never write --- between pages. Every page follows the one before it.
- The picture is the second sentence of the SCENE: line. Keep it concrete and kind: the place, the characters and what they are doing, with their looks from the bible. It must be a picture a child would love to look at, and the same child must look the same on every page.
- The words under the picture are narration only: no dialogue in quotation marks longer than a phrase, no stage directions, no camera talk, no page numbers.
- The pages tell the whole story in order: a beginning, a small problem, a kind solution and a warm ending. Plant one small thing a child can look for in the pictures.
- Keep names, places and facts the same as in the earlier text and as in the story bible.
- In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.
- Write only the pages. Do not write a title, chapter heading, notes or a summary, and no markdown other than the lines above.

If you are not sure of a real-world fact and the research notes above do not give it, write your best line anyway and put [RESEARCH: a short, specific question] right after it, then keep writing. Do this at most three times, only for real-world facts, never for things you invent in the story.

---
kind: prompt
role: writer
task: rewrite_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", a children's picture book, using the editors' notes.

Format: {{format_name}}. Age band: {{age_band}}. Keep the chapter at about {{chapter_words}} words.

Format guidance:
{{guidance}}

Story bible:
{{bible}}

The editors' notes that concern this chapter:
{{notes}}

{{research}}

The chapters before and after this one in full, the others as summaries:
{{other_chapters}}

The current text of chapter {{chapter_n}}, "{{chapter_title}}":
{{chapter_text}}

Write the improved chapter. Fix what the notes point out, keep what already works, and keep the story, names and facts consistent with the other chapters.

Keep it a picture book, page by page: one SCENE: line per page whose second sentence describes the picture, exactly one ON SCREEN: line per page naming who is in the picture (the people separated by commas, a semicolon is fine too), then one to three short narration sentences under the picture. Keep 12 to 16 pages and do not add, remove, merge or split pages unless a note asks for it: the page count must stay the same. Never write speaker lines (NAME: words), CG:, INSERT:, SFX:, AMBIENCE:, END CG or --- lines: this book has no dialogue lines and no picture or sound cues.

The pages are read aloud to a child of {{age_band}}: simple words, short sentences, a steady rhythm, a kind and warm tone.

In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.

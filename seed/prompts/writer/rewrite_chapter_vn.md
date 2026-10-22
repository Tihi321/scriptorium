---
kind: prompt
role: writer
task: rewrite_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", a visual novel, using the editors' notes.

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

Keep it a visual novel script, one element per line: SCENE: place and time; short narration lines for what the reader sees; ON SCREEN: who is shown and how they look; NAME (expression): spoken line. Speaker names in capitals, the same every time. Write only the script, with no title, heading or notes.

Keep the picture and sound lines (CG:, INSERT:, SFX:, AMBIENCE:, END CG) as they are, each on its own line right before the line it goes with and never last in a scene, unless a note asks you to change them. At most two CG, two INSERT and four SFX per chapter. ON SCREEN names only characters, never things. A speaker may be one of the character's aliases from the bible, in capitals.

In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.

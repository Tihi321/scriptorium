---
kind: prompt
role: writer
task: rewrite_chapter_nf
---
Rewrite chapter {{chapter_n}} of the non-fiction book "{{title}}" using the editors' notes.

Format: {{format_name}}. Age band: {{age_band}}. Keep the chapter at about {{chapter_words}} words.

Format guidance:
{{guidance}}

{{bible}}

{{research}}

The editors' notes on the whole book (take what applies to this chapter and ignore what doesn't). The fact-checker's claims come first: every claim listed for this chapter must be fixed by giving it the number of a source from the list that supports it, by correcting it so that it agrees with the notes, or by removing it:
{{notes}}

The current text of chapter {{chapter_n}}, "{{chapter_title}}":
{{chapter_text}}

Write the improved chapter. Use only the facts above, keep the number of the source in square brackets after every sentence that states a fact (for example [2]), and keep it in plain prose in your own words. Keep what already works, and stay consistent with the other chapters. Write only the text of the chapter. Do not write a title, heading or notes.

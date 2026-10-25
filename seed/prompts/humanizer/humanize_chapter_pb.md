---
kind: prompt
role: humanizer
task: humanize_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", "{{chapter_title}}", a children's picture book, so that the pages read aloud more naturally and every page sounds like a person telling a small child a story. Keep the story, the pages and their structure exactly as they are.

Format: {{format_name}}. Age band: {{age_band}}. The chapter is about {{chapter_words}} words: your version must stay within 10% of that, in both directions.

Format guidance:
{{guidance}}

Characters, places and looks (the bible):
{{bible}}

{{previous_ending}}

What a script found in this chapter (fix every one of these; it is only what a counter can see, so look for more of the same kind):
{{tics}}

The grammar of the book, which you must keep line for line: SCENE: place and time, its second sentence the picture; exactly one ON SCREEN: line per page naming who is in the picture; one to three short narration sentences under the picture. A page is a scene, and the page count stays the same. There are no speaker lines and no CG:, INSERT:, SFX: or AMBIENCE: cues.

What to do

- Do not add, remove, merge, split or reorder SCENE lines or ON SCREEN lines. The number of pages must stay the same, and each page keeps its one SCENE line and its one ON SCREEN line. Keep every name and every look the ON SCREEN lines give, unless the line itself says it changes. You change the words inside the lines, not the skeleton.
- The picture description in the SCENE line's second sentence stays: word it more warmly if you like, but keep the place, the characters, what they do and what is around them, because an illustrator draws from it.
- Rewrite the narration under each picture so it is easy to read aloud: simple words a child of {{age_band}} knows, short sentences that fit in one breath, a steady rhythm, soft sounds, and a little repetition a child can join in with.
- Never use an em dash (the long dash). Not one. Use a full stop, a comma, a colon or brackets, or rewrite the sentence. A script counts them and refuses a version that has more than the original.
- Keep whole sentences: every sentence has a subject and a verb. Do not break a sentence into a string of verbless fragments and do not add one-word sentences. A script counts them and refuses a version with more than the original.
- Write in English, as the original is. Keep every line in the language it is in; never translate it.
- Keep every concrete fact exactly as it is: each object, where it is, who holds it, every number and every name. A script compares the numbers and the names with the original and refuses a version that differs.
- Cut the tics of machine-written writing: characters who explain their feelings in full sentences, everyone answering politely and completely, "for a long moment", "a testament to", "the weight of", em dashes for drama, lists of three, similes that explain themselves, and a closing line that states the lesson. A picture book says less and lets the picture do the work.
- Keep a [RESEARCH: ...] marker exactly as it is, in the same place.

The current text of chapter {{chapter_n}}:

<chapter>
{{chapter_text}}
</chapter>

Write the whole chapter again, line by line, as a picture book. Reply with the pages only: no title, no heading, no notes, no explanation of what you changed.

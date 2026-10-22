---
kind: prompt
role: humanizer
task: humanize_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", "{{chapter_title}}", a visual novel script, so that the lines sound spoken by real, different people and the narration is vivid and brief. Keep the story and the script structure exactly as they are.

Format: {{format_name}}. Age band: {{age_band}}. The chapter is about {{chapter_words}} words: your version must stay within 10% of that, in both directions.

Format guidance:
{{guidance}}

Characters, places and looks (the bible):
{{bible}}

{{previous_ending}}

What a script found in this chapter (fix every one of these; it is only what a counter can see, so look for more of the same kind):
{{tics}}

The grammar of the script, which you must keep line for line: SCENE: place and time; short narration lines for what the reader sees; ON SCREEN: who is shown and how they look; NAME (expression): spoken line. Speaker names in capitals, the same every time. Picture and sound lines (CG:, INSERT:, SFX:, AMBIENCE:, END CG) are cues for the game.

What to do

- Do not add, remove, merge, split or reorder SCENE lines, ON SCREEN lines, speaker lines or picture and sound lines. The number of each, and who speaks in which order, must stay the same. Keep every CG, INSERT, SFX, AMBIENCE and END CG line word for word, in the same place. You change the words inside the lines, not the skeleton. Keep every name, every expression tag and every look that ON SCREEN lines give, unless the line itself says it changes.
- Never use an em dash (the long dash). Not one. Use a full stop, a comma, a colon or brackets, or rewrite the sentence. A script counts them and refuses a version that has more than the original.
- Vary the length, but keep whole sentences: every sentence has a subject and a verb. Do not break a sentence into a string of verbless fragments ("Eighty-four years old, widow of a judge, second floor.") and do not add one-word sentences. A script counts them and refuses a version with more than the original.
- Write in English, as the original is. Keep every line of dialogue in the language it is in; never translate it.
- Keep every concrete fact exactly as it is: each object, where it is, who holds it, every number, date and year, every name. Do not move a thing to another place ("under the third flowerpot" stays under the third flowerpot), do not change a count, do not invent a name or a figure. A script compares the numbers and the names with the original and refuses a version that differs.
- Keep each speaker's register. A formal speaker stays formal: no contractions, no slang, no softening added. A rough speaker stays rough. Change the rhythm and the words around the speech, not who talks how.
- Keep the story, the facts, what each character knows, and every name.
- Give each speaker their own voice from the bible: vocabulary, sentence length, what they never say. Cover the name and you should still know who is talking. People interrupt, trail off, dodge, and say less than they mean. Spoken lines are short enough for a text box.
- Cut the tics of machine-written writing: characters who explain their feelings in full sentences, everyone answering politely and completely, "for a long moment", "it was" narration, "did not look / say" beats, "a testament to", "the weight of", "something shifted", em dashes for drama, lists of three, similes that explain themselves, and a closing line that states the lesson.
- Narration sets a scene in a few concrete words: the exact sound, light, object or smell. Sharpen the verbs. Show a feeling through what the character does or gets wrong.
- Keep a [RESEARCH: ...] marker exactly as it is, in the same place.

The current text of chapter {{chapter_n}}:

<chapter>
{{chapter_text}}
</chapter>

Write the whole chapter again, line by line, as a script. Reply with the script only: no title, no heading, no notes, no explanation of what you changed.

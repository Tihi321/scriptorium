---
kind: prompt
role: writer
task: draft_chapter
---
Write chapter {{chapter_n}} of {{chapter_count}} of "{{title}}", a visual novel.

Format: {{format_name}}. Age band: {{age_band}}. The whole book is about {{target_words}} words. This chapter should be about {{chapter_words}} words.

Format guidance:
{{guidance}}

{{story_so_far}}

Now write chapter {{chapter_n}}: "{{chapter_title}}". What happens in it: {{chapter_summary}}

Write it as a visual novel script, not as prose. Put every element on its own line:

SCENE: the place and the time, in a few words (opens each scene, and the chapter starts with one)
Then one to three lines of narration describing what the reader sees: the background, the light, the sounds, the mood.
ON SCREEN: who is shown, each with a few words on how they look right now, for example: Mara (soaked raincoat, worried), Tomas (grinning)
MARA (worried): What she says, in her own voice.
TOMAS: What he says.
Narration lines for actions, glances and anything the characters do or feel that the dialogue does not show.

Rules:
- Speaker names in capitals, the same name every time, followed by a colon. The bracket after the name is optional: the expression or tone, a few words.
- Write ON SCREEN again whenever someone enters or leaves, or their look clearly changes.
- Most of the chapter is dialogue. Keep each spoken line short enough to fit a text box: one to three sentences.
- Narration is short and in the present tense.
- Use a line with only --- between scenes if you need a scene break. Start the next scene with SCENE:.
- Write only the script. Do not write a title, chapter heading, notes or a summary, and no markdown other than the lines above.
- Keep names, places and facts the same as in the earlier text.

If you are not sure of a real-world fact and the research notes above do not give it, write your best line anyway and put [RESEARCH: a short, specific question] right after it, then keep writing. Do this at most three times, only for real-world facts, never for things you invent in the story.

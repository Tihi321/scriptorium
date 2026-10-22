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
- ON SCREEN is only for characters. Never put a thing, a page or a crowd in it.
- A speaker may be one of the character's aliases from the bible, in capitals (THE BALD MAN:), until the story gives the name.
- Keep names, places and facts the same as in the earlier text.
- In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.

Pictures and sounds, each on its own line:
CG: a picture over the whole screen
INSERT: a page or thing shown up close
SFX: one sound effect
AMBIENCE: a sound that loops
END CG ends the picture. AMBIENCE: none stops the sound.

- Put a picture or sound line right before the line it goes with. Never make it the last line of a scene or of the chapter.
- CG: at most two per chapter, for the moments that matter most. Say who (bible names), doing what, and where, in one sentence. It stays until END CG or the next SCENE.
- INSERT: a letter, a sign, a page, a photo or an object the reader must see. At most two per chapter. Put what it says in a narration line after it.
- SFX: a single sound the story needs (a door, a shot, a phone). At most four per chapter.
- AMBIENCE: once, right after the SCENE line, when the place has a steady sound. It plays on into the next scenes, so write a new AMBIENCE, or AMBIENCE: none, when the sound changes or stops.
- The same picture again: copy its CG line word for word. Two different pictures start with different words.

If you are not sure of a real-world fact and the research notes above do not give it, write your best line anyway and put [RESEARCH: a short, specific question] right after it, then keep writing. Do this at most three times, only for real-world facts, never for things you invent in the story.

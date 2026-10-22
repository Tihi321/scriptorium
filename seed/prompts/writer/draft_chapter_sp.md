---
kind: prompt
role: writer
task: draft_chapter
---
Write chapter {{chapter_n}} of {{chapter_count}} of "{{title}}", a screenplay for a short film.

Format: {{format_name}}. Age band: {{age_band}}. The whole film runs {{runtime_min}} to {{runtime_max}} seconds. This chapter is one sequence of it. The chapter should be about {{chapter_words}} words and run about {{chapter_runtime}} seconds (the whole book is about {{target_words}} words).

Format guidance:
{{guidance}}

{{story_so_far}}

Now write chapter {{chapter_n}}: "{{chapter_title}}". What happens in it: {{chapter_summary}}

Write it as a screenplay, not as prose. Put every element on its own line:

SCENE: the place and the time, in a few words (opens each scene, and the chapter starts with one)
Then one or two action lines saying what the place looks like: the light, the weather, the mood. This is the background of the scene.
SHOT (framing, camera move, length): what the camera sees in this one take
ON SCREEN: who is in frame, each with a few words on how they look right now, for example: Mara (soaked raincoat, worried), Tomas (grinning)
NARRATOR: a voice-over line, not seen speaking.
MARA (worried): What she says, in her own voice.
MARA (V.O.): A voice-over line of a character.
MARA (O.S.): A line said off screen.
MUSIC: the mood, the instruments and the tempo
MUSIC: stop
SFX: a sound in this shot
TITLE: the words of a title card

Rules:
- Every scene has at least one SHOT. A shot is one continuous camera take of 4 to 10 seconds that a single picture can show: say who is in frame, what they do and where, in one or two sentences. Never cut inside a shot.
- In the SHOT line the bracket is a comma list: the framing (extreme wide, wide, medium, two-shot, close-up, extreme close-up, over-the-shoulder, pov, insert), the camera move (static, pan, tilt, push-in, pull-out, tracking, handheld, orbit), the length in seconds as 6s, and the word continuous when the shot picks up exactly where the last one ended.
- Add more action lines after a SHOT only for what the camera sees in that shot. Do not write what a character thinks.
- Write ON SCREEN after the SHOT line it belongs to, and again whenever someone enters or leaves, or their look clearly changes. It names only characters.
- One to three short spoken lines per shot. The words of a shot must fit its length: about two and a half words a second, so a 4 second shot holds about nine words.
- Tell the story in pictures. Use NARRATOR or (V.O.) only for what a picture cannot show. Speaker names in capitals, the same name every time, followed by a colon.
- MUSIC: at most two cues in the whole film, written on the line before the shot where the music starts. SFX: a sound the story needs, in the shot where it is heard. Never use the lines CG:, INSERT: or AMBIENCE:.
- A line of a different kind that the format does not have is action. Write only the screenplay: no title, chapter heading, notes or summary, and no markdown other than the lines above.
- Use a line with only --- between scenes if you want a fade to black. Start the next scene with SCENE:.
- Keep names, places, looks and facts the same as in the earlier text.
- In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.

If you are not sure of a real-world fact and the research notes above do not give it, write your best line anyway and put [RESEARCH: a short, specific question] right after it, then keep writing. Do this at most three times, only for real-world facts, never for things you invent in the story.

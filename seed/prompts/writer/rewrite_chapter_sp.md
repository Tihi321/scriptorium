---
kind: prompt
role: writer
task: rewrite_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", a screenplay for a short film, using the editors' notes.

Format: {{format_name}}. Age band: {{age_band}}. Keep the chapter at about {{chapter_runtime}} seconds of film: its length is the sum of its shot lengths, and the words do not count (the whole film runs {{runtime_min}} to {{runtime_max}} seconds).

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

Keep it a screenplay, one element per line: SCENE: place and time; action lines for the background of a scene; SHOT (framing, camera move, 6s): what the camera sees in one take of 4 to 10 seconds; ON SCREEN: who is in frame and how they look; NARRATOR: or NAME (V.O.): voice-over; NAME (delivery): spoken line; MUSIC:, SFX: and TITLE: cue lines. Speaker names in capitals, the same every time. Write only the screenplay, with no title, heading or notes.

Keep the MUSIC, SFX and TITLE lines unless a note asks you to change them. Every scene keeps at least one SHOT, the spoken words of a shot fit its length (about two and a half words a second), and ON SCREEN names only characters. Never use the lines CG:, INSERT: or AMBIENCE:.

In every SCENE: line name the place exactly as one of the places of the story bible (see "Places" in the bible). A new place is allowed only when the story moves somewhere the bible does not have: then name it plainly, and the engine adds it to the bible.

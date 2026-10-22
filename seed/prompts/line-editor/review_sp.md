---
kind: prompt
role: line-editor
task: review
---
You are the line editor of a short film. The text is a screenplay: SCENE lines, action lines, SHOT lines (framing, camera move, length) saying what the camera sees in one take, ON SCREEN lines saying who is in frame, NARRATOR and NAME (V.O.) voice-over, spoken lines (NAME (delivery): words), and MUSIC, SFX and TITLE cue lines. Judge the writing for this form: does each character sound like themselves and different from the others, is the dialogue spoken and natural and the voice-over short and plain, does every shot show one clear picture that could be drawn as a single image (who is in frame, what they do, where), does the story go forward in pictures instead of being told, and are there repetition, cliches, machine-sounding phrases or clumsy lines. Also check the form: every scene starts with a SCENE line and has at least one SHOT, a shot is one camera take of 4 to 10 seconds, the spoken words of a shot fit its length (about two and a half words a second, so a 4 second shot holds about nine words), speaker names are in capitals and the same every time, and the chapter fits its share of the runtime. Quote the lines you would change.

Book: "{{title}}"
Format: {{format_name}}. Age band: {{age_band}}. Target length about {{target_words}} words ({{words_min}} to {{words_max}} allowed); the film runs {{runtime_min}} to {{runtime_max}} seconds. This is review round {{round}}.

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

Story bible:
{{bible}}

The text to review:

{{book_text}}

{{extra}}
---

Give your review. Score each of these dimensions from 1 (very poor) to 10 (excellent): {{dimensions}}. A score of 7 means good enough to produce.
Verdict: "pass" if the book is good enough as it is for your area, "revise" if the writer must change something.
Be fair and calibrated. Most screenplays should pass in the first or second round. Say "revise" only for a concrete, real problem in the text that you can name and quote, not for matters of taste, small polish, or things you would simply have done differently. Judge only the book text; the pitch and the bible are background. If you say "revise", at least one of your scores must be below 7, and the notes must say exactly what to change. If all your scores are 7 or more, say "pass".
In "notes", write your findings in a few short paragraphs or bullet points, with the exact wording that is a problem and how to fix it. In "chapters" list the numbers of the chapters that need changes. When your verdict is "revise" you must name the chapters: the one to four chapters that need the change most (use the chapter numbers as they appear in the text), and say in "notes" what is wrong in each. Do not ask for the whole book to be rewritten; name the worst chapters. Leave "chapters" empty only when the verdict is "pass". "chapters" holds chapter numbers only, as plain numbers. In "problems" give one string for every concrete finding when the verdict is "revise": where it is (the chapter and a short quote), what is wrong, and what to change; leave it empty for "pass". If a statement about the real world in the text looks wrong and you cannot be sure, put a short, precise question in "research_questions" (at most two) so the researcher can look it up. Leave it empty when nothing needs checking.

Reply with one JSON object like this:
{"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "chapters": [], "problems": [], "research_questions": []}

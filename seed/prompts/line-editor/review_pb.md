---
kind: prompt
role: line-editor
task: review
---
You are the line editor of a children's picture book. The book is written page by page: each page starts with a SCENE: line whose second sentence describes the picture, then one ON SCREEN: line names who is in the picture, then one to three short narration sentences under the picture. A page is a scene, and the book has 12 to 16 of them.

Judge the words and the rhythm: does every page read aloud easily, with simple words a child of {{age_band}} knows and sentences short enough to say in one breath? Does each page's narration match its picture and add to the story, or does it repeat what the picture already shows? Is there a clear beginning, a small problem, a kind solution and a warm ending, and is the last page a quiet, satisfying one? Look for repetition, cliches, phrases that sound machine-written, clumsy lines, and pages that are much longer or shorter than the others. Check the page form too: exactly one SCENE: line and exactly one ON SCREEN: line per page, the picture described in the SCENE line's second sentence, and one to three narration sentences under the picture. A page with no speaker lines is correct: a picture book has no dialogue lines (what someone says goes into the narration or stays in the picture) and no CG:, INSERT:, SFX: or AMBIENCE: cues. Do not ask for dialogue, cue lines, more text on a page or more pages. Quote the lines you would change.

Book: "{{title}}"
Format: {{format_name}}. Age band: {{age_band}}. Target length about {{target_words}} words ({{words_min}} to {{words_max}} allowed). This is review round {{round}}.

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

Give your review. Score each of these dimensions from 1 (very poor) to 10 (excellent): {{dimensions}}. A score of 7 means good enough to publish.
Verdict: "pass" if the book is good enough as it is for your area, "revise" if the writer must change something.
Be fair and calibrated. Most books should pass in the first or second round. Say "revise" only for a concrete, real problem in the text that you can name and quote, not for matters of taste, small polish, or things you would simply have done differently. Judge only the book text; the pitch and the bible are background. If you say "revise", at least one of your scores must be below 7, and the notes must say exactly what to change. If all your scores are 7 or more, say "pass".
In "notes", write your findings in a few short paragraphs or bullet points, with the exact wording that is a problem and how to fix it. In "chapters" list the numbers of the chapters that need changes. When your verdict is "revise" you must name the chapters: the one to four chapters that need the change most (use the chapter numbers as they appear in the text), and say in "notes" what is wrong in each. Do not ask for the whole book to be rewritten; name the worst chapters. Leave "chapters" empty only when the verdict is "pass". "chapters" holds chapter numbers only, as plain numbers. In "problems" give one string for every concrete finding when the verdict is "revise": where it is (the chapter and a short quote), what is wrong, and what to change; leave it empty for "pass". If a statement about the real world in the text looks wrong and you cannot be sure, put a short, precise question in "research_questions" (at most two) so the researcher can look it up. Leave it empty when nothing needs checking.

Reply with one JSON object like this:
{"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "chapters": [], "problems": [], "research_questions": []}

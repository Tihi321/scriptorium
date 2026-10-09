---
kind: prompt
role: originality-checker
task: review_nf
---
You check originality and content of a non-fiction book. Does it copy or closely imitate a known book, article or author, or lift long passages from its sources? Is the angle fresh? Is the content suitable for its age band and shelf? Score originality (10 = clearly original, no problems). Say revise only if there is a real similarity, copied wording or an unsuitable passage.

Book: "{{title}}"
Format: {{format_name}}. Age band: {{age_band}}. Target length about {{target_words}} words ({{words_min}} to {{words_max}} allowed). This is review round {{round}}.

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

Fact base:
{{bible}}

The text to review:

{{book_text}}

{{extra}}
---

Give your review. Score each of these dimensions from 1 (very poor) to 10 (excellent): {{dimensions}}. A score of 7 means good enough to publish.
Verdict: "pass" if the book is good enough as it is for your area, "revise" if the writer must change something.
Be fair and calibrated. Most books should pass in the first or second round. Say "revise" only for a concrete, real problem in the text that you can name and quote, not for matters of taste, small polish, or things you would simply have done differently. Judge only the book text; the pitch and the fact base are background (the fact-checker checks the facts, so do not judge them). If you say "revise", at least one of your scores must be below 7, and the notes must say exactly what to change. If all your scores are 7 or more, say "pass".
In "notes", write your findings in a few short paragraphs or bullet points, with the exact wording that is a problem and how to fix it. In "chapters" list the numbers of the chapters that need changes. When your verdict is "revise" you must name the chapters: the one to four chapters that need the change most (use the chapter numbers as they appear in the text), and say in "notes" what is wrong in each. Do not ask for the whole book to be rewritten; name the worst chapters. Leave "chapters" empty only when the verdict is "pass". Numbers in square brackets are source citations: leave them as they are. Leave "research_questions" empty.

Reply with one JSON object like this:
{"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "chapters": [], "research_questions": []}

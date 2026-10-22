---
kind: prompt
role: architect
task: outline_nf
---
Turn this pitch into a chapter outline and the start of the book's fact base.

Title: {{title}}
Format id: {{format_id}}
Format: {{format_name}} ({{words_min}} to {{words_max}} words, target {{target_words}}). Age band: {{age_band}}.
Number of chapters: {{chapters_min}} to {{chapters_max}}.

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

{{research}}

{{revision_notes}}

Give each chapter a short title and a summary of two or three sentences saying which part of the argument it makes, which real events, people or ideas it covers, and what the reader understands at its end. Order the chapters so each builds on the one before, and make the last one pull the argument together. Only use the real facts in the research notes above when they are given. Do not put dates or numbers in the summaries that the notes do not give.
Also give: "thesis" (the argument or central question of the book, in two or three sentences), "audience" (who it is for), "terms" (the technical terms or names a reader must know, each with a plain definition of one sentence; at most 8), "style" (how the writer should explain things), and "story_year" (the year the book's events are set in as a number, or null when it covers many years; reviewers use it to check dates).

Reply with one JSON object like this:
{"chapters": [{"title": "...", "summary": "..."}], "thesis": "...", "audience": "...", "terms": [{"term": "...", "definition": "..."}], "style": "...", "story_year": null}

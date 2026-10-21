---
kind: prompt
role: architect
task: outline_article
---
Turn this pitch into the plan of a newspaper article and the start of its fact base.

Working headline: {{title}}
Format id: {{format_id}}
Format: {{format_name}} ({{words_min}} to {{words_max}} words, target {{target_words}}).

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

{{research}}

{{revision_notes}}

An article is one chapter. Give exactly one chapter: its "title" is the section the article belongs to or a short working label, and its "summary" is the section plan: the order of the parts of the article (the opening that carries the news or the most interesting fact, the context, who said what, the other side or the complication, what happens next), one line for each part, naming the real events, people and figures it uses and the number of the research note it comes from. Only use the facts in the research notes above. Do not put dates, names or numbers in the plan that the notes do not give.
Also give: "headline" (the headline of the article: specific, accurate, no clickbait, under 14 words), "standfirst" (one or two sentences under the headline that sum up what the reader will learn, using only what the notes support), "thesis" (what the article establishes, in two sentences), "audience" (who it is for), "terms" (names, abbreviations and technical terms a reader must have explained, each with a one-sentence plain definition; at most 6), and "style" (the voice: for example restrained and exact, or warm and curious).

Reply with one JSON object like this:
{"chapters": [{"title": "...", "summary": "..."}], "headline": "...", "standfirst": "...", "thesis": "...", "audience": "...", "terms": [{"term": "...", "definition": "..."}], "style": "..."}

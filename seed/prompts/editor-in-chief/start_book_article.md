---
kind: prompt
role: editor-in-chief
task: start_book_article
---
You are choosing how to make our next newspaper article.

Source:
{{source}}

Section: {{topic}}

Formats you may choose from:
{{formats}}

Pick the format that suits the subject: the short article for one development, one announcement or one explainer that fits in a few paragraphs; the feature for a story or a development that needs the background, several voices and a thread to follow. Give the article a working headline: specific, accurate, no clickbait, under 14 words (the publisher makes the final headline). Use "genre" for the kind of piece in a few words (news report, explainer, analysis, profile, opinion piece), and a target length in words that is inside the range of the format. Add one or two sentences of notes for the architect: what must be checked, and what is not yet known.

Reply with one JSON object like this:
{"format": "format-id", "title": "...", "genre": "...", "target_words": 900, "notes": "..."}

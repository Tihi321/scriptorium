---
kind: prompt
role: publisher
task: publish_nf
---
The non-fiction book "{{title}}" by {{author}} passed review with a weighted score of {{score}}. Prepare it for publication.

Format: {{format_name}}. Age band: {{age_band}}. Juvenile book: {{juvenile}}. Chapters: {{chapter_count}}.

Pitch:
{{pitch}}

The book:
{{book_text}}

Give:
- "title": the final title (keep the working title unless you have a clearly better one).
- "blurb": a back-cover blurb of two or three sentences that says what the reader will learn and why it matters, without claiming anything the book does not say.
- "subjects": two to four subject headings, such as "Printing, history" or "Space exploration".
- "keywords": four to eight search keywords.
- "cover_brief": a short description of a cover picture for a future image tool (subject, colours, mood). Plain words, one paragraph.
- "illustration_briefs": if this is a juvenile book, three to six pictures for the inside, each with the chapter number and what the picture shows (accurate, simple, suitable for the age band). Otherwise an empty list.

Reply with one JSON object like this:
{"title": "...", "blurb": "...", "subjects": ["..."], "keywords": ["..."], "cover_brief": "...", "illustration_briefs": [{"chapter": 1, "description": "..."}]}

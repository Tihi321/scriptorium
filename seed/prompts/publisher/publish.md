---
kind: prompt
role: publisher
task: publish
---
The book "{{title}}" by {{author}} passed review with a weighted score of {{score}}. Prepare it for publication.

Format: {{format_name}}. Age band: {{age_band}}. Juvenile book: {{juvenile}}. Chapters: {{chapter_count}}.

Pitch:
{{pitch}}

The book:
{{book_text}}

The end-of-book thread check left these story threads open (nothing here means every thread was closed):
{{open_threads}}

Give:
- "title": the final title (keep the working title unless you have a clearly better one).
- "blurb": a back-cover blurb of two or three sentences that makes a reader want to read it, without spoiling the ending.
- "subjects": two to four subject headings, such as "Bedtime stories" or "Cozy mystery".
- "keywords": four to eight search keywords.
- "cover_brief": a short description of a cover picture for a future image tool (scene, colours, mood). Plain words, one paragraph.
- "illustration_briefs": if this is a juvenile book, three to six pictures for the inside, each with the chapter number and what the picture shows (gentle, simple, suitable for the age band). Otherwise an empty list.

Reply with one JSON object like this:
{"title": "...", "blurb": "...", "subjects": ["..."], "keywords": ["..."], "cover_brief": "...", "illustration_briefs": [{"chapter": 1, "description": "..."}]}

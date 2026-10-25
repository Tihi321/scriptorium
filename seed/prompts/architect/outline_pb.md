---
kind: prompt
role: architect
task: outline
---
Turn this pitch for a children's picture book into a one-chapter outline and a story bible. Pages are planned in the chapter's summary: a picture book is one page per scene, 12 to 16 pages, and each page is one picture with one to three short sentences under it.

Title: {{title}}
Format id: {{format_id}}
Format: {{format_name}} ({{words_min}} to {{words_max}} words, target {{target_words}}). Age band: {{age_band}}.
Number of chapters: {{chapters_min}} to {{chapters_max}}. Long book: {{long}}.

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

{{research}}

{{revision_notes}}

Give exactly one chapter, with a short title and a summary that is the page plan: 12 to 16 numbered steps, one per page, in the order a child turns the pages. Say for each page where it is and what the picture shows, so the writer and the illustrator know what happens in it. The pages must tell the whole story: a beginning, a small problem, a kind solution and a warm ending, with one small thing a child can look for in the pictures.

Also list the main characters, each with a description that starts with how they look (age, build, face, hair, eyes, skin, clothes and the colours they wear, one thing that makes them easy to recognise) and then who they are, and how each one speaks (a "voice": a few words on their way of talking). These looks are what an illustrator draws on every page, so the same child must be easy to keep consistent. Give each character the name the pages will use, and use [] for aliases (a picture book has no speaker labels, so a character normally needs none). List the places where the pages happen, each with a description of how it looks (indoors or outdoors, size, light, colours, the main objects in view), so it can be drawn as a picture. Keep the cast small (one main child and at most two or three others) and the places few. Then give the story threads that need an ending by the last page, the setting in a few sentences, and the style the writer and the illustrator should keep to (warm, simple, bright, a child's-eye view). Also give "story_year": the year the story is set in as a number (2026, 1888), or null when it has no fixed year; a picture book normally has none.

Reply with one JSON object like this:
{"chapters": [{"title": "...", "summary": "Page 1: ... Page 2: ... ... Page 14: ..."}], "characters": [{"name": "...", "description": "...", "voice": "...", "aliases": []}], "places": [{"name": "...", "description": "..."}], "threads": ["..."], "setting": "...", "style": "...", "story_year": null}

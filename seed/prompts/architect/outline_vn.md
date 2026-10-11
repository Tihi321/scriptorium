---
kind: prompt
role: architect
task: outline
---
Turn this pitch for a visual novel into a chapter outline and a story bible. The bible is also the art reference: an artist will draw every character and place from it, so the looks must be concrete and stay the same for the whole book.

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

Give each chapter a short title and a summary saying what happens in it. For a short book two or three sentences are enough. For a long book (Long book: yes) write four to six sentences per chapter, name the characters and places in it, and make sure tension rises across the whole book, the middle has a turn, and every storyline you start is closed by the end. If the number of chapters is 1, give one chapter that holds the whole story.
Also list the main characters, each with a description that starts with how they look (age, build, face, hair, eyes, skin, clothes and the colours they wear, one thing that makes them easy to recognise) and then who they are, and how each one speaks (a "voice": a few words on their way of talking). Give each character the name the script will use. List the places where scenes happen, each with a description of how it looks (indoors or outdoors, size, light, colours, the main objects in view), so it can be drawn as a background. Then give the story threads (promises, mysteries and subplots) that need an ending by the last chapter, the setting in a few sentences, and the style the writer should keep to.

Reply with one JSON object like this:
{"chapters": [{"title": "...", "summary": "..."}], "characters": [{"name": "...", "description": "...", "voice": "..."}], "places": [{"name": "...", "description": "..."}], "threads": ["..."], "setting": "...", "style": "..."}

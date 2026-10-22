---
kind: prompt
role: architect
task: outline
---
Turn this pitch for a short film into a chapter outline and a story bible. Each chapter is one sequence of the film. The bible is also the picture reference: every character and place is drawn from it, so the looks must be concrete and stay the same for the whole film.

Title: {{title}}
Format id: {{format_id}}
Format: {{format_name}} ({{words_min}} to {{words_max}} words, target {{target_words}}; the film runs {{runtime_min}} to {{runtime_max}} seconds). Age band: {{age_band}}.
Number of chapters (sequences): {{chapters_min}} to {{chapters_max}}. Long book: {{long}}.

Format guidance:
{{guidance}}

Pitch:
{{pitch}}

{{research}}

{{revision_notes}}

Give each chapter a short title and a summary saying what happens in it and what the viewer sees: two or three sentences, with the place and the people in it, and about how many seconds it runs (the seconds of all chapters add up to the runtime). The film needs an opening image, a turn and an ending image. If the number of chapters is 1, give one chapter that holds the whole film.
Also list the main characters (at most five: every one is drawn and voiced), each with a description that starts with how they look (age, build, face, hair, eyes, skin, clothes and the colours they wear, one thing that makes them easy to recognise in a small picture) and then who they are, and how each one sounds (a "voice": a few words on age, pitch and way of talking, for example "an old woman, warm, slow"). Give each character the name the script will use, and list in "aliases" other names for the same person if the story uses any, otherwise []. List the places where scenes happen, each with a description of how it looks (indoors or outdoors, size, light, colours, the main objects in view), so it can be drawn as a background. Then give the story threads that need an ending by the last chapter, the setting in a few sentences, and the visual style of the film (a few concrete words on colour, light and the look of the pictures). Also give "story_year": the year the story is set in as a number (2026, 1888), or null when it has no fixed year.

Reply with one JSON object like this:
{"chapters": [{"title": "...", "summary": "..."}], "characters": [{"name": "...", "description": "...", "voice": "...", "aliases": []}], "places": [{"name": "...", "description": "..."}], "threads": ["..."], "setting": "...", "style": "...", "story_year": 2026}

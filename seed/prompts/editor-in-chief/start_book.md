---
kind: prompt
role: editor-in-chief
task: start_book
---
You are choosing how to make our next book.

Source:
{{source}}

Topic: {{topic}}

Formats you may choose from:
{{formats}}

Pick the format that suits the source best. Our youngest reader is almost two years old, so for any bedtime story choose the toddler format (bedtime-toddler) unless the idea clearly cannot be told in under 800 words. For adult fiction, a short story suits a small idea, a novella a story with one main storyline, and a novel only a big story with subplots. Genre sets the length: romance and thrillers sit in the lower half of a format's range, epic fantasy and science fiction in the upper half. Give the book a working title that is short, original and fitting, a genre label of a few words, and a target length in words that is inside the range of the format. Add one or two sentences of notes for the architect.

Reply with one JSON object like this:
{"format": "format-id", "title": "...", "genre": "...", "target_words": 600, "notes": "..."}

---
kind: prompt
role: researcher
task: check_notes
---
A question was sent to the research library:

Question: {{question}}

These notes are already in the library (found by search; they may be about something else):

{{notes}}

Decide whether the notes already answer the question well enough for a writer to use the facts. They must contain the specific facts the question asks for, not only the same subject. If a fact asked for is missing, they do not cover it.

Reply with one JSON object like this:
{"covered": false, "missing": "what is still missing"}

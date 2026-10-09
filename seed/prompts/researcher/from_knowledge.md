---
kind: prompt
role: researcher
task: from_knowledge
---
A writer needs facts, but no web source could be used for this question. Answer from your own knowledge as carefully as you can.

Question: {{question}}
{{context}}

Write only facts you are fairly sure of, as short sentences. Prefer concrete numbers, dates and names, but say "about" or "roughly" when you are not exact. If you are unsure about something, leave it out. Do not invent sources. These notes will be marked as unverified.

Between 2 and 8 facts. If you know nothing reliable, return an empty list.

Reply with one JSON object like this:
{"facts": [{"fact": "..."}]}

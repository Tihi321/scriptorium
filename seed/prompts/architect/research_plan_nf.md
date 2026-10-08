---
kind: prompt
role: architect
task: research_plan_nf
---
You have written the pitch for a new non-fiction book. Every chapter of it will be built on researched, sourced facts, so before the outline is made we collect the facts the whole book stands on.

Title: {{title}}
Topic: {{topic}}. Genre: {{genre}}.

Pitch:
{{pitch}}

List the most important questions (at most {{max_questions}}) whose answers the book needs: the overall background, the key events, people, dates, numbers and ideas the argument depends on. Each question must be specific and easy to look up in an encyclopedia article, and each must name its main subject, the way you would type it into a search box, for example "Who invented movable type printing in Europe?" or "How does a mechanical clock escapement work?". Keep every question short (under 15 words). Do not ask for opinions or for the structure of the book.

Reply with one JSON object like this:
{"needs_research": true, "questions": ["..."]}

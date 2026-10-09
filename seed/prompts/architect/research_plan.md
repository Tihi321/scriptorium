---
kind: prompt
role: architect
task: research_plan
---
You have written the pitch for a new book. Before the outline is made, decide whether the book needs real-world facts that you could get wrong.

Title: {{title}}
Topic: {{topic}}. Genre: {{genre}}.

Pitch:
{{pitch}}

Books need research when they touch a real period, place, profession, science or technology, culture, or animals and nature: historical fiction and thrillers usually do, fantasy sometimes (travel times, weapons, medicine, farming), most bedtime stories and pure fantasy do not. If the story is invented and needs no real-world facts, answer with no questions.

If research is needed, list the most important questions (at most {{max_questions}}). Each question must be specific and easy to look up, for example "How long did a sailing ship take from Lisbon to Goa around 1600?" or "What did a night nurse do on a hospital ward in the 1950s?". Keep every question short (under 15 words) and name its main subject, the way you would type it into a search box. Do not ask for plot ideas.

Reply with one JSON object like this:
{"needs_research": true, "questions": ["..."]}

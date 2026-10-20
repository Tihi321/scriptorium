---
kind: prompt
role: architect
task: research_plan_article
---
You have written the pitch for a newspaper article. An article is always researched: every statement of fact in it must come from a recent, sourced note, so before the outline is made we collect the facts the whole piece stands on.

Headline (working): {{title}}
Section: {{topic}}. Genre: {{genre}}.

Pitch:
{{pitch}}

List the most important questions (at most {{max_questions}}) whose answers the article needs. Ask like a reporter: what happened, when and where; who is involved and what each of them said or did; the key figures and what they are measured against; what was decided, announced, found or disputed; what the background is, in a sentence; what happens next. Prefer questions about recent events and name the main subject and the year or "this week", the way you would type it into a news search box, for example "What did the EU agree on AI rules in 2026?" or "Who won the 2026 Tour de France?". Each question must be short (under 15 words) and specific. Do not ask for opinions, predictions, or for the structure of the article.

Reply with one JSON object like this:
{"needs_research": true, "questions": ["..."]}

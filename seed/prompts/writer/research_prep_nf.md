---
kind: prompt
role: writer
task: research_prep_nf
---
You are about to write chapter {{chapter_n}} of {{chapter_count}} of the non-fiction book "{{title}}" ({{genre}}).

What the chapter covers: {{chapter_title}}. {{chapter_summary}}

The book's fact base, in short:
{{bible}}

Research the library already has (do not ask for these again):
{{known}}

Research is required for every chapter. List the real-world facts this chapter needs that the research above does not already give: the events, people, dates, numbers, places or explanations it will state. At most {{max_questions}} questions, each short (under 15 words), specific, naming its main subject, and easy to look up in an encyclopedia article. Ask at least one question.

Reply with one JSON object like this:
{"questions": ["..."]}

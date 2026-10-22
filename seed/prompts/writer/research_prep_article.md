---
kind: prompt
role: writer
task: research_prep_article
---
You are about to write the newspaper article "{{title}}" ({{genre}}). It is one piece of {{chapter_count}} chapter(s): {{chapter_title}}. {{chapter_summary}}

What the fact base holds so far:

{{bible}}

Research already done for this article:

{{known}}

Research is required. List the recent, real-world facts this article still needs that the research above does not give: the latest development, who said what and when, the exact figures, the other side's position, what happens next. At most {{max_questions}} questions, each short (under 15 words), specific, naming its main subject and the year or "this week", the way you would type it into a news search box. Ask at least one question. Give each question a "news" flag: true only for what happened in the last days or weeks; false for background, history, how something works and official explanations.

Reply with one JSON object like this:
{"questions": [{"question": "...", "news": true}]}

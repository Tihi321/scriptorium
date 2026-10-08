---
kind: prompt
role: writer
task: research_prep
---
You are about to write chapter {{chapter_n}} of {{chapter_count}} of "{{title}}" ({{genre}}).

What happens in it: {{chapter_title}}. {{chapter_summary}}

The story bible, in short:
{{bible}}

Research the library already has (do not ask for these again):
{{known}}

List the real-world facts you would need to check before writing this chapter, because you do not know them well enough or could get them wrong (how long something took, how a tool or job works, what a place was like in that period, what an animal does). Ask only about things this chapter really uses. At most {{max_questions}} questions, each short (under 15 words), specific, naming its main subject, and easy to look up. If you know enough, return an empty list. Most chapters need no research.

Reply with one JSON object like this:
{"questions": ["..."]}

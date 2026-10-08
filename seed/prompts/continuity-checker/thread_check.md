---
kind: prompt
role: continuity-checker
task: thread_check
---
You make the end-of-book check on story threads. A thread is a promise, mystery or subplot that the book opened. By the end every thread must be closed, or deliberately left as a quiet, acceptable open note.

Book: "{{title}}".

Threads that are still marked open:
{{threads}}

Summaries of the book:
{{summaries}}

The last chapter:
{{last_chapter}}

Go through the open threads one by one. For each, decide if the book really closed it (the summaries and last chapter may show it even if the bible was not updated). In "resolved" list the ids (such as "t3") of the threads the book really closed. Every id you leave out is reported to the publisher as still open, so be accurate. In "notes" say which threads are really unresolved. Say "revise" only if an important thread is left dangling, and name the chapter where it should be closed (usually one of the last chapters). Score threads from 1 to 10 (10 = everything closed).

Reply with one JSON object like this:
{"verdict": "pass", "scores": {"threads": 9}, "notes": "...", "chapters": [], "resolved": ["t1"]}

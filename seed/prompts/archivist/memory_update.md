---
kind: prompt
role: archivist
task: memory_update
---
You keep the memory of a long book. After each accepted chapter you record what became true. Record only what the text says, never guesses.

Book: "{{title}}". Chapter {{chapter_n}}: "{{chapter_title}}".

Characters and places already in the bible:
{{known}}

Open threads (id: text):
{{threads}}

The chapter:
{{chapter_text}}

Work through these steps in order:
1. Write the summary and the character and place updates.
2. Close threads. Go through the open threads listed above one by one. For each one ask: does this chapter resolve it (the question is answered, the promise is kept, the mystery is solved, the subplot ends)? Close any thread this chapter resolves by putting its id (for example "t3") in "threads_closed". Do not leave a thread open that the chapter has finished. A thread that the chapter only moves forward stays open.
3. Open new threads for the promises and mysteries this chapter starts.
4. Write the timeline lines.

Fields:
- "summary": a summary of the chapter in four to six sentences (who did what, what changed, where it ended).
- "characters": for every character that appears or changes, their name and one line saying what is new or different about them after this chapter (state, wants, relationships, injuries, secrets learned). For a new character add a "description". Use the exact names from the list when they exist.
- "places": the same for places.
- "threads_opened": new promises, mysteries or subplots this chapter starts, as short sentences.
- "threads_closed": the ids of open threads this chapter closes.
- "timeline": one short line for each event that matters for the order of events.

Reply with one JSON object like this:
{"summary": "...", "characters": [{"name": "...", "update": "...", "description": ""}], "places": [{"name": "...", "update": "...", "description": ""}], "threads_opened": ["..."], "threads_closed": ["t1"], "timeline": ["..."]}

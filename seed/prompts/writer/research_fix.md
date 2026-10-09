---
kind: prompt
role: writer
task: research_fix
---
While you wrote chapter {{chapter_n}} of "{{title}}" you marked places where you were unsure of a real-world fact with [RESEARCH: question]. The researcher has answered. Replace each marked sentence with a corrected sentence.

{{items}}

Rules:
- Use the research notes for the fact. Keep the same voice, tense and point of view, and keep the sentence about as long as before. Do not add the source or mention research.
- A note marked unverified is not confirmed: write the sentence so that it does not depend on the exact figure ("a few weeks", "many days").
- Where it says that no notes were found, rewrite the sentence so that it does not state a specific real-world fact.
- The new sentence replaces everything shown as "Sentence", including the marker. It must not contain a marker.

Reply with one JSON object like this:
{"fixes": [{"marker": 1, "sentence": "..."}]}

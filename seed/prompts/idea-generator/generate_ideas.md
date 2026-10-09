---
kind: prompt
role: idea-generator
task: generate_ideas
---
Come up with {{count}} new book ideas for our library. Each idea belongs to exactly one of these topics. Spread the ideas over the topics, favouring topics with fewer books:

{{topics}}

Ideas that already exist (do not repeat or closely copy any of them):

{{existing_titles}}

For a non-fiction or juvenile non-fiction topic the idea is a book about a real, specific subject with a clear angle (the question it answers or what it explains), not a story, and the pitch says what the reader will understand. For each idea give a short original title, the topic id exactly as written above, and a pitch of two or three sentences: who the main character is, what happens, and what makes it fresh. Keep it suitable for the topic's readers.

Reply with one JSON object like this:
{"ideas": [{"title": "...", "topic": "topic-id", "pitch": "..."}]}

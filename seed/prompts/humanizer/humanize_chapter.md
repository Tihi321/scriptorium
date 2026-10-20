---
kind: prompt
role: humanizer
task: humanize_chapter
---
Rewrite chapter {{chapter_n}} of "{{title}}", "{{chapter_title}}", so that it reads as if a person with a distinct voice wrote it, and so that it is livelier. Keep the story exactly as it is.

Format: {{format_name}}. Age band: {{age_band}}. The chapter is about {{chapter_words}} words: your version must stay within 10% of that, in both directions.

Format guidance:
{{guidance}}

Style, voices and facts of the book (the bible):
{{bible}}

{{previous_ending}}

What a script found in this chapter (fix every one of these; it is only what a counter can see, so look for more of the same kind):
{{tics}}

What to do

- Keep the plot, the events and their order, the facts, every name (people, places, things), the point of view, the tense, and what each character knows. Add no new plot facts, no new characters, no new places, and do not remove a scene or a beat the story needs.
- Keep each character's voice from the bible. Dialogue stays in the speaker's own way of talking: do not make everyone sound alike or polish rough speech into neat speech. People interrupt, trail off, answer a different question than the one asked, and say less than they mean.
- Vary the rhythm. Mix short and long sentences, and break any run of sentences built the same way or starting the same way. Sometimes a sentence is one word. Sometimes it runs on because the narrator is carried along.
- Make it concrete. Swap abstract or general words for the specific thing: the exact object, the sound, the smell, the number, the name of the tool or the bird. One precise detail is worth three adjectives. Keep details that fit this world and this voice.
- Sharpen the verbs. Replace "was", "had", "seemed", "began to", "started to", "felt" plus an adjective, and adverb-propped verbs with a verb that does the work. Show a feeling through what the character does, notices or gets wrong, not by naming it.
- Cut the tics of machine-written prose: "for a long time", "for a long moment", sentences that open "It was" one after another, "did not look / say / answer" beats, "not X but Y" reversals, "a testament to", "tapestry", "little did", "the weight of", "something shifted", a breath they did not know they were holding, nodding and sighing as stage business, em dashes used for drama, lists of exactly three adjectives or nouns, and similes that explain themselves. Write the plain version, or find a fresher one that belongs to this book.
- Do not end the chapter, or a scene, on a moral, a summary of what was learned, or a neat feeling. End on an action, an image, a line of dialogue, or an open question.
- Do not pad. A weak sentence is cut, not decorated. Do not add a closing summary or any commentary on the chapter.
- Leave a [RESEARCH: ...] marker exactly as it is, in the same place.
- If the text has numbers in square brackets, such as [1], they are source numbers: keep each one, next to the claim it supports.

The current text of chapter {{chapter_n}}:

<chapter>
{{chapter_text}}
</chapter>

Write the whole chapter again, from its first line to its last. Reply with the text of the chapter only, as plain prose: no title, no heading, no notes, no explanation of what you changed.

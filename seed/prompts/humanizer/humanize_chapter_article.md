---
kind: prompt
role: humanizer
task: humanize_chapter_article
---
Rewrite the newspaper article "{{title}}" so that it reads as if a sharp human reporter wrote it, and so that it is livelier. Keep every fact, claim and source exactly as it is.

Format: {{format_name}}. The article is about {{chapter_words}} words: your version must stay within 10% of that, in both directions.

Format guidance:
{{guidance}}

The facts, terms and style of the article (the fact base):
{{bible}}

What a script found in this article (fix every one of these; it is only what a counter can see, so look for more of the same kind):
{{tics}}

What to do

- Keep the facts, the figures, every name (people, organisations, places), the order of the argument, and who said what. Add no new facts, no new sources, no new quotes, and do not remove a claim the article needs. Quoted words stay word for word.
- Keep the numbers in square brackets, such as [1] or [2][3]: each stays next to the claim it supports, and none is added, dropped or moved to another claim.
- Write like a person with a voice: a lede that makes the reader want the second sentence, short paragraphs, a mix of short and long sentences, and the occasional dry or surprising turn where the material allows it. Not chatty, not breathless, and no opinion the sources do not give.
- Make it concrete. Swap abstract or general words for the specific thing the sources give: the exact figure, the place, the person's job. Cut vague framing like "in today's fast-changing world", "it is worth noting", "amid growing concerns", and "experts say" when the text can name who.
- Sharpen the verbs. Replace "was", "has been", "is set to", "plays a role in" and noun-heavy phrases with a verb that does the work.
- Cut the tics of machine-written prose: "a testament to", "tapestry", "landscape", "delve", "navigate", "underscores", "pivotal", "not only X but also Y" and "not X but Y" reversals, rows of exactly three items, em dashes used for drama, rhetorical questions that answer themselves, and a closing paragraph that restates the article or ends on a moral.
- End on the next step, an open question or a telling detail from the sources.
- Do not pad. A weak sentence is cut, not decorated. Do not add a headline, a standfirst, a byline, a closing summary or any commentary.
- Leave a [RESEARCH: ...] marker exactly as it is, in the same place.

The current text of the article:

<chapter>
{{chapter_text}}
</chapter>

Write the whole article again, from its first line to its last. Reply with the text of the article only, as plain prose (a feature may keep its "## " subheads): no headline, no notes, no explanation of what you changed.

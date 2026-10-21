---
kind: prompt
role: writer
task: draft_chapter_article
---
Write the newspaper article "{{title}}".

Format: {{format_name}}. The article should be about {{chapter_words}} words (the range is {{words_min}} to {{words_max}}).

Format guidance:
{{guidance}}

{{story_so_far}}

The plan of the article: {{chapter_summary}}

Rules for a newspaper article:
- Open with the news or the most interesting fact, in one or two plain sentences, then give the context. Write the way a good reporter does: short paragraphs, concrete detail, active verbs, a clear voice. Lively, not breathless.
- Use only the facts given above (the key facts and the research notes). Do not state any other date, number, name, place, quote or event, however sure you are. If a detail is missing, leave it out or say in general words that it is not known.
- Attribute every claim to a source in the text itself ("according to the ministry", "the report found", "said the mayor") and put the number of that source in square brackets right after the sentence, for example [2] or [2][3]. Use only the numbers in the list of numbered sources. A claim without a number is a claim without a source, and it will be sent back.
- Put the facts in your own words. A direct quote may only be used if a note gives the exact words; otherwise paraphrase. Never copy sentences from the notes.
- Explain what a reader may not know: spell out a name or abbreviation the first time, define a technical term in a clause.
- Be fair: when views differ, give each side its due and say who holds it. Say plainly what is not yet known.
- End on the next step, the open question or a telling detail, not on a moral or a summary.
- Write plain prose in paragraphs. A longer feature may have a few short subheads, each on its own line starting with "## ". Do not write the headline or the standfirst, a byline, bullet lists, notes or a summary of what you did. Answer with the article text only, never as JSON or with field names.
- Do not invent people, quotes, studies or anecdotes.

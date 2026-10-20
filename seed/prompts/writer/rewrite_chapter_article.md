---
kind: prompt
role: writer
task: rewrite_chapter_article
---
Rewrite the newspaper article "{{title}}" using the editors' notes.

Format: {{format_name}}. Keep the article at about {{chapter_words}} words (the range is {{words_min}} to {{words_max}}).

Format guidance:
{{guidance}}

{{bible}}

{{research}}

The editors' notes (take what applies and ignore what doesn't). The fact-checker's flagged claims come first. Fix each flagged claim by giving it the number of a source from the list whose note really says it, or by correcting it so that it agrees with the notes, or by removing it or softening it into a general statement. Do not add any new claim that has no source number, and do not change the rest of the article more than the other notes ask:
{{notes}}

The current text of the article:
{{chapter_text}}

Write the improved article. Use only the facts above, keep the number of the source in square brackets after every sentence that states a fact (for example [2]), attribute claims to who said them, and keep it in plain prose in your own words, with short paragraphs and a lively voice. Keep what already works. Write only the text of the article: no headline, standfirst, byline or notes (a feature may keep its "## " subheads). Answer with the article text only, never as JSON or with field names.

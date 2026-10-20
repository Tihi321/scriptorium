---
kind: prompt
role: publisher
task: publish_article
---
The newspaper article "{{title}}" by {{author}} passed review with a weighted score of {{score}}. Prepare it for the page.

Format: {{format_name}}.

Pitch:
{{pitch}}

The article:
{{book_text}}

Give:
- "title": the final headline. Specific, accurate, under 14 words, no clickbait, no quotation marks around it. Keep the working headline unless you have a clearly better one that the article fully supports.
- "standfirst": one or two sentences under the headline that tell the reader what the article is about and why it matters. Claim nothing the article does not say.
- "subjects": the section and up to two subject headings, such as "Technology" or "Climate policy".
- "keywords": four to eight tags for finding the article.

Reply with one JSON object like this:
{"title": "...", "standfirst": "...", "subjects": ["..."], "keywords": ["..."]}

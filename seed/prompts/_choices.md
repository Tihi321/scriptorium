---
kind: prompt
role: shared
task: choices
---
# Stories with choices

For formats with `choices: true` (choose-your-path books and visual novels with choices), the engine adds one section of this file to the end of a prompt: `outline` to the architect's outline, `draft` and `rewrite` to the writer's chapter prompts, `review` to every reviewer. Edit the text to change how these books are planned, written and reviewed. Keep the `## ` headings. `{{ways_in}}` and `{{ways_out}}` are filled in by the engine.

## outline
This book is a story with choices: at the end of some chapters the reader decides what happens next, and each choice leads to a different chapter. Plan it as a map of chapters, not a straight line:
- Chapter 1 is the start. Every reader begins there.
- A chapter that is not an ending ends with two or three choices (one only when the paths simply go on). Each choice is a short action the reader picks, like "Follow the light into the cave", and the number of the chapter it leads to.
- A choice always leads to a later chapter (a higher number), never back. Two choices from different chapters may lead into the same chapter when the paths meet again.
- Every chapter except chapter 1 is reached by at least one choice.
- A chapter without choices is an ending. Plan at least two endings, and make them truly different. The format guidance says which endings are allowed.
- Every path from chapter 1 to an ending is a whole story with a beginning, a turn and an ending of its own. Keep the paths about the same length, and make every choice matter: the paths must really differ.
- The chapter count ({{chapters_min}} to {{chapters_max}}) and the word count cover all chapters on all paths. One reader reads only one path.

In the JSON, give every chapter two more fields: "choices", a list like [{"text": "Follow the light into the cave", "to": 3}, {"text": "Climb back up to the road", "to": 4}] (an empty list for an ending), and "ending", a few words on how this ending feels, like "happy: the treasure is found" ("" for a chapter with choices). The summary of a chapter says what happens in it, for a reader who came by any of the choices that lead to it.

## draft
This book is a story with choices. One reader reads only one path through it.

{{ways_in}}
{{ways_out}}

Write the chapter so it reads well for every way in: start from what all of those paths have in common, and do not mention events that happen on only one of them. If the chapter ends with a choice, end at the moment of decision so the reader wants to choose, but do not write the choices, a list of options or "What do you do?": the book adds the choices after the chapter. If the chapter is an ending, bring this path's story to a full close.

## rewrite
This book is a story with choices. One reader reads only one path through it. The other chapters above are the ones that lead to this chapter and the ones its choices lead to, each followed by where it goes next.

{{ways_in}}
{{ways_out}}

Keep the chapter working for every way in. If it ends with a choice, end at the moment of decision and do not write the choices or a list of options: the book adds them. If it is an ending, keep it a full close.

## review
This book is a story with choices. The chapters are given in number order, but nobody reads them that way: after each chapter a line in square brackets gives its choices and the chapter each one leads to, or says that it is an ending. A reader starts at chapter 1 and follows one path to one ending. Judge every path as a story of its own: does each chapter follow from every chapter that leads to it, do the choices matter and lead where their words promise, are the paths really different, is every ending earned and complete. Do not report the jump from one chapter to the next in number order as a continuity error, and do not ask for the choices to be written into the chapters: the book adds them after each chapter.

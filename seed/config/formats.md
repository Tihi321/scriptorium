---
kind: formats
formats:
  - id: bedtime-toddler
    name: Bedtime story (toddler)
    enabled: true
    kinds: [juvenile-fiction]
    juvenile: true
    age_band: "2-4"
    words: [300, 800]
    chapters: [1, 1]
    read_aloud: true
    guidance: |
      A very gentle read-aloud story for a child who is almost two, up to four. Use repetition and a steady rhythm.
      Short sentences, simple everyday words, and a refrain the child can join in with. Sounds and soft actions are welcome.
      No peril, no villains, nothing scary, no sad endings. A small, cosy problem is fine, and it is solved kindly.
      End quietly, with sleep, a hug or a cosy place. One main character, at most two or three others.
  - id: bedtime-story
    name: Bedtime story
    enabled: true
    kinds: [juvenile-fiction]
    juvenile: true
    age_band: "3-6"
    words: [600, 2000]
    chapters: [1, 1]
    read_aloud: true
    guidance: |
      A calm read-aloud story for a child of three to six. Clear, warm language with some rhythm and repetition.
      Small gentle adventures are fine, with only mild, quickly solved worries. A kind, quiet ending that helps a child settle to sleep.
  - id: short-story
    name: Short story
    enabled: true
    kinds: [fiction]
    juvenile: false
    age_band: null
    words: [3000, 10000]
    chapters: [3, 6]
    read_aloud: false
    guidance: |
      A complete short story with one clear central problem and a satisfying ending. Few characters, one main setting, a strong voice.
  - id: chapter-book
    name: Chapter book
    enabled: true
    kinds: [juvenile-fiction]
    juvenile: true
    age_band: "6-9"
    words: [6000, 15000]
    chapters: [6, 10]
    read_aloud: true
    guidance: |
      A chapter book for ages six to nine that also works read aloud, one chapter per sitting. Simple, lively prose, short chapters
      that each end with a small hook, humour and warmth. Real but gentle stakes. Friendship, curiosity and kindness.
  - id: middle-grade
    name: Middle grade
    enabled: true
    long: true
    max_rounds: 1
    kinds: [juvenile-fiction]
    juvenile: true
    age_band: "8-12"
    words: [30000, 50000]
    chapters: [15, 25]
    read_aloud: false
    guidance: |
      A middle grade novel for ages eight to twelve. A young hero with a clear want, real but age-appropriate stakes, friends,
      humour and heart, a satisfying ending. Brisk chapters of 1,500 to 2,500 words that each end with a reason to read on.
      Keep language clear and the content gentle: nothing graphic, nothing hopeless.
  - id: novella
    name: Novella
    enabled: true
    long: true
    max_rounds: 1
    kinds: [fiction]
    juvenile: false
    age_band: null
    words: [20000, 50000]
    chapters: [10, 25]
    read_aloud: false
    guidance: |
      A novella with one main storyline and at most one or two subplots. A clear opening, a rising middle with a turn at the midpoint,
      a climax and a resolution that closes every thread. Chapters of 1,500 to 3,000 words.
  - id: novel
    name: Novel
    enabled: true
    long: true
    research_prep: true
    max_rounds: 1
    kinds: [fiction]
    juvenile: false
    age_band: null
    words: [60000, 150000]
    chapters: [25, 50]
    read_aloud: false
    guidance: |
      A full novel in three acts, with a strong middle (rising tension, reversals, a midpoint turn), a few subplots that all pay off,
      and a distinct voice for each main character. Chapters of 2,000 to 3,500 words. Genre sets the length: romance and thrillers sit
      in the lower half of the range, epic fantasy and science fiction in the upper half.
  - id: visual-novel
    name: Visual novel
    enabled: true
    script: true
    kinds: [visual-novel]
    juvenile: false
    age_band: null
    words: [8000, 25000]
    chapters: [4, 10]
    read_aloud: false
    guidance: |
      A visual novel written as a script, like a screenplay for a story told in pictures and text boxes. Each scene opens with where
      and when it is, a few lines of narration describe what the reader sees (the background, light and mood), an ON SCREEN line says
      which characters are shown and how they look, and then the characters speak, one short line at a time, with their expression
      in brackets when it matters. Most of the book is dialogue: every main character needs a distinct voice, and the story moves
      through what people say and do on screen. Short present-tense narration, three to six scenes per chapter, and each chapter ends
      on a moment that makes the reader want the next one. The story is linear, with no player choices. The topic sets the genre.
  - id: choice-visual-novel
    name: Visual novel with choices
    enabled: true
    script: true
    choices: true
    kinds: [visual-novel]
    juvenile: false
    age_band: null
    words: [10000, 30000]
    chapters: [8, 16]
    read_aloud: false
    guidance: |
      A visual novel with choices, written as a script like the linear visual novel: SCENE lines, short present-tense narration,
      ON SCREEN lines and short speaker lines with expressions. At the end of some chapters the reader decides what the main
      character does, and each choice leads to a different chapter, so the story branches and has several endings. The choices are
      real decisions about people (whom to trust, whom to help, what to say), each with its own consequences. Every path from the
      first chapter to an ending is a complete story with its own climax. The topic sets the genre.
  - id: gamebook
    name: Choose-your-path book
    enabled: true
    choices: true
    kinds: [interactive-fiction]
    juvenile: false
    age_band: null
    words: [10000, 30000]
    chapters: [10, 20]
    read_aloud: false
    guidance: |
      A choose-your-path book in prose, written in the second person and the present tense ("You push the door open"). The reader is
      the hero. At the end of most chapters the reader picks what to do next, and each choice leads to a different chapter, so the
      book has several paths and several endings: triumphant, bittersweet and a few that end the adventure early. Short, vivid
      chapters full of sensory detail and tension. Choices are concrete actions with real stakes, never a choice between doing
      something and doing nothing. The topic sets the genre.
  - id: kids-visual-story
    name: Visual story for children
    enabled: true
    script: true
    kinds: [juvenile-visual-novel]
    juvenile: true
    age_band: "6-9"
    words: [2000, 6000]
    chapters: [3, 6]
    read_aloud: false
    guidance: |
      A visual story for children aged six to nine, written as a visual novel script: SCENE lines, one or two short lines of
      narration about what the child sees, ON SCREEN lines and short speaker lines with simple expressions (happy, surprised, sad,
      curious). Bright, friendly places and characters a child can draw. Simple words, short sentences, lots of dialogue, humour
      and warmth. Gentle stakes only: nothing frightening, nobody gets hurt, every problem is solved kindly. Two or three scenes per
      chapter. The story is linear, with no choices.
  - id: kids-choice-visual-story
    name: Visual story with choices for children
    enabled: true
    script: true
    choices: true
    kinds: [juvenile-visual-novel]
    juvenile: true
    age_band: "6-9"
    words: [3000, 8000]
    chapters: [6, 10]
    read_aloud: false
    guidance: |
      A visual story with choices for children aged six to nine, written as a visual novel script: SCENE lines, short narration,
      ON SCREEN lines and short speaker lines with simple expressions. At the end of some chapters the child decides what the
      hero does next (which path to take, whom to ask for help, what to try), and each choice leads to a different chapter.
      Simple words, short sentences, bright places, humour and warmth. Every ending is happy or gently funny: no bad or scary
      endings, nobody gets hurt, and a different choice simply leads to a different adventure. Two or three scenes per chapter.
  - id: kids-choice-book
    name: Choose-your-path book for children
    enabled: true
    juvenile: true
    choices: true
    kinds: [juvenile-interactive-fiction]
    age_band: "7-10"
    words: [3000, 9000]
    chapters: [7, 12]
    read_aloud: false
    guidance: |
      A choose-your-path book for children aged seven to ten, in the second person and the present tense ("You open the little
      green door"). The child is the hero and decides what happens at the end of most chapters; each choice leads to a different
      chapter. Short chapters, simple words, vivid pictures, humour and warmth. Choices are fun and clear (the cave or the
      river, ask the owl or follow the footprints). Every ending is happy, funny or surprising in a nice way: no bad or scary
      endings, and nobody gets hurt.
  - id: nonfiction-short
    name: Short non-fiction book
    enabled: true
    nonfiction: true
    kinds: [nonfiction]
    juvenile: false
    age_band: null
    words: [5000, 15000]
    chapters: [5, 10]
    read_aloud: false
    guidance: |
      A short, accurate non-fiction book for curious general readers, built on one clear argument or question. Plain, concrete prose:
      define each term when it first appears, explain one idea at a time, use real examples, dates and numbers. Every chapter has a job
      in the argument and ends by pointing to the next. Every fact comes from the sourced notes and carries the number of its source in
      square brackets, like [2]. Never state a date, number, name or event that the notes do not give. No invented quotes, no invented people.
  - id: nonfiction-kids
    name: Fact book for children
    enabled: true
    nonfiction: true
    kinds: [juvenile-nonfiction]
    juvenile: true
    age_band: "7-10"
    words: [2000, 6000]
    chapters: [4, 8]
    read_aloud: false
    guidance: |
      A fact book for children aged seven to ten. Short sentences, everyday words, one idea per paragraph, a friendly voice that explains
      new words and asks the odd question. Facts must be right, simple and gentle: nothing frightening or graphic. Every fact comes from
      the sourced notes and carries the number of its source in square brackets, like [2]. Never state a date, number or name the notes do not give.
  - id: article
    name: Newspaper article
    enabled: true
    nonfiction: true
    article: true
    humanize: true
    max_rounds: 1
    kinds: [article]
    juvenile: false
    age_band: null
    words: [600, 1800]
    chapters: [1, 1]
    read_aloud: false
    reviewers: [fact-checker, line-editor, copy-editor, beta-reader]
    guidance: |
      A researched newspaper article for general readers: a headline, a standfirst (one or two sentences that sum it up), and a body that opens
      with the news or the most interesting fact, then gives the context, who said what, and what happens next. Plain, lively, accurate prose,
      short paragraphs, concrete detail, no jargon left unexplained. Every fact comes from the sourced notes and carries the number of its source
      in square brackets, like [2]; the sources are recent reporting, and the article says who said or did what and when. Never state a date, number,
      name, quote or event that the notes do not give. No invented quotes, no invented people. Say plainly what is not yet known.
  - id: feature-article
    name: Feature article
    enabled: true
    nonfiction: true
    article: true
    humanize: true
    max_rounds: 1
    kinds: [article]
    juvenile: false
    age_band: null
    words: [1800, 4000]
    chapters: [1, 1]
    read_aloud: false
    reviewers: [fact-checker, line-editor, copy-editor, beta-reader]
    guidance: |
      A researched long-form feature for general readers: a headline, a standfirst, and a body of several short sections that tells a story or
      explains a development in depth (the scene or the case that opens it, the background, the people and what they say, the competing views, what
      it means). Vivid but accurate, with a clear voice and a thread that pulls the reader on. Every fact comes from the sourced notes and carries the
      number of its source in square brackets, like [2]. Never state a date, number, name, quote or event that the notes do not give. No invented
      quotes, no invented people or scenes. Say plainly what is disputed or unknown.
  - id: short-film
    name: Short film
    enabled: true
    script: true
    screenplay: true
    humanize: false
    max_rounds: 1
    kinds: [video]
    juvenile: false
    age_band: null
    words: [400, 2000]
    chapters: [1, 3]
    runtime: [60, 180]
    read_aloud: false
    reviewers: [continuity-checker, developmental-editor, line-editor, beta-reader]
    guidance: |
      A screenplay for a short live-action-style film of one to three minutes, written as shots: each scene opens with where and when it
      is, and every shot is one continuous camera take of four to ten seconds that one picture can show (who is in frame, what they do,
      the framing and the camera move). Tell the story in pictures first: a short voice-over or a few short spoken lines (about two and a
      half words a second) carry what a picture cannot. One to three spoken lines per shot, one name per character everywhere, present
      tense, concrete visual detail (light, colour, objects, weather). Music cues set the mood at most twice in the whole film; sound
      effects name what is heard in a shot. The film has an opening image, a turn and an ending image, and fits its runtime.
  - id: cartoon
    name: Cartoon
    enabled: true
    script: true
    screenplay: true
    humanize: false
    max_rounds: 1
    kinds: [video]
    juvenile: false
    age_band: null
    words: [400, 2000]
    chapters: [1, 3]
    runtime: [60, 180]
    read_aloud: false
    reviewers: [continuity-checker, developmental-editor, line-editor, beta-reader]
    guidance: |
      A screenplay for a short animated cartoon of one to three minutes, written as shots like a short film, but for an animated look:
      bold shapes, bright colours, expressive characters and visual gags. Each scene opens with where and when it is, and every shot is
      one camera take of four to ten seconds that one picture can show. Characters look the same in every shot (the bible gives their
      looks, in a few concrete words). Humour, rhythm and timing come from the pictures; a short voice-over and a few short spoken lines
      (about two and a half words a second) carry the rest. One name per character everywhere, present tense. Music cues set the mood at
      most twice in the whole film. The cartoon has a clear set-up, a gag or a turn, and a payoff that fits its runtime.
  - id: kids-cartoon
    name: Cartoon for children
    enabled: true
    script: true
    screenplay: true
    humanize: false
    max_rounds: 1
    kinds: [juvenile-video]
    juvenile: true
    age_band: "3-8"
    words: [300, 1200]
    chapters: [1, 2]
    runtime: [45, 120]
    read_aloud: false
    reviewers: [continuity-checker, developmental-editor, line-editor, beta-reader, child-safety-reviewer]
    guidance: |
      A gentle screenplay for a short animated cartoon for children aged three to eight, one to two minutes long, written as shots:
      every shot is one camera take of four to ten seconds that one picture can show. Simple, bright, friendly pictures; characters with
      one or two easy-to-recognise looks (colour, shape, a favourite object) who look the same in every shot. Short sentences and
      everyday words, a warm narrator voice-over and a few short spoken lines (about two and a half words a second), a little repetition
      and a refrain a child can join in with. A small, cosy problem, solved kindly: no peril, no villains, nothing scary, no sad endings.
      Music cues are soft and playful, at most twice in the whole film.
---
# Formats

The kinds of book the factory can make. The editor-in-chief picks one for each book from the formats that are `enabled` and fit the topic's `kind`.

- `words`: the allowed range for the whole book. `chapters`: the allowed number of chapters.
- `juvenile`: the child-safety reviewer must pass, and the book gets illustration briefs for the later image milestone.
- `read_aloud`: the read-aloud reviewer checks how it sounds when read out loud.
- `age_band`: used in prompts and metadata.
- `guidance`: instructions added to the writer and reviewer prompts.
- `long`: use the book memory (see below). `max_rounds`: rewrite rounds for this format (default: `quality.max_rounds`).
- `nonfiction`: the non-fiction variant. Research for every chapter (required), a fact base in `factbase/` instead of a story bible, non-fiction prompts (`*_nf.md` in `prompts/`), the fact-checker in place of the continuity checker (it must pass), and a references section at the end of the EPUB and the reader. Non-fiction formats are short books (not `long`).
- `article`: a newspaper article (one chapter, `chapters: [1, 1]`, with `nonfiction: true`). It is researched like a non-fiction book, with the `_article` prompts (`pitch_article.md`, `research_plan_article.md`, `outline_article.md`, `draft_chapter_article.md`, `rewrite_chapter_article.md`, `humanize_chapter_article.md`, `publish_article.md`; roles without an `_article` prompt use their `_nf` one), a search for recent news, and research notes that belong to the article alone (never reused from or added to the shared library notes). It gets no cover, no EPUB and no Kindle: the publisher writes `out/article.html` (a styled page with headline, standfirst, byline, date, text and numbered references) and `out/article.md`. Articles are for topics of kind `article` (the sections of the newspaper, in `topics.md`) and never for another kind, and they have their own limit, `max_articles_in_progress` in `config/factory.md`.
- `research_prep`: the writer lists research questions before each chapter (one short model call per chapter, answered by the researcher before the chapter is written). `false` by default; books whose genre or topic contains a word of `research_prep_genres` in `config/factory.md` get it too, whatever the format says.
- `script`: a visual novel script instead of prose: SCENE lines, short narration, ON SCREEN lines for who is shown, and speaker lines (`NAME (expression): words`). The writer and the line editor use the `_vn` prompts (`draft_chapter_vn.md`, `rewrite_chapter_vn.md`, `review_vn.md`), the other roles their plain ones with the format guidance, and the EPUB and the reader lay the chapters out as a script. The visual novel formats are for topics of kind `visual-novel` and `juvenile-visual-novel`, so they are never picked for an ordinary fiction topic.
- `screenplay`: a screenplay for a short film or cartoon (with `script: true`, so it keeps the SCENE places of the bible, the tighten text, adaptation through `adapt_book` and the script layout of the EPUB and the reader). Chapters are sequences of the film, written as shots (`SHOT (framing, move, 6s): what we see`, `ON SCREEN:`, `MUSIC:`, `SFX:`, `TITLE:`, `NARRATOR:` and `NAME (V.O.):` voice-over, `NAME (delivery):` dialogue). The architect, writer and line editor use the `_sp` prompts (`outline_sp.md`, `draft_chapter_sp.md`, `rewrite_chapter_sp.md`, `review_sp.md`; a role without one uses its plain prompt, never the `_vn` one), and `get_screenplay` returns the parsed film. The screenplay formats are for topics of kind `video` and `juvenile-video` (all switched off in `topics.md`) and for a story that fixes the format (`add_story` with `format`, `adapt_book`): they are never picked for a story with no topic. Leave `humanize: false`. See `docs/screenplay.md`.
- `runtime`: `[min, max]` seconds of film a screenplay format should run. The writers are told the runtime and the chapter's share of it; `get_screenplay` reports the real one.
- `choices`: a story with choices (a choose-your-path book or a visual novel with choices). The architect plans a map of chapters: some end with two or three choices, each leading to a later chapter, and the story has at least two endings. The writer sees only the chapters that can lead to the one it writes, the reviewers read every path, and the EPUB and the reader end those chapters with links to the chapters the choices lead to ("The End" on an ending). The extra instructions are in `prompts/_choices.md`. The choice formats are for topics of kind `interactive-fiction`, `juvenile-interactive-fiction`, `visual-novel` and `juvenile-visual-novel`. Short formats only (not `long`).
- `reviewers`: optional list of reviewer roles to override the default set. The default set is continuity, developmental, line, copy, beta reader and originality, plus child safety for juvenile formats and read-aloud for read-aloud formats.

Middle grade, novella and novel are long formats (`long: true`): they use the book memory (structured bible, chapter and act summaries, a search index), are written chapter by chapter with a continuity check each, and are reviewed one act at a time. They get one rewrite round (`max_rounds: 1`) because every round costs a lot. The editor-in-chief picks the length by genre.

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
- `research_prep`: the writer lists research questions before each chapter (one short model call per chapter, answered by the researcher before the chapter is written). `false` by default; books whose genre or topic contains a word of `research_prep_genres` in `config/factory.md` get it too, whatever the format says.
- `reviewers`: optional list of reviewer roles to override the default set. The default set is continuity, developmental, line, copy, beta reader and originality, plus child safety for juvenile formats and read-aloud for read-aloud formats.

Middle grade, novella and novel are long formats (`long: true`): they use the book memory (structured bible, chapter and act summaries, a search index), are written chapter by chapter with a continuity check each, and are reviewed one act at a time. They get one rewrite round (`max_rounds: 1`) because every round costs a lot. The editor-in-chief picks the length by genre.

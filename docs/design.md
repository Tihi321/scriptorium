# Scriptorium (book factory)

Status: **ready for a plan**. Direction decided (see Decisions), nothing built yet.

This is the design document for Scriptorium: everything decided so far, worked out over two sessions on 2026-10-07 and 2026-10-08. It started as an idea note in `C:\projects\Cowork\Computer\ideas\` and moved here when the repository was created. Code lives in this repository (`C:\projects\Personal\scriptorium`, GitHub `Tihi321/scriptorium`). Later rows in the Decisions table override earlier ones where they differ.

## Original text

2026-10-07, the idea:

> would like to crteate agent factory, with local llm, lm studio support multiple api support, and even if possible acp support, but that can come later, now api and local one, need to have all that writing newspaper studio have, editor, writers all needed, but it should be writing in time to fill library, with all the genres library has, mučtiplle books, just addding more, it shouldhave a idea bucket, for me to add ideas books can be done for, it should have agents that check books during and after writing, same as writer would have, to make rewrotes and all needed, not sure where to host them, but wanted to have something like calibre, that will allow reading html preview, and epub can be downloaded, we can later utilise as well comfyui endpoints maybe to get images, though for now that is not important

2026-10-07, answers to the first questions:

> i do have deepseek api, maybe that will be quicker, and as we support more api, will try more than just local ones, i read the books, but this is as well for public, and children books as i read to my doughter. 2. Can be mix of all, there is no rule, as i will most liely read couple of them as they finish :-). 3. I will not be involved, would like to be as much automated as it can, i migh read some of the bookoa and rate them. 4. For  now acp we do not need to use, we can see to add that later if needed

2026-10-07, second round of answers:

> 1. To make it simple just make English. 2. No worries, that was example, she is almost 2 though. 3. I meant as i might add more api, and as well with api parallel is ok and that way they can work in parallel. 4. For now this is idea, implementation will come later. There sohuld be more api models supported other deepseek,

## Decisions

| Topic | Decision | Date |
|---|---|---|
| Models | DeepSeek API plus LM Studio from the start. Add more APIs over time and compare them | 2026-10-07 |
| Readers | You, the public, and children (books read aloud to your daughter) | 2026-10-07 |
| Schedule | No fixed rule. Mix of lengths and genres, books arrive whenever they finish | 2026-10-07 |
| Involvement | Fully automated. You add ideas sometimes and rate some finished books | 2026-10-07 |
| ACP | Not now. Revisit if needed | 2026-10-07 |
| Language | English only | 2026-10-07 |
| Providers | Many API providers, not only DeepSeek. Adding one should be easy | 2026-10-07 |
| Parallel work | API providers can run work in parallel. Agents should work at the same time wherever possible | 2026-10-07 |
| Stage | Design done. Next: implementation plan for the MVP | 2026-10-08 |
| Provider list | Local: LM Studio and Ollama only. Cloud: dropped Grok, Groq, Together, Fireworks | 2026-10-07 |
| Book memory | Use RAG for long books, alongside the story bible and summaries | 2026-10-07 |
| Book length | Up to long novels, 96–150k words (about 128–200k tokens) | 2026-10-07 |
| ComfyUI | Not in the MVP. Next milestone, but plan for it now | 2026-10-07 |
| Budget | Spend counter (per provider, book, role, day, month), caps you set in the UI, pause and stop buttons | 2026-10-07 |
| Monthly cap | Start at **40 USD per month** | 2026-10-08 |
| Shared files | Agents share everything through plain files on disk, almost all markdown: research, bible, outlines, reviews, ideas, topics, agents, jobs, logs. The UI reads the same files | 2026-10-08 |
| Topics | A big list of topics, **fiction and non-fiction**. You choose which ones are active (which to write), and each shows how many books are done, so empty topics are visible | 2026-10-08 |
| Name | **Scriptorium** | 2026-10-08 |
| Model choice | Default model per agent type (role), and an override per agent, both selectable in the UI. Can be changed while a book is being written. Applies from the next job | 2026-10-08 |
| Daily cap | 5 USD a day, next to the 40 USD a month | 2026-10-08 |
| Kindle email | You add the Kindle address and the sending email account yourself | 2026-10-08 |
| Images (MVP) | No picture books for now. Children's books are text too. Simple images drawn by code from data (HTML/SVG, no image model and no LLM drawing), only if easy | 2026-10-08 |
| Office look | Simple, effective pixel art, like AIOffice (christianfjung.com/aioffice) | 2026-10-08 |
| Web search | Search APIs, several supported: SerpApi, SERPHouse, DuckDuckGo, Brave, Tavily | 2026-10-08 |
| Covers (MVP) | An HTML template cover: title, author (the writer agent's name), genre, year. No images. Programmable | 2026-10-08 |
| Code | This repository: `C:\projects\Personal\scriptorium`, GitHub `Tihi321/scriptorium` | 2026-10-08 |
| Local models | 128 GB unified memory. You choose from the models already in LM Studio | 2026-10-08 |
| UI | 2D office, mainly for watching: who does what, how many, which role and connection, who asked whom, which book. Click an agent for its full terminal log. Few controls on screen (add, remove, pause, stop, model picker, Ask researcher), the rest in markdown config files | 2026-10-08 |
| Agent control | Everything about agents can be controlled (see Managing agents): the on-screen part is limited to the controls in the UI row, the rest is done in the agents' markdown files | 2026-10-08 |
| Research | Researcher works only on demand: at the start if the book needs it, when you ask manually, when a writer asks (before or during writing), or when a reviewer asks | 2026-10-08 |
| Deployment | Factory: Windows desktop app on this machine. **No public side for now.** Decide on that once the factory works and there are a few books | 2026-10-08 |
| Library | Inside the factory: a library room next to the factory floor. Click a book to read it, open its folder, or email it to Kindle. Calibre or similar only comes in with the public side | 2026-10-08 |
| Technology | Anything recommended, as long as it runs on Windows. Chosen: Electron + TypeScript + Phaser 3 + markdown files (see Technology) | 2026-10-08 |
| Picture books | Not now. Board and picture books wait for ComfyUI. The children's shelf is text-only read-aloud stories | 2026-10-08 |

## The idea, restated

A set of AI agents that works like a publishing house. Over time it fills a public library with books in every genre, including a children's shelf.

1. **Idea bucket.** You drop in ideas when you like. The factory also comes up with its own ideas to fill genres the library is missing. Since you won't be involved, generating ideas is a core feature, not an extra.
2. **Editorial staff as agents.** The roles a real publisher has: writers, editors, and checkers who review during and after writing and send work back for rewrites.
3. **Continuous production, no human gate.** The agents decide what is good enough to publish.
4. **Model providers.** DeepSeek API and LM Studio first, more APIs later.
5. **Library and reader.** For now inside the factory: browse the shelves, read a book in the app, open its folder, send the EPUB to Kindle. A public library comes later.
6. **Topics.** A big list of topics. You choose the active ones and see how many books each has.
7. **Ratings.** You rate some books, and the ratings feed back into how the factory works.
8. **Next milestone, after the MVP:** cover and illustration images from ComfyUI.

## What the answers change

### No human in the loop, so the quality gate is automated

Nobody approves a book before it goes public, so the reviewer agents are the gate. Each finished book gets scores (for example structure, prose, continuity, genre fit, age fit). It is only published if it passes a threshold. Otherwise it is rewritten or rejected. Rejected books are kept, out of public view, so the rejection reasons can be checked.

### Public readers (when the public side comes)

- **Label the books as AI-written**, in the library and in the EPUB metadata.
- **Originality.** Don't imitate living authors or use existing characters and worlds. A check agent compares each pitch and finished book against this rule.
- **Content rules per shelf.** A stated policy for what each shelf may contain, checked by an agent.

### Children's books are their own shelf with stricter rules

- **Age bands** with their own length and vocabulary targets: board books (0–3, about 50–300 words, repetition and rhyme), picture books (3–6, a few hundred to about 1,000 words), early readers, chapter books (6–9), middle grade (8–12, 30–50k words). Your daughter is almost 2, which is the board-book band. The text is tiny and cheap to generate, and almost all the quality comes from rhythm, rhyme and pictures.
- **Child-safety reviewer.** Must pass, no exceptions. It checks themes, fear level, language, and messages for the age band.
- **Read-aloud reviewer.** Checks how the text sounds read aloud: rhythm, sentence length, words that are hard to say. You read them to your daughter, so this matters.
- **Text only for now.** Picture books need illustrations, so they wait for ComfyUI. Until then, children's books are text: bedtime stories and chapter books that work read aloud. Simple images drawn by code can be added to them (see Simple images).

### Ratings drive the feedback loop

Every book records how it was made: which model did each role, prompt versions, rewrite counts, and reviewer scores. With your ratings next to that, you can see which models write best (DeepSeek or local) and whether the reviewer scores agree with your taste. That makes trying more APIs a measured comparison, not guesswork.

### The library: inside the factory for now

**No public side for now.** Once the factory works and there are a few books, we decide how to make them public (see Later).

Finished books live in the factory itself. The office has two areas: the **factory floor**, where the agents work, and the **library**, where finished books stand on shelves, one shelf per topic. A book appears on its shelf when it's published. Empty shelves show what's missing.

**Click a book** to open its card: cover, title, author (the writer agent), topic and genre, year, length, reviewer scores, cost, and your rating. From there:

| Action | What it does |
|---|---|
| Read | Opens an HTML preview of the book inside the app |
| Open folder | Opens the book's folder in Explorer (EPUB, cover, chapters, reviews, log) |
| Send to Kindle | Emails the EPUB to your Kindle address. Amazon's Send to Kindle accepts EPUB by email, but only from senders on the approved list in your Amazon account. You enter the Kindle address and the sending email account yourself, in the settings. The password is kept in Windows' credential store |
| Rate | 1–5 and a note, saved in the book's `book.md` |

The factory stays local because it needs LM Studio and later ComfyUI, which run on this machine, and because it holds the API keys and the budget controls.

## Parts

### Model layer

**Providers to support.** Most of these speak the **OpenAI-compatible API**, so one client covers them. The rest get small native adapters.

| Kind | Providers | How |
|---|---|---|
| Local | LM Studio, Ollama | OpenAI-compatible |
| Cloud, OpenAI-compatible | DeepSeek, OpenAI, Mistral, Moonshot (Kimi), Alibaba (Qwen), Zhipu (GLM) | OpenAI-compatible |
| Gateways | OpenRouter (one key, hundreds of models) | OpenAI-compatible |
| Cloud, own API | Anthropic (Claude), Google (Gemini) | Native adapter. Both also offer OpenAI-compatible endpoints, but the native APIs support more features |

**Provider registry.** Adding a provider means adding a config entry, not writing code. Each entry has: base URL, the name of the environment variable holding the API key (keys never go in the config file), available models, how many requests it may run at once, rate limits, and price per token for cost tracking.

**Choosing models: a default per role, an override per agent.**
- **Default per agent type.** Each role (writer, line editor, researcher, …) has a default model, set in `config/roles.md` and selectable in the UI. A new agent of that type starts with it.
- **Override per agent.** Any single agent can be switched to a different model in the UI (a model picker in the agent panel), for example one writer on DeepSeek and another on a local Qwen.
- **Changeable mid-book.** A change applies from the agent's next job, so it can be made while a book is being written. Each job records which model did it, so the scorecard and ratings stay accurate.
- The picker lists every model in the provider registry, including the LM Studio models found on this machine.

**Roles pick models from the registry.** Behind the default, each role has a list of models, not just one:
- **Fallback:** if a provider is down or rate-limited, use the next model in the list.
- **Spread:** share the work across several providers, which raises throughput and gives the ratings comparison more data.
- **Mixed model families for reviews:** a model reviewing its own writing tends to go easy on it. Have the reviewers use a different model family from the writer (for example a DeepSeek writer with a Claude or Gemini line editor).

**Speed.** APIs are much faster than local models. DeepSeek and others can do most of the heavy writing, and local models are free for checks or overnight work.

**Local models already on this machine** (LM Studio, checked 2026-10-08). The machine has 128 GB of unified memory. Windows sees 32 GB, which leaves about 96 GB for models. You choose which model does which role. The notes are only first guesses from size and type. None have been tested for book writing.

| Model (as LM Studio lists it) | Type | Size | First guess |
|---|---|---|---|
| `ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp` | 27B, dense (Qwen) | 11.2 GB | Writing or editing: a general model, small enough to keep loaded |
| `nail-qwen3.6-35b-a3b-mtp` | 35B MoE, about 3B active per token (Qwen) | 23.8 GB | Fast. High-volume work: summaries, bible updates, checks |
| `nvidia/nemotron-3-nano-4b` | 4B | 2.8 GB | Very fast. Simple jobs: pulling facts out of a chapter, sorting, yes/no checks |
| `poolside/laguna-s-2.1` | Large MoE (256 × 4.5B) | 71.2 GB | The biggest. Poolside mainly builds coding models, so its prose is unknown. Worth testing as a writer |
| `tiel-coder-35b-a3b-mtp` | 35B MoE, coding model | 23.7 GB | Made for code. Probably not useful for books |
| `text-embedding-nomic-embed-text-v1.5` | Embedding model | 84 MB | **Exactly what the RAG index needs.** Free and local |

- **Memory:** everything except Laguna fits in memory at the same time. Laguna fits together with the small models. Long contexts also use memory, so leave some headroom.
- **Model bake-off:** to make choosing easier, the factory can write the same test scene with each model (and with DeepSeek), and you pick the winner. This could be a small built-in tool.
- **Ollama:** its data folder exists, but Ollama isn't installed and has no models. It stays supported in the provider registry, for when it's installed.

### Parallel work

With API providers, many requests can run at the same time. The useful places:

1. **Several books at once.** Books don't depend on each other, so this is the easiest and biggest gain. Example: 5 books in progress, each on its own provider mix.
2. **Reviewers in parallel.** The continuity checker, line editor, child-safety reviewer and the rest all read the same finished chapter, so they can run at the same time. Their notes are then merged into one rewrite request.
3. **Idea generation and packaging** (blurbs, metadata, building the EPUB) run alongside writing.
4. **Chapters in parallel: not by default.** Each chapter depends on what happened in the one before. Writing them at the same time from the outline and then reconciling them is possible, but it hurts consistency. Maybe an option for short works later.

This needs a **job queue**: every step (draft chapter 3, review chapter 3, …) is a job. Workers take jobs as long as their provider has free capacity, within each provider's concurrency and rate limits. LM Studio on this machine counts as one provider with low concurrency, because all its requests share one GPU.

### Shared files: everything is markdown

Agents share information through **plain files on disk**, almost all of them markdown. The files are the single source of truth:
- Agents read and write them.
- The UI reads them to draw the office, the terminals and the library.
- You can open any of them in Zed or Double Commander to see, or change, what's going on.

**Rules:**
- **Structured fields** (status, role, model, book, dates) go in a short YAML header at the top of the file (frontmatter). The rest is normal markdown text.
- **No hidden state between agents.** A writer learns about research only by reading the research file, and a review is a file the writer reads. Anything an agent knows, you can read too.
- **Agents are files.** Each agent is one markdown file. Its header holds the role, model, focus and limits, and the body holds its instructions. Hiring in the UI writes a new file. Editing the file changes the agent from its next job.
- **Jobs are files.** Each job is one small markdown file in a folder for its state: `queued`, `running`, `done` or `failed`. Moving the file between folders is the status change. A move on the same drive is atomic on Windows, so two agents can't take the same job. After a restart, the factory simply reads the folders.
- **Logs are files.** Each agent and each book has a log file that grows as work happens. The terminal in the UI is a live view of that file.
- **One writer per file at a time.** Parallel work never edits the same file: each chapter and each review is its own file. Shared files, such as a book's bible, are only updated by one job at a time per book.
- **The only data that isn't markdown:** the EPUB and cover files, and the search index for RAG (SQLite with sqlite-vec). The index is only a cache built from the markdown files. Delete it and it rebuilds.

**Folder layout (proposal).** This is the data folder, separate from the code repository:

```
factory-data/
  config/
    providers.md          providers, models, prices, limits (API keys are NOT here)
    budget.md             caps; spend summary kept up to date by the engine
  agents/                 one file per agent: role, model, focus, limits + its instructions
    writer-mara-quill.md
    line-editor-otto.md
  topics.md               the big topic list: active or not, target, books done, in progress
  ideas/                  the idea bucket, one file per idea (yours or generated)
  research/               shared research notes, one file per subject
  templates/              cover templates (HTML)
  books/
    the-silver-inn/
      book.md             title, author, topic, target length, stage, scores, cost, your rating
      pitch.md
      outline.md
      bible/              characters/, places/, threads.md, timeline.md, style.md
      research/           notes for this book only
      chapters/           ch-01.md, ch-02.md, ...
      summaries/          ch-01.md, ..., act-1.md
      reviews/            ch-18-line-editor.md, ch-18-continuity.md, ...
      log.md              the book's terminal
      out/                the-silver-inn.epub, cover.html, cover.png
  jobs/
    queued/  running/  done/  failed/
  logs/
    agents/               one log per agent (the agent terminals)
    spend/2026-10.md      every paid request: time, agent, book, provider, tokens, cost
  index/                  search index (cache, rebuildable)
```

**Backups and git.** The data folder can be backed up by copying it. It could also be its own git repository, which would give a history of every rewrite for free. It's large and changes constantly, though, so it stays out of the GitHub code repository.

### Topics

The library should in time cover everything a library has, so the factory keeps **one big list of topics** to choose from.

- **The whole list, fiction and non-fiction:** BISAC, the standard subject list publishers and bookshops use, in full. Examples:
  - *Fiction:* Fantasy / Epic, Mystery & Detective / Cozy, Science Fiction / Space Opera.
  - *Non-fiction:* History, Science, Biography, Cooking, Travel, and many more, each with subtopics.
  - *Juvenile Fiction and Juvenile Nonfiction:* children's subjects such as Animals, Bedtime & Dreams and Friendship. The age band is added on top.

  That is several thousand topics in total. Only the ones you switch on get written.
- **You choose what gets written.** Every topic starts switched off. You switch on the ones you want, and the factory stays within those.
- **`topics.md`:** one row per topic, with columns for active (yes or no), target number of books, books done, and books in progress. Topics are grouped by section, so the file stays readable. You switch topics on by editing the file, or with a tick box in the UI.
- **Counts are kept by the engine.** When a book starts or is published, the counts update.
- **Choosing what to write.** The editor-in-chief only picks from active topics, emptiest first, so gaps get filled. Your own ideas from the bucket come first. An idea can name its topic, or the editor-in-chief assigns one.
- **In the UI:** the library shelves are the topics, so empty shelves stand out. A topic overview lists all topics with their counts, sorted with the emptiest first.

**Non-fiction works differently** from fiction, so it gets its own variant of the pipeline:
- **Research is required.** For fiction the researcher is on demand. For non-fiction every chapter is built on research notes with sources.
- **A fact base instead of a story bible:** the book's sources, key facts, terms and its argument or structure, in markdown like the rest.
- **The fact-checker must pass**, like the child-safety reviewer for children's books. A claim without a source is sent back.
- **Sources and references** go at the end of the book.
- **The AI-written label** matters even more here, once the books go public.
- **Same agents, different instructions:** writers and editors get non-fiction instructions (clear explanations, accuracy, structure) instead of story instructions.

### Budget and controls

**Spend counter.** Every API response reports how many tokens it used. The factory multiplies that by the provider's prices (from the provider registry) and records it. You see spending:
- in total, per day, and per month
- per provider and model
- per book (what each book cost)
- per role (for example how much goes to writing versus reviewing)

Local models (LM Studio, Ollama) cost no money. They are still counted in tokens and time, for the model comparison.

**Caps.** Spending limits, kept in `config/budget.md` and shown in the UI:
- a monthly cap, starting at **40 USD**, and a daily cap. My proposal for the daily cap is **5 USD**: a monthly average is about 1.30 USD a day, so 5 USD allows busy days but stops a bug or a runaway rewrite loop from spending the whole month in one afternoon
- optionally a per-book cap, so one book that keeps getting rewritten can't use up the month
- a warning at, for example, 80% of a cap

When a cap is reached, the factory stops starting new paid jobs. Requests already running finish, so no paid work is wasted. Jobs on local models can keep running.

**Stop controls.**
- **Pause all:** no new jobs start, and running ones finish. Resume continues exactly where it stopped, because every step is a job saved as a file.
- **Stop now:** cancels running requests too, for emergencies.
- **Per book and per agent:** pause or stop a single book or a single agent.

### The office (UI)

The factory's UI is a **2D office** where you see the agents at work, in the spirit of a small management game.

**The UI is mainly for watching.** You look at the office and click into agents. There are few controls on screen: adding and removing agents, and pause and stop. Everything else (models, prompts, limits) lives in config files to start with.

**What you can see at a glance:**

| Question | How the office shows it |
|---|---|
| What is each agent doing? | Animation plus a speech bubble with the task, for example "Writing ch. 18, scene 2" |
| How many are working, and on what? | A status bar at the top: working / waiting / idle counts, broken down by role and by provider. The whiteboard shows how many agents are on each book |
| What type is each agent? | The room it sits in, plus a role label under the character |
| Which connection does it use? | A badge with the provider and model, for example "DeepSeek · deepseek-chat" or "LM Studio · local". Desk colour matches the provider |
| Who asked whom for what? | **Lines between agents** while work is handed over: writer → researcher ("question: ship travel times 1600"), writer → line editor ("review ch. 18"), editor → writer ("rewrite: pacing notes"). The line carries a short label and fades when the handover is done |
| Which book and topic? | Every agent has a small tag with the book's title (and colour). Click a book on the whiteboard to highlight every agent working on it and dim the rest |

Hovering over an agent shows a tooltip: name, role, provider and model, book, current task, and how long it has been on it.

### The terminal (click an agent)

Clicking an agent opens its **terminal**: a full, live, scrollable log of everything the agent does, like watching a program run in a terminal window. Per job it shows:

1. **The request:** who asked (for example "editor-in-chief → you" or "writer Mara → you"), what for, and which book.
2. **What it was given:** which bible entries, research notes, summaries and passages went into the request, with the token count. The full request text can be expanded.
3. **The model's output**, streaming live as it's written.
4. **Tool calls:** for example `ask_researcher("…")`, and the answer when it comes back.
5. **The result:** passed on to whom ("→ line editor", "→ queue"), or the error.
6. **Numbers:** provider and model, tokens in and out, cost, time taken.

Older jobs stay in the scrollback, so you can scroll up through the agent's whole history. There is a search box and a filter (by book or job type), and you can copy text out. The terminal is read-only: it's for looking, not typing.

The same kind of log also exists **per book**: every job on that book in order, across all agents. This is the way to follow one book from idea to finished EPUB.

Built with xterm.js (the terminal component used in VS Code) for the real terminal look, or a simple monospaced log view. Either works.

**Layout:** rooms by department.
- **Idea room:** editor-in-chief and idea generator, with the idea bucket on the wall.
- **Writers' room:** writers at desks.
- **Editing desks:** developmental, line and copy editors.
- **Archive:** continuity checker, fact-checker and the book memory (bible, RAG).
- **Research library:** the researchers, on call. When a writer asks a question, the bubble travels from the writer's desk to the researcher, and the answer travels back.
- **Children's corner:** child-safety and read-aloud reviewers.
- **Print room:** the publisher, building EPUBs and covers.
- **Break room:** where idle agents go.
- **Library:** finished books on shelves, one shelf per topic (see The library).

**Agents as characters.** Each agent is a small character at a desk, with its state shown by animation:

| State | Shown as |
|---|---|
| Working (writing) | Typing, with a speech bubble for the current task, for example "Ch. 18, scene 2" |
| Reviewing | Reading pages |
| Waiting for a provider (rate limit, queue) | Clock or hourglass above the head |
| Waiting for research | Raised hand, or a question mark above the head |
| Idle | In the break room |
| Error | Red bubble |
| Paused | Sitting still and greyed out |

A badge or desk colour shows which model the agent runs on (DeepSeek, Claude, local, …).

**Hiring and firing.** "Hire" an agent: pick a role and a model or provider, and a new desk appears. More writers means more books in parallel. "Fire" one: it finishes its current job and leaves. The number of agents per role is how parallel work is controlled, within each provider's limits.

### Managing agents

An **agent** is a role plus a model plus its settings, sitting at a desk. It picks up **jobs** (draft scene, review chapter, …) from the queue.

**Kept small in the UI.** On screen there's only: add an agent, remove one, pause or stop one, pause all / stop now, the **model picker** (default per role and override per agent), and the "Ask researcher" box. Everything else below is done in **markdown files** at first (`config/providers.md`, and one file per agent in `agents/`) and picked up by the factory without a restart. The tables below are the full list of what's possible. Each action moves into the UI later only if it turns out to be used often.

**Staffing**

| Action | What it does |
|---|---|
| Hire | New agent: role, model, name and avatar, optional focus (genres, shelves) |
| Clone | Copy an agent's setup to hire another one just like it |
| Fire (gracefully) | Finishes the current job, then leaves |
| Fire now | Leaves immediately. Its job goes back to the queue |
| Move to another room | Drag the agent to a different room to change its role, for example a spare editor becomes a writer |

**Controlling work**

| Action | What it does |
|---|---|
| Pause / resume | Stops taking new jobs, and continues later |
| Stop current job | Cancels the request. The job goes back to the queue for any agent |
| Assign | Pin the agent to one book, a genre, or a shelf (for example "only children's books"), or leave it free to take any job |
| Priority | Which jobs it takes first: oldest book, shortest book, most-needed genre |
| Retry or skip | For a failed job: try again (optionally with another model) or skip it |

**Configuring**

| Action | What it does |
|---|---|
| Change model | Switch, for example, DeepSeek to Claude. Applies from the next job |
| Fallback list | Which models to try if its main one is down or rate-limited |
| Instructions | View and edit the agent's prompt. A writer can get its own voice ("spare, dark, short sentences"). Every edit is saved as a new version, so ratings can show whether a change helped |
| Own limits | A spending cap and a maximum number of parallel jobs for this agent |
| Shift | Working hours, for example local-model agents only overnight, or API agents only during set hours |

**Watching and judging**

| What | Shown |
|---|---|
| Live view | The text it's writing as it streams, and the request it was given (to debug bad output) |
| History | Every job it did: book, chapter, time, tokens, cost, result |
| Scorecard | Books worked on, how often its work passes review on the first try, average reviewer scores, and your ratings of the books it wrote. Use it to decide who to keep, re-instruct, or fire |
| Errors | Failed requests and why (rate limit, timeout, bad output) |

**Teams and automation (later)**
- **Team presets:** save a whole office setup and switch to it, for example a "night shift" on local models only or a "premium team" on Claude and Gemini.
- **Auto-staffing:** the editor-in-chief hires temporary agents when the queue backs up and lets them go when it's empty, within limits you set (maximum agents, budget). Off by default.
- **Notes on a book:** you can leave a note like "make the ending happier", which the editors pick up on their next pass. Optional, since the factory is meant to run without you.

**Books from the whiteboard.** Click a book to see its progress. You can also pause or cancel it, raise its priority, send it back to a stage (for example "re-outline"), or override the decision to publish or reject it.

**Also in the office:**
- a whiteboard with every book in progress and its stage (idea, outline, drafting, editing, published)
- a budget meter on the wall, showing spend against the cap
- a big red stop button

**Other pages** besides the office: idea bucket, library (with your ratings), book detail (pipeline progress, reviewer notes, rewrite history, cost), providers and models, budget.

**The look: simple pixel art, like AIOffice.** [AIOffice](https://www.christianfjung.com/aioffice) (Christian F. Jung, May 2026) is an open-source pixel-art office for AI coding agents. Each agent is a character at a desk, you walk up to one to see its terminal output, and idle or stuck agents are visible at a glance. That's very close to this idea. It's built with Phaser 3 and TypeScript, with a small Node (Express) server streaming agent output to the page over WebSockets.

- **Recommendation:** the same style. A top-down pixel-art office, small characters, a few animations per state (typing, reading, waiting, idle). It's simple to draw, reads well at a glance, and ready-made office tilesets and characters are easy to find.
- **Before building, read AIOffice's code.** If its licence allows, parts of it could be a starting point. At least its approach (Phaser scene, agent sprites, terminal panel) is a proven example.
- **How it's drawn:** **Phaser 3** inside the app window. Phaser is a full 2D game framework (tilemaps, sprites, animations, camera), which suits an office with characters better than a plain renderer like PixiJS. The engine sends live updates (agent states, streaming text, spend) to the UI as events.
- Later, ComfyUI could generate a custom look.

### Technology

**The factory is a Windows desktop app.** The office is a 2D game-like view, and web technology is by far the easiest way to draw that. So the factory is a desktop app with a web UI inside it. You left the technology open as long as it runs on Windows, so this is the recommended stack:

| Part | Choice | Why |
|---|---|---|
| App shell | **Electron** | A normal Windows app (installer, window, tray icon) with a web UI inside. Everything is TypeScript. |
| Engine (agents, job queue, providers, book memory) | **TypeScript (Node)**, in a separate background process from the UI | One language for the whole app. Calling the OpenAI-compatible APIs, Claude and Gemini is easy from Node, and embeddings come from LM Studio over its API anyway |
| UI | **Phaser 3** for the office, plus plain HTML panels (or React/Svelte) for the terminal, book cards and lists | Same approach as AIOffice |
| Data | **Markdown files** in the data folder (see Shared files). SQLite + sqlite-vec only as the search index for RAG, rebuildable from the files | Readable and editable by you, by agents and by the UI. No database server |
| EPUB | Generated by the engine into the book's `out/` folder, then shown in the library room | |
| Covers | HTML template filled in by the engine, captured to PNG by Electron itself | No extra tools needed |
| Code | This repository (`Tihi321/scriptorium`) | |

**Considered and not chosen:** Tauri (a smaller app shell) with a Python engine beside it. Python has more AI and EPUB libraries, but that means two languages and harder packaging. **No agent framework** (LangGraph, CrewAI): the pipeline is a fixed sequence with rewrite loops, and parallel work across providers is easier to control in plain code.

**Keep the engine separate from the UI.** The engine runs on its own and the UI only shows it and sends commands. Advantages:
- **Closing the window doesn't stop work.** The factory keeps going from the tray, for example overnight.
- **Restarting is safe.** Every step is a saved job, so after a crash, reboot or update, it carries on where it left off.
- **It can move later.** The engine could run headless on a home server, with the same UI connecting to it. Not needed now, but it costs nothing to keep this possible.

**Windows details:**
- **Stop Windows from sleeping** while jobs are running (and allow sleep when idle), so overnight runs aren't cut off.
- **API keys** are stored with Windows' own credential protection, not in a plain config file.
- **Optional:** start with Windows, minimised to the tray.

### Staff (agent roles)

| Role | Job |
|---|---|
| Editor-in-chief | Picks the next book: from your idea bucket first, otherwise its own idea for the genre or age band the library needs most |
| Idea generator | Fills the bucket with pitches when it runs low |
| Architect / outliner | Premise, then synopsis, then chapter outline. Writes the **story bible** (characters, world, rules, timeline) |
| Writer | Drafts one chapter or scene at a time from the outline, the bible, and summaries of earlier chapters |
| Continuity checker | Checks each chapter against the bible: names, timeline, facts, who knows what |
| Researcher *(on demand)* | Looks up real-world facts, only when asked: by the architect at the start if the book needs it, by you, by a writer before or during writing, or by a reviewer. Writes research notes with sources into the book memory |
| Fact-checker | Checks the real-world claims in a finished chapter against the research notes. Asks the researcher when something isn't covered |
| Developmental editor | Structure, pacing, stakes, character arcs. Works per act and on the whole book |
| Line editor | Prose quality, voice, repetition, clichés, "AI-isms" |
| Copy editor / proofreader | Grammar and consistency of style |
| Genre reader (beta reader) | Reads as a fan of the genre: is it satisfying, does it deliver what the genre promises |
| Originality and content checker | No imitation of real authors or existing works. Content fits the shelf policy |
| Child-safety reviewer *(children's shelf)* | Age fit, must pass |
| Read-aloud reviewer *(children's shelf)* | How the text sounds read aloud |
| Publisher | Final scores against the threshold, then publish or reject. Title, blurb, metadata, EPUB build, adding the book to the library |
| *(later)* Art director | Prompts ComfyUI for the cover and illustrations |

Each review step can **pass** or **send back with notes** (rewrite). It needs a limit on rewrite rounds. A book that is still failing after the limit is rejected, not published.

### Pipeline (one book)

```
idea → pitch → (research, if needed) → outline + story bible
     → [per chapter: draft (⇄ researcher on demand) → continuity + fact check → rewrite?]
     → per act: developmental edit → rewrite?
     → full book: dev edit → line edit → copy edit → beta read → originality/content (+ child safety, read-aloud)
     → score ≥ threshold? → publish (EPUB + cover, onto its library shelf) : reject
```

Short works (picture books, short stories) skip the per-act steps.

### Research (on demand)

Books need real-world facts even when they're fiction: how a 17th-century sailing ship was crewed, how a police interrogation actually works, what a nurse does on a night shift, how fast a horse can travel in a day, what a hedgehog eats (for a children's book). Models make these up confidently, so the factory gets a **researcher**.

**Only on demand.** The researcher is not a fixed step that runs for every book. It works only when someone asks it something. If nobody asks, it sits idle in the research library and costs nothing. Who can ask:

1. **At the start, if the book needs it.** After the pitch, the architect decides whether the book needs facts before it can be outlined (period, places, professions, science or technology, culture). If yes, it sends the researcher a list of questions, and the outline is built on the answers. If not (most bedtime stories, a lot of fantasy), no research happens. Genre is a guide: historical fiction and thrillers usually need it, fantasy sometimes (for plausibility: travel, weapons, medicine, farming), bedtime stories rarely.
2. **You, manually.** A small **"Ask researcher"** box in the UI, one of the few controls on screen. A question can be tied to a book or idea (the answer goes into that book's notes and its writer and editors get it), or be general (the answer goes into the shared library notes for any future book). Example: "Research Victorian London street life, for a future mystery."
3. **A writer, before starting a chapter or scene.** When the writer reads its outline for the next scene and sees something it doesn't know enough about.
4. **A writer, in the middle of writing.** When it hits a question mid-scene, for example: "How long did Lisbon to Goa take by ship in 1600?" Two ways to handle it:
   - **Wait:** the scene job waits for the answer, and the writer takes another job (another book) in the meantime. Nobody sits idle.
   - **Mark and keep going:** the writer marks the spot and writes on. The researcher answers in parallel, and the line is fixed in the next pass. This is better for small details.
5. **A reviewer.** An editor or the fact-checker asks when a claim looks wrong and the notes don't cover it.

Every request shows in the office as a line from whoever asked (or from "you") to the researcher, and in the researcher's terminal with who asked and why.

**How agents ask:** through tool calling (the model calls an `ask_researcher` tool). Most API models do this well. For local models that don't, the writer puts a marker in the text, such as `[RESEARCH: …]`, and the engine picks it up.

**Where answers come from:**
- **Web search through APIs.** Several are supported, each as an entry in `config/providers.md` with its key, limits and price:

  | Service | Notes |
  |---|---|
  | **Tavily** | Built for AI agents. Returns the cleaned page text along with the results, so fewer extra page fetches are needed |
  | **Brave Search** | Its own independent index, with an official API |
  | **SerpApi** | Returns Google (and other engines') results as structured data |
  | **SERPHouse** | Also returns Google and Bing results as structured data |
  | **DuckDuckGo** | No official full web search API. The official Instant Answer API only gives short answers (definitions, Wikipedia summaries). Full results need unofficial libraries that can break or get blocked. Good as a free extra, not as the main source |

  The researcher uses them in an order you set (for example Tavily first, Brave if it fails or runs out), just like the model fallback list. The spend counter tracks the cost of each service. Self-hosted SearXNG is a free option for later.
- **Wikipedia's API**: free, and good for the basics.
- **Built-in search** of some providers (Claude, Gemini and OpenAI can search the web themselves), when the researcher runs on one of them.
- **The model's own knowledge** as a last resort, marked as *unverified*. The fact-checker treats it with suspicion.

**Research notes** go into the book memory as their own layer: markdown files of short facts in the researcher's own words, each with its source and date, indexed for RAG. Notes for one book go in `books/<book>/research/`, and shared notes in `research/`. The writer then gets the relevant facts automatically with each scene, without having to ask again.

**Shared across the library.** Research is saved for the whole library, not only for one book. A later book set at sea reuses the sailing research instead of paying for it again. The researcher checks the shared notes first and only searches when they don't cover the question.

**Safety and rules:**
- **Web pages are untrusted.** A page can contain text trying to give the model instructions. The researcher can only search, read and write notes. It has no other tools and can't change anything else. Its notes are data for the writer, never instructions.
- **No copying.** Notes are summaries of facts in its own words, never passages copied from web pages into a book. The originality checker covers this too.
- **Children's books:** facts must be right (animals, nature, safety), and the child-safety reviewer checks that the research didn't bring in anything unsuitable.

**Cost:** research has its own line in the spend counter (model tokens plus search API calls) and a per-book limit on the number of research questions, so a curious writer can't run up the bill.

### The hard problem: keeping a long book coherent

A long novel (96–150k words, about 128–200k tokens) doesn't fit well in a model's working context, especially a local one. Some cloud models accept very long contexts, but sending the whole book with every request is slow and expensive. Models also miss details in the middle of very long inputs. So the writer never gets the whole manuscript. Instead each request is built from the book's memory: only what that chapter needs.

### Book memory: five layers

RAG helps, but as one layer next to the bible and summaries, not as a replacement for them. Each layer answers a different question:

| Layer | What it holds | What it answers | Why the other layers can't |
|---|---|---|---|
| **Outline** | The plan for every chapter | Where is the story going? | — |
| **Story bible** (structured) | One entry per character, place, object, rule, timeline event, and **open thread** (a setup that still needs a payoff) | What is true right now? | RAG returns old text. If a character changed sides in chapter 12, a chapter 3 passage is out of date |
| **Summaries** (by chapter and by act) | Short version of everything so far | What has happened overall? | RAG returns fragments and doesn't tell the story so far |
| **RAG over the full text** | Every finished chapter, cut into passages and indexed | What exactly was written? Wording, details, scenes | The bible and summaries lose detail: the inn's name, eye colour, what someone promised word for word, how a place was described |
| **Research notes** (shared by the whole library) | Real-world facts with sources, from the researcher | How does it work in the real world? | The other layers only know the story, not the real world |

The last chapter or two still go in **in full**, so voice and flow carry on.

**How a writer request is built (example, chapter 18):**
1. Read the outline for chapter 18 and list the characters, places and threads it involves.
2. Get their **bible entries** (current state), plus the **research notes** for the chapter's topics.
3. Use **RAG** to find the most relevant earlier passages: their last scenes together, the first description of the place, the setup this chapter pays off.
4. Add the **summaries** and the **last chapter in full**.
5. Result: a small, focused context (for example 15–25k tokens) instead of the whole book. It is cheaper, faster, works with local models, and usually gives better quality.

**Other uses of RAG:**
- **Continuity checker:** pulls the claims out of a new chapter ("Mara has never been to the coast") and checks each one against retrieved passages and the bible.
- **Series and shared worlds:** an index across several books keeps sequels consistent.
- **The whole library:** check new pitches and finished books against everything already written, so the factory doesn't keep producing the same plots, names and openings. A fully automated factory will repeat itself without this check.

**Details that matter:**
- **Search by meaning and by keyword together** (hybrid search). Meaning-based search alone handles names poorly, and fiction is full of names. A keyword search catches "Mara" and "the Silver Inn" exactly.
- **Embeddings run locally and free.** LM Studio already has `nomic-embed-text-v1.5`, so indexing costs nothing even when writing uses cloud APIs.
- **Storage stays simple:** the bible, summaries, chapters and research are all markdown files. The search index is one SQLite file with sqlite-vec, built from those files and rebuildable at any time.
- **Weakness:** RAG only finds what it's asked for. It can't notice that something is missing, such as a thread that was never resolved. That's what the open threads in the bible are for. An end-of-book check confirms every one is closed.
- **Update after every chapter:** the chapter is indexed for RAG, bible entries are updated (by an agent pulling out new facts), and a summary is written. This runs in parallel with the reviews.

Short works (children's stories, short stories) fit fully in context and don't need this. It becomes necessary at novella length and above.

### Long books (96–150k words)

The target goes up to 96–150k words (about 128–200k tokens). At that length the book memory above is required, and a few more things are needed:

- **Write scene by scene, not chapter by chapter.** A 150k-word book is about 3–4 acts, 40–50 chapters, and 100–150 scenes of 1–1.5k words. Models write best in stretches of that size. Asked for much more, they rush, summarise, or wrap the story up early, and many APIs limit how much text one request can return.
- **Put extra effort into the outline.** Before any chapter is written, the developmental editor reviews the outline: is the middle strong enough, does tension keep rising, does every subplot pay off. Fixing a structural problem in the outline costs a few thousand tokens, while fixing it in a finished draft costs a rewrite of many chapters.
- **Whole-book reviews read one act at a time.** Most models can't take 200k tokens of manuscript in one request, and those that can miss details. The developmental editor and beta reader each read one act at a time, together with summaries of the other acts, the outline, and the bible.
- **Problems that only show up in long books, and their checks:**
  - *Sagging middle:* the outline review above, plus a tension score per chapter to spot flat stretches.
  - *Repeated phrases and tics* over 150k words (the same gestures, metaphors, sentence openings): a plain counting script over the whole book. It needs no model, so it's free and fast. Findings go to the line editor.
  - *Character voice drifting:* each character's bible entry has a voice sheet (how they talk, a few sample lines) for the writer and a voice check.
  - *Too many subplots:* the open-threads list in the bible, with a limit, and a check that each thread closes.
- **Length depends on genre.** The editor-in-chief sets a target length for each book: romance and thrillers usually shorter, epic fantasy and sci-fi at the top of the range. So the library gets a natural mix.

### Simple images (drawn by code, no image model)

Until ComfyUI arrives, books can still get simple pictures drawn by **code from data**: HTML and SVG templates filled in from the book's markdown files. No image model, and no LLM doing the drawing. The agents only provide the data they already write anyway (tags, names, places). This is easy, so it can go in the MVP, simplest first:

| Image | Drawn from | Effort |
|---|---|---|
| **Cover pattern** | A pattern (stripes, waves, dots, geometric shapes) generated from the book's title, so every book gets its own, always the same for the same title. Colours come from the genre | Easy |
| **Chapter ornaments** | A divider or ornament at the start of each chapter, in the genre's style | Easy |
| **Topic icons** | One icon per book or chapter from a free icon set, chosen by tags the writer already adds ("moon", "ship", "forest", "cat"). Good for children's books: a big friendly icon per chapter | Easy |
| **Character cards** | One card per character from the bible: name, a monogram avatar in that character's colour, and a few traits | Easy to medium |
| **Relationship diagram** | Who is related to whom, from the bible | Medium |
| **Timeline** | The book's events in order, from the bible's timeline | Medium |
| **Story map** | Places from the bible as a simple schematic map | Harder. Later |

- **Icon licences:** Lucide (ISC licence) and Tabler Icons (MIT) are free to use. game-icons.net has thousands of fantasy-style icons under CC BY 3.0, which requires credit.
- **The same images appear in the EPUB and the in-app preview.** Electron renders the HTML or SVG and saves it as PNG for the EPUB, the same way as the covers.
- **Where:** templates in `templates/`, and the finished images in the book's `out/` folder.

## Rough numbers (estimates, to measure once it runs)

For one 150k-word book:
- **Text written:** about 200k tokens for the draft. With rewrites and review notes, roughly 0.4–0.6M tokens of output.
- **Text read:** each of the ~120 scenes is written from about 20k tokens of context. Each chapter is read by several reviewers, then by the memory updates and the act-level reviews. In total roughly **5–10M tokens of input**. Most of the work is reading, not writing.
- **Cost control:** put the parts that don't change (instructions, bible, outline) at the start of each request. Providers with prompt caching, DeepSeek among them, then charge much less for that repeated part. Check current prices once the real token counts are measured.
- **Time:** through APIs, with several books in parallel, a book should take hours. Locally on LM Studio or Ollama, a long book probably takes one to a few days, which is fine for overnight runs.
- **Short works** (children's stories, short stories) are a tiny fraction of that.
- **Monthly cap of 40 USD:** how many books this covers depends on the providers' current prices and the measured token counts. The spend counter will show the real cost per book after the first few. Local models add volume at no cost.
- This machine has a Ryzen AI Max+ 395 with 128 GB of unified memory, so about 96 GB is left for models (see Model layer).

## Milestones (for when implementation starts)

### MVP: text only

Build order inside the MVP: get one short book through the whole pipeline, then novellas, then long books.

1. Idea bucket, idea generator, and an editor-in-chief that picks the next book and its target length, from active topics, emptiest first.
2. Provider registry with a few providers from the start (for example DeepSeek, OpenRouter, Anthropic or Gemini, LM Studio), chosen per role with fallback. Local models chosen by you from the LM Studio list.
3. Job queue running several books and the reviewers in parallel. Everything shared through markdown files in the data folder.
4. Pipeline for **all lengths, up to 150k words**, including the book memory (bible, summaries, RAG) that long books need.
5. Reviewers with the score threshold, including the long-book checks above.
6. Children's shelf: **text-only stories that work read aloud** (bedtime stories, chapter books). Board books and picture books wait for milestone 2, because they need pictures.
7. Output: EPUB with full metadata, plus a **template cover**. An HTML template is filled in with the title, author (the writer agent's name), genre and year, styled by genre (colours, fonts), and captured to PNG for the EPUB. No images. Templates are plain HTML in `templates/`, so changing the look means editing a file.
8. Library room: shelves per topic, book cards, read in the app, open folder, Send to Kindle, ratings (1–5 and a note).
9. Budget: spend counter, caps (40 USD a month to start, plus a daily cap), pause all and stop now.
10. Windows app with the office view, mainly for watching. Simple art is enough at first, but with live agent states, the status bar with counts, role and provider badges, book tags, lines showing who asked whom, the whiteboard, and the budget meter.
11. The terminal: click an agent for its full live log (requests, context, streamed output, tool calls, results, tokens and cost), plus the same log per book.
12. Controls in the UI: add and remove agents, pause and stop (per agent and for everything). Everything else in config files. Later in the UI, if needed: assigning, changing models, editing prompts, shifts, team presets, auto-staffing, scorecards.
13. Researcher, on demand only: questions from the architect at the start (if needed), from you through the "Ask researcher" box, from writers before or during writing, and from reviewers, using one web search API plus Wikipedia, with research notes in the book memory, shared across the library. Later: the fact-checker as a full reviewer, and more search sources.
14. Topics: the full BISAC list (fiction and non-fiction) in `topics.md`, active topics chosen by you, book counts per topic, and empty topics visible in the UI. The non-fiction pipeline variant (required research, fact base, fact-checker must pass, references).
15. Model picker in the UI: a default per role, an override per agent, changeable mid-book.
16. *If easy:* simple images drawn by code from data (see Simple images), starting with the generated cover pattern and chapter ornaments.

### Milestone 2: images with ComfyUI

Not in the MVP, but the MVP should be built so images can be added without restructuring:

- **Leave places for images.** The book format has a cover slot and illustration slots from the start. In the MVP, the publisher already writes a **cover brief**, and **illustration briefs** for children's books (what each picture shows). These are cheap text. Milestone 2 then only has to render them.
- **How ComfyUI is called.** Its API takes a saved workflow (JSON) plus the prompt, runs it, and returns the image. Each kind of image (cover, children's illustration) gets its own workflow, chosen in config the same way models are.
- **Covers first**, for every book. Then children's illustrations, which open up board books and picture books.
- **The hard part:** keeping a character looking the same on every page of a picture book. This needs a reference image per character, plus IP-Adapter or a small LoRA trained per character.
- **Image reviewer:** a vision model checks that each picture matches its text and suits the age band.
- **To check:** how well ComfyUI runs on this AMD GPU under Windows.

### Later

The public side, once the factory works and there are a few books. Options then: Calibre with Calibre-Web, or Kavita, made reachable from the internet, or a custom static library site on cheap hosting. The public-reader rules (AI-written label, originality, content rules) apply from then. Also: series and shared worlds, more providers, nicer office art, ACP.

## Open questions

None blocking. Everything needed for a plan is decided. Smaller choices that can be made during implementation:

1. **Search order.** Which search API the researcher tries first (my proposal: Tavily, then Brave, then the others). It's a config setting, so it's easy to change.
2. **Starting models.** The defaults per role on first start (my proposal: DeepSeek for writing and editing, the fast local Qwen MoE for summaries and checks, nomic for the index). You change them in the model picker.
3. **AIOffice licence.** Check whether its code can be reused, or only used as an example.

**Next step:** turn this into an implementation plan for the MVP in this repository (`.claude/tickets/scriptorium-mvp/plan.md`).

## History

- 2026-10-07: Idea written down. First breakdown and open questions added.
- 2026-10-07: Answers added: DeepSeek and LM Studio from the start, public and children's audience, fully automated, ACP postponed. Added the automated quality gate, children's shelf rules, ratings feedback, a static public site, and a suggested first version.
- 2026-10-07: English only, many API providers (provider registry, fallback, mixed model families for reviews), parallel work via a job queue, board-book age band. Implementation postponed, this stays an idea for now.
- 2026-10-07: Trimmed the provider list (local: LM Studio and Ollama; cloud: dropped Grok, Groq, Together, Fireworks). Added book memory in four layers: outline, structured bible, summaries, and RAG over the full text, plus library-wide RAG to avoid repeating plots.
- 2026-10-07: Long books up to 96–150k words: scene-by-scene writing, outline review, act-by-act whole-book reviews, long-book checks. Corrected the token estimate (reading dominates: 5–10M input tokens per long book). Replaced "first version" with milestones: text-only MVP covering all lengths, then ComfyUI as milestone 2, with image slots and briefs planned in the MVP.
- 2026-10-07: Added budget and controls (spend counter, caps, pause and stop), the 2D office UI (agents as characters, hiring and firing), and the split between factory and library: the factory is a local Windows app, and only a static library site goes on the web. Technology proposal: Electron + TypeScript + PixiJS + SQLite, with the engine kept separate from the UI.
- 2026-10-07: Serving books: for now Calibre or something similar (Calibre content server, Calibre-Web, Kavita). The factory adds EPUBs with `calibredb`. The custom static site moved to Later.
- 2026-10-07: Technology left to the recommendation (must run on Windows): Electron + TypeScript + PixiJS + SQLite, with no agent framework. Removed the leftover mentions of the static site from the pipeline and roles.
- 2026-10-07: Added Managing agents: staffing (hire, clone, fire, move between rooms), controlling work (pause, stop job, assign, priority, retry), configuring (model, fallback, instructions with versions, own limits, shifts), watching (live view, history, scorecard, errors), a list view, and later team presets and auto-staffing. Split the agent actions between the MVP and later.
- 2026-10-08: Added the on-demand researcher and a fact-checker: a research brief at the start of a book, questions from writers and editors while they work (wait, or mark and keep going), web search, Wikipedia and built-in provider search as sources, research notes as a fifth memory layer shared across the library, safety rules for untrusted web pages, and a per-book research limit. Added the research library room and the "waiting for research" state.
- 2026-10-08: The UI is mainly for watching: added what the office shows at a glance (status bar with counts, role and provider badges, book tags, lines for who asked whom), the read-only terminal per agent and per book, and kept on-screen controls to add, remove, pause and stop, with everything else in config files. Renumbered the MVP list.
- 2026-10-08: Researcher is on demand only, never a fixed step: the architect at the start (only if the book needs it), you through an "Ask researcher" box (for a book or for the shared library), writers before or during a scene, and reviewers.
- 2026-10-08: Agents share everything through markdown files on disk (data-folder layout, agents and jobs as files, SQLite only as a rebuildable search index). Monthly cap 40 USD, with a proposed 5 USD daily cap. Office look like AIOffice (pixel art, Phaser 3). No public side for now: a library room inside the factory with Read, Open folder, Send to Kindle and Rate. Web search through an API (Tavily proposed). Big topic list (BISAC) with active topics and book counts. Listed the LM Studio models on this machine (128 GB unified memory, about 96 GB for models). Template HTML covers. Code in `C:\projects\Personal` with a GitHub repository. New open questions: name, non-fiction, models per role, daily cap, search API, Kindle email.
- 2026-10-08: Named the project **Scriptorium** (`C:\projects\Personal\Scriptorium`). Topics: the full BISAC list, fiction and non-fiction, with you choosing what gets written, plus a non-fiction pipeline variant. Model picker: a default per role and an override per agent, changeable mid-book. Daily cap 5 USD confirmed. Search APIs: SerpApi, SERPHouse, DuckDuckGo (with its API limits noted), Brave, Tavily, in a configurable order. Kindle address and sending email entered by you. No picture books for now. Added simple images drawn by code from data (cover pattern, chapter ornaments, icons, character cards, diagrams). No blocking open questions left.
- 2026-10-08: Moved from `C:\projects\Cowork\Computer\ideas\book-factory.md` into this repository as `docs/design.md`. Updated the status, code location and the UI and agent-control rows, which overlapped.

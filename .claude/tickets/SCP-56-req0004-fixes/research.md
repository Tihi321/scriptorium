# SCP-56 research: fixes from the REQ-0004 run

Request REQ-0005, piece P1. Read-only research, 2026-11-09. Evidence comes from the live data folder `C:/Users/Infplane/Scriptorium`
(books `what-fate-decides-luck-will-and-the-life` and `the-tide-table`) and from the code on `master` (0fa42ff).
Baseline: `yarn vitest run` gives 58 files and 728 tests, all passing.

## 1. Philosophy topics for idea-blink

- The seed (`seed/topics.md:478-488`, section `## Philosophy & Religion`) already has `phil-stoicism` (Stoicism) and
  `phil-everyday-philosophy`. The live `topics.md` has the same rows. `phil-everyday-philosophy` shows `done 1`, which is the
  What Fate Decides book.
- There is no row for fate and free will, or for luck and moral luck. `phil-stoicism` covers Stoicism. Amor fati is Nietzsche,
  but it is the Stoic theme the idea-blink guidance names, so the Stoicism row is enough for it.
- A topic is picked by `kind`. The format comes from the editor-in-chief among the formats whose `kinds` include `nonfiction`, and
  `idea-blink` already does (`seed/config/formats.md`, Decisions row "Ideas explainer format"). Nothing in code ties a topic to a format.
- Migration: `topics.md` is copied from the seed only when it is missing. The section migrations (`migrateNewspaper`,
  `migrateScreenplay`, `src/engine/store/migrations.ts:89-137` and `194-222`) add whole sections. They don't add single rows.
  The idea-blink decision already set "no migration, add by hand" for `formats.md`, and the Topics panel's "Add a topic" covers
  the rest. **Recommendation: no migration.** Add two seed rows only. If the user wants them, the live folder can get the two
  rows by hand. That is outside the repo, so the director should ask first.
- `seed/topics.md` is not under `seed/prompts` or `seed/templates`, so `yarn seed:hashes` is not needed.

## 2. Humanizer name check rejects "Greeks", and the refusal is silent

- Evidence: in the What Fate book `log.md:2153`, the log says `humanizer: chapter 1 kept as it was: it brought in a name that is not in the
  chapter or the bible (Greeks)`. The original chapter has "the Greek Fates", and the revision ends "We begin with the Greeks". The
  director had to fix ch01 by hand (`.claude/tickets/REQ-0004-destiny-series/config-revert.md:38`).
- Root cause: `newNames` (`src/engine/pipeline/humanizerHandlers.ts:122-137`) compares `nameKey(w)`
  (`:114`). That function lower-cases the word and strips only a possessive `'s`. So `greeks` is checked against the known words
  `greek`, `the`, ... and is reported as new. Plurals, singulars of known plurals and group nouns ("Stoics", "Romans",
  "Christians") are all reported the same way.
- Silent refusal: the handler writes the refusal only to the job log (`ctx.log`, `humanizerHandlers.ts:321`), which is the book's
  `log.md` block. Nothing reaches the engine log (`PipelineDeps.log`, the `[engine]` stdout line, wired at `src/engine/engine.ts:205`).
  The job result says `kept as it was (...)`, but the operator only sees it by opening the book log.
- Tests to extend: `tests/humanizerGuards.test.ts:72-82` ("units are not names", already table-like). There is also
  `tests/humanizer.test.ts:343-353` (a refused pass in a pipeline). `makePipelineEnv` collects the engine log in `env.logs`
  (`tests/helpers.ts` around line 298-304).

## 3. The fact checker sees only the extracted facts

- `fact_check` (`src/engine/pipeline/nonfiction.ts:178-260`) gives the model the fact base digest and `factCheckNotes(...)`
  (`:80-86`). That is `numberedNotes` and therefore `formatNote` at 1,800 characters per note, cut to `min(30000, roomChars)` (`:235-236`).
- The researcher reads up to three pages per question (`researchHandlers.ts:172-193`, up to 5,000 characters each), but the note
  keeps only the extracted facts. It also keeps at most four sentences of missing figures (SCP-14, `notes.ts:142-170`). The page text
  is never written to disk, so no later stage can see it. The 30-minute search cache in `SearchService` is in memory only.
- Evidence: the What Fate fact check r0 (`reviews/book-fact-checker-r0.md`) flagged four ch06 claims because "Source [21] defines moral
  luck but does not mention the two drivers example". The Moral_luck page had been read, but nothing was extracted from it (item 5),
  so the fact checker had no way to check against the page.
- Root cause: the excerpts are not persisted. The fix has to store a bounded copy of the page excerpts in the note (markdown, as
  the shared-files rule requires) and show that copy to the fact checker only. The writer's context is already tight (`NOTE_CHARS` 1,800).
- The prompt does not need to change: the excerpts go into the existing `{{notes}}` variable after the notes, under their own
  label. So no `seed/prompts` change and no `seed:hashes`.

## 4. Same-URL search results collapse; task correlation

- **Dedupe found:** `parseSearchAnswer` (`src/engine/research/clientSearch.ts:64-86`) has `seen.has(url)` at `:71`. A second
  result with the same URL is dropped, even when its `content` is a different excerpt. A client that sends three excerpts of
  `wikipedia.org/wiki/Moral_luck` as three results gives the researcher only the first one. In the What Fate log `:130-133`, page 1
  Moral_luck is 142 tokens.
- **Second dedupe:** `gatherPages` (`src/engine/pipeline/researchHandlers.ts:172-193`) skips any URL in `seenUrls`
  (`:180`, added at `:191`). That set is shared by every query of one question. A later query whose result is the same page with a
  *different* excerpt (client search answers per query) is skipped. When every result was already read, `gatherPages` returns null
  and the caller logs `no search provider gave results for "<query>"` (`:150`). That is false: the provider did answer.
- **Correlation: not a bug in the engine.** Each client search is its own task. The job id is `search-<Date.now base36>-<module seq>`
  (`clientSearch.ts:106`) and the task id is `<job>#<call>` (`src/engine/models/client.ts:112-135`). `lease` hands out one task.
  `submit(id, text)` resolves exactly the `done` promise of that id (`client.ts:183-198`). The `SearchService` cache key is
  `[query, news, days, limit]` (`service.ts`, `search()`). No path moves an answer to another task. The suspicion comes from the What
  Fate log `:144-156`. The query "Moral luck" listed Thomas_Nagel and Bernard_Williams, because Moral_luck itself had been read already
  and was skipped. The query "Thomas Nagel" then logged "no search provider gave results", because all of its results were already
  read. Both come from the `seenUrls` skip and the misleading log line, not from a mix-up of tasks. A client that submits query B's
  answer under task A's id can't be detected by the engine. That would be a client error, and nothing in the logs shows it happened.
- Tests: `tests/clientsearch.test.ts:29-52` covers parsing through the queue.

## 5. Researcher extraction is lossy

- Evidence: the What Fate log `:125-162` (job `research--...--3fd96675d2`). Gemini (`acp/antigravity/gemini-3.8-flash`) answered
  `{"facts": []}` for the correct Moral_luck page. It did the same for the "Moral luck" query (pages Thomas_Nagel and Bernard_Williams).
  The job then fell to `from_knowledge`, and the note `what-did-thomas-nagel-argue-in-his-1976-essay-moral-luck.md` is **unverified**.
  That is why fact check r0 says "Nagel's categories appear only in unverified research notes".
- Code: `factsFrom` (`researchHandlers.ts:195-250`) returns `{facts: [], excerpts: []}` at `:217` when nothing was kept. The loop
  (`:140-170`) tries new search words once, then `from_knowledge` (`:252-264`) writes an unverified note. Page text that was read
  successfully is thrown away.
- Existing machinery: SCP-14 excerpts (`NoteExcerpt`, `ResearchStore.write({excerpts})`, `EXCERPTS_HEADING`, `notes.ts:142-183`) are
  lines like `- "<text>" (source: <url>, <date>)`. The writer sees them through `formatNote`, which keeps them inside its cap. The fact
  base takes them as facts through `candidateFacts` (`nfcontext.ts:77-89`, which matches `- ... (source: url, date)`). They are capped
  at 4 lines of 300 characters (`notes.ts:147`).
- Gap: `ResearchStore.write` computes `sources` from the facts only (`notes.ts:145`). A note with excerpts and no facts would have no
  sources, so `unmergedNotes` and `syncSources` would ignore it. The fallback therefore also needs the excerpt URLs in `sources`.
- Side observation (not planned): `keep()` drops a fact whose `source` number is missing (`:198-205`). With one page, it could mean
  page 1. The real failure here was an empty list, so this is not part of the fix.

## 6. Publisher keywords are not enforced

- Evidence: What Fate `book.md:58-68` has 10 keywords and The Tide Table `book.md:52-63` has 11. The prompts ask for "four to
  eight" (`seed/prompts/publisher/publish.md:23`, `publish_nf.md:20`, `publish_article.md:20`). Subjects are also over the limit
  (What Fate has 5, while the prompt asks for two to four), but the request only names keywords.
- Code: the schema is `keywords: z.array(z.string()).default([])` (`src/engine/pipeline/handlers.ts:1232`), and the list is
  written as it came at `:1252` (article) and `:1289` (book). There is no check of any kind.
- The test helper's default publisher answer has 3 keywords (`tests/helpers.ts:523`), so the "below 4" rule decides what every
  pipeline test book gets. No test reads the keywords, so nothing breaks.

## 7. MCP `wait_for_book` empty body

- Server: stateless Streamable HTTP. There is a new `McpServer` and transport per POST (`src/engine/mcp/server.ts:95-108`), SDK 1.32.1.
  With an `Accept` that lists `text/event-stream`, the SDK answers with an SSE `Response` whose stream gets the JSON-RPC result only
  when the tool returns. `@hono/node-server` 2.1.5 writes the headers and flushes them at once for a stream body
  (`node_modules/@hono/node-server/dist/index.mjs:1001-1008`). So the client gets `200 text/event-stream` and then **no bytes at
  all** until `wait_for_book` returns. That can take up to 900 s (`src/engine/mcp/tools.ts:243-300`, a one-second poll and nothing
  written meanwhile). There is no event store, so the SDK sends no priming event either.
- Likely root cause (not reproduced live): any client with an idle or body timeout shorter than the wait closes the stream with no
  `data:` event, and its JSON parse fails on an empty body. One example is Node's fetch, which is undici with a 300 s `bodyTimeout`
  by default. A script's own read timeout does the same. The server side is fine, and the tool always builds a JSON result (also on
  abort: `reason: "timeout"`). The fix is a keep-alive: SSE comment lines (`: keepalive\n\n`) every 15 s on an SSE response. Every
  SSE parser ignores them, and so does a "find the `data:` line" parser, so the result is unchanged. Progress or log notifications
  would add `data:` events that naive clients would parse as the answer, so they are worse. Lowering the 900 s cap would only shrink
  the window.
- Fast reproduction: a raw `http.request` with a 500 ms socket idle timeout, calling `wait_for_book {timeout_seconds: 2}`. Today the
  idle timeout fires, because no byte arrives for 2 s. With a 100 ms keep-alive (an option, for tests) it ends with a `data:` line
  that parses. `tests/mcp.test.ts:624-655` covers wait_for_book through the SDK client, and `rawRequest` (`:40-50`) shows the raw style.
- Open: the exact client that failed during REQ-0004 is not in the logs. If the fast reproduction does not fail before the fix, the
  implementer must stop and report, not ship an unproven fix.

## 8. ACP seed port 7461 -> 8787

- Places: `seed/config/providers.md:141` (`base_url`) and `:255` (help text). `src/engine/store/migrations.ts:381-394`
  (`ACP_PROVIDER_BLOCK`), `:398` (doc comment) and `:427` (change message). `src/renderer/ui/ModelsDialog.tsx:346` (placeholder).
  `docs/design.md:136` (Decisions row "Custom providers (SCP-44)"). `ROADMAP.md:77`. Tests: `tests/migrations.test.ts:267,280,311`.
  `tests/customProviders.test.ts:64,120` and `tests/renderer/office.spec.ts:369-378` use 7461 only as a form value, which is any URL,
  so they can stay.
- The proxy's own default is 8787 (`api-acp-proxy/README.md:72,93`). The live folder already says 8787 and is `enabled: true`
  (`C:/Users/Infplane/Scriptorium/config/providers.md:6-14`).
- **Conflict to flag:** REQ-0003 decision D3 kept 7461 because the creative-hub starts the proxy with `PROXY_PORT=7461`
  (`creative-hub/services.json:176-177`, `README.md:46`, `ROADMAP.md:78-83`). Book Translator's seed also uses 7461. REQ-0005 now
  asks for 8787 explicitly, and the Book Translator README is moving to 8787 (BTT-26). After this change, Scriptorium's seed matches
  the proxy's own default but not the hub's launcher. The hub is out of scope, so the user should know that `hub.ps1 start acp-proxy`
  still listens on 7461.
- Existing folders: `migrateAcpProvider` (`migrations.ts:403-429`) adds the block only when it is missing. A folder that got the old
  default keeps 7461. A safe rewrite changes the `acp` entry's `base_url` only when it is exactly `http://127.0.0.1:7461/v1` **and**
  the entry is `enabled: false`, so it was never used. A folder that runs the hub's proxy on 7461 with acp switched on, and the live
  folder (already 8787), are left alone.

## No seed prompt or template changes

None of the planned fixes touches `seed/prompts` or `seed/templates`. The changed seed files are `seed/topics.md` and
`seed/config/providers.md`. So `yarn seed:hashes` is not needed. If an implementer changes a prompt after all, they must run it.

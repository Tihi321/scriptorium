# REQ-0009 research: ACP Gemini review JSON failure, and REQ-0007 discoveries triage

## Question

1. Why did `acp/antigravity/gemini-3.8-flash` never return review JSON for the whole-book reviews of `fifty-minutes-of-common-sense` (~62.7k-token prompt) when the same pins worked for `the-tide-table` (~12.8k tokens), and where does the fix belong?
2. Triage the defects in `.claude/tickets/REQ-0007-psychologist-sessions/discoveries.md`.

## Answer

**Root cause (high confidence, reproduced live):** the Antigravity ACP agent (`agy_acp_server.exe`, which api-acp-proxy drives) silently keeps only the first ~192,000 characters of the prompt and drops the rest. Scriptorium puts the JSON instruction ("Reply with one JSON object like this: ...") at the bottom of the review prompt, after the book text. The prompt was ~252,000 characters, so Gemini saw chapters 1 to 12 (cut mid-sentence: "shook her head very"), never saw chapters 13 to 15, the scoring rules or the JSON instruction, and wrote a free-form markdown review. The repair round re-sends the same oversized conversation, so the repair instruction at its end is cut off too. The-tide-table (~51k characters) fits under the cap, which is why it worked. Neither Scriptorium nor the proxy truncates the prompt. `response_format`, system-message handling and the AAP-27 preamble are not the cause.

**Where the fix belongs:** mainly **api-acp-proxy**. Give the Antigravity provider a prompt-size limit and reject a longer prompt with a 400 context-length error instead of letting the agent cut it silently. Scriptorium already treats that kind of error as "too big" and moves to the next model without retrying (`src/engine/models/router.ts:274-276, 344-346`). A second, defensive fix belongs in **Scriptorium**: set a realistic `context` for the `acp/antigravity/*` models in `config/providers.md` and check the prompt size before routing. Today `context` is never checked before a request. Moving the JSON instruction to the top would produce JSON, but from a review that silently missed the last quarter of the book. That is worse than failing, so it is not the fix.

## Path through the code

### Scriptorium: how the review request is built and sent

- **confirmed:** The whole-book review handler fills `book_text` with the full text for short formats, so for `linked-collection` too (`src/engine/pipeline/handlers.ts:983-986`). It builds the messages with `buildMessages` and then appends the series, adapt and calendar sections at the end (`handlers.ts:988-1005`). It calls `chatJson(..., { maxTokens: 6000, temperature: 0.2 })` (`handlers.ts:1020`).
- **confirmed:** The messages are `[system: _rules + persona, user: rendered template]` (`src/engine/pipeline/prompts.ts:75-92`). The JSON-only rule is in the system message: "When JSON is requested, reply with one JSON object and nothing else." (`seed/prompts/_rules.md`).
- **confirmed:** In the review template the book text sits in the middle and the instructions and the JSON example are at the bottom (`seed/prompts/continuity-checker/review.md`: `{{book_text}}`, then `---`, "Give your review...", and at the end "Reply with one JSON object like this: {...}"). In the saved prompt (`.claude/temp/req0007/tasks/continuity-checker.book.review.json.done`), the book text starts at about character 7,425 of the user message, which is 250,803 characters long. The instruction block takes about the last 2.5k characters.
- **confirmed:** With `json_schema: false` (`C:/Users/Infplane/Scriptorium/config/providers.md`, acp block), `OpenAiCompatClient.chat` sends no `response_format` (`src/engine/models/openaiCompat.ts:72-74`). Messages are passed as they are, with streaming.
- **confirmed:** `chatJson` tries once with the schema, then once more as a repair: the original messages, plus the first reply cut to 6,000 characters, plus a "Reply again with only one valid JSON object" user message, sent without a schema (`src/engine/pipeline/llm.ts:84-116`). The error text "no JSON object in the reply" comes from `extractJson` (`llm.ts:49`).
- **confirmed:** No truncation happens in Scriptorium. A search for truncation and context checks in `src/engine/queue` and `src/engine/models` finds none. The router only estimates cost before a request (`router.ts:181`). It never compares the prompt with the model's `context`.

### api-acp-proxy: how the request reaches Antigravity

- **confirmed:** `normalizeChat` turns `response_format` into a format, and to text mode when it is absent (`src/api.ts:394-395`). Every message is converted, none is dropped (`api.ts:396`).
- **confirmed:** `buildPrompt` joins everything into a single text block: preamble (AAP-27 text plus Antigravity's `promptPreamble`), then `[system]\n...`, `[user]\n...`, then `[output format]` when JSON mode is on (`src/api.ts:550-571`; preamble at `src/providers/antigravity.ts:157`). System messages are kept as a `[system]` block, not dropped. Nothing is sliced. Images are the only reason to split into several blocks.
- **confirmed:** The block is sent as one `session/prompt` (`src/acp-provider.ts:805-806`). The body limit is 20 MiB (`src/settings.ts:45`). Going over it gives a 413, not a truncation (`src/server.ts:72-80`). The only character budget in the server is for the output (`max_tokens`, `src/server.ts:135-146`).
- **confirmed:** The agent is a closed binary (`agy_acp_server.exe`, `src/providers/antigravity.ts:31`). **inferred:** the cap lives there or in Google's backend behind it. It cannot be read in code, but the probes below pin it down: the agent reports the same prompt token count whether 250k or 400k characters are sent.

### Evidence from the run

- **confirmed:** Every Gemini review attempt failed with "no JSON object in the reply" (`C:/Users/Infplane/Scriptorium/books/fifty-minutes-of-common-sense/log.md:7056, 7209, 7544, 7619, 7707, 7934, 8237, 8347, 8562, 8891, 8951, 9033, ...`). The context line says "whole book text (62701 tokens)" (`log.md:6940`).
- **confirmed:** Gemini says itself that it saw a cut text:
  - `log.md:10658`: "*(Note: Text submitted terminates mid-scene in Chapter 12; Chapters 13–15 were not present for review).*" (continuity checker)
  - `log.md:7572-7573, 8305-8306, 9028, 9807`: the copy editor reports in three different attempts that chapter 12 ends at "...shook her head very". The real text goes on: "very slightly, and Priya smiled." (saved prompt, offset 190,655 of the user message).
  - Reviews are headed "Chapters 1–12" (`log.md:6945, 6996, 9047, 9919`).
- **confirmed:** The copy editor's cut lies at about character 191,950 of the prompt the proxy builds (computed from the saved prompt, the preamble and the role differences; script output in this session). That is the same place as the cap the probes show.
- **confirmed:** Claude Code reviewed the same prompt in full and returned valid JSON (`log.md:10668-10676`, "Continuity across the fifteen stories").
- **confirmed:** The cost: 219 Gemini requests, 6,323,592 input tokens (`C:/Users/Infplane/Scriptorium/config/budget.md:30`).

## Reproduction (reproduced live)

Script: `C:/projects/Personal/scriptorium/.claude/temp/req0009/probe.py`, results in `probe-out.jsonl` next to it. Each probe sends numbered paragraphs `[P00001]...`, then an `END-OF-TEXT-7319` line, and asks for `{"first_label","last_label","saw_end_marker"}`. All went to `http://127.0.0.1:8787/v1`, non-streaming.

| probe | model | prompt chars | where the instruction is | prompt_tokens | reply |
|---|---|---|---|---|---|
| A | gemini-3.8-flash | 40,421 | bottom | 23,909 | valid JSON, last P00227 of 227, end marker seen |
| B | gemini-3.8-flash | 250,462 | bottom | 58,362 | **no answer to the task**: "The input text was truncated before a specific query, question, or instruction was provided" |
| C | gemini-3.8-flash | 250,462 | top | 58,380 | JSON, last **P01086** of 1423, end marker **not** seen |
| D | gemini-3.8-flash | 250,151 | system message | 58,542 | JSON, last P01091 of 1425, end marker not seen |
| E | gemini-3.8-flash | 400,471 | top | 58,379 | JSON, last **P01086** of 2278, end marker not seen |
| F | gemini-4-argon | 250,462 | top | 59,046 | JSON, last P01086 of 1423, end marker not seen |

What the probes show (all **confirmed**):
- The cap is a fixed size, not a fraction of the prompt. 250k and 400k characters both stop at P01086, and the agent counts the same ~58.4k prompt tokens for both (C, E).
- In probe C, P01086 starts at character 191,792 and P01087 at 191,987 of the proxy prompt. So the cap is about 192,000 characters, which matches the real cut (~191,950). **inferred:** the cap counts characters, not tokens. My random-word filler and the real prose cut at the same character offset although they have very different token densities.
- Both Antigravity models have the same cap (F), so it belongs to the agent, not to the model.
- An instruction at the top, or in the system message, is obeyed, but the model still sees only the first ~192k characters (C, D).

## What the plan needs

### Fix options

1. **api-acp-proxy, recommended (S-M).** Add `maxPromptChars` to the provider descriptor (`src/provider.ts:143` area), set it for Antigravity in `src/providers/antigravity.ts` (with a margin, e.g. 180,000), and check it in `acp-provider.ts` before `session/prompt` (`:805` and the tools path at `:1032`), counting the text of the `buildPrompt` blocks. Over the limit, return 400 `context_length_exceeded` with a message such as "prompt is too long for Antigravity: N characters, limit M". Scriptorium's `isContextError` matches "prompt is too long" and "context length" (`router.ts:346`), so the job falls to the next model without retries. Document the cap in the README, and optionally report it in `/v1/models` (AAP-29 notes "Context window: data not available yet", `.claude/tickets/AAP-29-usage-and-ux-redesign/plan.md:319`). Tests: a unit test on the limit check using the existing fake agent in `tests/`.
2. **Scriptorium, defensive (S for config, M for code).**
   - Config: in `C:/Users/Infplane/Scriptorium/config/providers.md`, set `context` for `antigravity/gemini-3.8-flash` and `gemini-4-argon` to about 45,000 tokens instead of 1,000,000. The seed lists no acp models (`seed/config/providers.md:136-145`), so this is a data-folder edit, plus a note in `docs/design.md` / `docs/mcp.md`.
   - Code: a router pre-check that skips a model whose `context` is smaller than the estimated prompt plus `maxTokens`, with a `too-big` problem. This touches every provider, so the tests need models with a small `context`. This only helps once option 1 or the config value tells the router the real limit.
3. **Not recommended as the fix: the JSON instruction at the top.** It gives JSON from a review that silently misses chapters 13 to 15, which is worse than failing. It could be added later for robustness, but it changes every review prompt (`seed/prompts/*/review*.md`, `yarn seed:hashes`, prompt versions).
4. Optional, Scriptorium: when `chatJson`'s repair also fails with "no JSON object in the reply", raise a provider error that the router can fall through on, so the job goes to the next model in the role list instead of failing the attempt. This is the discovery's third suggestion. It is a broader behaviour change (M).

### Files

- api-acp-proxy: `src/acp-provider.ts`, `src/provider.ts`, `src/providers/antigravity.ts`, `src/api.ts` (`serializePrompt` exists for size estimates, `:574`), README, `tests/`.
- Scriptorium: `src/engine/models/router.ts`, `src/engine/pipeline/llm.ts`, data-folder `config/providers.md`.

## Risks

- The exact cap is measured, not documented (about 192,000 characters, Antigravity build of 2026-11). A newer agent build may change it, so make the limit a setting with a margin.
- **inferred, not tested:** whether the cap is per text block or for the whole prompt. If it is per block, the proxy could split long text into several blocks. That needs a probe that sends several text blocks, which the proxy only does with images. Until then, reject.
- The same silent cut hits any long Scriptorium prompt on acp/antigravity, not only reviews. Short-format writer prompts carry every earlier chapter (`handlers.ts:845-854`), so late chapters of a long linked collection would lose their instructions too (**inferred**).
- A Scriptorium router pre-check changes routing for every provider. A wrong `context` value would skip models that work today.
- Book Translator and VN Studio also have the acp provider (SCP-44, `ROADMAP.md:77`). A proxy-side fix covers all three apps. A Scriptorium-only fix covers one.

## Question 2: triage of the REQ-0007 discoveries

| # | item | real? (evidence) | severity | fix location | size | tracked elsewhere | group |
|---|---|---|---|---|---|---|---|
| 1 | VN test with "The Moon Lamp" fixture failed once in 739 | plausible; fixture at `tests/adapt.test.ts:41, 81`. Not rerun here | wastes work (CI noise) | `tests/adapt.test.ts` book.md setup | M | yes: SCP-57 `discoveries.md:7` (adapt.test.ts:433-458, ENOENT on book.md under load) | fix later (with SCP-57's item) |
| 2 | data-folder `config/formats.md` drifted from the seed | real (diff: `research: false` missing on bedtime-toddler and bedtime-story, kids-picture-book moved and older guidance, doc bullets missing). No effect: a `bedtime-*` format without `research` counts as false (`src/engine/pipeline/advance.ts:16-18`) | cosmetic | data folder `config/formats.md` (resync from seed) | S | no | fix later |
| 3 | plain-text Book Translator bearer token in `.claude/temp/req0006/mcp.py` | real: line 2 assigns `TOK` a literal (value not copied here); port 47811. The file is gitignored (`.gitignore:5` `.claude/temp/`), so it is not committed. `req0007/mcp.py` reads its token from the environment instead | **security** (local, not in git) | delete or rewrite the file to read an env var; rotate the token in Book Translator | S | no | **fix now** |
| 4 | `index/engine.lock` holds dead pid 16920 | the lock is gone now (`index/` holds only `library.sqlite`). A dead-pid lock is replaced at start anyway (`src/engine/store/dataFolder.ts:149-163`) | cosmetic | none | - | REQ-0006 `discoveries.md:11` | ignore |
| 5 | short-mode writer prompt grows with every chapter, uncapped | real: every earlier chapter goes in in full (`handlers.ts:845-854`); only long and nonfiction formats use a 20k-token budget (`handlers.ts:834-843`) | wastes work; blocks runs on small-context models and on acp/antigravity beyond ~192k chars | `handlers.ts` draft_chapter (budgeted context like `memoryContext`, or summaries of older chapters) | M | no | fix later (sooner if linked collections grow) |
| 6 | `py -I` has no PyYAML | real for scripts only, not a code defect | cosmetic | agent briefs / scratch scripts | S | no | ignore |
| P4-1 | Gemini via ACP never returns review JSON | real; root cause above (agent cuts input at ~192k chars) | **blocks runs** | api-acp-proxy (reject over-cap prompts); Scriptorium config `context` and optional pre-check | S-M | no | **fix now** |
| P4-2 | one failed-for-good review job fails the whole book while other reviewers still run | real: any failed job sets the stage to `failed` (`advance.ts:332-334`) | wastes work | `advance.ts` (optional reviewers), or a per-job retry/skip MCP tool (`src/engine/mcp/tools.ts:847`) | M | no | fix later |
| P4-3 | after `set_book_model`, the new model got the old model's repair conversation | real: a model change restarts only the request in flight (`src/engine/queue/scheduler.ts:616-621`), and the request in flight was `chatJson`'s repair call with Gemini's reply in it (`llm.ts:104-112`). Saved tasks show `messages` = user (250k), assistant (3.7k-6k), repair user (`.claude/temp/req0007/tasks/beta-reader.book.review.json.done` etc.) | wastes work (wrong input for the new model) | `llm.ts` chatJson: on `modelChanged`, start again from the original messages | S-M | no | fix now (small, and it bites every model switch during a repair) |
| P4-4 | repair-round client tasks had no `schema` | real: the repair asks with `withSchema=false` (`llm.ts:111`), so `get_client_task` has no schema and submit-time checks are skipped (`src/engine/models/client.ts:127, 188`). Confirmed in the saved tasks: the 4 repair tasks have no schema key, the 2 fresh ones have one | wastes work (bad answers accepted, then failed by zod) | `llm.ts:111`: pass the schema on repair when the first ask accepted it | S | no | fix now (with P4-3) |
| P4-5 | book.md `models:` counts only successful jobs | real: counted when a `made.md` row is written (`src/engine/pipeline/books.ts:193-195`); failures are only in `config/budget.md:30` | cosmetic | `books.ts` made/stats | S | no | fix later |
| P4-6 | beta-reader agent named like a character (Priya Nair) | real, harmless | cosmetic | agent hiring | S | no | ignore |
| P4-7 | chapter frontmatter `humanized: 0` despite humanizer runs | works as designed: `humanized` is the round the humanizer last rewrote the chapter in, and round 0 is the first (`books.ts:68-69`) | cosmetic (naming) | doc note in `docs/design.md`, or rename | S | no | ignore (or a doc line) |
| P4-8 | killing headless leaves `engine.lock` | real but harmless (replaced at next start, `dataFolder.ts:149-163`). No MCP `shutdown` tool in Scriptorium (no match in `src/engine/mcp/tools.ts`) | cosmetic | an MCP `shutdown` tool or `engine stop` | M | yes: REQ-0006 `discoveries.md:11` | fix later |
| P4-9 | parallel subagents overwrote each other's `book.txt` in one scratchpad | real, process issue only | wastes work (risk of wrong input) | director briefs (unique scratch file names) | S | no | ignore in code; add a line to briefs |

## Discoveries (not in the discoveries file)

- **Silent input cut in the proxy path:** api-acp-proxy forwards prompts over ~192k characters to Antigravity without a warning, and the agent drops the tail (probes B-F). This affects Book Translator and VN Studio through their acp providers too (**inferred** from SCP-44, `ROADMAP.md:77`).
- **`context` is informational only:** Scriptorium's router never compares a prompt with the model's `context` before sending it (`router.ts:181` estimates cost only). The data-folder acp rows claim 1,000,000 (`config/providers.md`, antigravity rows).
- **Repair cuts the first reply:** `chatJson` cuts the first reply to 6,000 characters and then asks the model to "Keep everything your first reply said" (`llm.ts:106-109`). The developmental and line editor repairs carried exactly 6,000 characters (saved tasks), so the end of their findings was lost. **inferred:** a cut reply also never matches the proxy's kept-session transcript (`acp-provider.ts:951`), so the repair always re-sends the whole prompt.
- **Wasted spend:** the failing Gemini reviews used 6.3M input tokens over 219 requests (`config/budget.md:30`). It cost nothing here (subscription), but it was ~1.5 h of model time (5,329.8 s).

## Open questions

- Is the Antigravity cap per text block or for the whole prompt, and can it be configured in `agy_acp_server`? Not tested (it needs a multi-block probe).
- The exact cap in characters: between 191,792 and 191,987 in probe C. Not narrowed further.
- Does Codex or Claude through the proxy have a similar cap? Not probed (the brief allowed only the free Antigravity probes).
- Does the proxy have session reuse turned on for Antigravity? It matters only for how repair rounds are sent; I did not check the live settings.

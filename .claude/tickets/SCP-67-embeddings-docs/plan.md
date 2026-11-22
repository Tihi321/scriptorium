---
status: in-progress
request: creative-hub/REQ-0030
repos: [scriptorium]
branch: SCP-67_embeddings-docs
updated: 2026-11-22
---

# SCP-67 Docs say embeddings go through the proxy; port 8787 as the sample URL in a test

Hub ticket: creative-hub HUB-41 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-41-pixel-agent-and-small-ideas\plan.md`), request REQ-0030. The user said "new small ideas, build them now". Checked on master 8cec567 (2026-11-22), reading only.

Do not start Scriptorium, the engine, a re-index or anything that writes `C:\Users\Infplane\Scriptorium`. This ticket changes docs and one test file in the repo; the live `config\roles.md` is the hub's step (HUB-41 L2).

## Scope

1. Since SCP-66 (and AAP-43) Scriptorium embeds through the ACP proxy (`seed/config/roles.md:3` `embeddings: acp/llama/nomic-embed-text-v1.5`; its prose `:51` says so) and LM Studio is not installed. Four places in the docs still say LM Studio serves the embeddings: `README.md:12`, `CLAUDE.md:15` (twice), `CLAUDE.md:16`, `docs/design.md:511` and `:652`.
2. `tests/customProviders.test.ts:64` and `:120` use `http://127.0.0.1:7461/v1` as the URL of a custom provider named "ACP Home" (id `acp-home`). It is a pure sample: the 7461 to 8787 migration acts only on the provider with id `acp` and exactly that URL (`src/engine/store/migrations.ts:403-422`), and `saveCustomProvider` has no check on the URL's port. 8787 is today's proxy port.

## Out of scope

- The dated decision rows of `docs/design.md` (`:72` Strata, `:152` SCP-65, `:257` the 2026-10-10 Strata note) and the history line `README.md:5`: they record what was true then.
- The migration tests that use 7461 as the old address under test.
- Any code, seed or live data.

## Files to touch (verified; find each by its text)

**`README.md:12`**. Old: "(Gufo, Strata and Llama.cpp models through the ACP proxy; LM Studio only for embeddings, Ollama)" New: "(Gufo, Strata and Llama.cpp models through the ACP proxy, the nomic embeddings too: `acp/llama/nomic-embed-text-v1.5`; Ollama)"

**`CLAUDE.md:15`**. Old (start of the line): "- LM Studio is installed (CLI `~\.lmstudio\bin\lms.exe`, server is OpenAI-compatible). `lms ls` lists its models." New: "- LM Studio is not installed (its `lmstudio` provider stays in the code, switched off in the seed since SCP-66)."
Same line, old (end): "; LM Studio only serves embeddings until the proxy has `/v1/embeddings` (AAP-43)." New: "; since SCP-66 the embeddings too (`acp/llama/nomic-embed-text-v1.5`, the proxy's `/v1/embeddings` on its own small llama-server, AAP-43)."
The rest of the line ("The model table is in the design doc under "Model layer". Ollama is not installed. Since HUB-38 ...") stays.

**`CLAUDE.md:16`**. Old: ", and it takes most of the GPU memory, so keep only the nomic model loaded in LM Studio." New: ", and it takes most of the GPU memory; the nomic embeddings run beside it on the proxy's small embedding server."

**`docs/design.md:511`**, last cell. Old: "and embeddings come from LM Studio over its API anyway" New: "and embeddings come from a local OpenAI-compatible API anyway (the ACP proxy since SCP-66, LM Studio before)"

**`docs/design.md:652`**. Old: "- **Embeddings run locally and free.** LM Studio already has `nomic-embed-text-v1.5`, so indexing costs nothing even when writing uses cloud APIs." New: "- **Embeddings run locally and free.** `nomic-embed-text-v1.5` runs through the ACP proxy (`acp/llama/nomic-embed-text-v1.5`, llama.cpp; LM Studio until SCP-66), so indexing costs nothing even when writing uses cloud APIs."

**`tests/customProviders.test.ts:64`**: `baseUrl: 'http://127.0.0.1:7461/v1'` becomes `baseUrl: 'http://127.0.0.1:8787/v1'`. **`:120`**: `base_url: 'http://127.0.0.1:7461/v1'` becomes `base_url: 'http://127.0.0.1:8787/v1'`. No other line of the file changes.

**`ROADMAP.md`**, a new bullet after `:98` (SCP-66):
"- **SCP-67 (branch `SCP-67_embeddings-docs`; plan in `.claude/tickets/SCP-67-embeddings-docs/`; hub HUB-41, REQ-0030): docs say the embeddings go through the proxy.** README, CLAUDE.md and the design doc's present-tense lines name `acp/llama/nomic-embed-text-v1.5` instead of LM Studio (not installed); the custom-provider test uses 8787 as its sample URL. No code change."

## Tasks for workers

One task: the edits above, verbatim. Commands (Bash; Node under fnm): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"`, then in `C:\projects\Personal\scriptorium`: `yarn test` (it also runs `test:recovery`; it does not start the app), `yarn typecheck`, `yarn lint`, `yarn build:engine`. `tests/adapt.test.ts` "starts without asking the editor-in-chief" once failed under load with ENOENT and passed alone (HUB-40 discoveries): if it fails, re-run it alone and report both runs; it is not touched by this ticket.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| S1 | no doc says LM Studio serves the embeddings (outside dated history) | `grep -n "LM Studio only for embeddings\|only serves embeddings\|nomic model loaded in LM Studio\|embeddings come from LM Studio\|LM Studio already has" README.md CLAUDE.md docs/design.md` prints nothing |
| S2 | `CLAUDE.md` no longer says LM Studio is installed | `grep -n "LM Studio is installed" CLAUDE.md` prints nothing |
| S3 | the sample URL is 8787 and the test passes | `grep -n "7461" tests/customProviders.test.ts` prints nothing; `yarn test tests/customProviders.test.ts` passes |
| S4 | the rest green | `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:engine` exit 0 |

## UNTESTED

Nothing runtime changes. The live `roles.md` prose line is the hub's step (HUB-41 L2).

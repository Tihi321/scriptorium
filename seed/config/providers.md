---
kind: providers
providers:
  - id: deepseek
    kind: openai-compat
    base_url: https://api.deepseek.com
    api_key_env: DEEPSEEK_API_KEY
    concurrency: 8
    json_schema: false             # DeepSeek answers response_format json_schema with HTTP 400 ("unavailable now"), checked 2026-10-12
    models:
      - id: deepseek-flash
        family: deepseek
        context: 1000000
        price_in: 0.30
        price_out: 1.20
        price_cached_in: 0.006
        extra_body: { thinking: { type: disabled } }
      - id: deepseek-v4-pro
        family: deepseek
        context: 1000000
        price_in: 1.32
        price_out: 3.96
        price_cached_in: 0.044
        extra_body: null
  - id: openrouter
    kind: openai-compat
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    concurrency: 4
    rpm: 20                        # OpenRouter's limit for the free models
    rpd: 50                        # free-model requests per day without credits (1000 after buying 10 credits): then the next model
    discover: free                 # adds every model OpenRouter lists at price 0 (the `:free` ones); a paid one goes in the list below
    discover_skip: [content-safety]
    json_schema: false             # not every model there supports response_format; the engine checks and repairs the JSON instead
    models:
      # to verify
      - id: google/gemini-2.5-flash
        family: gemini
        context: 1000000
        price_in: 0.30
        price_out: 2.50
  - id: anthropic
    kind: anthropic
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
    concurrency: 4
    models:
      # to verify
      - id: claude-sonnet-4-5
        family: claude
        context: 200000
        max_output: 16000
        price_in: 3
        price_out: 15
        price_cached_in: 0.30
  - id: gemini
    kind: gemini
    base_url: https://generativelanguage.googleapis.com
    api_key_env: GEMINI_API_KEY
    concurrency: 4
    models:
      # to verify
      - id: gemini-2.5-flash
        family: gemini
        context: 1000000
        price_in: 0.30
        price_out: 2.50
        price_cached_in: 0.03
  - id: lmstudio                  # switched off (HUB-38): LM Studio is not installed; embeddings go through the ACP proxy (acp/llama/nomic-embed-text-v1.5, AAP-43). Kept as a way back
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://localhost:1234/v1
    concurrency: auto             # the sum of `parallel` over the loaded chat models (lms load --parallel <n>), 1 when none is loaded
    discover: false
    discover_skip: [dflash]       # LM Studio lists these, but they are not models it can load here
    load_models: true             # load a model that isn't loaded yet with lmstudio_parallel, lmstudio_context and lmstudio_ttl_minutes from settings.md
    models:
      - id: text-embedding-nomic-embed-text-v1.5
        family: nomic
        embedding: true
  - id: strata                    # switched off (HUB-38): Strata is reached through the ACP proxy as acp/strata/*; kept as a way back
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://127.0.0.1:8080/v1
    api_key_env: STRATA_API_KEY   # optional: only sent if set
    concurrency: auto             # as many as the running Strata serves (its /v1/status)
    discover: true                # ask Strata which model it runs (GET /v1/models, and `model` of /v1/status)
    json_schema: false
    models:                       # the refs roles and settings use; each stands for whatever model Strata has loaded
      - id: default               # thinking off
        loaded: true
        aliases: [qwen3.8-flash-next]
        context: 131072           # used until Strata has answered once
        extra_body: { reasoning_effort: none }
      - id: default-low           # thinking on low, for the checks
        loaded: true
        aliases: [qwen3.8-flash-next-low]
        context: 131072
        extra_body: { reasoning_effort: low }
    profiles:                     # settings per model Strata may run, matched by id prefix; not refs, not in pickers
      - id: qwen3.8-flash-next    # matches qwen3.8-flash-next-unsloth-ud-iq4_xs and any other Qwen3.8-Flash-Next quant
        family: qwen
        context: 131072
      - id: deepseek-v4.1-flash
        family: deepseek
        context: 131072
  - id: ollama
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://localhost:11434/v1
    concurrency: 1
    discover: true
    models: []
  # The ACP proxy (api-acp-proxy: Antigravity, Codex and Claude through ACP, plus the local Gufo, Strata and Llama.cpp models) as an OpenAI-compatible server.
  # See "The ACP proxy" below. Any other OpenAI-compatible server is added in the Models dialog (Add provider).
  - id: acp
    name: ACP proxy
    kind: openai-compat
    enabled: true
    local: true
    base_url: http://127.0.0.1:8787/v1
    concurrency: 4                # the hub's live config uses 8 for Scriptorium
    json_schema: false
    discover: true
    discover_skip: [ qwen-image, nomic-embed ]
    models:
      # Local models through the proxy (HUB-38). One local model is loaded at a time across gufo, strata and llama;
      # a request for another one waits until the proxy has switched (minutes). LOCAL is the strata row.
      - id: strata/qwen3.8-flash-next-unsloth-ud-iq4_xs
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: gufo/Qwen3.8-27B
        family: qwen
        context: 32768
        extra_body: { reasoning_effort: none }
      - id: gufo/deepseek4
        family: deepseek
        context: 16384
        extra_body: { reasoning_effort: none }
      - id: gufo/flash-next-q4
        family: qwen
        context: 32768
        vision: true
        extra_body: { reasoning_effort: none }
      - id: llama/inkling-2-mini
        family: inkling
        context: 32768
        vision: true
      - id: llama/inkling-2-mini-dspark
        family: inkling
        context: 32768
        vision: true
      - id: llama/nomic-embed-text-v1.5
        family: nomic
        embedding: true
  # Claude Code (or any MCP client) does the model work: a request waits in the engine until the client answers it (see docs/mcp.md).
  # Switched off here so a new install never routes to it: set `enabled: true`, then point one agent or role at client/claude-code.
  - id: client
    kind: client
    enabled: false
    local: true                   # free, never paid, never budget-checked, no key
    concurrency: 8                # requests that may wait for the client at once
    models:
      - id: claude-code
        family: claude
        context: 200000
        vision: true
      # Antigravity CLI as a client: it takes its own tasks with get_client_task {client: "antigravity"} (see docs/mcp.md).
      - id: antigravity
        family: gemini
        context: 1000000
        vision: true
  # Search services for the researcher (kind: search). They have no models. The order is search_order at the end of the list.
  # price_per_request is logged to the spend files for every answered request (USD, to verify on the provider's pricing page).
  - id: tavily
    kind: search
    engine: tavily
    base_url: https://api.tavily.com
    api_key_env: TAVILY_API_KEY
    price_per_request: 0.008
    concurrency: 2
  # Web search done by Claude Code (or any MCP client): each query is a `searcher` task in the client queue (see docs/mcp.md). It costs nothing
  # and waits for a client: a task nobody takes within wait_minutes gives no results, and the next provider is tried.
  - id: client-search
    kind: search
    engine: client
    enabled: true
    wait_minutes: 10
    price_per_request: 0
    concurrency: 2
  - id: wikipedia
    kind: search
    engine: wikipedia
    base_url: https://en.wikipedia.org
    price_per_request: 0
    concurrency: 2
  - id: brave
    kind: search
    engine: brave
    enabled: false
    api_key_env: BRAVE_API_KEY
    price_per_request: 0.005
    concurrency: 2
  - id: serpapi
    kind: search
    engine: serpapi
    enabled: false
    api_key_env: SERPAPI_API_KEY
    price_per_request: 0.01
    concurrency: 2
  - id: serphouse
    kind: search
    engine: serphouse
    enabled: false
    api_key_env: SERPHOUSE_API_KEY
    price_per_request: 0.01
    concurrency: 2
  - id: duckduckgo
    kind: search
    engine: duckduckgo
    enabled: false
    price_per_request: 0
    concurrency: 1
# The researcher tries these search providers in this order: the first one that gives results wins. One without a key is skipped.
search_order: [tavily, client-search, wikipedia, brave, serpapi, serphouse, duckduckgo]
---
# Providers

One entry per provider. Edit this file and the engine picks the change up without a restart. API keys are never written here: `api_key_env` names an environment variable, and the engine also looks in the Windows credential store under that name (`npm run key:set <NAME>`).

Prices were checked 2026-10-08 from third-party listings; the DeepSeek ones were updated 2026-10-11 from the DeepSeek docs. `deepseek-flash` is DeepSeek-V4.1-Flash (the old name `deepseek-v4-flash` still works, but is served by V4.1 at the Flash price) and `deepseek-v4-pro` is DeepSeek-V4-Pro-0813. DeepSeek charges a peak and an off-peak price; the config holds the peak price, so the budget never counts too little (off-peak is half of it). Verify them at api-docs.deepseek.com/quick_start/pricing and the other providers' pricing pages. The OpenRouter, Anthropic and Gemini entries are examples marked "to verify": model ids and prices there may be out of date.

## Fields of a provider

- `name`: optional label shown in the app (the Models panel, the fallback rows). Defaults to the id.
- `custom`: `true` marks a provider added with **Add provider** in the Models panel. Only those can be edited and removed there (Remove also deletes the stored key and the provider's ticked models and fallback rows); a custom provider is always its own kind in the fallback list, named by its id, whether it is free (`local: true`) or paid. Its key is `CUSTOM_<ID>_API_KEY` in the Windows credential store. The seed providers have no `custom` flag: edit them here.
- `id`: the name used in model references. A model is written `provider/model`, for example `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`.
- `kind`: `openai-compat` (any OpenAI-style API), `anthropic`, `gemini`, `client` (no model server: an MCP client such as Claude Code answers, see below), `mock` (scripted answers, only for the tests: the app's own config has none, so the model pickers never offer one) or `search` (web search for the researcher: `engine` names the service, see below).
- `enabled`: `false` switches the provider off. A provider whose key can't be found is skipped automatically.
- `local`: `true` for models on this machine. Local models cost nothing and never count against the caps. Their tokens and time are still recorded.
- `on_device`: optional. `true` when the provider runs on this machine (LM Studio, Strata, Ollama), `false` when it does not (a proxy to cloud models). Without it, a `local` provider of kind `openai-compat` is on this machine, except `acp`. A model row can carry its own `on_device`; without it, a model of an `openai-compat` provider whose id starts with `gufo/`, `strata/` or `llama/` (the local models behind the ACP proxy) is on this machine, and the others follow their provider. A book with `no_local_fallback: true` (MCP `set_book_local_fallback`) never uses a model of such a provider outside its own `role_models` list. Set `on_device: false` on a custom provider that points at another proxy.
- `base_url`, `api_key_env`: where to call and which variable holds the key.
- `concurrency`: how many requests may run at once. `auto`: as many as the server says it serves at once, asked at start and every 10 seconds, 1 while the server is down. A server that doesn't answer is skipped: its jobs go straight to the next model in the role (no failed retries first) until it answers again, and the office shows the model that really answers. The first request that can't connect marks it down at once for every agent, and the status bar shows it as off with a **Check now** button for right after you start it. Strata reports it as `concurrency.serving` of `<base_url>/status`, so it follows the script you started: 4 with a `-parallel` script, 1 with a `-solo` one, and nothing in this file changes when you switch. For LM Studio it is the sum of `parallel` over the loaded chat models (from LM Studio's `/api/v1/models`): load a model with `--parallel 4` and four requests go to it at once. Requests in parallel share the GPU, so each one is slower, but the total is higher.
- `rpm`, `tpm`: optional rate limits (requests and tokens per minute). Only `rpm` is enforced for now.
- `rpd`: optional requests per day, counted from midnight UTC (when OpenRouter's daily limit starts again), also across restarts. A provider that reached it, or that answers that its daily limit is used up, is skipped until then: its jobs go to the next model in their role. When no model of the role can take a job (every one is used up or down), the job waits in the queue instead of failing, and the agent shows why; `factory_status` lists it under `blocked`.
- The app's **Models** panel sets requests at once, per minute and per day for each API provider. It saves them in `limits` of `config/models.md`, which win over the values here.
- `discover`: ask the provider for its models (`GET /v1/models`) and add the ones not listed here. `discover_skip` leaves out models whose id contains one of its words (any case): LM Studio skips `dflash`, which it lists but can't load here. `discover: free` adds only the models the provider lists at price 0. A model of a paid provider is only added with the price the provider lists, so the budget always counts its cost: one listed without a price is left out (add it below with its price). Models that answer with something besides text (music, images) are left out. Discovery runs at start, when a key is stored and when this file changes.
- `json_schema`: `true` (the default) sends the JSON schema of a structured answer as `response_format`. Set `false` for a server that answers a bad JSON reply with an error instead of constraining it. The prompt then asks for the JSON shape and the engine checks it and repairs it.
- `loaded`, `aliases` (on a model), `profiles` (on the provider): for a server that runs one model at a time (Strata). A `loaded: true` row is not a model id but a ref (`strata/default`) that stands for whatever the server runs; with `discover: true` the app asks the server which model that is, and takes the row's family, context, `extra_body` and `json_schema` from the `profiles` entry whose `id` is that model's id or the longest prefix of it (a row's own values win over the profile's). `aliases` are older ids that still resolve to the row. Discovery adds no other models for such a provider.

## Strata

Strata (`D:\Strata`) is a fast local server with an OpenAI-style API. Since HUB-38 Scriptorium does not connect to it directly: the ACP proxy does (see "The ACP proxy"). The `strata` provider above is switched off (`enabled: false`) and kept, with its rows and profiles, as a way back: set `enabled: true` and point the roles at `strata/default` to use it directly again.

- Under the proxy, an `acp/strata/*` request makes the proxy start `D:\Strata\terminal\run-unsloth-ud-iq4_xs-parallel.bat` (Qwen3.8-Flash-Next IQ4_XS, four requests at once). The other scripts are `D:\Strata\terminal\run-unsloth-ud-iq4_xs.bat` (one at a time), `run-deepseek-v4.1-flash-ist-das-2.00bpw.bat` and `run-deepseek-v4.1-flash-ista-das-coder.bat` (DeepSeek V4.1 Flash), all in `D:\Strata\terminal`. From the creative-hub folder, `scripts\hub.ps1 start strata <variant>` starts one by hand.
- Only one local model is on the GPU at a time across Gufo, Strata and Llama.cpp: a request for another local model waits until the proxy has switched, which takes minutes (loading Strata takes 1 to 3 minutes, the DeepSeek config allows up to an hour).
- Direct use (the way back): Scriptorium asks Strata which model it runs (`/v1/status`) and uses the matching entry of `profiles` for that model's settings (family, context, extra body). `strata/default` (no thinking) and `strata/default-low` (thinking on `low`) follow it, and the older ids `qwen3.8-flash-next` and `qwen3.8-flash-next-low` still work as aliases. A new model needs a profile (its `id` is matched as a prefix of the id Strata reports).
- Strata takes most of the GPU memory with any of these models: no ComfyUI while it runs. The proxy's small nomic embedding server (port 8083) runs beside it.
- `json_schema: false` because Strata checks a structured answer after the fact and fails the request (502 `structured_output_failed`) when it is bad. The engine's own parse-and-repair step copes with a loose JSON answer. The proxy does not enforce `response_format` either.
- No key is needed. `STRATA_API_KEY` is only sent if you set it.

## The ACP proxy

`acp` points at the api-acp-proxy (`http://127.0.0.1:8787/v1`), which serves Antigravity, Codex and Claude through ACP, and the local Gufo, Strata and Llama.cpp models, as an OpenAI-compatible API. It is on in the seed (`enabled: true`); start the proxy first. It is local (free, its own kind `acp` in the fallback list); press **Detect models** to list what the proxy offers and tick the ones you want.

- The local rows are `strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` (the default local model, written LOCAL in the plans), `gufo/Qwen3.8-27B`, `gufo/deepseek4`, `gufo/flash-next-q4`, `llama/inkling-2-mini` and `llama/inkling-2-mini-dspark`. Defaults name only the Strata one. The proxy answers a request with `tools` to a local model with 400, and does not enforce `response_format`.
- Only one local model is loaded at a time; a request for another one waits until the proxy has switched (minutes).
- A model of the proxy that runs on this machine (`gufo/*`, `strata/*`, `llama/*`, or a row with `on_device: true`) counts as on this machine for `no_local_fallback`; the Codex, Antigravity and Claude ones do not.
- Start the proxy with `PROXY_IGNORE_SAMPLING=1`: Scriptorium sends `temperature`, `max_tokens` and `stream_options`, which the proxy has to ignore.
- It is text only: no vision (Scriptorium sends none).
- `PROXY_TIMEOUT_MS` (5 minutes by default) must cover your longest request: a chapter can take a while.
- The Antigravity agent keeps only about the first 192,000 characters of a prompt and drops the rest without an error. After Detect models, give each `antigravity/*` model `context: 45000` (estimated tokens, characters / 4): the engine then sends a longer prompt to the next model. The proxy (AAP-30) also refuses such prompts with HTTP 400 "prompt is too long".
- Terms risk: driving Antigravity this way may break its terms of use. Read the section "Antigravity models and the ACP proxy" of the creative-hub ROADMAP before you rely on it.
- A data folder that already exists gets the entry at the next start, once (before the `client` provider), without changing the entries, comments and order you have.

## OpenRouter

One key (`OPENROUTER_API_KEY`, stored in the app's settings) gives many models. `discover: free` adds every free one OpenRouter lists, with its context and output limit, so they show in the model pickers as `openrouter/<maker>/<model>:free` (19 on 2026-10-12, `openrouter/openrouter/free` among them: OpenRouter picks a free model for each request). Free models cost nothing and never count against the caps. OpenRouter limits them to 20 requests a minute and 50 a day, or 1000 a day once the account has bought $10 of credit. A rate-limited request is retried with backoff, then the next model in the role takes it. For a paid OpenRouter model, tick it in the app's Models panel (the Models button in the top bar; Detect models lists them all), or add it there by its id: it is saved in `config/models.md` with the price OpenRouter lists. You can also add it to the list here with its price from openrouter.ai/models, or set `discover: true` to add all of them (about 450) with the prices OpenRouter lists. The Models panel also unticks models you don't want in the pickers.

## DeepSeek

- `json_schema: false`: DeepSeek answers `response_format: json_schema` with HTTP 400 ("This response_format type is unavailable now"), so every structured job failed there at once. The prompt asks for the JSON shape instead, and the engine checks and repairs the answer. Checked 2026-10-12.

## Client provider (`kind: client`)

Claude Code (or another MCP client) does the model work. A request to `client/claude-code` is not sent anywhere: it waits in the engine's task queue, with no time limit, until the client takes it with `get_client_task` and answers it with `submit_client_task` (see `docs/mcp.md`). The book carries on as if a model had answered. The provider is local (free, never paid, never counted against the caps, no key) and is never marked down, so nothing is spent. `concurrency` is how many requests may wait at once. It is switched off in the seed (`enabled: false`).

- Use it for one book: `add_story {models: {writer: "client/claude-code"}}` or `set_book_model` puts that book's jobs of a role on it, so the factory's own ideas keep using their models and never wait for you. Or set a whole role to it with `set_model`. (An agent pinned to a book with `assign_agent` only prefers its jobs.)
- A role left on `client` when nobody is answering stalls every book that needs it: switch it back when you are done.
- `context: 200000`: Claude's window. It sizes the memory context (45%) and source excerpts (30%); without it Scriptorium uses its smaller defaults.
- Named clients: the models are `client/claude-code` and `client/antigravity`. A task carries the model it was made for, and a client only takes its own: `get_client_task` without `client` gives `claude-code` tasks, Antigravity CLI passes `client: "antigravity"` (see `docs/mcp.md`, "Antigravity CLI as a client"). Add another client with "Add a model by its id" on the `client` provider.
- `vision: true` on the model is for clients that can look at images (VN Studio sends images to its art critic; Scriptorium's jobs send none).
- Tasks live in memory only. If the engine restarts, the jobs that waited are requeued and make new tasks.

## Search providers (`kind: search`)

Used only by the researcher. A search provider has no models. `engine` is `tavily`, `client`, `wikipedia`, `brave`, `serpapi`, `serphouse` or `duckduckgo` (it defaults to the id). `search_order` (the last line of the frontmatter) is the order they are tried in. Each answered request is written to the spend files with `price_per_request`, and a paid provider is skipped while a budget cap is reached.

- **Tavily** (`TAVILY_API_KEY`): returns cleaned page text with the results. Written, but not yet checked against the real service (no key was available).
- **Client search** (`engine: client`, id `client-search`: the id `client` is the model provider above): the web research is done by Claude Code, or any MCP client. Each query becomes a client task (role `searcher`, task `web_search`) that the client takes with `get_client_task {role: "searcher"}`, answers by searching the web itself, and submits as `{results: [{title, url, content, published?}]}`. Free, no key. `wait_minutes` (default 10): a task nobody has taken by then gives no results (logged) and the next provider is tried, so books never stall without a session. Once a client has taken it, the answer is waited for. It sits after Tavily and before Wikipedia in `search_order`.
- **Wikipedia**: the MediaWiki API, no key, free. Sends a descriptive User-Agent. Good for basics, weak for specialist facts.
- **Brave, SerpApi, SERPHouse, DuckDuckGo**: stubs. They sit behind the same interface and are switched off. Switching one on today only makes it fail and fall through to the next provider.

Set a key with `npm run key:set TAVILY_API_KEY` (or the environment variable). Notes the researcher writes go to `research/` (shared) and `books/<book>/research/`.

## Fields of a model

- `id`, `family` (used so reviewers can avoid the writer's family), `context`, `max_output`.
- `price_in`, `price_out`, `price_cached_in`: USD per 1M tokens. Cached input falls back to `price_in` when missing.
- `embedding: true` marks an embedding model.
- LM Studio is switched off in the seed (HUB-38); if you switch it back on, its models load with a small context window (8192 tokens) unless you change it. Long books need more: the engine reads the loaded window from LM Studio and keeps its prompts within it, but a window of 8192 makes long-book prompts fail. Load the models you use with 32768 or more, for example `lms load <model> -c 32768 --parallel 1 --ttl 28800 -y`, or set it in LM Studio's model settings. With `--parallel <n>` the requests running at once share that window, so give it more room when several long requests run together, for example `lms load <model> -c 32768 --parallel 4 --ttl 28800 -y`.
- `load_models: true` (LM Studio): before a request to a model that isn't loaded, the engine loads it with `lmstudio_parallel`, `lmstudio_context` and `lmstudio_ttl_minutes` from `config/settings.md`, using `lms load` (or LM Studio's API when `lms` isn't installed). A model that is already loaded is used as it is, so one you loaded yourself keeps your settings. A model entry can override the context and parallel count with `load_context` and `load_parallel` (a large model whose context cache takes far more memory can use a smaller window and fewer parallel requests). A model LM Studio doesn't have fails at once and the next model in the role's list is tried.
- `extra_body`: optional JSON fields merged into the request body. The local models here send `reasoning_effort: none`, which turns thinking off (checked 2026-10-08 on the Qwen models: a 500-word story took 25 s instead of 3.5 minutes, because the model otherwise spends thousands of hidden tokens thinking). Remove it, or set `low` or `medium`, if you want thinking back for the other models. DeepSeek V4 has thinking on by default and bills it as output. `deepseek-flash` sends `thinking: { type: disabled }` (checked 2026-10-11: with thinking on, a 15k-token continuity check spent all 6000 answer tokens thinking and returned nothing). `deepseek-v4-pro` keeps thinking on. Empty means nothing extra is sent.

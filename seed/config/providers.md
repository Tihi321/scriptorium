---
kind: providers
providers:
  - id: deepseek
    kind: openai-compat
    base_url: https://api.deepseek.com
    api_key_env: DEEPSEEK_API_KEY
    concurrency: 8
    models:
      - id: deepseek-v4-flash
        family: deepseek
        context: 1000000
        price_in: 0.14
        price_out: 0.28
        price_cached_in: 0.0028
        extra_body: null
      - id: deepseek-v4-pro
        family: deepseek
        context: 1000000
        price_in: 1.74
        price_out: 3.48
        price_cached_in: 0.0145
        extra_body: null
  - id: openrouter
    kind: openai-compat
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    concurrency: 4
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
  - id: lmstudio
    kind: openai-compat
    local: true
    base_url: http://localhost:1234/v1
    concurrency: 1
    discover: true
    models:
      - id: ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
      - id: nail-qwen3.6-35b-a3b-mtp
        family: qwen
        extra_body: { reasoning_effort: low }
      - id: nvidia/nemotron-3-nano-4b
        family: nemotron
        extra_body: { reasoning_effort: none }
      - id: poolside/laguna-s-2.1
        family: poolside
        extra_body: { reasoning_effort: none }
      - id: tiel-coder-35b-a3b-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
      - id: text-embedding-nomic-embed-text-v1.5
        family: nomic
        embedding: true
  - id: ollama
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://localhost:11434/v1
    concurrency: 1
    discover: true
    models: []
  # Search services for the researcher (kind: search). They have no models. The order is search_order at the end of the list.
  # price_per_request is logged to the spend files for every answered request (USD, to verify on the provider's pricing page).
  - id: tavily
    kind: search
    engine: tavily
    base_url: https://api.tavily.com
    api_key_env: TAVILY_API_KEY
    price_per_request: 0.008
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
  - id: mock
    kind: mock
    concurrency: 4
    models:
      - id: mock-writer
        family: mock
      - id: mock-reviewer
        family: mock-other
# The researcher tries these search providers in this order: the first one that gives results wins. One without a key is skipped.
search_order: [tavily, wikipedia, brave, serpapi, serphouse, duckduckgo]
---
# Providers

One entry per provider. Edit this file and the engine picks the change up without a restart. API keys are never written here: `api_key_env` names an environment variable, and the engine also looks in the Windows credential store under that name (`npm run key:set <NAME>`).

Prices were checked 2026-10-08 from third-party listings. Verify them at api-docs.deepseek.com/quick_start/pricing and the other providers' pricing pages. The DeepSeek numbers are the ones in use. The OpenRouter, Anthropic and Gemini entries are examples marked "to verify": model ids and prices there may be out of date.

## Fields of a provider

- `id`: the name used in model references. A model is written `provider/model`, for example `lmstudio/nvidia/nemotron-3-nano-4b`.
- `kind`: `openai-compat` (any OpenAI-style API), `anthropic`, `gemini`, `mock` (scripted, for tests) or `search` (web search for the researcher: `engine` names the service, see below).
- `enabled`: `false` switches the provider off. A provider whose key can't be found is skipped automatically.
- `local`: `true` for models on this machine. Local models cost nothing and never count against the caps. Their tokens and time are still recorded.
- `base_url`, `api_key_env`: where to call and which variable holds the key.
- `concurrency`: how many requests may run at once. LM Studio is 1 because all its requests share one GPU.
- `rpm`, `tpm`: optional rate limits (requests and tokens per minute). Only `rpm` is enforced for now.
- `discover`: ask the provider for its models (`GET /v1/models`) and add the ones not listed here.

## Search providers (`kind: search`)

Used only by the researcher. A search provider has no models. `engine` is `tavily`, `wikipedia`, `brave`, `serpapi`, `serphouse` or `duckduckgo` (it defaults to the id). `search_order` (the last line of the frontmatter) is the order they are tried in. Each answered request is written to the spend files with `price_per_request`, and a paid provider is skipped while a budget cap is reached.

- **Tavily** (`TAVILY_API_KEY`): returns cleaned page text with the results. Written, but not yet checked against the real service (no key was available).
- **Wikipedia**: the MediaWiki API, no key, free. Sends a descriptive User-Agent. Good for basics, weak for specialist facts.
- **Brave, SerpApi, SERPHouse, DuckDuckGo**: stubs. They sit behind the same interface and are switched off. Switching one on today only makes it fail and fall through to the next provider.

Set a key with `npm run key:set TAVILY_API_KEY` (or the environment variable). Notes the researcher writes go to `research/` (shared) and `books/<book>/research/`.

## Fields of a model

- `id`, `family` (used so reviewers can avoid the writer's family), `context`, `max_output`.
- `price_in`, `price_out`, `price_cached_in`: USD per 1M tokens. Cached input falls back to `price_in` when missing.
- `embedding: true` marks an embedding model.
- LM Studio models load with a small context window (8192 tokens) unless you change it. Long books need more: the engine reads the loaded window from LM Studio and keeps its prompts within it, but a window of 8192 makes long-book prompts fail. Load the models you use with 32768 or more, for example `lms load nail-qwen3.6-35b-a3b-mtp -c 32768 --parallel 1 --ttl 28800 -y`, or set it in LM Studio's model settings.
- `extra_body`: optional JSON fields merged into the request body. The LM Studio chat models here send `reasoning_effort: none`, which turns thinking off (checked 2026-10-08 on the Qwen models: a 500-word story took 25 s instead of 3.5 minutes, because the model otherwise spends thousands of hidden tokens thinking). The Qwen 35B MoE (used for review) uses `low` so its verdicts are steadier. Remove it, or set `low` or `medium`, if you want thinking back for the other models. DeepSeek V4 has thinking on by default and bills it as output. The field that turns it off is not set here because the exact name hasn't been checked. Find it in the DeepSeek API docs and put it under `extra_body` for the model, for example `extra_body: { some_field: value }`. Empty means nothing extra is sent.

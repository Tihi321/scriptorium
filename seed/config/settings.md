---
kind: settings
kindle_address: ""
from_address: ""
smtp_host: ""
smtp_port: 587
smtp_user: ""
smtp_secure: false
fallbacks:
  - deepseek/deepseek-flash
  - strata/qwen3.8-flash-next
  - lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic
fallback_shared: false
last_resort_model: ""
lmstudio_parallel: 4
lmstudio_context: 131072
lmstudio_ttl_minutes: 60
---
# Settings

Sending books to your Kindle by email.

- `kindle_address`: your Send to Kindle address (for example `yourname_123@kindle.com`).
- `from_address`: the sender address. It must be on the approved list in your Amazon account (Content & Devices, Preferences, Personal Document Settings).
- `smtp_host`, `smtp_port`, `smtp_user`, `smtp_secure`: your mail server. `smtp_secure: true` for port 465, `false` for 587 with STARTTLS.
- The password is not stored here. Enter it in the app's settings, which keeps it in the Windows credential store (account `SCRIPTORIUM_SMTP_PASSWORD`). The environment variable of the same name also works.

## Default models

`fallbacks` is the list of models the factory falls back through, first row first. It can have any length, and a kind may repeat: for example API, API, LM Studio, API. Each row is one `provider/model`. Its **kind** comes from the model's provider, so a row can't disagree with its model: an API provider (free or paid) is `paid`, any other provider is named by its id (`strata`, `lmstudio`, `client` ...). Edit the list here or in the app's Models panel (a kind, then its model, with add, remove, up and down). A change applies at once, to running jobs too.

The role lists in `roles.md`, an agent's `model` and a book's `role_models` can name a kind instead of a model: `paid` is the first API row, `paid-2` the second, `strata` the first Strata row, `lmstudio-2` the second LM Studio row, `client` the first client row. A name with no matching row is skipped (the engine logs it once). An agent's own model, picked in the app, still goes first.

- `fallbacks`: the rows, for example the three below. At least one.
- `fallback_shared`: `true` gives every role the rows top to bottom (the Models panel's "One fallback order for every role"). A role's own concrete model of the same kind takes the place of the first row of that kind not taken yet (the checks name Strata's `-low` model, so it takes the Strata row's place). A model with no row of its kind, such as that one without a Strata row, comes after the rows. A role gets every row, even for a kind its own list leaves out. `false` keeps each role's own order from `roles.md`, and the rows only say what `paid`, `strata`, `lmstudio` ... stand for.

```yaml
fallbacks:
  - deepseek/deepseek-flash                 # paid
  - openrouter/google/gemma-4-31b-it:free   # paid-2
  - lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic   # lmstudio
  - deepseek/deepseek-v4-pro                # paid-3
```

## Last resort

- `last_resort_model`: a `provider/model` (or a kind name such as `paid`), empty by default. It is used only when **every** model of a job's role is down or used up for the day (a Strata that is not running and an OpenRouter day that is full, for example). It is not used while a model is only busy or rate-limited (the job waits for it), or when the budget keeps a paid model out. The job runs on this model alone, and the engine logs `every model of <role> is unusable (...): using the last resort <ref>`. If the last resort is busy, down or over budget itself, the job waits, and `factory_status` shows why. A paid model here still goes through the budget caps. A `client` model here means those jobs wait for a Claude Code session to take them (nothing else runs them). Set it here: it has no control in the app.

## LM Studio loading

When a request goes to an LM Studio model that isn't loaded, the engine loads it first with these settings (also in the app's Models panel, under lmstudio) (through `lms load`, or LM Studio's API when the `lms` command isn't installed). A model that is already loaded is used as it is.

- `lmstudio_parallel`: how many requests the model serves at once (`--parallel`). 1 means one at a time.
- `lmstudio_context`: the context window (`-c`). The parallel requests share it: one request may use all of it (checked 2026-10-11). A long-book check takes about 23,000 tokens with its answer, so plan about 25,000 per request that runs at once: 131072 suits Gemma 4 E4B with 4 at once. A model in `providers.md` can have its own `load_context` and `load_parallel` (the big Qwen models use 65536 and 2).
- `lmstudio_ttl_minutes`: LM Studio unloads the model after this many idle minutes (`--ttl`).

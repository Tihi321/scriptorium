---
kind: roles
embeddings: lmstudio/text-embedding-nomic-embed-text-v1.5
roles:
  editor-in-chief:
    models: [paid, strata, lmstudio]
  idea-generator:
    models: [paid, strata, lmstudio]
  architect:
    models: [paid, strata, lmstudio]
  writer:
    models: [paid, strata, lmstudio]
  publisher:
    models: [paid, strata, lmstudio]
  developmental-editor:
    models: [strata, lmstudio, paid]
  line-editor:
    models: [strata, lmstudio, paid]
  copy-editor:
    models: [strata, lmstudio, paid]
  humanizer:
    models: [deepseek/deepseek-flash, paid]
  beta-reader:
    models: [strata, lmstudio, paid]
  child-safety-reviewer:
    models: [strata, lmstudio, paid]
  read-aloud-reviewer:
    models: [strata, lmstudio, paid]
  continuity-checker:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  originality-checker:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  fact-checker:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  researcher:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  archivist:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
---
# Roles

The default models for each role, as an ordered list of `provider/model` or an alias. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list.

The aliases `paid`, `strata` and `lmstudio` stand for the default models in `config/settings.md` (also in the app's Models panel): DeepSeek V4.1 Flash, Strata's Qwen3.8-Flash-Next and LM Studio's Gemma 4 E4B to start with. Change a default there and every role that uses the alias follows.

Starting choices, all of them first guesses to be tuned in the model picker:
- Writers, architect, editor-in-chief, idea generator, publisher: the paid default, with Strata and then LM Studio as fallbacks.
- The humanizer (SCP-13, changed in SCP-14): DeepSeek Flash first, then the paid default. Strata and the free OpenRouter models broke sentences into fragments and needed retries, and DeepSeek Flash is cheap. It has no LM Studio step: a small local model cut too much and added em dashes, so a refused pass (the guards keep the original) is better than a bad one. Per book it can be set to another model, for example the client. Existing data folders keep their own chain.
- Editors and reviewers (per book a model can be set, for example the client): Strata (local Qwen3.8-Flash-Next with thinking off: a different model family from the DeepSeek writer, and free), then LM Studio, then the paid default.
- Archivist, researcher and the checks (continuity, originality, fact): Strata with thinking on `low` (named directly, it is not the Strata default), then LM Studio, then the paid default.
- Embeddings: the local nomic model in LM Studio. Strata has no embeddings, so LM Studio keeps nomic loaded while Strata runs.

Reviewer jobs prefer a model family different from the book's writer. Changing a default here applies at once: a running job asks its current request again on the new model. `model_order` in `config/settings.md` (the Models panel) can sort every list here by group (API, Strata, LM Studio) instead. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.

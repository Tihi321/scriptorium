---
kind: roles
embeddings: acp/llama/nomic-embed-text-v1.5
roles:
  editor-in-chief:
    models: [paid, acp]
  idea-generator:
    models: [paid, acp]
  architect:
    models: [paid, acp]
  writer:
    models: [paid, acp]
  publisher:
    models: [paid, acp]
  developmental-editor:
    models: [acp, paid]
  line-editor:
    models: [acp, paid]
  copy-editor:
    models: [acp, paid]
  humanizer:
    models: [deepseek/deepseek-flash, paid]
  beta-reader:
    models: [acp, paid]
  child-safety-reviewer:
    models: [acp, paid]
  read-aloud-reviewer:
    models: [acp, paid]
  continuity-checker:
    models: [acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]
  originality-checker:
    models: [acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]
  fact-checker:
    models: [acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]
  researcher:
    models: [acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]
  archivist:
    models: [acp/antigravity/gemini-4-hydrogen, acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]
---
# Roles

The default models for each role, as an ordered list of `provider/model` or an alias. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list.

The aliases `paid` and `acp` stand for the first API row and the first ACP proxy row of the `fallbacks` list in `config/settings.md` (also in the app's Models panel): DeepSeek V4.1 Flash and the local Strata model behind the ACP proxy (`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`, thinking off) to start with. `paid-2`, `acp-2` ... stand for the second row of a kind, and so on. Change a row there and every role that uses the alias follows.

Starting choices, all of them first guesses to be tuned in the model picker. Since HUB-38 every local model is reached through the ACP proxy; the `strata` and `lmstudio` providers are switched off:
- Writers, architect, editor-in-chief, idea generator, publisher: the paid default, with the local model behind the ACP proxy as fallback.
- The humanizer (SCP-13, changed in SCP-14): DeepSeek Flash first, then the paid default. Strata and the free OpenRouter models broke sentences into fragments and needed retries, and DeepSeek Flash is cheap. It has no local step: a small local model cut too much and added em dashes, so a refused pass (the guards keep the original) is better than a bad one. Per book it can be set to another model, for example the client. Existing data folders keep their own chain.
- Editors and reviewers (per book a model can be set, for example the client): the local Strata model through the proxy (`acp`, thinking off: free, and a different model family from the DeepSeek writer), then the paid default.
- Researcher and the checks (continuity, originality, fact): the local Strata model by its full id (`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`; the proxy cannot carry a `-low` variant, so the checks run with thinking off), then the paid default. The archivist tries Antigravity's `acp/antigravity/gemini-4-hydrogen` first, then the local model, then the paid default.
- Embeddings: the local nomic model through the ACP proxy (`acp/llama/nomic-embed-text-v1.5`, AAP-43), on its own small server beside the chat model. Only one local chat model is on the GPU at a time: a request for another one waits for the proxy to switch (minutes).

Reviewer jobs prefer a model family different from the book's writer. Changing a default here applies at once: a running job asks its current request again on the new model. `fallback_shared` in `config/settings.md` (the Models panel) can give every role the fallback list there instead, top to bottom. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.

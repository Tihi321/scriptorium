---
kind: roles
embeddings: lmstudio/text-embedding-nomic-embed-text-v1.5
roles:
  editor-in-chief:
    models: [deepseek/deepseek-v4-flash, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  idea-generator:
    models: [deepseek/deepseek-v4-flash, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  architect:
    models: [deepseek/deepseek-v4-flash, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  writer:
    models: [deepseek/deepseek-v4-flash, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  publisher:
    models: [deepseek/deepseek-v4-flash, lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp]
  developmental-editor:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  line-editor:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  copy-editor:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  beta-reader:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  child-safety-reviewer:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  read-aloud-reviewer:
    models: [lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp, deepseek/deepseek-v4-flash]
  continuity-checker:
    models: [lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]
  originality-checker:
    models: [lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]
  fact-checker:
    models: [lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]
  researcher:
    models: [lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]
  archivist:
    models: [lmstudio/nail-qwen3.6-35b-a3b-mtp, deepseek/deepseek-v4-flash]
---
# Roles

The default models for each role, as an ordered list of `provider/model`. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list.

Starting choices, all of them first guesses to be tuned in the model picker:
- Writers, architect, editor-in-chief, idea generator, publisher: DeepSeek, with the local Qwen 27B as fallback.
- Editors and reviewers: the local Qwen 27B (a different model family from the DeepSeek writer, and free), with DeepSeek as fallback.
- Archivist, researcher and the checks (continuity, originality, fact): the local Qwen 35B MoE, which is fast.
- Embeddings: the local nomic model.

Reviewer jobs prefer a model family different from the book's writer. Changing a default here applies from the next job. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.

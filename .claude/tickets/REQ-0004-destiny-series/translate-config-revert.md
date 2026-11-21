# P3 translation: temporary config changes

No config file was changed. Paid models were blocked per project instead:

- Project `the-one-way-street-why-time-only-runs-hr-30e47a` was created with `clientOnly: true`, so all four agents (glossary, translator, proofreader, qa) ran on `client/claude-code` and the project refuses any other model.
- `~/BookTranslator/config/providers.md` and `config/defaults.json`: untouched (DeepSeek stays as it was, no key was entered).
- No budget cap setting exists in Book Translator, so none was changed.

Nothing to revert. Engine process stopped; `~/BookTranslator/engine.lock` is a stale file left by the stopped headless engine (the pid is dead; the next start ignores it, as it did at the start of this run).

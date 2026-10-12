---
kind: models
picked: []
hidden: []
---
# Models in the pickers

Which models the model pickers offer (the agent panel, Role defaults and Settings). The app writes this file from its **Models** dialog (Settings, then **Choose models**): pick a provider, press **Detect models** to list everything it has, and tick the models you want. You can also edit it by hand.

- `picked`: models a provider lists that are not in `providers.md`, each with its `provider`, `id`, `context` and the price the provider listed when you picked it (`price_in`, `price_out`, `price_cached_in`, USD per 1M tokens). The budget counts them at that price. A paid model is only picked with a listed price; to use one whose price the provider doesn't list (DeepSeek's), add it to `providers.md` with its price.
- `hidden`: `provider/model` refs the pickers leave out: models from `providers.md` or found by `discover` that you unticked. A role list in `roles.md` can still name a hidden model.

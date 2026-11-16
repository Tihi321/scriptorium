---
status: done
request: REQ-0027
repos: [scriptorium]
branch: SCP-63_proxy-backoff
updated: 2026-11-16
---
# SCP-63: proxy backoff

Follow-up to SCP-62 (`syncProxyHealth` in `src/engine/engine.ts`).

## Scope

- An unreachable ACP proxy (refused, timed out, 5xx) is asked again after 60 s, 120 s, 240 s, then every 5 min at most; never given up.
- An ok answer resets it to the 10 s poll. The not-proxy count is unchanged. Proxy-set entries stay until their `until`.
- The delay is a pure function `proxyRetryDelayMs` in `src/engine/models/proxyHealth.ts`.
- The engine comment and the `docs/design.md` sentence ("every 60 s") are updated.

## Acceptance

- One table test for `proxyRetryDelayMs` (1..5 and 20 failures).
- `yarn test`, `yarn typecheck`, `yarn lint` pass.
- Not tested live (Scriptorium is not started).

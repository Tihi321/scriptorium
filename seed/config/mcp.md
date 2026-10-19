---
kind: mcp
enabled: true
host: 127.0.0.1
port: 7341
token_env: SCRIPTORIUM_MCP_TOKEN
---
# MCP server

The engine can serve the factory to outside agents (Claude Code, Codex and others) over MCP, at `http://<host>:<port>/mcp`. It runs wherever the engine runs: with the app open, with `--headless`, or with plain `yarn headless`. The agents can read everything and give orders (add stories, notes, pause books, hire agents); they cannot touch secrets, settings or Kindle. Changes to this file apply at the next engine start.

- `enabled`: `false` switches the server off. The engine flags `--mcp` and `--no-mcp` override it.
- `host`: only loopback is allowed. Any other host is refused and `127.0.0.1` is used.
- `port`: the port to listen on. `--mcp-port <n>` overrides it. If the port is taken, the factory keeps working without MCP.
- `token_env`: the name of the secret that holds a bearer token. When that environment variable (or Windows credential) is set, every request needs `Authorization: Bearer <token>`. The token itself never goes in this file: set it with `yarn key:set SCRIPTORIUM_MCP_TOKEN`.

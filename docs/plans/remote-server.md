# Remote server (v0.36.0)

One Mnemosyne store on an always-on host (Unraid + Dokploy), reached over Tailscale by
every PC. The container serves the dashboard behind a password and two keyed routes:
`/api/plugin/*` for the Claude Code plugin in client mode, and `/mcp` for other MCP
clients. This file is the contract the parts are built against.

## Server mode (ui/server.ts --server)

Started as `bun ui/server.ts --server`. It runs until SIGTERM/SIGINT: no parent,
stdin or ui-users.json watch, no ui.json handoff.

| Variable | Meaning |
|---|---|
| `MNEMOSYNE_ROOT` | data root, e.g. `/data` (config.json, vocabulary.json, projects.json, activity.jsonl, keys.json, server-secret, backups/) |
| `MNEMOSYNE_STORE` | the store, e.g. `/data/store` |
| `MNEMOSYNE_CLI` | the engine cli, e.g. `/opt/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts` |
| `MNEMOSYNE_PLUGIN_ROOT` | the repo copy in the image, e.g. `/app` (bin/memories.ts, bin/projects.ts, bin/mcp-proxy.ts) |
| `MNEMOSYNE_UI_PASSWORD` | required, 8+ characters: the dashboard password |
| `MNEMOSYNE_PORT` | default `8787` |
| `MNEMOSYNE_BIND` | default `0.0.0.0` |
| `MNEMOSYNE_HOSTS` | optional comma list of allowed `Host` header values; empty allows any |
| `MNEMOSYNE_PUBLIC_URL` | optional, e.g. `https://mnemosyne.tail1234.ts.net`: the address shown in copied connection settings; else the page's own origin |
| `MNEMOSYNE_EMBEDDINGS` | `on` or `off` |
| `MNEMOSYNE_MODEL_CACHE` | absolute PI_CONFIG_DIR for the engine, e.g. `/opt/mnemosyne/model-cache` |
| `MNEMOSYNE_ACTIVITY_LOG` | default `<root>/activity.jsonl`; empty string turns it off |
| `MNEMOSYNE_SECURE_COOKIE` | `auto` (default: Secure when `X-Forwarded-Proto: https`), `1`, `0` |

The local dashboard (no `--server`) is unchanged: 127.0.0.1, random token in the link.

## Dashboard API in server mode

- `GET /api/session` (no auth) -> `{ server: true, signedIn: boolean, publicUrl: string }`. In local
  mode this route does not exist without the token (401), which is how the page tells the modes apart.
- `POST /api/login` `{ password }` -> `200 { ok: true }` with a session cookie (30 days, HttpOnly,
  SameSite=Strict, Secure per the setting); `401 { error }` on a wrong password; `429 { error, retryAfter }`
  after 5 wrong tries in a row (60 s pause).
- `POST /api/logout` -> `200 { ok: true }`, cookie cleared.
- Every other `/api/*` route takes the cookie instead of the bearer token. POSTs need an `Origin` whose
  host equals the request's `Host`. The page sends no `Authorization` header in server mode.
- `GET /api/health` adds `server: true` in server mode. The Update button is hidden then (upgrade = redeploy);
  `/api/update*` answer `404`.
- Device keys (cookie only, never a key):
  - `GET /api/keys` -> `{ keys: [{ id, name, created, lastUsed }] }` (ISO strings, `lastUsed` null when never)
  - `POST /api/keys/create` `{ name }` (1-60 chars) -> `{ id, name, created, key }`; the key is shown once
  - `POST /api/keys/revoke` `{ id }` -> `{ ok: true }` or `404`
- Keys look like `mn_<id 8 chars>_<secret 43 chars>` (base64url). keys.json (0600) holds only the
  SHA-256 of each key.

## Plugin routes (bearer device key)

`Authorization: Bearer mn_...`. No cookie, no Origin check. 401 `{ error: 'unauthorized' }` on a bad key;
429 after 20 bad keys in a minute.

- `GET /api/plugin/hello` -> `{ ok: true, plugin, engine, embeddings }`
- `POST /api/plugin/engine` `{ owner, requests, timeoutMs? }`: `requests` is the exact text
  `hooks/engine.ts buildRequests` makes (JSON-RPC `tools/call` lines). Every line must be a `tools/call` of
  `mnemopi_remember | recall | update | forget | get | stats | similar | invalidate`, else 400. `owner` is
  `global` or `project-...`. The server runs one engine process as that owner and answers
  `{ stdout, stderr, exitCode }`, which `parseReplies` reads as if the engine ran locally.
- `POST /api/plugin/memories` `{ args }`: `args[0]` is `first-prompt` or `row-info`; the server runs
  `bun bin/memories.ts --store <store> ...args` -> `{ stdout, stderr, exitCode }`.
- `POST /api/plugin/project` `{ input }` (a project record) -> runs `bun bin/projects.ts write <root>/projects.json`; a PC sends it after its session start hello (0.36.1).
- `POST /api/plugin/resolve` `{ input }` (a ResolveInput) -> runs `bun bin/projects.ts resolve <root>/projects.json <store>`
  with the input on stdin -> `{ stdout, stderr, exitCode }`.

## MCP route

`POST /mcp`, Streamable HTTP, stateless, JSON replies (`application/json`). Bearer device key. Each POST runs
`bin/mcp-proxy.ts` once with a synthetic `initialize` whose client name is `<device name>`, so saves are recorded
as `mcp:<device name>`, `EXTERNAL_WRITE`. Owner: `global`, or the `Mnemosyne-Owner` header (`project-...`).
A notification answers `202`. `GET` and `DELETE` answer `405`.

## Plugin client mode

Two userConfig fields: `serverUrl` (string) and `serverKey` (string, sensitive). When `serverUrl` is set:

- every engine run, `first-prompt`, `row-info` and the owner resolve go through `bun bin/remote.ts <op>`
  (op: `engine | memories | resolve | hello`), stdin `{ url, key, body, timeoutMs }`; it POSTs to
  `<url>/api/plugin/<op>`, prints the reply's stdout and stderr and exits with its exitCode. Unreachable server:
  exit 75, "mnemosyne server unreachable"; 401: exit 77. Connect budget about 3 s.
- no local engine is needed: no install toast, no auto update, no syncWrapper, no sweep, no summaries,
  no knowledge extraction; the store-wide commands (`/mnemosyne-tags`, `-import`, `-knowledge`, `-embed`,
  `-setup`, `-ui`) answer that they run on the server (or open its dashboard, for `-ui`).
- after one unreachable call the session marks memory offline for 60 s: calls fail at once, the status line says
  "Mnemosyne · memory offline".

## Docker

`Dockerfile` and `docker-compose.yml` at the repo root, `docker/` for helpers. Debian Bun image; the engine and
model are installed at build time under `/opt/mnemosyne`; the data volume is `/data`. Compose runs a Tailscale
sidecar (`tailscale/tailscale`, hostname `mnemosyne`, `tailscale serve` HTTPS 443 -> 127.0.0.1:8787) and the
app with `network_mode: service:tailscale`. No published port.

## Server upkeep (0.36.1)

Once a day (the `<root>` sweep marker) the server backs the store up and runs the unused-expiry sweep for every owner (`MNEMOSYNE_EXPIRE_UNUSED_DAYS`, 90 by default, 0 off). Each plugin engine call leaves an activity line in the server log (client `claude-code`, `device` = the key name).

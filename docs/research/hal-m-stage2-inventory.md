# HAL-M stage 2: inventory and migration design

Date: 2026-11-22. Read-only research, nothing in the repo or on any PC was changed. Excluded from every count: `engine/`, `node_modules/`, `.git`, `.inbox/`, `docs/research/`. Counts are grep line counts of the string, so one line can hold several hits.

Companion file: `docs/research/hal-m-stage2-external-refs.md` (what outside the repo names the old ids: Mac `~/.claude`, other repos, other agents, 7of9). This report does not repeat it; section 3 only adds what that file does not cover.

Short answer:

1. 129 files mention the old name (59 tests, 11 in docs/plans history, README, DESIGN and CHANGELOG, and 56 source and config files). The code change is mechanical; the risk is in four places: the plugin id (stored options are keyed by it), the tool prefix (it follows the plugin name, so old rules cannot be kept as an alias), the data folder move (running processes, launchers and other tools hold paths into it) and the server container (its env vars are set in Unraid and Dokploy, outside the repo).
2. Env vars, the data folder, slash commands, the HTTP header, the launcher name and the root marker can all keep working under the old names for a transition. The tool names and the plugin id cannot: after the rename, a PC has either the old plugin or the new one.
3. The stored plugin options do not move by themselves. Non-sensitive ones sit under `pluginConfigs["mnemosyne@mnemosyne"]` in `settings.json`; the `serverKey` sits in the macOS Keychain (or `~/.claude/.credentials.json`) under the old id, and a device key is shown only once on the server, so each PC needs a new key or the old one typed again.
4. 59 of the 98 test files pin an old name (about 907 lines); two files hold 60 percent of them (`tests/register.test.ts` 363, `tests/bun/launcher.spec.ts` 131).
5. Six tasks, three of them parallel after one foundation task. Section 5.

---

## 1. Inventory by category

### a. Plugin id and marketplace name `mnemosyne`

| # | File | Pattern | Count |
|---|------|---------|-------|
| 1 | `.claude-plugin/plugin.json` | `"name": "mnemosyne"`, keyword, option descriptions naming `/mnemosyne-*` and `~/.claude/mnemosyne` | 8 |
| 2 | `.claude-plugin/marketplace.json` | marketplace `name`, plugin entry `name` | 2 |
| 3 | `package.json` | `"name": "claude-mnemosyne"` (private, only a label) | 1 (+1 in `bun.lock`) |
| 4 | `hooks/register.ts:151,154` | `atom({ plugin: 'mnemosyne', ... })` | 2 |
| 5 | `types/index.d.ts:11` | `interface PluginState { mnemosyne: {...} }` (the key is the plugin name) | 1 |
| 6 | `hooks/register.ts:141` | prompt section id `'mnemosyne:rules'` | 1 |
| 7 | `hooks/register.ts:887`, `hooks/ui-launch.ts:175` | `${$.plugin.name}@${$.plugin.name}` used as the plugin id: assumes marketplace name equals plugin name | 2 |
| 8 | `ui/update.ts:156` | text `claude plugin update mnemosyne@mnemosyne` | 1 |
| 9 | `ui/server-mode.ts:70,73` | copied snippet `mcpServers: { mnemosyne: {...} }` and text "/plugin -> mnemosyne -> configure" | 2 |
| 10 | `README.md` lines 12, 18, 23, 32, 74, 525, 701 | install, update, uninstall commands, "/plugin -> mnemosyne" | about 8 |
| 11 | `docker/unraid/my-HAL-M.xml` | no plugin id (server only) | 0 |
| 12 | Tests: `tests/bun/update-dashboard.spec.ts` 2, `tests/bun/fixtures/claude-stub.ts` 2, `tests/ui-launch.test.ts`, `tests/register.test.ts`, `tests/bun/settings-view.spec.ts`, `tests/bun/settings-routes.spec.ts` (1 each) | the id as a fixture | 9 |

Notes:

1. The plugin has no `mcpServers` or `commands` key in `plugin.json`: it is a module plugin (`hooks/hooks.json` loads `./register.ts`). Tools and commands are registered at runtime, so their names are in `register.ts`, not in the manifest.
2. The repo name was already changed in stage 1 (`claude-hal-m`); `marketplace.json` has no repo URL, the installed marketplace record in `~/.claude/plugins/known_marketplaces.json` does.
3. Claude Code's reserved-name rules (docs, plugins-reference) do not forbid `hal-m`: only names starting with claude-, anthropic- or cc-plugin- and a few exact words.
4. The two places that build the id as `name@name` (item 7) must stay true or be changed to read the marketplace; keeping marketplace name equal to plugin name is the cheaper choice.

### b. Tool names Claude sees and the MCP server names

| # | File | Pattern | Count |
|---|------|---------|-------|
| 1 | `hooks/register.ts:127,146,2526,2527,2715,2787` | `mcp__mnemosyne__memory_*` in the rules block, the recall heading, the `tool.call` matcher `/^mcp__mnemosyne__memory_/`, the prefix strip, the trigger text | 6 lines |
| 2 | `hooks/session.ts:257` | `[cut: call mcp__mnemosyne__memory_get ...]` text that Claude reads | 1 |
| 3 | `README.md` (2), `DESIGN.md` (2) | tool names in prose | 4 |
| 4 | `hooks/register.ts:2300` | `$.tool.register({ ...tool })` with bare names `memory_remember` ... (the six tools); the host adds the prefix | 1 |
| 5 | `hooks/surface.ts:10` | `memory_stats` reply field `provider: 'mnemosyne'` (Claude sees it) | 1 |
| 6 | `bin/mcp-proxy.ts:432` | stdio server answers `serverInfo.name = 'mnemosyne'` | 1 |
| 7 | `ui/remote.ts:450` | HTTP `/mcp` answers `serverInfo: { name: 'mnemosyne' }` | 1 |
| 8 | `ui/server-mode.ts:70` | the JSON snippet the dashboard hands out: `mcpServers.mnemosyne` | 1 |
| 9 | `hooks/register.ts:2386`, README line 633 | `claude mcp add mnemosyne-memory -- <wrapper>` hint | 2 |
| 10 | `bin/install-engine.ts:285` | engine package name `mnemosyne-engine` (a label in the engine's own package.json) | 1 |
| 11 | Tests: `tests/register.test.ts` 201 lines with `mcp__mnemosyne__`, `tests/bun/knowledge-host.ts` 1 | | 202 |

How the prefix is made (evidence): the MCP instructions the host gives say "Tools registered by the mnemosyne plugin through $.tool.register", and the tool calls arrive as `mcp__mnemosyne__memory_*`. So the prefix is `mcp__<plugin name>__`. For a new name `hal-m` the prefix becomes `mcp__hal-m__` (inferred, not yet tried; hyphens in prefixes work for other plugins, for example `mcp__plugin_context-mode_context-mode__`). Verify with a throwaway plugin or the first built copy before anything else (task T2 step 1).

The old-prefix tools cannot be registered next to the new ones from the same plugin, because the host derives the prefix from the plugin name. A rename means a hard cut for every rule that names `mcp__mnemosyne__*`.

External MCP server names that the user's other agents hold (`mnemosyne-memory`, in omp, gemini and antigravity configs) are the clients' own labels and are not read by the repo; see the companion file. Only the hints in item 9 and the snippet in item 8 are repo text.

### c. Slash commands

Six names, registered at session start in `hooks/register.ts:2271-2294` and handled by `on('command.run', { command: '...' })` at lines 2326, 2403, 2431, 2447, 2465, 2481.

| # | File | Hits (`mnemosyne-setup|ui|tags|import|knowledge|embed`) |
|---|------|------|
| 1 | `hooks/register.ts` | 90 (6 registrations, 6 handlers, the rest in reply texts) |
| 2 | `README.md`, `DESIGN.md` | 54, 52 |
| 3 | `ui/app.ts` 10, `ui/server.ts` 6, `ui/health.ts` 5, `ui/settings.ts` 4, `ui/knowledge.ts` 4, `ui/index.html` 4, `ui/map-state.ts` 2, `ui/vocabulary.ts`, `ui/form.ts`, `ui/map.ts`, `ui/search-mode.ts`, `ui/update-routes.ts`, `ui/settings-routes.ts` | 40 (dashboard text, the copy button at `ui/app.ts:4250` copies `/mnemosyne-ui`) |
| 4 | `hooks/ui-launch.ts` 5, `hooks/engine-build.ts` 4, `hooks/import.ts` 2, `hooks/knowledge.ts`, `hooks/engine.ts`, `hooks/backfill.ts`, `hooks/activity-log.ts` | 15 (comments and messages) |
| 5 | `bin/*.ts` (memories 3, update 2, install-engine 2, eval 2, ui-users, mcp-proxy, import, activity), `scripts/dev-ui.ts` 3 | 17 (messages) |
| 6 | `.claude-plugin/plugin.json` | 2 (option descriptions) |
| 7 | Tests | 87 lines in 16 files (`tests/register.test.ts` 50, `tests/ui-launch.test.ts` 6, `tests/bun/import.spec.ts` 6, `tests/bun/health-view.spec.ts` 5, others 1-3) |

Other command-like names: the activity-log client labels `mnemosyne-knowledge`, `-tags`, `-import`, `-session`, `-sweep` (`hooks/register.ts:1452,1548,1869,1870,2101,2148,2199,2203`, `ui/remote.ts:580,582`). They are written into `activity.jsonl` as the `client` field, so old log lines keep the old label. Rename is optional; any filter that groups on them must accept both (not checked in `ui/`).

### d. `MNEMOSYNE_*` environment variables

34 distinct names, 488 occurrences in all, 210 of them outside tests, docs/plans and the CHANGELOG. Highest: `MNEMOSYNE_ACTIVITY_LOG` 55, `_ROOT` 49, `_OWNER` 40, `_GUARD_MODE` 40, `_EMBEDDINGS` 35, `_VOCABULARY` 32, `_CLI` 30, `_UI_PASSWORD` 22, `_EXTRACTION` 20, `_STORE` 15.

By role (this decides who has to accept both names):

| # | Role | Names | Set by |
|---|------|-------|--------|
| 1 | Launcher to proxy (stdio MCP) | CLI, ACTIVITY_LOG, GUARD_MODE, VOCABULARY, ROOT, OWNER | `hooks/launcher.ts:31-103`, `ui/remote.ts:411-415`, `hooks/ui-launch.ts:180-190` |
| 2 | Plugin to dashboard server | PLUGIN_ROOT, PLUGIN_ID, ROOT, STORE, CLI, ACTIVITY_LOG, EXTRACTION, EMBEDDINGS, CLAUDE_CLI, UI_DEV, UI_PORT, UI_TOKEN, UI_PARENT_CHECK_MS | `hooks/ui-launch.ts`, `scripts/dev-ui.ts` |
| 3 | Server container (set by the operator) | UI_PASSWORD, PORT, BIND, SECURE_COOKIE, PUBLIC_URL, HOSTS, EXPIRE_UNUSED_DAYS, MODEL_CACHE, ROOT, STORE, CLI, PLUGIN_ROOT, EMBEDDINGS | Unraid template, Dokploy env, `.env`, Dockerfile |
| 4 | Compose and build only | DATA, BUILD_EMBEDDINGS | `docker-compose.yml`, `.env.example` |
| 5 | Update and install | LOCK_WAIT_MS, UPDATE_CMD, UPDATE_CWD | `hooks/register.ts:1924`, `ui/update-routes.ts:221-224`, `bin/install-engine.ts:354,613`, `bin/update.ts:918` |
| 6 | Dev and tests | HOME, DEV_ENGINE, ACTIVITY_APPEND, CAPTURE | `scripts/dev-ui.ts`, `hooks/register.ts:917,934`, tests |
| 7 | Settings the plugin reads from Claude Code's environment | ACTIVITY_APPEND (read with `$.env.get`) | the user's shell or settings `env` |

Per file, non-test: `ui/server.ts` 26, `ui/remote.ts` 19, `hooks/launcher.ts` 19, `scripts/dev-ui.ts` 16, `docker/entrypoint.sh` 10, `Dockerfile` 10, `hooks/ui-launch.ts` 9, `bin/mcp-proxy.ts` 9, `docker-compose.yml` 7, `README.md` 7, `.env.example` 7, `bin/update.ts` 5, `docker/init-data.ts` 4, `docker/unraid/my-HAL-M.xml` 4, `bin/install-engine.ts` 3, `hooks/register.ts` 3, `ui/warm-engine.ts` 2, `ui/update-routes.ts` 2, `.github/workflows/docker.yml` 1, `hooks/engine-build.ts` 1, `ui/settings-routes.ts` 1; `DESIGN.md` 13.
Tests (23 files, 227 lines): `tests/bun/launcher.spec.ts` 107, `tests/register.test.ts` 23, `tests/bun/mcp-proxy.spec.ts` 19, `tests/ui-launch.test.ts` 11, `tests/bun/ui-server.spec.ts` 8, `tests/bun/server-mode.spec.ts` 8, `tests/bun/ui-search-mode.spec.ts` 8, `tests/bun/knowledge-api.spec.ts` 7, the rest 1-6.

Different, not environment variables: `MNEMOPI_*` and `PI_CONFIG_DIR` belong to the vendored engine and stay.

### e. Data folder and launcher

`~/.claude/mnemosyne` (Windows `%USERPROFILE%\.claude\mnemosyne`) is built in these places:

| # | File:line | What |
|---|-----------|------|
| 1 | `hooks/register.ts:314,316,878` | `root`, default `memoryDir` `~/.claude/mnemosyne/store`, the DEFAULTS filled into settings |
| 2 | `hooks/engine.ts:15` | `EMBEDDINGS_CACHE_DIR = '.claude/mnemosyne/model-cache'` (relative to HOME; also baked into every launcher as `PI_CONFIG_DIR`) |
| 3 | `bin/update.ts:102,103,110` | `root`, `~/.claude/mnemosyne-ui` (Windows update shortcut scripts), launcher path |
| 4 | `bin/eval.ts:319` | default `--root` |
| 5 | `ui/update-routes.ts:167-171` | detects "Claude Desktop install" by comparing root with `<home>/.claude/mnemosyne` |
| 6 | `ui/settings-routes.ts:251,337` | setup status looks in `<home>/.claude/mnemosyne`; checks `bin/mnemosyne-mcp(.cmd)` |
| 7 | `scripts/dev-ui.ts:22` | `MNEMOSYNE_HOME` default |
| 8 | `.claude-plugin/plugin.json:50,65,66,95` | option descriptions and the `memoryDir` default value |
| 9 | `bin/mcp-proxy.ts:27`, `hooks/ui-launch.ts:57`, `ui/app.ts:2549`, `ui/update-routes.ts:197,303` | comments and user-facing paths (`update.log`) |
| 10 | `README.md` about 30 lines, `DESIGN.md` | paths in prose and commands |

Launcher and marker names:

| # | File | Name |
|---|------|------|
| 1 | `hooks/register.ts:337`, `bin/install-engine.ts:448,483`, `bin/update.ts:110`, `ui/settings-routes.ts:337` | `bin/mnemosyne-mcp`, `bin/mnemosyne-mcp.cmd` |
| 2 | `bin/install-engine.ts:437,453,485,505,512` | root marker file `.mnemosyne-root` (a non-empty root without it is refused) |
| 3 | `bin/update.ts:42,43,589-603` | Windows scheduled task `Mnemosyne dashboard`, Start Menu entries `Update Mnemosyne` and `Open Mnemosyne dashboard`, files `update-mnemosyne.ps1` and `.vbs` (created on user PCs; `open-dashboard.vbs` is written outside this repo's code) |
| 4 | `hooks/launcher.ts` | text of the generated launcher (env names, see d) |
| 5 | Dockerfile | in-image folders `/opt/mnemosyne`, `/home/mnemosyne`, user and group `mnemosyne` (lines 28, 35-49) |

What lives in the folder and what points into it:

1. Contents (Mac, today): `engine/`, `bin/`, `model-cache/`, `backups/`, `archive/`, `dev-ui/`, `knowledge-pending/`, `session-pending/`, `activity.jsonl(.1)`, `activity-daily.json`, `projects.json`, `vocabulary.json`, `meaning.json` (5 MB), `tags-proposed.json`, `embeddings.json`, `expire-sweep.json`, `ui-users.json`, `update-check.json`; `store.retired-20261122/` holds the retired database. On the Mac the store is retired, so the folder is small and the move is low risk there.
2. Paths pointing in: the generated launcher bakes absolute `store`, `cli`, `root`, `vocabulary`, `activity` paths and `PI_CONFIG_DIR`; `activity.jsonl` and `projects.json` hold no folder path (not read in full; believed, unverified); other tools' MCP configs and Claude Desktop/Cursor/Codex entries may point at `.../bin/mnemosyne-mcp` (the Mac's Desktop config has none; the other PC is unknown); the Windows scheduled task and Start Menu scripts point into `mnemosyne` and `mnemosyne-ui`.

### f. Server-side names

| # | File:line | Name | Effect of change |
|---|-----------|------|------------------|
| 1 | `ui/server.ts:3165,3166` | HTTP header `Mnemosyne-Owner` (and the error text). Read only on `/mcp`. No repo code and none of the configs I looked at sends it (omp and gemini send only `Authorization`) | low; accept both names |
| 2 | `ui/remote.ts:131,133` | session cookies `mnemosyne_session` and `__Host-mnemosyne_session` | rename logs every browser out once; accept both for one release or keep |
| 3 | `ui/app.ts:139,1267,1879,2590,3227`, `ui/theme.ts:8`, `ui/review.ts:95`, `ui/search-mode.ts:7,65`, `ui/map-state.ts:194,230,426,1876` | browser localStorage keys `mnemosyne.*` (token, theme, map layout, review state, search mode) | rename resets saved view settings; invisible, so keep |
| 4 | `Dockerfile:28,35-49`, `docker/entrypoint.sh:22,37` | Linux user and group `mnemosyne`, `HOME=/home/mnemosyne`, `/opt/mnemosyne` (engine and model cache baked at build) | none outside the image if renamed together; `PUID/PGID` map the data folder, so ownership of `/data` is not affected |
| 5 | `docker-compose.yml:17,45`, `.env.example:19,20` | defaults `/mnt/cache/appdata/mnemosyne-tailscale` and `.../mnemosyne` | stage 1 already moved Unraid to `hal-m`; compose defaults were kept on purpose; changing a default does not move existing data, the operator's `.env` wins |
| 6 | `docker-compose.yml` volumes | none are named volumes: both are bind paths from env (so "compose volume names" has nothing to rename; stage 1 note says names unchanged) | n/a |
| 7 | `docker/unraid/my-HAL-M.xml:47-50` | four `MNEMOSYNE_*` Config entries | existing installs keep the old env keys stored in their container config until edited |
| 8 | `.github/workflows/docker.yml:21,26` | image tag `mnemosyne:test`, env names | CI only |
| 9 | `docker-compose.yml:32,39-43` | `${MNEMOSYNE_UI_PASSWORD:?...}` shell interpolation (fails when unset) | needs both-name form |
| 10 | `docker/init-data.ts:3,11,69,70` | `MNEMOSYNE_ROOT`, `MNEMOSYNE_STORE` | fallback |
| 11 | `bin/remote.ts:84-147` | stderr prefix `mnemosyne server ...`; `hooks/register.ts:401` strips it with `/^mnemosyne server unreachable:\s*/` | rename both together; accept both |
| 12 | `bin/*.ts` error prefixes `mnemosyne ui:`, `mnemosyne import:`, `mnemosyne memories:`, `mnemosyne vocab:`, `mnemosyne settings:`; `hooks/register.ts:1586` and `ui/settings-routes.ts:649` strip them | cosmetic, but the strippers must match |

The Unraid/Dokploy environment is where the old names live in practice: the user's running container has `MNEMOSYNE_UI_PASSWORD` and others in its own config, outside the repo. A new image that reads only `HALM_*` would refuse to start (`entrypoint.sh:26` exits when the password variable is empty). So the server must read both for at least one release.

### g. userConfig option keys and how Claude Code stores them

Option keys (`.claude-plugin/plugin.json`): `scope`, `showActivity`, `activityLog`, `guardMode`, `memoryDir`, `rememberTerms`, `recallTerms`, `externalMcp`, `extractionModel`, `sessionSummary`, `expireUnusedDays`, `embeddings`, `serverUrl`, `serverKey` (sensitive). None contains the old name, so the keys stay as they are; only their default values and descriptions mention the old folder and commands (`memoryDir` default, `activityLog`, `externalMcp`, `extractionModel`, `embeddings` text).

Storage (official docs, plugins-reference "Where values are stored" and settings-reference `pluginConfigs`, read today):

1. Non-sensitive values: `settings.json` -> `pluginConfigs["<plugin>@<marketplace>"].options`. On this Mac that is `pluginConfigs["mnemosyne@mnemosyne"]` with scope, guardMode, recallTerms, rememberTerms, sessionSummary, showActivity, activityLog, embeddings, externalMcp, memoryDir and serverUrl (seen; `serverKey` not listed there).
2. Sensitive values (`serverKey`): macOS Keychain, falling back to `~/.claude/.credentials.json`; other platforms use that file. The docs say the store is keyed by plugin id; I did not open the Keychain entry and did not test what Claude Code does when the id changes. Treat as: not carried over (believed from the docs' "keyed by plugin ID", untested).
3. A new id means a fresh configuration dialog with the defaults. Nothing copies the old block. `enabledPlugins` (`mnemosyne@mnemosyne`), `extraKnownMarketplaces.mnemosyne`, `~/.claude.json` (`favoritePlugins`, `pluginUsage`) and `installed_plugins.json` also name the old id (see companion file).
4. The plugin itself fills blanks with `claude plugin configure <id> --values-stdin` (`hooks/register.ts:885-900`, `DEFAULTS` at 873-880: `memoryDir '~/.claude/mnemosyne/store'`). That same CLI is the supported way to write the options for the new id, from a migration script.
5. `memoryDir` is stored as a literal `~/.claude/mnemosyne/store` in the user's block. If that block is copied as is, the new plugin keeps using the old folder: the data folder code must treat that exact literal as "the default" (section 2.2).
6. Plugin data dir `${CLAUDE_PLUGIN_DATA}` is not used by this plugin (no `data/mnemosyne-*` folder exists on this Mac), so no data there to move.
7. The code reads options from the module's `options` argument; it never reads settings.json or the keychain directly (grep: only `options.serverKey` at `hooks/register.ts:390`), so no code change is needed for option storage itself.

---

## 2. Back-compat needs and the data folder move

### 2.1 Where old names must be read as a fallback

| # | Name | Rule | Where |
|---|------|------|-------|
| 1 | `MNEMOSYNE_*` env (34) | read `HALM_X`, else `MNEMOSYNE_X`; new wins when both are set. A shared helper in a no-import module (for example `hooks/names.ts`) used by `hooks/*`, `bin/*`, `ui/*`; `entrypoint.sh` and `docker-compose.yml` get the same rule in shell (`${HALM_X:-${MNEMOSYNE_X:-default}}`) | all of d. above |
| 2 | Old launchers on disk | A launcher written before the update exports only `MNEMOSYNE_*` and calls the *current* `bin/mcp-proxy.ts`, so the proxy must accept the old names until the launcher is rewritten (session start with `externalMcp` on, or `bin/update.ts`) | `bin/mcp-proxy.ts:67-90` |
| 3 | Launcher parser | `bin/update.ts parseLauncher/launcherFor` keeps user choices by reading `MNEMOSYNE_ACTIVITY_LOG`, `_GUARD_MODE`, `_VOCABULARY`, `_ROOT` out of the existing file; it must read both spellings or it silently resets them to defaults | `bin/update.ts:255-290` |
| 4 | Data folder | prefer `~/.claude/hal-m`; if absent and the old one exists, use or migrate the old one (2.2) | `paths()` and the other places in e. |
| 5 | Default `memoryDir` | the literal `~/.claude/mnemosyne/store` in stored options counts as "default" and maps to the new root; any other path is the user's own and is used as given | `hooks/register.ts:314-316` |
| 6 | Root marker | accept `.mnemosyne-root` and `.hal-m-root`; write the new one; never delete the old one | `bin/install-engine.ts:505` |
| 7 | Launcher file name | write `bin/hal-m-mcp(.cmd)`; keep `bin/mnemosyne-mcp(.cmd)` as a copy or link so other tools' configs keep working; the setup check accepts either | `install-engine.ts`, `settings-routes.ts:337`, `register.ts:337` |
| 8 | HTTP header | accept `Hal-M-Owner` (or the chosen name) and `Mnemosyne-Owner` | `ui/server.ts:3165` |
| 9 | Cookies | read both names; set the new one only | `ui/remote.ts:131-133` and its readers |
| 10 | Slash commands | register both `/hal-m-setup` and `/mnemosyne-setup` (old text marked "old name") for one or two releases; handle both in `command.run`. Whether `command.run` accepts a regex for `command` (as `tool.call` accepts one for `tool`) is not verified: otherwise register two handlers from one function | `hooks/register.ts:2271-2490` |
| 11 | Stderr prefixes | strippers match `(hal-m|mnemosyne)` | `register.ts:401,1586`, `settings-routes.ts:649` |
| 12 | Tool names | no fallback is possible (section 1b) | n/a |
| 13 | Engine build id `18.12.3-mnemosyne.N` | keep as is: it is the vendored engine's version string, parsed in `register.ts:692` and `ui/warm-engine.ts:18`; renaming it would need both regexes to accept both and a new build of the engine | keep |

### 2.2 Moving the data folder on first start

Goal: `~/.claude/mnemosyne` becomes `~/.claude/hal-m` with no copy of the database and no window where two writers use two copies.

Proposed procedure (one function, called early in `session.start` and at the start of `bin/update.ts`, `bin/install-engine.ts --root` and the dashboard server; idempotent):

1. Resolve. If `hal-m` exists, use it and stop. If neither exists, use `hal-m` (fresh install). If only `mnemosyne` exists, go to 2.
2. Check it is safe: no live dashboard (`ui.json` pid alive, `hooks/ui-launch.ts`), no held `engine.lock`, no custom `memoryDir` that lives outside the folder (then only the folder moves), not under `~/.omp`. On Windows also refuse when any process has the folder as its working directory or an open file in it (the rename fails with a sharing violation: treat it as "not now", not as an error). If unsafe, keep using `mnemosyne` for this session and try again at the next start.
3. Move with one `rename(old, new)` (atomic on the same volume; both folders have the same parent, so they are on the same volume). Two sessions starting together: the second rename fails with ENOENT or EEXIST; re-resolve and use `hal-m`.
4. Leave a compatibility link at the old path: a symlink on macOS and Linux; a junction (`mklink /J`, no admin rights needed) on Windows. It keeps working: Claude Desktop/Cursor/Codex entries pointing at `.../mnemosyne/bin/mnemosyne-mcp`, the old launcher's baked paths, the Windows scheduled task and shortcuts. Remove the link in a later release when stage 2's alias period ends. If the link cannot be made, say so once in a toast and rewrite the launcher instead.
5. After the move, rewrite the launcher (new env names, new paths, new file name, old file kept per 2.1 item 7) and `PI_CONFIG_DIR` if it names the old path. The rewrite is already what `syncWrapper` does at session start when `externalMcp` is on; `bin/update.ts` does it for Desktop installs.
6. Write a one-line record in the new folder (`moved-from-mnemosyne.json`: time, version) for support, and log it to `activity.jsonl` or a toast. Never delete the old link or any file silently.
7. `~/.claude/mnemosyne-ui` (Windows update scripts) is rewritten by the updater, not moved; it can stay as a name or become `hal-m-ui` via the same updater.

Why rename and not symlink-only or copy:

1. Rename keeps SQLite WAL files, locks and permissions together and costs nothing; a copy of a 17 MB store (more on 7of9) risks a half copy and needs a second cleanup.
2. A symlink in the other direction (new -> old) leaves the old name as the real folder forever and defeats the purpose.
3. Rename-then-link also keeps rollback easy: rename back and reinstall the old plugin.

Per machine:

1. Mac (this one): the store is already retired (`store.retired-20261122`); the rename is safe any time. Expect the retired folder to move with it; delete it on 2026-12-06 as planned.
2. Windows PC (second PC): the data folder is `%USERPROFILE%\.claude\mnemosyne`; risks are the running always-on dashboard (scheduled task `Mnemosyne dashboard`), open handles, and the Start Menu shortcuts. Stop the task, move, rewrite shortcuts with `bin/update.ts --install-shortcut`, start the task. Antivirus or indexer holds can fail a rename: retry once after 2 s, then defer. Case-insensitive file system: no problem since names differ by more than case. Windows launcher is `.cmd`: replace by rename (existing code does this, `bin/update.ts:130-140`).
3. Server (7of9, container): no folder moves in the container; `/data` is a bind mount whose host folder was already renamed in stage 1. Inside the image the `/opt/mnemosyne` and `/home/mnemosyne` renames take effect with the new image, no data involved. The real server risk is env names (2.1 item 1), not folders.

---

## 3. What breaks for users and must be migrated outside the repo

Details per file are in `hal-m-stage2-external-refs.md`. Steps a person must do, per PC, after the new release is out:

1. Install the new plugin: add the marketplace if its name changed (`claude plugin marketplace add Interstellar-code/claude-hal-m`), `claude plugin install hal-m@hal-m` (names depend on decision 1), then restart Claude Code.
2. Uninstall the old plugin (`claude plugin uninstall mnemosyne@mnemosyne`) in the same step. Two plugins loaded together would both register hooks and the same memory tools under two prefixes; the old one also holds the old settings. Keep the data folder (uninstall leaves it).
3. Stored options: the new id starts on defaults. Re-enter or copy: `serverUrl` and the other nine non-sensitive options can be copied from the old block with `claude plugin configure hal-m@hal-m --values-stdin` (the same CLI the plugin uses at `register.ts:885`); `serverKey` cannot be copied by the plugin (secure storage, not readable by it). Each PC therefore needs a device key: create a new one in the server dashboard (Settings > MCP connection; a key is shown once) and revoke the old one, or type the old one in from where it was saved. A migration script (task T6) can do the copy and prompt for the key.
4. `settings.json`: `enabledPlugins` entry, `extraKnownMarketplaces` key if the marketplace name changed, `pluginConfigs` block (stale after step 3, can be removed), and `~/.claude.json` `favoritePlugins` / `pluginUsage` (cosmetic).
5. Permission allowlists naming `mcp__mnemosyne__*`: none in the user's `~/.claude/settings.json` (23 rules checked by the companion file); one in `matrixkoder/.claude/settings.json` (retired tool). Repo-level `.claude/settings*.json` and `.mcp.json` in about 37 project folders under `~/Development`: none name it.
6. CLAUDE.md and rules: `hermes-switchui/CLAUDE.md:135-143` (plugin id, `mcp__mnemosyne__memory_recall`, store path); `~/.claude/CLAUDE.md:144` is a history note only. Memory contents themselves may quote `mcp__mnemosyne__*` in old instruction memories (not searched; would need a recall or a store query). The plugin's own rules block and first-prompt text are regenerated by code.
7. Hook matchers: none in `~/.claude/settings.json` match the plugin. The plugin's own `tool.call` matcher changes with the code.
8. Other agents' MCP configs (OMP `~/.omp/agent/mcp.json`, AGY `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-cli/mcp_config.json`): entry name `mnemosyne-memory`, type http, URL plus `Authorization` header, no `Mnemosyne-Owner`. They talk to the server, not the plugin, so they keep working; their server name only decides the tool prefix those agents see (`mcp__mnemosyne-memory__*`), which Claude's rules do not use. Rename only if you want consistency, and do the three files together (each has a `.bak-20261122-112648`). Server `serverInfo.name` change does not affect them.
9. Claude Desktop, Cursor, Codex entries that run the stdio launcher: none found on this Mac; unknown on the Windows PC. They keep working through the compatibility link and the old-name launcher copy (2.1 items 7, 2.2 step 4).
10. Server: Unraid container env keys `MNEMOSYNE_UI_PASSWORD`, `_BIND`, `_PUBLIC_URL`, `_EXPIRE_UNUSED_DAYS`; Dokploy/compose `.env` the same plus `_HOSTS`, `_DATA`, `_BUILD_EMBEDDINGS`. Works unchanged if the server reads both (2.1 item 1); switch the keys at the operator's pace.
11. Windows: scheduled task `Mnemosyne dashboard` and the Start Menu shortcuts keep the old names until the updater rewrites them; add the rename to `bin/update.ts` (task T3).
12. Outside text only: `headroom` allowlist and cleanup script (companion file section 4), `switch-agent` dev scripts that set `MNEMOSYNE_OWNER/REPO/CLI` for the upstream product.

---

## 4. Tests that pin the old names

98 test files exist (70 in `tests/bun`, 11 top-level, the rest embed and fixtures); 59 mention the old name, 907 lines in all. By category (lines, files):

| # | Pins | Lines | Files | Largest |
|---|------|-------|-------|---------|
| 1 | `mcp__mnemosyne__` tool prefix | 202 | 2 | `tests/register.test.ts` 201 |
| 2 | `/mnemosyne-*` commands and command names | 87 | 16 | `tests/register.test.ts` 50, `tests/ui-launch.test.ts` 6, `tests/bun/import.spec.ts` 6, `tests/bun/health-view.spec.ts` 5 |
| 3 | `MNEMOSYNE_*` env | 227 | 23 | `tests/bun/launcher.spec.ts` 107, `tests/register.test.ts` 23, `tests/bun/mcp-proxy.spec.ts` 19 |
| 4 | `.claude/mnemosyne` paths | 132 | 18 | `tests/bun/launcher.spec.ts` 58, `tests/register.test.ts` 45, `tests/bun/update-dashboard.spec.ts` 6 |
| 5 | `mnemosyne-mcp` launcher name | 8 | 4 | `tests/register.test.ts` 5 |
| 6 | plugin id `mnemosyne@mnemosyne` | 9 | 7 | `update-dashboard.spec.ts` 2, `fixtures/claude-stub.ts` 2 |
| 7 | `mnemosyne.*` localStorage keys | 18 | 6 | `tests/bun/solar-page.spec.ts` 7 |
| 8 | cookie `mnemosyne_session` | 1 | 1 | `tests/bun/server-mode.spec.ts` |
| 9 | `.mnemosyne-root` marker | 2 | 1 | `tests/bun/install-root.spec.ts` |
| 10 | `Mnemosyne-Owner` header | 0 | 0 | not pinned: add a test when the header changes |

(The categories overlap: one line can be in two.) Top files overall: `tests/register.test.ts` 363, `tests/bun/launcher.spec.ts` 131, `tests/bun/import.spec.ts` 79, `tests/ui-launch.test.ts` 22, `tests/bun/mcp-proxy.spec.ts` 21, `tests/bun/update-dashboard.spec.ts` 20, `tests/bun/server-mode.spec.ts` 14, `tests/bun/knowledge-wiring-b.spec.ts` 14. Also `tests/fixtures/owner-golden.json` (1 hit) and `tests/bun/fixtures/galaxy-c11.json` (7): check whether those hits are data (a project named mnemosyne) rather than names.

Tests that must be added, not only edited: env fallback (new wins, old works, both set), data-folder migration (fresh, old only, both present, live dashboard, lock held, concurrent starters, Windows junction path), old launcher text read by `launcherFor`, `memoryDir` literal old default, old marker, old header, old cookie, both command names, tool prefix derived from `$.plugin.name`.

---

## 5. Task breakdown (each can be pasted as a worker brief)

Common rules for every brief: engine/ is not touched; `MNEMOPI_*` and `ENGINE_BUILD` are not renamed; old names are read as fallback and never removed in this release; never `git checkout` or `git stash` to undo; run only the tests named in the brief and one full run at the end by the orchestrator; no silent workarounds (a tool that fails gets three real tries, each changing something, then a plain report); report over the Orca bus.

| # | Task | Depends on | Parallel with |
|---|------|------------|---------------|
| T1 | Naming core | none | none (first) |
| T2 | Plugin identity and tools | T1 | T3, T4 |
| T3 | bin, ui, scripts, Windows | T1 | T2, T4 |
| T4 | Server, Docker, CI | T1 | T2, T3 |
| T5 | Docs and in-app text | T2 (names fixed) | T6 |
| T6 | Migration script and runbook | T2 | T5 |

1. T1 Naming core. New no-import module (for example `hooks/names.ts`) holding: the new and old plugin name, tool prefix builder from `$.plugin.name`, command names (new and old), `envOf(get, 'ROOT')` (new then old), the data-root resolver and `migrateDataRoot()` from section 2.2 (rename, link, junction on Windows, safety checks), old/new marker and launcher names, header and cookie name lists. Tests first (the list at the end of section 4). Files: new `hooks/names.ts`, new `tests/bun/names.spec.ts`. Acceptance: unit tests pass on macOS; the Windows branch is covered with an injected fs/platform.
2. T2 Plugin identity and tools. Owns `hooks/register.ts` entirely (every edit there goes through this task), `hooks/session.ts`, `hooks/surface.ts`, `hooks/ui-launch.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json`, `marketplace.json`, `package.json`. Step 1: build a throwaway copy named `hal-m` and confirm the tool prefix `mcp__hal-m__` and the command names in a real Claude Code session (evidence before the bulk change). Then: manifest names, atoms, `PluginState`, rules section id, prefix from the helper, both command names registered with handlers, `fillDefaults` and `ui-launch` plugin id (read the marketplace or keep name equal), data root via T1, env reads via T1 (3 refs), option default texts. Tests: `tests/register.test.ts`, `tests/ui-launch.test.ts`, `tests/session.test.ts`, `tests/bun/session.spec.ts`, `tests/bun/knowledge-host.ts`, `tests/bun/fixtures/claude-stub.ts`.
3. T3 bin, ui, scripts, Windows. Owns `bin/*.ts`, `ui/*`, `scripts/*`, `hooks/launcher.ts`, `hooks/engine.ts`, `hooks/engine-build.ts` (comments), `hooks/import.ts`, `hooks/knowledge.ts`, `hooks/backfill.ts`, `hooks/activity-log.ts`. Work: env helper everywhere (with the launcher parser reading both spellings), data root and launcher/marker names, launcher writes new names and keeps the old file, header and cookie both names, `serverInfo.name`, snippet and hint texts, stderr prefixes and their strippers, Windows task and Start Menu names with a migration in `bin/update.ts`, dashboard texts (commands). Keep the localStorage keys and the `-mnemosyne.N` engine build suffix. Tests: `tests/bun/launcher.spec.ts`, `mcp-proxy.spec.ts`, `update*.spec.ts`, `install-root.spec.ts`, `ui-*.spec.ts`, `server-mode*.spec.ts`, `settings-*.spec.ts`, `import.spec.ts`, `health-view.spec.ts` and the other UI specs listed in section 4.
4. T4 Server, Docker, CI. Files: `Dockerfile`, `docker/entrypoint.sh`, `docker/init-data.ts`, `docker-compose.yml`, `.env.example`, `docker/unraid/my-HAL-M.xml`, `.github/workflows/docker.yml`. Work: shell-level both-name reads (`${HALM_X:-${MNEMOSYNE_X:-default}}`, and the password check accepting either), new Linux user and in-image paths, new Unraid Config keys (the template is only read at install; existing containers keep their keys), CI image tag. Verify by building the image in an Orca terminal on 7of9 and starting it once with only old names and once with only new names (health check on `/api/session`). Cross-check with T3 on `ui/remote.ts` env names (T3 owns that file).
5. T5 Docs and in-app text. `README.md` (install, update, uninstall, settings, Unraid section, upgrade note for 0.37 -> 0.38), `DESIGN.md`, `CHANGELOG.md` (new entry only; old entries stay), `docs/plans/hal-m-rename.md` stage 2 section (mark done), `docs/architecture.svg`. Old CHANGELOG entries and `docs/plans/` history are not edited. Check: grep for the old names in README and DESIGN returns only the "formerly" and migration lines.
6. T6 Migration script and runbook. `scripts/migrate-hal-m.ts` (run from the new plugin; dry run by default): lists what it would change, then with `--apply` backs up `settings.json`, copies the non-sensitive options through `claude plugin configure`, sets `enabledPlugins`, uninstalls the old plugin, prompts for `serverKey` (never printed or logged), moves the data folder through T1's function, rewrites Windows shortcuts. Runbook in `docs/plans/hal-m-stage2-runbook.md`: order per PC (Mac, Windows, 7of9), rollback (rename back, reinstall old id, restore settings backup), and the two-week keep window for old names. The edits to `hermes-switchui/CLAUDE.md` and other outside files are listed there for the owner, not done by the script.

Test plan:

1. Per task: its own spec files (listed above) with `bun test <file>`.
2. After T2-T4 merge: the repo gates in `package.json`: `bun run typecheck`, `bun run test:bun` (runs `bun install` and `bun scripts/vendor-map.ts --check`), `bun run test:embed` on the Mac, `bun test tests/*.test.ts` for the top-level files (the scripts above do not list them; check how they are run before relying on it).
3. Real-session checks (the part tests cannot cover): throwaway plugin shows `mcp__hal-m__memory_*`; `/hal-m-setup` and the old `/mnemosyne-setup` both answer; a session start with only the old folder moves it and leaves a working link; stale launcher (old env names) still serves recall through the new proxy; `claude plugin configure hal-m@hal-m` carries the options.
4. Server: image built from the branch, started with only `MNEMOSYNE_*`, then only `HALM_*`; `/api/session` healthy; a client with the old `mnemosyne-memory` entry recalls through `/mcp`.
5. Windows: run T1's Windows branch tests on the Windows PC or its CI equivalent (untested on a real Windows machine so far: README says the install path is untested there).
6. Review: a separate review agent reads the merged diff against this report's inventory and greps both spellings; not the author.

---

## 6. Open decisions for the owner

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | New plugin id | `hal-m` (display name HAL-M). Kebab-case, not reserved by Claude Code, matches the repo, image and Tailscale name |
| 2 | Marketplace name | `hal-m`, so the id is `hal-m@hal-m` and the two `name@name` code spots stay right |
| 3 | Tool prefix | `mcp__hal-m__*` (follows from decision 1; verify with the throwaway plugin before the bulk edit). Hard cut: old rules must be edited |
| 4 | Env prefix | `HALM_*`: one token, shorter, no clash with `HAL_` names. `HAL_M_*` reads closer to the product name but doubles the underscores in names like `HAL_M_UI_PASSWORD` |
| 5 | Data folder | `~/.claude/hal-m` (Windows `%USERPROFILE%\.claude\hal-m`), by rename plus a link at the old path |
| 6 | Slash commands | `/hal-m-setup`, `-ui`, `-tags`, `-import`, `-knowledge`, `-embed`. Old names kept as aliases |
| 7 | Alias period | Old env names, old folder link, old commands, old header and cookie accepted for 3 releases or until 2027-03-01, whichever is later; then remove with one clean-up release. The tool prefix and plugin id have no alias period (not possible) |
| 8 | Launcher name | `bin/hal-m-mcp(.cmd)`, old file kept as a copy during the alias period |
| 9 | Keep as is | Mnemopi engine name and `MNEMOPI_*`, `ENGINE_BUILD` suffix `-mnemosyne.N`, localStorage keys, activity-log client labels (or rename with both accepted), older CHANGELOG and `docs/plans/` |
| 10 | Server key handling | Issue a new device key per PC at migration and revoke the old ones, instead of trying to read the secure store |
| 11 | MCP server entry name for other agents | Leave `mnemosyne-memory` as is now; rename to `hal-m-memory` later in one pass over the three config files |
| 12 | Version | A minor release (0.38.0) that carries both name sets, then a later clean-up release; not 1.0 |

Open questions I could not answer from here:

1. Does `command.run` accept a regex for `command`? (decides one handler or two; untested)
2. What exactly does Claude Code do with the Keychain entry when a plugin id disappears: leaves it (likely) or removes it on uninstall? Not read in the docs; a stale entry is harmless but worth deleting.
3. Whether the Windows PC has any Desktop, Cursor or Codex entry that points at the stdio launcher.
4. Whether old instruction memories in the store quote `mcp__mnemosyne__*` (needs a store query).

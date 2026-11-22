# HAL-M stage 2: references outside the repo that a rename would touch

Date: 2026-11-22. Read-only sweep, nothing changed. Secrets were not copied into this file.

Terms: "breaks" means a live config, rule or script stops working after the rename. "stale" means text that only becomes out of date.
The rename under review: plugin id `mnemosyne` to `hal-m`, tools `mcp__mnemosyne__*` to `mcp__hal-m__*`, slash commands `/mnemosyne-*`, env `MNEMOSYNE_*`, folder `~/.claude/mnemosyne`.

## 1. Short answer

1. Only five live places on the Mac would break: four entries in `~/.claude/settings.json`, plus the plugin registry files (`installed_plugins.json`, `known_marketplaces.json`).
2. Two more live places break by name: `hermes-switchui/CLAUDE.md` (tool names and store path told to agents) and the switch-agent dev scripts that set `MNEMOSYNE_*` env.
3. Everything on 7of9 (Ubuntu) is clean except old backups. Nothing there names the plugin in a live file.
4. Other agents (omp, gemini/antigravity, codex, opencode) point at the HAL-M server by HTTP URL under the server name `mnemosyne-memory`. They do not use the plugin id, so they keep working. The name is stale only.
5. No permission rule, hook matcher, slash command, agent, rule file or skill text in `~/.claude` names the plugin. `~/.claude/commands`, `rules` and `settings.local.json` do not exist.

## 2. Mac: ~/.claude (live config)

| # | File | Count | Kind and effect |
|---|------|-------|-----------------|
| 1 | settings.json line 316 | 1 | enabledPlugins `mnemosyne@mnemosyne`: BREAKS (new id would be disabled or missing) |
| 2 | settings.json lines 364, 367 | 2 | extraKnownMarketplaces key `mnemosyne` and repo `Interstellar-code/claude-mnemosyne`: BREAKS if the marketplace name changes; repo URL is covered by a GitHub redirect after a repo rename |
| 3 | settings.json lines 409, 412 | 2 | pluginConfigs key `mnemosyne@mnemosyne` holds all options (scope, guardMode, recall/remember terms, serverUrl, externalMcp false). BREAKS: options are keyed by plugin id, so the new id starts on defaults. `memoryDir` still names `~/.claude/mnemosyne/store`, which is already renamed to `store.retired-20261122` |
| 4 | plugins/installed_plugins.json | 2 | registry entry `mnemosyne@mnemosyne`, installPath `.../cache/mnemosyne/mnemosyne/0.37.0`: BREAKS until reinstalled under the new id |
| 5 | plugins/known_marketplaces.json | 3 | marketplace key, repo, installLocation `.../marketplaces/mnemosyne`: BREAKS if the marketplace name changes |
| 6 | CLAUDE.md line 144 | 1 | history note ("Mnemosyne recall results came back compressed"): stale |
| 7 | ~/.claude.json | 31 | pluginUsage keys, favoritePlugins `mnemosyne@mnemosyne`, project and repo path lists. Favourite and usage counters would be orphaned: stale. Path entries matter only if the repo folder is renamed |

Not found (checked): permissions allow list (23 rules, none for this plugin), hooks matchers, agents/, skills/, commands/, rules, settings.local.json.
The settings.json backups (bak, bak-codemode, bak-statusline, bak-headroom, bak-20261122-halm) each repeat the same 5 lines: stale.
Also stale: history.jsonl (929), transcripts/ (30 files), jobs/ (MatrixKoder scratch), paste-cache/, shell-snapshots/, plans/harmonic-crafting-muffin.md (1), plugins/store/matrixkoder_* (3, path names only), .session-stats.json (2, old tool name `mcp__mnemosyne-store__mnemopi_stats`).

## 3. Mac: project files under ~/Development

The folders `mnemosyne/` and `mnemosyne-upgrade/` are the older upstream product, not this plugin. Their docs (hundreds of hits) are about that product and are out of scope.

| # | File | Count | Kind and effect |
|---|------|-------|-----------------|
| 1 | hermes-switchui/CLAUDE.md lines 135-143 | 4 lines | rule text: names `mnemosyne@mnemosyne`, `mcp__mnemosyne__memory_recall`, store path `~/.claude/mnemosyne/store/mnemopi.db`. BREAKS: agents in that repo would call a tool that no longer exists, and the store path is already retired |
| 2 | matrixkoder/.claude/settings.json | 1 | permission rule `mcp__mnemosyne__memory_recall`: BREAKS only the auto-allow (prompts again). MatrixKoder is retired, so low value |
| 3 | switch-agent/switch/crates/switch-store/scripts/throwaway-launcher.sh | 12 | dev script sets `MNEMOSYNE_REPO`, `MNEMOSYNE_OWNER`, `MNEMOSYNE_CLI` and points at `claude-mnemosyne/engine/src/cli.ts`. BREAKS if the env names change |
| 4 | switch-agent/.../scripts/baseline.mjs, gen-owners.mjs | 1 each | sets `MNEMOSYNE_OWNER`, lists the repo path. BREAKS on env rename; path only on folder rename |
| 5 | switch-agent/.omp/skills/switch/SKILL.md, cheatsheet.md | 2, 1 | skill text about the pinned upstream engine and its `mnemosyne-mcp` launcher. Different install from the plugin: stale at most |
| 6 | switch-agent/docs, endurance-agent/docs, 9router/docs, pfr-orca, servers/docs/overnight-2026-10-26 and project-analysis, switch-agent test fixtures | about 100 | briefs, reports, fixtures: stale text |
| 7 | hermes-switchui/src/server/mnemosyne-browser.ts and tests | about 60 | reads `MNEMOSYNE_BANK_ID`, `MNEMOSYNE_DB_PATH`, `MNEMOSYNE_DATA_DIR`, `MNEMOSYNE_WM_TTL_HOURS`: these belong to the upstream product, not the plugin. Not affected |

Not found: AGENTS.md, .claude/agents, .claude/skills, .mcp.json or settings.local.json naming the plugin in any other project.

## 4. Mac: skills and other agents

| # | Place | Count | Kind and effect |
|---|-------|-------|-----------------|
| 1 | orca-skills/skills/stellar-orca/SKILL.md line 104, CHANGELOG.md line 63 | 1, 1 | skill text "Mnemosyne stays Mac-only": stale wording |
| 2 | ~/.agents/skills (all other skills) | 0 | clean |
| 3 | ~/.omp/agent/mcp.json | 1 | MCP config, server `mnemosyne-memory` over HTTP to the HAL-M server (switched from the local launcher during retirement; backup keeps the old local launcher path). Name only: stale |
| 4 | ~/.gemini/config/mcp_config.json, antigravity-cli/mcp_config.json | 1 each | same `mnemosyne-memory` HTTP entry: stale name |
| 5 | ~/.gemini/antigravity-cli/settings.json | 3 | trusted folder paths including `claude-mnemosyne`: fine unless the repo folder is renamed |
| 6 | ~/.gemini antigravity brain/ outputs, *.bak-20261122-112648 | many | old outputs and backups: stale |
| 7 | ~/.codex, ~/.config/opencode, ~/.orca | 0 | clean |
| 8 | ~/Library/LaunchAgents/ai.headroom.proxy.plist.disabled and .bak | 1 each | protected-tool list `mcp__mnemosyne__*`. Plist is disabled: stale. If re-enabled, add `mcp__hal-m__*` |
| 9 | ~/.headroom/bin/reap-temp-scratch.sh | 3 | temp-folder cleanup matches the prefix `mnemosyne-`. Breaks quietly: folders renamed to `hal-m-*` would not be cleaned |
| 10 | ~/Library/Application Support/orca (stats, usage, pane accounts) | 5 | repo name and path in Orca bookkeeping: stale |
| 11 | ~/.config/herdr snapshots | 10 | old session snapshots: stale |
| 12 | claude_desktop_config.json, shell rc files, crontab | 0 | clean |

## 5. Orca Ubu 7of9 (ssh worked on the first try)

| # | Place | Count | Kind and effect |
|---|-------|-------|-----------------|
| 1 | ~/.claude/settings.json, CLAUDE.md, plugins/*.json, ~/.claude.json | 0 | clean |
| 2 | ~/.claude/settings.json.bak, settings.json.bak-mnemosyne-20261102 | 5 each | old backups: stale |
| 3 | ~/codebase/*/CLAUDE.md, AGENTS.md, .claude, .mcp.json | 0 | clean |
| 4 | ~/.omp, ~/.gemini, ~/.codex, ~/.config/opencode, ~/.agents, ~/.orca | 0 | clean |
| 5 | ~/.claude/skills and ~/.agents/skills (stellar-orca etc.) | 0 | clean |

## 6. Things to know before the rename

1. The pluginConfigs block is the largest hidden risk: it carries every user setting and the HAL-M server URL, keyed by `mnemosyne@mnemosyne`. It must be copied to `hal-m@hal-m` (or whatever the new id is) in the same step as the enabledPlugins change.
2. The `~/.claude/mnemosyne` folder no longer holds the store (renamed `store.retired-20261122`) but still holds `bin/`, `engine/`, `archive/`, `backups/`, `session-pending/` and other files. The headroom cleanup script and the retired omp launcher path name it.
3. The external agents use the server name `mnemosyne-memory`, so their tools appear as `mcp__mnemosyne-memory__*`. Nothing breaks if that name stays; renaming it is optional and separate.
4. The omp and gemini MCP files hold the server bearer tokens in plain text (two different tokens). I did not copy them here. One of my own search outputs did print them to my working context while I was reading those files, so treat those two tokens as seen by this session.
5. Whether the marketplace name changes decides whether rows 2 and 5 in section 2 break. The plugin manifest already points the repo at `claude-hal-m`.

# Rename Mnemosyne to HAL-M

Decided 2026-11-21 (Rohit: "yes to all"). Done in two stages so nothing breaks.

## Stage 1 (v0.37.0): the visible name

1. Docs and screen text say HAL-M: README, DESIGN.md, `docs/architecture.svg`, the dashboard (was HAL-10000), plugin and marketplace descriptions, CLI and hook messages, server pages.
2. GitHub repo renamed `claude-mnemosyne` -> `claude-hal-m`; every repo link updated. GitHub redirects the old URL.
3. Server: image `hal-m:local`, Unraid template `docker/unraid/my-HAL-M.xml` (container HAL-M, Tailscale name `hal-m`, appdata `hal-m`), compose service `hal-m`; compose volume names unchanged.
4. Kept: plugin id and marketplace `mnemosyne`, tools `mcp__mnemosyne__*`, `MNEMOSYNE_*` variables, `~/.claude/mnemosyne`, the Linux user in the image, the Mnemopi engine name, older CHANGELOG entries and `docs/plans/` history.
5. 7of9 redeploy: build `hal-m:local`, move `/mnt/cache/appdata/mnemosyne` to `.../hal-m`, install `my-HAL-M.xml`, remove the old container, approve the new Tailscale device and turn off its key expiry, remove the old `mnemosyne` device, set the new address as `serverUrl` on each PC that uses the server.

## Stage 2 (later, its own plan): the machine names

Plugin id, tool names (`mcp__hal-m__*`), `MNEMOSYNE_*` variables and the data folder. Needs: reading the old variable names as a fallback, moving the data folder on first start, and updating every rule, permission list and memory that names `mcp__mnemosyne__*` on every PC. Each PC reinstalls the plugin.

# HAL-M Stage 2 plan: review (Fable 5.2)

Date: 2026-11-22. Read-only review of `docs/plans/hal-m-stage2.md` against the code in this checkout (main at 596292d) and the two research reports. Nothing was edited except this file. No tests, builds or installs were run.

Verdict: ready after fixes. The task shape (one naming core, then parallel lanes) is sound and the inventory is accurate where I spot-checked it. Three things must change before any brief is sent (B1 to B3), because each one can lose or expose data without any test in the plan noticing.

How to read a finding: plan section, evidence in the code, what would go wrong, the change to the plan.

Terms: "old root" is `~/.claude/mnemosyne`; "new root" is `~/.hal-m`; "link" is the symlink (Windows: junction) the plan leaves at the old root.

---

## Blockers

### B1. The new server image would override the settings in the existing container template

1. Plan: section 1 item 6, T4, "Done means" item 2 ("runs the 0.38.0 image with its existing MNEMOSYNE_* template unchanged").
2. Evidence:
   1. `Dockerfile:17-28` bakes defaults into the image as env: `MNEMOSYNE_ROOT=/data`, `MNEMOSYNE_STORE=/data/store`, `MNEMOSYNE_PORT=8787`, `MNEMOSYNE_BIND=0.0.0.0` (line 24), `MNEMOSYNE_SECURE_COOKIE=auto`.
   2. The live Unraid template sets the bind address the other way: `docker/unraid/my-HAL-M.xml:48` has `MNEMOSYNE_BIND=127.0.0.1` ("only Tailscale Serve reaches the app, not the LAN"). The container sits on `br0` with its own LAN address (xml line 8).
   3. The plan's rule is "new name wins" (T4: `${HALM_X:-${MNEMOSYNE_X:-default}}`).
3. Failure: T4 renames the Dockerfile env lines to `HALM_*`. The new image then carries `HALM_BIND=0.0.0.0`, and that beats the operator's `MNEMOSYNE_BIND=127.0.0.1`. The server starts listening on the LAN address over plain HTTP, silently. The same trap overrides an operator's old-name `MNEMOSYNE_STORE` (the server opens an empty store at `/data/store`), `MNEMOSYNE_PORT` and `MNEMOSYNE_SECURE_COOKIE`. T4's check (old names only, new names only, `/api/session` healthy) passes in all these cases.
4. Fix to the plan:
   1. Rule for T4: the image sets no default, under either name, for a variable an operator can set (BIND, PORT, SECURE_COOKIE, ROOT, STORE, EMBEDDINGS, PUBLIC_URL, HOSTS, EXPIRE_UNUSED_DAYS). Defaults live in `docker/entrypoint.sh`, which resolves new-then-old-then-default and exports the result (`ui/remote.ts:76,78,87` already default port, cookie mode and bind; `ui/server.ts:187-189` needs ROOT and STORE exported). Image-internal paths nobody sets (CLI, PLUGIN_ROOT, MODEL_CACHE) may be baked under the new names.
   2. `Dockerfile:55` (health check) reads `MNEMOSYNE_PORT` from the container's own env, not from what the entrypoint exports: it must read both names.
   3. Acceptance for T4: start the image with exactly today's Unraid variables (`MNEMOSYNE_UI_PASSWORD`, `MNEMOSYNE_BIND=127.0.0.1`, `MNEMOSYNE_PUBLIC_URL`, `MNEMOSYNE_EXPIRE_UNUSED_DAYS`) and prove it listens on 127.0.0.1 only; start it with an old-name `MNEMOSYNE_STORE` that is not the default and prove that store is the one opened. Keep one CI leg on the old names (`.github/workflows/docker.yml:26` passes `MNEMOSYNE_SECURE_COOKIE=off`; with a baked `HALM_SECURE_COOKIE=auto` that leg's login would fail, which is the same bug showing itself).

### B2. The data folder move has a reachable state the plan does not define: both folders exist

1. Plan: section 1 item 5, T1 ("atomic rename, symlink or Windows junction at the old path, skipped while a dashboard or lock is live, retried next start").
2. Evidence:
   1. The move is two steps (rename, then make the link). Between them the old path does not exist.
   2. Code that runs in every other live session recreates a missing root: `bin/activity.ts:105-107` and `135-140` (`mkdirSync(dirname(log), { recursive: true })` on every logged memory call), `hooks/register.ts:630-633` (`secure()` makes root and store at each session start, called at line 2313).
   3. A 0.37 session, an old launcher or a running proxy holds the old path as text and knows nothing about the move.
   4. The inventory's resolver (section 2.2 step 1) says "if hal-m exists, use it and stop". The plan gives no rule at all for both existing.
   5. A hook cannot do the move itself: the host's file API is read, write, list, exists, stat, ancestors only (`.claude-plugin/types/claude-code/index.d.ts:3306-3420`), and hook code is type-checked with no Node or Bun types (`tsconfig.json`: `"types": []`). The repo's own pattern for folder work from a hook is a `bun` child process (`hooks/register.ts:619-626`).
3. Failure: a session that logs or starts inside the gap recreates the old root as a real folder, the link then cannot be made, and from then on two real folders exist. Depending on which one a process resolves, memories look empty and new saves go to a second store. This Mac runs many sessions at once (orchestrator plus Orca lanes), so the gap is small but not theoretical. Separately, any 0.38 code path that creates the new root before the move (a missed hard-coded path in T2/T3, a deferred move) produces the same state through the "new exists, use it" rule.
4. Fix to the plan (T1 brief):
   1. Write the state table into the brief and test every row: only old; only new; new real plus old link; both real; old is a link to somewhere else; dangling link. For "both real": never pick silently. Use the folder that holds the store and warn at every start until a person resolves it; remove an old root only with non-recursive `rmdir` when it holds nothing but empty folders.
   2. The move runs in a Bun script that T1 owns (for example `bin/migrate-root.ts`), called from the hook through `$.process.run`. Today `bin/*` belongs to T3 and T1 owns only `hooks/names.ts`, so this file has no owner.
   3. A lock for the move that lives outside the folder being moved (in the home folder), so two starters cannot interleave.
   4. Never move when the root comes from an explicit setting (`HALM_ROOT`, `MNEMOSYNE_ROOT`, a `--root` flag): that covers the server's `/data` (`Dockerfile:18`, `docker/entrypoint.sh:17,41`) and every standalone root.
   5. Better, change D3 (see "Decisions"): in 0.38 make the new path an alias of the old folder and do the physical move as an explicit, stopped-everything step. That removes the gap entirely.

### B3. Paths under the old root that are stored as text keep working only through the link, and break as data loss when the link is removed

1. Plan: section 1 item 5 ("The memoryDir option default moves with it"), T3 ("the launcher parser reads both spellings so old launchers keep their settings"), T6 ("copies the non-sensitive options"), section 5 item 7 (later clean-up).
2. Evidence:
   1. `/mnemosyne-setup` writes the literal `memoryDir: '~/.claude/mnemosyne/store'` into the user's settings (`hooks/register.ts:877-881`, `886-896`). On this Mac the stored value is exactly that (read today with `claude plugin configure mnemosyne@mnemosyne --json`; other values not printed).
   2. `paths()` uses a stored `memoryDir` as given (`hooks/register.ts:316-317`).
   3. The updater keeps every path it finds in the existing launcher as a "user choice": store, activity log, vocabulary, root, model cache (`bin/update.ts:275-283`).
   4. The model cache is a path relative to home with the old name inside: `hooks/engine.ts:15` (`.claude/mnemosyne/model-cache`), baked into every launcher as `PI_CONFIG_DIR` (`hooks/launcher.ts:60`, `hooks/register.ts:653`).
   5. The inventory names the rule (section 2.1 item 5: the old literal counts as "the default"). The plan dropped it, and T6 copies the literal to the new id.
3. Failure: after the switch the store is still addressed as `~/.claude/mnemosyne/store` and works only because of the link. In the clean-up release the link goes; `secure()` then creates a new empty store at the old path, and every memory disappears from view while new ones go into a fresh database. Same for a launcher that kept old-root paths, and for the model cache (embeddings switch off or the 63 MB model downloads again into a recreated old folder).
4. Fix to the plan:
   1. T1 owns one function that rebases any path at or under the old root onto the resolved root; it is applied to `memoryDir` (T2), to every value `launcherFor` keeps and to `PI_CONFIG_DIR` (T3). The model cache folder becomes a function of the resolved root, not a constant; T1 owns that too, because `hooks/register.ts` (T2) and `hooks/launcher.ts`, `bin/update.ts` (T3) all use it.
   2. T6 writes `memoryDir` as empty (meaning default) when the old value is the old default literal.
   3. Section 5 item 7 gets a precondition: the link is removed only after a check finds no stored option, launcher or scheduled task that still names the old root.

---

## Major

### M1. Launcher back-compat has three gaps

1. Plan: T3 ("the launcher writes new names and keeps the old file as a copy").
2. Evidence and failure:
   1. The launcher reads `MNEMOSYNE_OWNER` from the calling tool's own environment (`hooks/launcher.ts:40`, `76-78`; documented for other clients in `README.md:638`; the switch-agent scripts set it). A new launcher that reads only `HALM_OWNER` sends every such client's saves and recalls to the `global` owner without an error. The plan's section 5 item 3 says these scripts "keep working", which is true only if the launcher text itself reads both.
   2. The old-name file `bin/mnemosyne-mcp` bakes the path of the proxy inside the old plugin's cache folder (`hooks/register.ts:642`, `$.plugin.root`). Once `mnemosyne@mnemosyne` is uninstalled that folder is gone, so a stale copy left on disk stops working. And when `externalMcp` is switched off only the current name is removed (`hooks/register.ts:643-646`), so an old-name copy would keep serving the store after the user turned sharing off.
   3. The updater reads the existing launcher from one file name (`bin/update.ts:110`). With the new name it finds nothing on the first 0.38 run, and `launcherFor` falls back to defaults for store, guard mode and the rest (`bin/update.ts:274-283`): a custom store is silently replaced by the default one.
3. Fix: the brief says (a) both launcher forms read `HALM_OWNER`, then `MNEMOSYNE_OWNER`, then `global`; (b) the old-name file is rewritten at every start with the same content as the new one (or is a two-line shim that runs the new one) and is removed together with it when sharing is off; (c) the updater reads the old-name launcher when the new-name one is missing. One test each.

### M2. The env helper needs two rules the plan does not state

1. Plan: section 1 item 4, T1 `envOf`.
2. Evidence:
   1. Empty has a meaning: `MNEMOSYNE_ACTIVITY_LOG` empty means "log off" (`bin/mcp-proxy.ts:71`, `hooks/launcher.ts:62`, `ui/server.ts:194`). Compose passes empty strings for unset values (`docker-compose.yml:40-41`).
   2. Parents set these names for children: `ui/remote.ts:411-415`, `ui/server.ts:3396`, `hooks/ui-launch.ts:180-190`, `hooks/register.ts:1924`.
3. Failure: if empty counts as "not set", a launcher that says "log off" under the new name falls through to an inherited old-name path and the log is written although the user turned it off. If empty counts as "set", an empty new name from compose hides the operator's old-name value. And when a parent sets only the new name while an old one is inherited (or the reverse during the parallel build), the child can read the wrong one.
4. Fix: T1's brief defines per variable whether empty is a value (at least ACTIVITY_LOG) and gives a second helper for building a child env that sets the new name and deletes the old one. Tests: new empty with old set, both set, child env built from a parent that carries the other spelling.

### M3. T4 cannot run in parallel with T3, and the compose file is not verified at all

1. Plan: section 3 table (T4 parallel with T3), T4 verify step.
2. Evidence: the server reads its password, port, bind, cookie mode, public URL, hosts and expiry in `ui/remote.ts:74-94`, a file T3 owns. `docker/init-data.ts:15-18` (T4) imports from `hooks/` and `bin/` (T3). `docker-compose.yml:39` uses the "must be set" form and line 45 the data folder default; both need nested defaults for two names.
3. Failure: in T4's own worktree "start with only the new names" fails at the TypeScript password check, so T4 either reports a false failure or works around it in the entrypoint. For compose, a wrong nested default on line 45 mounts a new empty folder as `/data`: the server comes up healthy with no memories. Nested defaults in compose are believed to work in current versions, untested here and on Dokploy.
4. Fix: T4 depends on T3 (or T4's verify moves to the integration step after T3 merges). Add to T4's acceptance: `docker compose config` with an old-names-only `.env` and a new-names-only one, and compare the resolved `/data` source and every environment line with what main produces.

### M4. Test files are shared across lanes and nobody owns the join

1. Plan: section 3 (T2 and T3 test lists), section 4 item 2.
2. Evidence:
   1. `tests/bun/knowledge-host.ts` is a rig that loads `hooks/register.ts` with `plugin: { name: 'mnemosyne' }`, the tool prefix and the old root (lines 70, 90, 112, 182). Nine specs run through it: `import`, `memories`, `pinned`, `knowledge-r3`, `knowledge-wiring`, `-a`, `-b` and others. The inventory gives the rig to T2 and `import.spec.ts` (79 old-name lines) to T3.
   2. `tests/bun/fixtures/claude-stub.ts:15` (given to T2) is used only by `settings-routes.spec.ts` and `settings-view.spec.ts` (T3).
   3. `tests/bun/helpers.ts` has no owner. It builds the old root in every temp home (line 30) and links the real model cache from the developer's own old root (line 37).
3. Failure: specs that are green in each lane and red after the merge, with no task that owns making them green; or two lanes editing the same spec. If `helpers.ts:37` is renamed while the Mac's real folder has not moved, the embed tests lose the cached model and download it.
4. Fix: every spec that imports `knowledge-host` goes to T2; `claude-stub.ts` goes to T3; `helpers.ts` goes to T1 and looks for the real model cache in both places. Add an integration task after T2 to T4 merge (one owner, full gates, fixes cross-lane breaks) before T5 and T6.

### M5. Installs that live inside the data folder, and the always-on Windows dashboard, are not covered

1. Plan: T1 ("skipped while a dashboard or lock is live, retried next start"), T3 ("Windows task and Start Menu names migrate").
2. Evidence:
   1. The standalone (Claude Desktop) install keeps its code in the data folder: `<root>/plugin`, `<root>/engine`, `<root>/update-staging` (`bin/update.ts:9-13`, `102-116`; `bin/install-engine.ts:440-454`). The updater downloads the newest release into the root and runs that copy's updater from there.
   2. `homeLayout()` hard-codes the root (`bin/update.ts:102`); `updaterHome()` recognises a Desktop install only at the old path (`ui/update-routes.ts:167-175`).
   3. Windows runs the dashboard from a scheduled task at logon (`bin/update.ts:42`).
3. Failure: on such a PC the 0.38 updater is the first new code to run, from inside the folder it is supposed to move. If its layout simply points at the new root it installs a second engine, plugin copy and empty store there. If it tries the move, Windows refuses to rename a folder with open files or a working directory inside, so "retried next start" never succeeds while the task runs, and the user is never told.
4. Fix: the brief states that `homeLayout`, `updaterHome`, `bin/eval.ts:319`, `scripts/dev-ui.ts:22` and `ui/settings-routes.ts:251,337` all go through T1's resolver; that the updater never moves the folder it runs from; that a deferred move is reported once (toast or dashboard line) with the reason; and that the Windows move is a runbook step (stop the task, move, rewrite shortcuts, start the task). Put back the inventory's test item 5 (run on the real Windows PC before that PC is switched); the plan dropped it, and Windows is untested even on main per the README.

### M6. The switch on each PC and the way back are not designed

1. Plan: section 1 last paragraph, T6, D6, section 5 item 1. There is no rollback section.
2. Evidence and failure:
   1. Order: "install hal-m, carry the options over, enter a fresh key, uninstall mnemosyne". If Claude Code starts between the first and last step, both plugins load: both run `session.start` (`hooks/register.ts:2270`), both inject recall and both answer remember triggers, so saves can double.
   2. T6 uninstalls the old plugin before anything proves the new one recalls. D6 revokes the old key at the switch. A PC whose switch fails half way then has no working plugin and no valid key.
   3. After main's `marketplace.json` is renamed there is no stated place to reinstall `mnemosyne@mnemosyne` from.
   4. A PC left on 0.37 sees "v0.38.0 available" in its dashboard, and the Update button runs `claude plugin update` for the old id (`ui/update.ts:156`, `ui/update-routes.ts:309,335`, id from `hooks/ui-launch.ts:175`). What Claude Code does when the installed marketplace `mnemosyne` now declares itself `hal-m` is untested.
   5. Section 5 item 1 reads as editing `settings.json` directly. The repo's own rule is the CLI only (`hooks/register.ts:883-885`), and a running session can write the file back over a hand edit.
   6. `claude plugin configure --values-stdin` takes "a JSON object of single-line strings" (its help text, read today). Whether it accepts the sensitive `serverKey` and stores it in the keychain is untested.
3. Fix: add a "Switch and rollback" section. Suggested content: (a) server first, since it accepts both names, with a backup of `/data`; then one PC at a time. (b) T6 uses only `claude plugin` commands, runs from a plain terminal with no Claude Code session open, and goes: install and configure new, verify a recall, only then uninstall old and remove the old marketplace entry. (c) The new plugin warns at start when it sees the old plugin's tools in the session (`prompt.compose` has the tool list, `hooks/register.ts:2715`). (d) Old keys are revoked after the PC is verified, not at the switch. (e) Rollback per PC: reinstall the old id from the `v0.37.0` tag, restore the settings backup, old plugin works through the link; server: previous image tag, template untouched. (f) T2 step 1 also tries: old id installed while its marketplace is renamed; `configure --values-stdin` with a sensitive key.

### M7. The gates in the plan are not the repo's gates

1. Plan: section 4 item 4 ("`bun run typecheck`, `bun run test:bun`, top-level tests").
2. Evidence: the top-level files (`tests/register.test.ts` and ten more) import `claude-code/testing` and are run by `claude plugin test .`; earlier plans gate on `claude plugin test . && bun run typecheck && bun run test:bun && claude plugin validate .` (`docs/plans/mapx-solar-map.md:509`). `package.json` has no script for them. `bun.lock:6` stores the package name `claude-mnemosyne`, and both `test:bun` and `Dockerfile:38` install with `--frozen-lockfile`.
3. Failure: T2's largest test file (363 old-name lines) has no command in its brief. `claude plugin validate .`, the one gate that reads the renamed manifest and marketplace, is never run. If T2 renames `package.json` `name` without the matching line in `bun.lock`, the frozen install is likely to fail and take `test:bun` and the image build with it (inferred, not run).
4. Fix: name the four commands plus `bun run test:embed`; give `bun.lock` to T2 as a one-line hand edit or leave the private package name alone (it is only a label).

### M8. Real-session checks on this Mac would move the real data folder while 0.37 sessions run

1. Plan: T2 step 1, section 6 item 1, D8.
2. Evidence: the Mac's old root still holds `engine/`, `bin/`, `backups/`, `archive/`, `session-pending/` and the retired store (external-refs report, section 6 item 2); every lane and the orchestrator run the 0.37 plugin, which writes `activity.jsonl` there on each memory call.
3. Failure: the first builder that starts a session with a half-built 0.38 copy runs the move on real data, in exactly the many-sessions situation of B2.
4. Fix: an off switch for the move (for example `HALM_NO_MIGRATE=1`, and off by default for a `--plugin-dir` load); real-session checks first against a copy of the folder under a throwaway `HOME`; a tar backup of the old root before the first real move. For D8: by the routing rule in use (data loss or security goes to Opus high), T3 (launcher parser, Windows), T4 (bind address, password) and T6 (settings, uninstall, keys) are not Sonnet-medium work.

---

## Minor

1. Tool prefix (section 1 item 2, T1, T2). The host's own types confirm the rule: "`mcp__<plugin>__<name>`" (`.claude-plugin/types/claude-code/index.d.ts:3121-3130`, `13783`), and this session's tool list shows `mcp__mnemosyne__*` for plugin name `mnemosyne`. So the prefix follows the plugin name; the hyphen is untested, so the throwaway check stays. Two corrections: the `tool.call` matcher is fixed when the module loads, before any `$` exists (`hooks/register.ts:2526`), so "prefix from `$.plugin.name`" cannot feed it: use a constant from T1 and compare it at session start with the full name `$.tool.register` returns (line 2300). And the throwaway must be installed from a local marketplace, not `--plugin-dir`: a folder-loaded plugin's id is `<name>` or `<name>@inline` (same types file, PluginOptions note near line 7820), which proves nothing about `hal-m@hal-m`. Add to its checklist: state atoms under a hyphenated plugin key (`types/index.d.ts:11`, `hooks/register.ts:151,154`).
2. Names the plan leaves open (section 1 item 6, T1): the new header and cookie names. Logout must clear all four cookie names (`ui/remote.ts:189`), login sets the new one, the check reads all four (`ui/remote.ts:195`).
3. Keep-or-rename is not stated for: activity client labels `mnemosyne-*` (`hooks/register.ts:1452` and seven more, `ui/remote.ts:580,582`), the stderr prefixes written by `bin/remote.ts:84-147` (T3) and stripped in `hooks/register.ts:401,1586` (T2) and `ui/settings-routes.ts:649`, `serverInfo.name` (`bin/mcp-proxy.ts:432`, `ui/remote.ts:450`), the rules section id (`hooks/register.ts:141`). Two lanes will guess differently on the prefix pair. Simplest: strippers accept both, everything else in this list stays.
4. The copied MCP snippet uses the key `mnemosyne` (`ui/server-mode.ts:70`). Renamed to `hal-m` it gives another client's tools the same `mcp__hal-m__` prefix as the plugin's on a PC that has both. Use `hal-m-memory`, the D7 name.
5. Files with no owner: `hooks/engine-build.ts` (inventory gives it to T3, the plan omits it), `tsconfig.bun.json` (lists hook files by name; `hooks/names.ts` is new), `bun.lock`. T5 is titled "Docs and in-app text" but in-app text lives in T3's `ui/*`. T6's script sits under T3's `scripts/*` and uses T3's `bin/update.ts --install-shortcut`: T6 depends on T3, and T5 on T2 to T4, not on T2 alone.
6. The move now crosses two parent folders (`~/.claude` to home). If `~/.claude` is itself a link to another disk the rename fails as a cross-device move: defer and say so, never fall back to a copy. The hook takes home from `HOME` first, even on Windows (`hooks/register.ts:312`), while `bin/update.ts` uses the OS home: the resolver takes home as an argument so each caller keeps its own source.
7. `README.md:80` tells users to delete the data with `rm -rf ~/.claude/mnemosyne`. After the move that removes only the link (the memories stay, which the user did not want), or with a trailing slash or a recursive delete in Windows PowerShell 5 it deletes through the link. T5 rewrites the uninstall section for both paths. The "store must not be inside the engine folder" guards compare text against one root (`hooks/register.ts:326-329`, `ui/settings-routes.ts:251`): compare against both roots.
8. D5 reads "3 releases or to 2027-03-01". This repo ships several releases a month, so say "whichever is later", as the inventory does.
9. "Done means" has no item for the Windows PC, for an old launcher still serving recall, or for a before-and-after file count of the moved folder.
10. The inventory's line references were right in every place I opened (about 60).

---

## Decisions I would change

| # | Change | Why |
|---|---|---|
| D3 | Alias first, move later | Removes the B2 gap |
| D5 | Date-based, with a check | Releases are frequent |
| D6 | Revoke after verifying | Keeps rollback possible |
| D7 | Separate from the switch | One change at a time |
| D8 | Opus for T3, T4, T6 | Data loss and security |

Notes:

1. D3. In 0.38 the default root for a fresh install is `~/.hal-m`; on a PC that has the old root, 0.38 makes `~/.hal-m` a link (junction on Windows) to the old folder and uses the new name everywhere. Nothing moves, there is no moment where a path is missing, it works while a dashboard holds files open, and undoing it is deleting one link. The physical move (the flip) becomes an explicit `migrate --apply` step with everything stopped, in the runbook. The inventory rejected new-to-old because the old name stays the real folder; as a first step that is the point. D1, D2 and D4 I would keep.
2. D5. Old env names, commands, header and cookie: until 2027-03-01 or three releases, whichever is later. The folder link: only after the check in B3 fix 3 passes on every PC.
3. D7. The external-refs report says both bearer tokens of the OMP and AGY entries were printed into a research session (its section 6 item 4). That is a reason to rotate those two keys now, whatever happens to Stage 2. The rename of the entry changes the prefix those agents see (`mcp__mnemosyne-memory__*`), so their own rules need a look; do it as its own small step, not on the day the plugin id changes.
4. D8. Also: T4 after T3 (M3) and an integration task before T5 and T6 (M4).

---

## Checked and found fine

1. The plugin is a hooks-module plugin: tools and commands are registered at run time (`hooks/register.ts:2271-2300`), nothing in the manifest to rename besides the names.
2. Client and server speak over `/api/plugin/<op>` with a bearer key and no old name on the wire (`bin/remote.ts:90-104`), so a 0.38 plugin with a 0.37 server, and the reverse, should work (read, not run).
3. `engine/` holds one comment with the old path and no `MNEMOSYNE_*` read: "engine is not touched" is safe.
4. The 34 variable names match a fresh count over hooks, bin, ui, scripts, docker, tests and docs.
5. The Unraid data path already says `hal-m`; the compose defaults still say `mnemosyne` on purpose (`docker-compose.yml:17,45`).

## Not checked

1. No test, build or image was run; nothing was tried in a real Claude Code session.
2. The Windows PC, the server's live container settings and the keychain were not looked at.
3. Claude Code's behaviour on a renamed marketplace, on uninstall (does it delete the old options block and key), and on `--values-stdin` with a sensitive option is unverified; M6 lists these as things to try.

# HAL-M Stage 2: the internal names (v0.38.0)

Status: draft 3 (2026-11-22): draft 2 plus the re-check's edits R1-R7 and its minors (`docs/research/hal-m-stage2-recheck-fable.md`). Waiting on Rohit's go. Stage 1 (v0.37.0) is done; see `hal-m-rename.md`.

Inputs (read before working on any task):
- `docs/research/hal-m-stage2-inventory.md`: code touch points, back-compat design, tests.
- `docs/research/hal-m-stage2-external-refs.md`: what breaks outside the repo.
- `docs/research/hal-m-stage2-review-fable.md` (ids F-B1..F-B3, F-M1..F-M8, F-m*) and `docs/research/hal-m-stage2-review-agy.md` (ids A-B1..A-B5, A-M1..A-M10, A-m1..A-m6): every finding is assigned to a task in section 4; the finding text has the file:line evidence.

## 1. What changes

1. Plugin id and marketplace: `mnemosyne@mnemosyne` -> `hal-m@hal-m`.
2. Tools Claude sees: `mcp__mnemosyne__memory_*` -> `mcp__hal-m__memory_*`. Claude Code's types say the prefix is `mcp__<plugin>__`; the hyphen is untested, so T2 proves it first with a throwaway plugin.
3. Slash commands: `/mnemosyne-*` -> `/hal-m-*`; old names stay as aliases.
4. Environment variables: 34 `MNEMOSYNE_*` -> `HALM_*`; old names read as a fallback (rules in 3.3).
5. Data folder: the canonical root becomes `~/.hal-m` (Windows `%USERPROFILE%\.hal-m`), outside `~/.claude` so HAL-M is not tied to one agent; `HALM_ROOT` overrides it. Link only in 0.38 (D3, section 3.2): 0.38 never moves a folder. The physical move ships with the later clean-up release (R7).
6. Server: accepts both name sets; the image bakes no default an operator can set (3.1); header `Mnemosyne-Owner` -> `HAL-M-Owner` and cookies `mnemosyne_session` / `__Host-mnemosyne_session` -> `halm_session` / `__Host-halm_session`, both sets accepted (3.5).
7. Copied MCP snippet key and the OMP/AGY entry name: `hal-m-memory`, never `hal-m`, so another client's tools never share the plugin's `mcp__hal-m__` prefix (F-m4).

Kept: the Mnemopi engine name and `MNEMOPI_*`, the `-mnemosyne.N` engine build suffix, browser localStorage keys, older CHANGELOG entries and `docs/plans/` history, the private `package.json` name (a label only; renaming it would also need `bun.lock`, F-M7).

Cannot be aliased: the plugin id and the tool prefix. Each PC switches once (section 6).

## 2. Decisions

| # | Decision | Draft 2 |
|---|---|---|
| D1 | Plugin and marketplace id | `hal-m@hal-m` |
| D2 | Env prefix | `HALM_` |
| D3 | Data folder | `~/.hal-m`; link only in 0.38 |
| D4 | Slash commands | `/hal-m-*`, old as aliases |
| D5 | Alias period | to 2027-03-01 or 3 releases, whichever later |
| D6 | Server keys | new key per PC; revoke old after verifying |
| D7 | OMP/AGY entry rename | its own later step |
| D8 | Build route | Orca on the Mac; Opus high for risky tasks |

Notes:
1. D3: on a PC with the old root, 0.38 creates `~/.hal-m` as a link (Windows junction) to `~/.claude/mnemosyne` and uses the new path once the link exists. Nothing moves, open files do not matter, and undoing it is removing one link safely (6.5). A fresh install (neither path exists) creates a real `~/.hal-m`. The physical move is out of 0.38: it ships with the clean-up release, designed then from the state "new path is a link to old" (R7), with a move lock every process waits on.
2. D5: the old folder link is removed only after the check in 3.2 item 6 passes on every PC, whatever the date.
3. D8: see section 5.

## 3. Safety rules (every brief quotes the ones it touches)

### 3.1 Server defaults (F-B1, A-B1, A-M7)
1. The image sets no default, under either name, for a variable an operator can set: BIND, PORT, SECURE_COOKIE, ROOT, STORE, EMBEDDINGS, PUBLIC_URL, HOSTS, EXPIRE_UNUSED_DAYS, UI_PASSWORD. `docker/entrypoint.sh` resolves new, then old, then default, and exports the result under the new name. Image-internal paths nobody sets (CLI, PLUGIN_ROOT, MODEL_CACHE) may be baked under the new names.
2. The Dockerfile health check reads the port under both names.
3. Compose uses nested defaults for both names; `docker compose config` with an old-names-only and a new-names-only `.env` must resolve the same `/data` source and environment as main. AGY's alternative (A-M7: pass both names through, let the entrypoint decide) is declined: the entrypoint already decides for everything the image runs, and the compose check proves the data folder mount, which only compose resolves.

### 3.2 Data root (F-B2, F-B3, F-M5, F-M8, A-B2..A-B5, A-M9, A-M10, R1, R7)
1. One resolver (T1) decides the root, and every Bun entry point (dashboard, proxy, updater, bin scripts) and the hook resolve through it; nothing builds the path itself. State table, each row tested:
   1. Only old, no link (link not made yet, failed, or `HALM_NO_MIGRATE`): the old root. The new path is used only once it exists.
   2. New is a link to old: the new path.
   3. Old is a link to new: the new path.
   4. Only new (real): the new path.
   5. Neither exists: fresh install, create a real `~/.hal-m`. This is the only row that creates the default new root.
   6. Both real: never pick silently. Use the one that holds a store; if neither holds one (this Mac: store retired), use the old root. Warn at every start until a person resolves it; delete nothing except an empty folder with non-recursive `rmdir`.
   7. A link to somewhere else, or a dangling link: use the old root if it exists, warn, change nothing.
   Two folders are the same when their real paths are equal, not only when one reports as a link (junction reporting on Windows is untested).
2. Hooks cannot rename or link (the host file API has no such call): the link runs in a Bun script T1 owns, `bin/migrate-root.ts` (link only in 0.38), started through `$.process.run` with the home folder the hook resolved passed as an argument (the hook reads `HOME` first, even on Windows; F-m6). Creating the link is one `symlink` call; EEXIST from a parallel start is success when it points at the old root.
3. The hook makes the link first thing in `session.start`, ahead of the client-mode early return (R1), and only in a Claude Code install, never from the updater or from inside the root.
4. Never link when the root comes from an explicit setting (`HALM_ROOT`, `MNEMOSYNE_ROOT`, a `--root` flag): that covers the server's `/data` and standalone roots.
5. One function (T1) rebases any path at or under the old root onto the resolved root. It is applied to the stored `memoryDir` (T2), to every value the updater keeps from an old launcher (T3), to the store-against-engine-folder check in `hooks/register.ts` (F-m7, compares both spellings), and to the model cache, which becomes a function of the root instead of the constant `.claude/mnemosyne/model-cache` (T1 owns it). A stored `memoryDir` equal to the old default literal counts as "default".
6. Before the old-path link or old-root fallback is ever removed (clean-up release): a check finds no stored option, launcher, scheduled task or shortcut that still names the old root.
7. `HALM_NO_MIGRATE=1` turns off the link; it is on by default for a `--plugin-dir` load, so builders and test sessions never touch the real folder. Real-session checks run against a copy of the folder under a throwaway `HOME` with `HALM_NO_MIGRATE=0` (section 7). A tar backup of the old root is taken before the first real link on any PC.

### 3.3 Environment helper (F-M2)
1. `envOf(name)` reads `HALM_<name>`, then `MNEMOSYNE_<name>`. Per variable, the helper states whether an empty value is a value: ACTIVITY_LOG empty means "log off" and wins; for the others an empty value means "not set".
2. A second helper builds a child process environment. Bun-side parents set the new name and delete the old one. Hooks cannot delete an inherited variable (`$.process.run` only sets values over the host's environment), so a hook sets both spellings to the same value.
3. Tests: new empty with old set; both set; child env built from a parent carrying the other spelling.

### 3.4 Launchers (F-M1, A-M4, A-M5)
1. T1 owns `hooks/launcher.ts` and `tests/bun/launcher.spec.ts` (R4): one generator for the launcher and one for the shim; T2 (`register.ts`) and T3 (installers, updater) only call them. Both launcher forms read `HALM_OWNER`, then `MNEMOSYNE_OWNER`, then `global`, so other agents' scripts keep their owner.
2. The old-name launcher `bin/mnemosyne-mcp` is rewritten at every start as a short shim that runs `bin/hal-m-mcp`, and both are removed when `externalMcp` is off.
3. The updater reads the old-name launcher when the new one is missing, and rebases what it keeps (3.2 item 5).

### 3.5 Server sessions (A-M6)
1. Header: `HAL-M-Owner` and `Mnemosyne-Owner` both accepted. Cookies: four names (plain and `__Host-`, old and new); a session from any of them is valid, new sessions get the new name, and sign-out revokes the session whichever cookie carried it and clears all four.
2. stderr prefixes written by `bin/remote.ts` keep their old text in 0.38; every stripper (`hooks/register.ts`, `ui/settings-routes.ts`) accepts both old and new (F-m3). `serverInfo.name`, the rules section id and the `provider` value in replies stay as they are in 0.38 (decided once in T1's names module).

## 4. Tasks

Common rules for every brief: work only in the one Stage 2 worktree and commit your task before reporting; use subagents for independent parts of the task (one per file group or test file, in parallel, never two on the same file; the brief's Parallel plan names them), while the builder alone runs the gates and commits (Rohit, 2026-11-22); engine/ is not touched; old names are read as a fallback and never removed in this release; never `git checkout` or `git stash` to undo; run only the tests the brief names (T7 and T8 run the full gates); never link or move the real `~/.claude/mnemosyne` (3.2 item 7); `plugin.json` version stays 0.37.0 until T5 (R2); no silent workarounds (three real tries, then a plain report); a builder never routes or picks models; report back with `worker_done` over Orca.

One worktree only (Rohit, 2026-11-22): every task runs in the same Orca worktree on one branch, `feat/hal-m-stage2`, one after another. Each task ends with its own commit on the branch and its own targeted tests green; the next task starts from that commit. The task boundaries and file ownership below still apply: they scope each brief and each commit.

| Order | Task | Model |
|---|---|---|
| 1 | T1 Naming core, data root, launcher | Opus high |
| 2 | T2 Plugin identity and tools | Opus high |
| 3 | T3 bin, ui, scripts, Windows | Opus high |
| 4 | T4 Server, Docker, CI | Opus high |
| 5 | T7 Gates and real-session checks | Opus high |
| 6 | T5 Docs and version | Sonnet medium |
| 7 | T6 Switch script and runbook | Opus high |
| 8 | T8 Final gates and review | Opus high, Fable max review |

Test file ownership (closes the open-owner gap): T1 owns `tests/bun/names.spec.ts`, `tests/bun/migrate-root.spec.ts`, `tests/bun/launcher.spec.ts`, `tests/bun/helpers.ts`; T2 owns every `tests/*.test.ts` and every file that imports `tests/bun/knowledge-host.ts` (including `tests/embed/near-duplicate.spec.ts`) and the rig itself; T4 owns `tests/bun/docker-init.spec.ts`; T3 owns every other file under `tests/bun` and `tests/embed`, including `install-root.spec.ts` (whole file, A-M2) and `no-real-home.spec.ts`.

1. T1 Naming core, data root, launcher. Files: new `hooks/names.ts` (no imports: plugin names, a constant tool prefix `mcp__hal-m__` (the `tool.call` matcher is fixed at load, F-m1), command names new and old, header and four cookie names, the stderr prefix list, the 3.5 item 2 keep-list, `envOf` and the child-env helper, root resolver, path rebaser, model cache path); new `bin/migrate-root.ts` (link only, state table, home passed in); `hooks/launcher.ts` (generators, `HALM_OWNER` fallback, shim); `tests/bun/helpers.ts` (finds the real model cache in both places, A-m3); `tsconfig.bun.json` (A-M1); `hooks/engine-build.ts` comments (F-m5). Tests first: every row of 3.2 item 1, the 3.3 cases, launcher text and shim; Windows junctions with an injected fs and platform. Covers F-B2, F-B3 (helpers, model cache), F-M2, F-m1, F-m2, F-m3 (list), F-m5, F-m6, A-B3 (helper side), A-B4, A-M1, A-M3 (launcher), A-M9, A-m3, R1 (resolver), R4.
2. T2 Plugin identity and tools. Owns `hooks/register.ts` (every edit there goes through T2), `hooks/session.ts`, `hooks/surface.ts`, `hooks/ui-launch.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json` (names and `memoryDir` default; version stays), `marketplace.json`, the README row that the `memoryDir` default invalidates (only that row, R2), and the test files listed above. Step 1: a throwaway plugin named `hal-m` loaded with `--plugin-dir` and `HALM_NO_MIGRATE=1` proves `mcp__hal-m__memory_*` and the command names in a real session (it does not prove the installed id; section 7 check 1 does). Then: manifest names; prefix from T1; old and new commands registered (one handler each unless `command.run` takes a pattern, A-m1); the link call first in `session.start`, ahead of the client-mode return (R1); `memoryDir`, root and the engine-folder check through T1 (F-m7); launcher writes and removal through T1's generators (A-M5); the warning when the old plugin's tools are also in the session (6.3, F-M6); the `env.get` mocks that answer `/home/u` for any name fixed in T2's test files (A-B3); stderr strippers accept both (F-m3). Test commands: `claude plugin test .` for the top-level files, `bun test <file>` for the bun specs. Covers F-B3 (memoryDir), F-M4 (part), F-M6 (6.3), F-m3, F-m7, A-B3, A-M3 (part), A-M5, A-M10 (part), A-m1, A-m5 (part), R1 (hook).
3. T3 bin, ui, scripts, Windows. Owns `bin/*.ts` except `bin/migrate-root.ts`, `ui/*`, `scripts/*` (never change `scripts/vendor-map.ts`, `ui/map-state.ts` or the seed `mnemosyne-starfield`, A-m4), `hooks/engine.ts`, `hooks/import.ts`, `hooks/knowledge.ts`, `hooks/backfill.ts`, `hooks/activity-log.ts`, `tests/bun/fixtures/claude-stub.ts` (F-M4) and the test files listed above. Work: `envOf` everywhere; launchers through T1's generators (3.4); `homeLayout`, `updaterHome`, `claudeInstall`, `bin/eval.ts`, `scripts/dev-ui.ts`, `ui/settings-routes.ts` through T1's resolver, comparing real paths, not text, there and in `classifyProcesses` (F-M5, A-B2, re-check minor 2); `optionState` in `ui/settings-routes.ts` treats the old default literal as default (A-M10); activity client labels in `ui/remote.ts` read both (A-m5); the updater never touches the folder it runs from and its staging stays valid across the 0.37 -> 0.38 standalone update (A-B5); header and cookies per 3.5 (A-M6, F-m2); copied snippet key `hal-m-memory` in `ui/server-mode.ts` (F-m4); `bin/install-engine.ts` accepts both root markers (A-m2); Windows task, Start Menu and old `mnemosyne-ui` dashboard folder migrate, and a link that could not be made is reported once (A-M8). Covers F-B3 (updater), F-M1 (updater), F-M5, F-m2, F-m4, A-B2, A-B5, A-M2, A-M3 (part), A-M4, A-M6, A-M8, A-M10, A-m2, A-m4, A-m5.
4. T4 Server, Docker, CI (after T3, F-M3). Files: `Dockerfile`, `docker/entrypoint.sh`, `docker/init-data.ts`, `docker-compose.yml`, `.env.example`, `docker/unraid/my-HAL-M.xml` (new Config keys; existing containers keep theirs), `.github/workflows/docker.yml` (keep one leg on old names), `tests/bun/docker-init.spec.ts`. Rules 3.1. Acceptance on 7of9 (no Docker on the Mac) in its own clone in a temp folder, image tag `hal-m:stage2-test`, its own container name and throwaway data folder; never the tag `hal-m:local`, the checkout `hal-m-src` or the live HAL-M container (R3): (a) exactly today's Unraid variables (`MNEMOSYNE_UI_PASSWORD`, `MNEMOSYNE_BIND=127.0.0.1`, `MNEMOSYNE_PUBLIC_URL`, `MNEMOSYNE_EXPIRE_UNUSED_DAYS`) -> listens on 127.0.0.1 only; (b) an old-name non-default `MNEMOSYNE_STORE` -> that store opens; (c) new names only -> healthy; (d) the two `docker compose config` comparisons. Covers F-B1, F-M3, A-B1, A-M7 (declined in 3.1 with reason).
5. T7 Gates and real-session checks. With T1-T4 committed on the branch: fixes any break between their areas, runs the gates in 5.2 (the version spec is expected to stay green because the version is unchanged), then runs the section 7 checks.
6. T5 Docs and version. README (install, update, uninstall, settings, Unraid, 0.37 -> 0.38 upgrade and the switch), DESIGN.md, `docs/architecture.svg`, the `plugin.json` version bump to 0.38.0 together with the new CHANGELOG entry (R2), Stage 2 marked done in `hal-m-rename.md`.
7. T6 Switch script and runbook. `scripts/migrate-hal-m.ts`, dry run by default, using only `claude plugin` commands (never hand-edits `settings.json`), run from a plain terminal with no Claude Code session open; order and rollback per section 6, safe link removal per 6.5. Runbook `docs/plans/hal-m-stage2-runbook.md`. Covers F-M6, A-m6 (safe removal).
8. T8 Final gates and review. Full gates again (5.2) on the branch with T5 and T6, then a separate Fable max read-only review of the whole branch, including the T6 script and runbook, against the inventory, both reviews, the re-check and a grep of both spellings (R2).

## 5. Route and gates

### 5.1 Route
1. Builds run locally on the Mac through Orca (Rohit, 2026-11-22) in exactly one Orca worktree, `feat/hal-m-stage2` from `main`. One Claude Code terminal per task in that worktree, started only after the previous task's commit, `claude --model <m> --effort <e>`, models per section 4; a task's fix rounds reuse its terminal. Opus high where a mistake loses data or opens the server (F-M8 routing note). The worktree is removed after the PR merges.
2. Every builder session runs with `HALM_NO_MIGRATE=1` exported in its terminal.
3. Review: T8 (section 4), after T5 and T6.

### 5.2 Gates (F-M7)
1. `claude plugin test .`, `bun run typecheck`, `bun run test:bun`, `claude plugin validate .`, and `bun run test:embed` on the Mac.
2. Baseline on main today: 5 known `test:bun` failures and 21 typecheck errors in `settings-view.spec.ts`; nothing new may fail.

## 6. Switch and rollback (F-M6, R3, R6)

1. Server first: back up `/data`; tag the running image `hal-m:0.37.0`; build 0.38 as `hal-m:local` from the tag and recreate with the template unchanged; check it listens on 127.0.0.1 only and recalls. Server rollback: point the container back at `hal-m:0.37.0`, template unchanged.
2. Then one PC at a time (the Mac first; the Windows PC only after T1's Windows branch has run there), with no Claude Code session open:
   1. Tar backup of the old root.
   2. `claude plugin disable mnemosyne@mnemosyne`.
   3. Install and configure `hal-m@hal-m` (options carried, `memoryDir` empty when it was the old default); add a new device key for this PC.
   4. Start one session: the link appears, a recall and a save reach the server.
   5. Only then uninstall `mnemosyne@mnemosyne` and remove the old marketplace entry. Revoke the old key some days later, not in this step.
3. The new plugin warns at start when the old plugin's tools are also in the session (double saves).
4. Rollback on a PC:
   1. Before step 2.5: uninstall `hal-m`, `claude plugin enable mnemosyne@mnemosyne`; its options and key are untouched.
   2. After step 2.5: reinstall `mnemosyne@mnemosyne` from the `v0.37.0` tag (section 7 check 2) and give it a new device key if the old one was revoked; settings are set again through `claude plugin configure`, never by restoring a file over `settings.json`.
5. The `~/.hal-m` link stays in place on rollback (0.37 ignores it). If it must go, remove only the link and check first that it is one: macOS and Linux `rm ~/.hal-m` (no `-r`, no trailing slash), Windows `rmdir %USERPROFILE%\.hal-m` from cmd. A recursive delete or a trailing slash goes through the link and empties the real folder.
6. Declined (R6): a 0.37 PC will show "v0.38.0 available" and its Update button cannot switch ids. That code is already shipped; the only Claude Code installs are Rohit's own PCs, switched by this runbook. The standalone update path is handled in T3 (A-B5).
7. Out of this release (F-m9): Windows PC recall after its switch is checked when that PC is switched, not as part of "Done means".

## 7. Real-session checks (T7, before the Mac is switched; R5)
1. Marketplace rename: install 0.37 from a local marketplace folder, change that folder to the 0.38 manifest, update, and record what happens to the old id, the old marketplace entry and the stored options.
2. Rollback source: install `mnemosyne@mnemosyne` from the `v0.37.0` tag.
3. `claude plugin configure --values-stdin` with a sensitive `serverKey`: is it stored in the keychain? If not, the runbook has the user type it in `/plugin`.
4. Under a throwaway `HOME` holding a copy of a 0.37 root, with `HALM_NO_MIGRATE=0`: a session start creates the `~/.hal-m` link, recall works, nothing moves; `mcp__hal-m__memory_*` and `/hal-m-setup` appear and `/mnemosyne-setup` still answers. If a session will not start under a throwaway `HOME` (sign-in, first-run setup), test the link by running `bin/migrate-root.ts` by hand, and accept that the first real link is made during the Mac switch, after the tar backup.
5. A stale old launcher (old env names, `MNEMOSYNE_OWNER` set) recalls under the right owner.

## 8. Outside the repo (at or after the switch)

1. `hermes-switchui/CLAUDE.md`: name `mcp__hal-m__*` and the server, not the retired store.
2. `switch-agent` dev scripts set `MNEMOSYNE_OWNER`, `_CLI`, `_REPO`: they keep working through the fallbacks; update them in that repo.
3. `~/.headroom/bin/reap-temp-scratch.sh` matches temp folders by `mnemosyne-`: add `hal-m-`.
4. OMP and AGY entries: rename to `hal-m-memory` as its own step (D7); their tool prefix changes too, so check their rules.
5. Server memories that quote old names (active rows today): 3 name `mcp__mnemosyne__`; update them after the switch.
6. Later clean-up release: the physical move (designed from the state "new path is a link to old", with a move lock every process waits on, cross-disk rename refused, R7, F-m6), then removal of the fallbacks after D5 and the check in 3.2 item 6. That release decides whether the move is mandatory.

## 9. Done means

1. A real Claude Code session on the Mac shows `mcp__hal-m__memory_*` and `/hal-m-setup`, with memory on the server; the old plugin is uninstalled.
2. The server runs the 0.38.0 image with its existing `MNEMOSYNE_*` template unchanged and listens on 127.0.0.1 only.
3. Gates match main's baseline; the final review's findings are fixed.
4. Every finding id in both reviews and the re-check is covered by a task or declined with a reason (declined: A-M7 in 3.1, R6 in 6.6; moved to the clean-up release: R7 and the move half of F-m6; out of release: F-m9 in 6.7).

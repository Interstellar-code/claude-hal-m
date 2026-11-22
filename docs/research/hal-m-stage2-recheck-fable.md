# HAL-M Stage 2 plan, draft 2: re-check (Fable 5.2)

Date: 2026-11-22. Read-only re-check of `docs/plans/hal-m-stage2.md` (draft 2) against the code on main (596292d), my first review (ids F-*) and AGY's review (ids A-*). Nothing was edited except this file. No tests, builds or real sessions were run.

Verdict: not ready to build yet. No redesign is needed: draft 2 fixes all eight blockers from both reviews, and "link first, move later" is the right design. Seven plan edits remain (R1 to R7); five of them change what the T1 and T2 briefs say, so they come before T1 starts.

Terms: "old root" is `~/.claude/mnemosyne`, "new path" is `~/.hal-m`, "the link" is the symlink (Windows: junction) that 0.38 makes at the new path, pointing at the old root.

---

## Blocker

None.

---

## Major

### R1. The link-first design still has one way to end with two real folders: a write to the new path before the link exists

1. Plan: D3 note 1 ("uses the new path everywhere"), 3.2 items 1 and 2, T2 ("the hook calling `bin/migrate-root.ts` (link only)").
2. Evidence:
   1. In client mode (the Mac's mode) `session.start` returns early, before any folder work (`hooks/register.ts:2302-2305`). Every memory call still logs through `record()` (`hooks/register.ts:929`), and the appender creates the log's folder when it is missing (`bin/activity.ts:105-107`).
   2. `secure()` creates the root and the store at start in local mode (`hooks/register.ts:630-633`).
   3. Standalone scripts, the dashboard and the proxy never pass through `session.start` at all.
   4. The state table names the row "only old" but not its outcome when the link is not there yet, could not be made, or is switched off (`HALM_NO_MIGRATE`).
3. Failure: if the link call sits after the client-mode return, or fails, and the code then "uses the new path everywhere", the first logged memory call makes a real `~/.hal-m` holding only `activity.jsonl`. That is the "both real" state on the one PC named in "Done means".
4. Fix (3.2 item 1, T1 and T2 briefs): one sentence each.
   1. "Only old, no link" resolves to the old root. The new path is used only once it exists. No code creates the default new root unless the resolver answered "fresh install" (neither path exists).
   2. The hook makes the link before anything else in `session.start`, ahead of the client-mode return, and every Bun entry point (dashboard, proxy, updater, bin scripts) resolves through T1 instead of building the path.
   3. "Both real" needs a tie-break when neither folder holds a store (the Mac: its store is retired): use the old root and warn.
   4. Two folders are "the same" when their real paths are equal, not only when one reports as a link (whether the host reports a Windows junction as a link is untested).

### R2. The gates run before the two tasks that change gated files, and one gate fails by construction

1. Plan: section 4 order (T7, then T5 and T6), 5.1 item 3 (review after T7), 5.2.
2. Evidence: `tests/bun/readme-settings.spec.ts:139` requires the newest CHANGELOG entry to equal `plugin.json`'s version; lines 104-112 require each README option row to show `plugin.json`'s default. T2 changes `plugin.json` (version, `memoryDir` default); README and CHANGELOG are T5, after T7.
3. Failure: `bun run test:bun` in T7 has new failures that T7 cannot fix in its own files. After that, T5 (README, pinned by that spec) and T6 (the script that installs, configures, uninstalls and handles keys) get no gate run and no review.
4. Fix: T2 leaves the version at 0.37.0 and may edit the one README row its `memoryDir` default invalidates; T5 bumps the version together with the CHANGELOG entry. Add a last step after T5 and T6: full gates again plus the read-only review of the T6 script and runbook.

### R3. Rollback (6.5) and the server step (6.1, T4) can destroy what they are meant to protect

1. Evidence and failure:
   1. "Delete the `~/.hal-m` link": `rm -rf ~/.hal-m/` (trailing slash) on macOS, or a recursive delete in Windows PowerShell 5, goes through the link and empties the real old root. AGY's A-m6 item 3 (check it is a link, remove only the link) was not taken over.
   2. Step 2.4 revokes the old key; 6.5 then says "keep using the old key (not yet revoked)". After 2.4 that is false. Whether uninstall also deletes the stored key is untested.
   3. "Restore the settings backup" is a hand edit of `settings.json`, which T6 forbids, and it overwrites anything changed since.
   4. The live server runs the image tag `hal-m:local` (`docker/unraid/my-HAL-M.xml:6`, `docker-compose.yml:28`), built in the checkout `/mnt/cache/appdata/hal-m-src` (`README.md:730`). T4's acceptance runs on that same host. A test build tagged `hal-m:local`, or a branch checked out in that folder, puts untested code under the live container's next recreate. And once 0.38 is built over the tag, there is no 0.37 image to go back to; the plan has no server rollback line.
2. Fix:
   1. 6.5: leave the link in place on rollback (0.37 ignores it). If it must go: macOS/Linux `rm ~/.hal-m` with no `-r` and no slash, Windows `rmdir` from cmd, and the script checks it is a link first. After a physical move, leave the folder where it is: 0.37 works through the old-path link.
   2. 6.2: before the verify session, `claude plugin disable mnemosyne@mnemosyne` (the command exists; checked in `claude plugin --help`). Rollback before uninstall is then `enable` again, with options and key untouched. Revoke the old key some days after step 2.4, not in it; say that a rollback after uninstall needs a new key.
   3. T4: own clone in a temp folder on 7of9, image tag `hal-m:stage2-test`, own container name, never `hal-m:local` and never `hal-m-src`. 6.1: tag the running image `hal-m:0.37.0` before building 0.38; server rollback is that tag with the template unchanged.

### R4. Launcher text is written from two lanes with no single owner

1. Plan: 3.4, T2 ("launcher writes and removal of 3.4 item 2"), T3 (owns `hooks/launcher.ts`, `bin/install-engine.ts`, `bin/update.ts`).
2. Evidence: `hooks/register.ts:639-655` (T2) writes the launcher with `shWrapper` and `cmdWrapper` from `hooks/launcher.ts` (T3). T2's own test file asserts that text (`tests/register.test.ts:864`, `1623-1647`). The new shim has no stated home.
3. Failure: T2 cannot make its launcher assertions pass in its lane (the text changes in T3's), and the shim gets written twice, once in `register.ts` and once in the installers, with nothing keeping the two copies equal. This is the A-M3 collision, still open for this file.
4. Fix: `hooks/launcher.ts` and `tests/bun/launcher.spec.ts` move to T1, which adds the `HALM_OWNER` fallback and one shim generator; T2 and T3 only call them.

### R5. Three Claude Code behaviours on the switch path are still untested and no check covers them

1. Plan: 6.2, 6.5, 6.6, section 7, T2 step 1.
2. Evidence: 6.6 itself says "untested what Claude Code does with a renamed marketplace". Between steps 2.2 and 2.4 the Mac holds two marketplace entries for the same repo, one of them under a name the repo no longer declares. Whether `claude plugin configure --values-stdin` stores a sensitive `serverKey` is untested (F-M6 f, AGY section 4). Whether a real session starts under a throwaway `HOME` (sign-in, first-run setup) is untested, and section 7 depends on it. Builder terminals export `HALM_NO_MIGRATE=1` (5.1 item 2) and a `--plugin-dir` load defaults to it, so check 7.1 ("a session start creates the link") cannot pass unless it is switched off there.
3. Fix: add to section 7, before the Mac is switched: (a) install 0.37 from a local marketplace folder, change that folder to the 0.38 manifest, update, and record what happens to the old id and the old marketplace entry; (b) install from the `v0.37.0` tag, as rollback needs; (c) `--values-stdin` with a sensitive key; (d) `HALM_NO_MIGRATE=0` for the throwaway-HOME checks, and if a session will not start under a throwaway HOME, test the link through `bin/migrate-root.ts` run by hand and accept that the first real link is made during the Mac switch, after the tar backup.

### R6. Section 6 item 6 cannot be done by T3

1. Evidence: a PC on 0.37 finds new versions from the repo's GitHub tags (`ui/update-routes.ts:109-113`) and its Update button runs `claude plugin update` for the old id (`ui/update-routes.ts:335`). That code is already shipped; nothing in 0.38 runs on that PC.
2. Failure: once `v0.38.0` is tagged, a 0.37 Claude Code install shows "v0.38.0 available" and the button fails or says "no newer version" every time. T3 can only fix the standalone path, where the 0.37 updater runs the staged 0.38 updater (A-B5).
3. Fix: either ship a small 0.37.1 under the old id first (its check says "0.38 is a new plugin: switch with the runbook"), or decline this for Claude Code installs with the reason "only Rohit's own PCs, switched by runbook" and keep the standalone half in T3.

### R7. The physical move (--apply) starts from a different state than 3.2 assumes

1. Plan: 3.2 item 3, D3 note 1, 7.4.
2. Evidence: after 0.38 has run, the new path is a link to the old root. The move must first remove that link, then rename, then link the old path: three steps, with one or both paths missing in between. "Session process holds the old root" cannot be detected: a Claude Code session keeps no file open there.
3. Failure: a session that starts inside the gap sees neither folder, reads that as a fresh install and creates an empty root.
4. Fix: the resolver, in every process, treats a held move lock as "wait, then resolve again", never as a fresh install; the rows "dangling link" and "neither exists while the lock is held" get that outcome; a cross-disk rename is refused, never turned into a copy (F-m6). Since the move is optional and later (6.4), it could also leave 0.38 altogether and ship with the clean-up release; that makes T1 smaller.

---

## Minor

1. 3.3 item 2: a hook cannot delete an inherited variable; `$.process.run` and `$.process.spawn` only set variables "over the host process's own environment" (`.claude-plugin/types/claude-code/index.d.ts:8170`, `8261`). In hooks the helper sets both spellings to the same value; only Bun-side parents can delete.
2. With the link, one folder has two spellings. `updaterHome` compares text paths (`ui/update-routes.ts:168-175`) while the dashboard takes its plugin folder from the runtime (`ui/server.ts:114,195`), which may be the real, old spelling (inferred, not run). T3: compare real paths there and in `classifyProcesses`, or the Update button disappears on a standalone install.
3. `tests/surface.test.ts` (T2's list) does not exist; AGY's A-m6 named it in error. The `provider: 'mnemosyne'` assertion is at `tests/register.test.ts:957` and in `tests/bun/mcp-proxy.spec.ts` (T3): decide keep or rename once, in T1.
4. Test files still without a clear owner. T3's list is by category; about 20 specs with old names fit no category (for example `connection`, `crud-api`, `engine-build`, `engine-env`, `knowledge-api`, `ui-users`, `project-identity`, `tests/embed/embed.spec.ts`, `similar.spec.ts`), plus top-level `activity-log`, `guard` and `vocab` tests. Rule that closes it: T2 owns every `tests/*.test.ts` and every file that imports `knowledge-host` (eleven, including `tests/embed/near-duplicate.spec.ts`); T4 owns `tests/bun/docker-init.spec.ts`; T3 owns every other `tests/bun` and `tests/embed` file. `tests/bun/no-real-home.spec.ts:10-11` allows spawns by file and line number, so T3 owns it too.
5. Ownership slips: `tests/bun/install-root.spec.ts` is split between T1 (closure list) and T3 (marker and launcher names), and the import that changes the closure is made by T3: give the whole file to T3. The env mock fix of A-B3 (the `env.get` mocks that answer `/home/u` for any name: `tests/register.test.ts:77,929,1302,1780,2984`, `tests/session.test.ts:232`, `tests/ui-launch.test.ts:88`) is listed under T1 but the files are T2's. A-M10 item 3 (`ui/settings-routes.ts:230-234`) and A-m5's `ui/remote.ts:580,582` are T3 files not named in T3. `hooks/engine-build.ts` still has no owner (F-m5).
6. 3.5 says "both cookies": there are four names (plain and `__Host-`, old and new; `ui/remote.ts:131-133,189,195`), and sign-out must revoke the session whichever cookie carried it (A-M6). The new header and cookie names are still not written down (F-m2).
7. 6.3 (warn when the old plugin's tools are in the session) is code in `hooks/register.ts` but is not in T2's work list.
8. 3.1 item 3 keeps nested compose defaults, where AGY (A-M7) advised passing both names through and letting the entrypoint decide. The `docker compose config` check covers it; say that the advice was declined and why.
9. A-m4: "leave alone unless a name in them must change" leaves a door open. The seed `mnemosyne-starfield` and `scripts/vendor-map.ts` never change.
10. T2 step 1 with `--plugin-dir` proves the prefix and the commands, not the id: a folder-loaded plugin's options key is `hal-m` or `hal-m@inline`. The id is proven by R5 check (a). T1 still says "tool prefix from `$.plugin.name`" although the `tool.call` matcher is fixed at load (`hooks/register.ts:2526`): use a constant (F-m1).
11. A PC that never runs the physical move keeps "new path is a link to old" for good. Section 8 item 6 should say whether the clean-up release makes the move mandatory or keeps that row.
12. "A deferred move is reported once" (T3) is left over from draft 1: 0.38 no longer moves by itself. What needs reporting now is a link that could not be made.

---

## Finding ids not covered and not declined

"Done means" item 4 asks for every id to be covered or declined with a reason. The plan has no declined list. Open ids:

| Id | What is open | See |
|---|---|---|
| F-M6 | untested host behaviours; 6.3 owner | R5, minor 7 |
| F-m1 | constant prefix; id proof | minor 10 |
| F-m2 | new header and cookie names | minor 6 |
| F-m3 | stderr prefixes, serverInfo, section id | note 1 |
| F-m4 | copied snippet key | note 2 |
| F-m5 | `hooks/engine-build.ts` owner | minor 5 |
| F-m6 | cross-disk rename; home source | R7, note 3 |
| F-m7 | engine-folder guard in register.ts | note 4 |
| F-m9 | Windows PC in "Done means" | note 5 |
| A-B3 | env mocks sit in T2 files | minor 5 |
| A-M2 | closure list belongs with T3 | minor 5 |
| A-M3 | launcher and surface contracts | R4, minor 3 |
| A-M6 | four cookies; revoke by either | minor 6 |
| A-M7 | declined without a reason | minor 8 |
| A-M10 | `optionState` in T3's file | minor 5 |
| A-m5 | `ui/remote.ts` labels in T3 | minor 5 |
| A-m6 | safe link removal; missing test file | R3, minor 3 |

Notes:
1. F-m3: `bin/remote.ts:84-147` (T3) writes prefixes that `hooks/register.ts:401,1586` (T2) and `ui/settings-routes.ts:649` strip. Say "strippers accept both, prefixes keep the old text" or the two lanes will differ.
2. F-m4: `ui/server-mode.ts:70` hands out the key `mnemosyne`; renamed to `hal-m` it collides with the plugin's own `mcp__hal-m__` prefix. Use `hal-m-memory`.
3. F-m6, second half: the hook reads `HOME` first even on Windows (`hooks/register.ts:312`) and the Bun scripts use the OS home. `bin/migrate-root.ts` must take the home the hook resolved as an argument, or the link can be made in a different folder than the one the hook then uses.
4. F-m7: `hooks/register.ts:326-329` compares the store against one engine folder by text; with two spellings of the root it should compare both.
5. F-m9: add "the Windows PC recalls after its switch" to section 9, or state that it is outside this release.

Covered in full: F-B1, F-B2, F-B3, F-M1, F-M2, F-M3, F-M4, F-M5, F-M7, F-M8, F-m8; A-B1, A-B2, A-B4, A-B5, A-M1, A-M4, A-M5, A-M8, A-M9, A-m1, A-m2, A-m3, A-m4 (wording in minor 9). F-m10 was a note, not a finding.

---

## The four questions

1. Coverage: 17 ids are open or only partly covered (table above); none of them is a blocker.
2. D3 and 3.1 to 3.5: correct against the code, with three corrections: R1 (write before the link), R7 (the move's starting state) and minor 1 (hooks cannot delete variables). 3.1 matches `Dockerfile:17-28,55`, `docker/entrypoint.sh:17-42` and `ui/remote.ts:74-94`. 3.4 matches `hooks/launcher.ts:40,76-78` and `bin/update.ts:270-285`. No new security gap in the rules themselves; the new exposure is operational (R3 item 4, the live image tag).
3. Ownership: no source file has two owners. One test file is split (`install-root.spec.ts`), one listed file does not exist, the launcher generator is shared by two lanes (R4), and about 20 test files have no stated owner (minor 4).
4. Section 6: the order is right (server first, verify before uninstall, revoke late). It is workable after R3 (safe rollback wording, disable instead of running both plugins, image tags), R5 (three untested behaviours) and R6 (item 6 is not doable as written).

## Verdict

Not ready to build as written; ready once R1 to R7 are edited into the plan. R1, R2, R4, R7 and minor 1 change the T1 and T2 briefs and come first. R3, R5 and R6 change sections 6 and 7 and can be edited while T1 runs.

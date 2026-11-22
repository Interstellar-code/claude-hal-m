# HAL-M 0.38 switch runbook

Plan: `docs/plans/hal-m-stage2.md` section 6. Evidence: `docs/research/hal-m-stage2-t7-checks.md`.
Order: the server first, then one PC at a time (the Mac first). Every step has its rollback next to it.

## 1. Server (Unraid 7of9)

The template stays unchanged: the 0.38 image reads its `MNEMOSYNE_*` keys as a fallback (T4 acceptance a-c).

1. Back up the data folder:
   `ssh root@192.168.0.200 'tar -czf /mnt/cache/appdata/hal-m-backup-$(date +%F).tgz -C /mnt/cache/appdata hal-m'`
2. Keep the running image for rollback: `docker tag hal-m:local hal-m:0.37.0`
3. Build 0.38 from the tag: `cd /mnt/cache/appdata/hal-m-src && git fetch --tags && git checkout v0.38.0 && docker build -t hal-m:local .`
4. Recreate with the template unchanged: `php /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/rebuild_container HAL-M`, then `docker start HAL-M` if it is not running.
5. Check:
   1. Health: `docker inspect -f '{{.State.Health.Status}}' HAL-M` shows `healthy`.
   2. Listens on 127.0.0.1 only: `docker exec HAL-M sh -c 'cat /proc/net/tcp' | awk '$4=="0A" && $2 ~ /:2253$/'` prints only `0100007F:2253`.
   3. Recall: a recall from a 0.37 PC still answers (the server accepts the old header and cookies).

Server rollback: `docker tag hal-m:0.37.0 hal-m:local`, run step 4 again. The template is never changed.

## 2. A PC (the Mac first)

Close every Claude Code session, then work in a plain terminal as your normal user. The server key lives in the keychain, so a different HOME cannot save it. Export `HALM_NO_MIGRATE` only if you want to skip the data-folder link.

1. Look first: `bun scripts/migrate-hal-m.ts switch` (a dry run that changes nothing). It lists, in order:
   1. A tar backup of `~/.claude/mnemosyne` to `~/hal-m-switch-backup-<time>.tgz`.
   2. `claude plugin marketplace add Interstellar-code/hal-m`. The old marketplace cannot be renamed in place (T7 check 1), so `hal-m` is added beside `mnemosyne`.
   3. `claude plugin disable mnemosyne@mnemosyne` (its options and key stay).
   4. `claude plugin install hal-m@hal-m`.
   5. `claude plugin configure hal-m@hal-m --values-stdin` with the old options that were set. `memoryDir` is left out when it was the old default, and `serverKey` is never copied.
2. Run it: `bun scripts/migrate-hal-m.ts switch --apply`. It refuses while a Claude Code session is running and stops at the first failed step.
3. Server PCs: make a new device key in the server's Settings, MCP connection, then `claude plugin configure hal-m@hal-m` (or `/plugin` in Claude Code) and paste it as `serverKey`. Keep the old key until step 6.
4. Start one Claude Code session and check:
   1. The tools are `mcp__hal-m__memory_*` and `/hal-m-setup` exists (`/mnemosyne-setup` still answers).
   2. `ls -ld ~/.hal-m` shows a link to `~/.claude/mnemosyne` (made at session start; nothing moves).
   3. A recall finds a known memory and a save appears on the dashboard.
   4. No warning about the old plugin's tools also being loaded (that would mean double saves).
5. Only then: `bun scripts/migrate-hal-m.ts finish --apply`. It uninstalls `mnemosyne@mnemosyne` (`--keep-data`) and removes the `mnemosyne` marketplace.
6. Some days later: revoke the old device key on the dashboard.

Windows PC: only after T1's Windows branch has run there (plan 6.7). Same steps from a plain cmd window. The link is a junction.

## 3. Rollback on a PC

1. Before step 5: `bun scripts/migrate-hal-m.ts rollback --apply`. It uninstalls `hal-m@hal-m` and enables `mnemosyne@mnemosyne`, whose options and key were never touched. The `hal-m` marketplace entry stays; it is harmless, or remove it with `claude plugin marketplace remove hal-m`.
2. After step 5 (rollback after finish):
   1. `claude plugin marketplace add 'https://github.com/Interstellar-code/hal-m.git#v0.37.0'` (T7 check 2).
   2. `claude plugin install mnemosyne@mnemosyne`.
   3. Set the options again with `claude plugin configure mnemosyne@mnemosyne`, and give it a new device key if the old one was revoked. Never restore a file over `settings.json`.
   4. `claude plugin uninstall hal-m@hal-m`.
3. The `~/.hal-m` link can stay: 0.37 ignores it. If it must go, check that it is a link first (`ls -ld ~/.hal-m` starts with `l`), then:
   1. macOS/Linux: `rm ~/.hal-m`, with no `-r` and no trailing slash.
   2. Windows: `rmdir %USERPROFILE%\.hal-m` from cmd.
   A recursive delete, or a trailing slash, goes through the link and empties the real folder.
4. Restore data only from the tar backup: `tar -xzf ~/hal-m-switch-backup-<time>.tgz -C ~/.claude`, run while no session is open.

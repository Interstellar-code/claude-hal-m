# HAL-M Stage 2 Plan Review (AGY)

Reviewed:
- Plan: `docs/plans/hal-m-stage2.md`
- Research reports: `docs/research/hal-m-stage2-inventory.md`, `docs/research/hal-m-stage2-external-refs.md`
- Codebase: `hooks/`, `bin/`, `ui/`, `docker/`, `scripts/`, `tests/`, `.claude-plugin/`, `Dockerfile`, `docker-compose.yml`, `tsconfig*.json`

---

## Findings by Severity

### Blockers

#### B1. `Dockerfile` `ENV` defaults (`HALM_BIND=0.0.0.0`, etc.) override operator `MNEMOSYNE_*` container variables when `HALM_*` wins

- **Plan section**: Section 1 item 6, Section 3 T1 & T4, Section 6 item 2 ("The server runs the 0.38.0 image with its existing `MNEMOSYNE_*` template unchanged").
- **Code evidence**:
  - `Dockerfile:17-25` bakes default values into the image environment:
    `MNEMOSYNE_ROOT=/data`, `MNEMOSYNE_STORE=/data/store`, `MNEMOSYNE_CLI=/opt/mnemosyne/node_modules/@MnemoPi/mnemosyne/dist/cli.js`, `MNEMOSYNE_PLUGIN_ROOT=/app`, `MNEMOSYNE_MODEL_CACHE=/opt/mnemosyne/model-cache`, `MNEMOSYNE_PORT=8787`, `MNEMOSYNE_BIND=0.0.0.0`, `MNEMOSYNE_SECURE_COOKIE=auto`.
  - `docker/unraid/my-HAL-M.xml:8,47-50` runs the container on `br0` (LAN IP) and passes `MNEMOSYNE_UI_PASSWORD`, `MNEMOSYNE_BIND=127.0.0.1`, `MNEMOSYNE_PUBLIC_URL`, and `MNEMOSYNE_EXPIRE_UNUSED_DAYS=90`.
  - `ui/remote.ts:73-96` (`serverModeFromEnv`) and `ui/server.ts:186-199` (`configFromEnv`) read `env`.
  - `Dockerfile:55` runs `HEALTHCHECK` against `process.env.MNEMOSYNE_PORT || '8787'`.
- **Failure it would cause**:
  If T4 renames the `Dockerfile` `ENV` keys to `HALM_BIND=0.0.0.0`, `HALM_PORT=8787`, `HALM_SECURE_COOKIE=auto`, `HALM_ROOT=/data`, and `HALM_STORE=/data/store`, then any container started with an existing Unraid or Dokploy `MNEMOSYNE_*` template has **both** `HALM_BIND=0.0.0.0` (from the image `ENV`) and `MNEMOSYNE_BIND=127.0.0.1` (from `docker run -e`) in `process.env`. Because T1's `envOf()` rule makes `HALM_*` win when both are set, the image's default `HALM_BIND=0.0.0.0` silently overrides the operator's `MNEMOSYNE_BIND=127.0.0.1`, exposing the Unraid container on the LAN instead of localhost-only for Tailscale Serve. Any custom `MNEMOSYNE_PORT`, `MNEMOSYNE_SECURE_COOKIE`, `MNEMOSYNE_ROOT`, or `MNEMOSYNE_STORE` is likewise ignored.
- **Fix to the plan**:
  1. Do **not** set `HALM_BIND`, `HALM_PORT`, `HALM_SECURE_COOKIE`, `HALM_ROOT`, or `HALM_STORE` in `Dockerfile` `ENV` (the code already defaults them in `docker/entrypoint.sh:17,41-42` and `ui/remote.ts:76-87`), OR have `docker/entrypoint.sh` resolve `${HALM_X:-${MNEMOSYNE_X:-default}}` and `export` the effective values before `exec bun /app/ui/server.ts --server` (without pre-populating `HALM_BIND`/`HALM_PORT`/`HALM_SECURE_COOKIE`/`HALM_ROOT`/`HALM_STORE` in `Dockerfile` `ENV`).
  2. For image-internal build paths (`HALM_CLI`, `HALM_PLUGIN_ROOT`, `HALM_MODEL_CACHE`), either leave them out of `Dockerfile` `ENV` if an operator might override `MNEMOSYNE_CLI`, or resolve them in `docker/entrypoint.sh` via `export HALM_CLI="${HALM_CLI:-${MNEMOSYNE_CLI:-/opt/hal-m/node_modules/@MnemoPi/mnemosyne/dist/cli.js}}"`.
  3. Update `Dockerfile:55` `HEALTHCHECK` to read `process.env.HALM_PORT || process.env.MNEMOSYNE_PORT || '8787'`.

---

#### B2. Moving the data root outside `~/.claude` (`~/.claude/mnemosyne` -> `~/.hal-m`, D3) breaks `claudeInstall` and `updaterHome` in `ui/update-routes.ts` and `memoryDirProblem` in `ui/settings-routes.ts`

- **Plan section**: Section 1 item 5, Section 2 D3 (`~/.claude/mnemosyne` -> `~/.hal-m`, outside `~/.claude`), Section 3 T3.
- **Code evidence**:
  - The inventory report (`docs/research/hal-m-stage2-inventory.md:178,190,298`) assumed the new folder was `~/.claude/hal-m` (inside `~/.claude`). The plan (`docs/plans/hal-m-stage2.md:15,28`) changed the target to `~/.hal-m` (directly under `$HOME`), which breaks parent-directory math in two UI route files:
  - `ui/update-routes.ts:68-72`:
    ```ts
    export function claudeInstall(root: string, pluginRoot: string) {
      const fold = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
      const cache = join(dirname(resolve(root)), 'plugins', 'cache')
      return fold(pluginRoot).startsWith(`${fold(cache)}${process.platform === 'win32' ? '\\' : '/'}`)
    }
    ```
  - `ui/update-routes.ts:168-175`:
    ```ts
    export function updaterHome(root: string, pluginRoot: string) {
      const home = dirname(dirname(resolve(root)))
      if (fold(join(home, '.claude', 'mnemosyne')) !== fold(root)) return undefined
    ```
  - `ui/settings-routes.ts:251`:
    `for (const base of [root, join(home, `.${'claude'}`, 'mnemosyne')])`
  - `tests/bun/settings-routes.spec.ts:253`:
    `expect(source).not.toMatch(/homedir\s*\(|writeFileSync|appendFileSync|\.claude['"/\\]/)`
- **Failure it would cause**:
  1. In `claudeInstall(root, pluginRoot)`: when `root` was `<home>/.claude/mnemosyne`, `dirname(resolve(root))` was `<home>/.claude`, so `cache` was `<home>/.claude/plugins/cache`. When `root` is `<home>/.hal-m`, `dirname(resolve(root))` is `<home>`, so `cache` becomes `<home>/plugins/cache`. Because Claude Code still caches plugins at `<home>/.claude/plugins/cache/hal-m/hal-m/0.38.0`, `claudeInstall()` returns `false`, `via()` (`ui/update-routes.ts:273`) returns `null`, and the dashboard Update button breaks on every Claude Code install.
  2. In `updaterHome(root, pluginRoot)`: `dirname(dirname(resolve('<home>/.hal-m')))` is the parent of `<home>` (e.g. `/Users`), not `<home>`. A naive replacement of `'.claude', 'mnemosyne'` with `'.hal-m'` without changing `dirname(dirname(...))` to `dirname(...)` makes `updaterHome` always return `undefined`, breaking standalone/Desktop updates from the dashboard too.
  3. In `ui/settings-routes.ts:251`, `memoryDirProblem` must guard `root`, `join(home, '.hal-m')`, and the legacy `join(home, `.${'claude'}`, 'mnemosyne')` (keeping the `.${'claude'}` interpolation so `tests/bun/settings-routes.spec.ts:253` continues to pass).
- **Fix to the plan**:
  Add explicit instructions to T3:
  1. In `ui/update-routes.ts:68-72` (`claudeInstall`), check both `join(dirname(resolve(root)), '.claude', 'plugins', 'cache')` (for `<home>/.hal-m`) and `join(dirname(resolve(root)), 'plugins', 'cache')` (for legacy `<home>/.claude/mnemosyne`).
  2. In `ui/update-routes.ts:168-175` (`updaterHome`), match both `<home>/.hal-m` (where `home = dirname(resolve(root))`) and legacy `<home>/.claude/mnemosyne` (where `home = dirname(dirname(resolve(root)))`).
  3. In `ui/settings-routes.ts:251` (`memoryDirProblem`), guard `[root, join(home, '.hal-m'), join(home, `.${'claude'}`, 'mnemosyne')]`.

---

#### B3. `hooks/names.ts` cannot run Node/Bun filesystem migration in-process inside `hooks/register.ts`, and `on('env.get')` mocks in `tests/*.test.ts` return `'/home/u'` for every unknown env var

- **Plan section**: Section 3 T1 ("New no-import module `hooks/names.ts`: ... `migrateDataRoot()` (atomic rename, symlink or Windows junction at the old path, skipped while a dashboard or lock is live, retried next start) ... the Windows branch is tested with an injected fs and platform") and T2 ("Owns `hooks/register.ts` ... data root and env reads through T1").
- **Code evidence**:
  - `.claude-plugin/types/claude-code/index.d.ts:19-25`: Claude Code hook modules run in a no-Node, no-DOM sandbox without `require` or `node:fs`.
  - `tsconfig.json:3,9`: compiles `hooks/` with `"types": []`, `"lib": ["es2023"]`. Any `node:fs` import in `hooks/names.ts` fails `bun run typecheck` (`tsc -p .`).
  - `hooks/register.ts:620-625`: `$` only provides `$.fs.read` and `$.fs.stat`; all filesystem mutations in `register.ts` spawn `bun -e` subprocesses (`bunFs`).
  - `bin/install-engine.ts:409-433` (`proxyClosure`): walks every runtime import reachable from `bin/mcp-proxy.ts` and rejects `claude-code` or dynamic imports.
  - `tests/register.test.ts:77`:
    `on('env.get', (_$, e) => ({ value: extra.env?.[(e as { name: string }).name] ?? '/home/u' }))`
  - `tests/ui-launch.test.ts:88` and `tests/session.test.ts:232`:
    `on('env.get', () => ({ value: '/home/u' }))`
- **Failure it would cause**:
  1. If `hooks/names.ts` imports `node:fs`, `tsc -p .` and Claude Code's hook loader fail. If `hooks/names.ts` imports `claude-code`, `proxyClosure` (`tests/bun/install-root.spec.ts:145`) fails.
  2. If `paths($, options)` in `hooks/register.ts:310` calls `$.env.get('HALM_ROOT')` (or `$.env.get('MNEMOSYNE_ROOT')`), the existing `on('env.get')` mocks in `tests/register.test.ts:77`, `tests/ui-launch.test.ts:88`, and `tests/session.test.ts:232` return `'/home/u'` for **every** env var name not in `extra.env`! That makes `HALM_ROOT` evaluate to `'/home/u'` instead of `undefined`, setting `root = '/home/u'` instead of `'/home/u/.hal-m'` and breaking almost every test in those three files.
  3. If `paths($, options)` calls `$.fs.stat` or spawns a `bun` subprocess on every hook event to check whether `~/.hal-m` or `~/.claude/mnemosyne` exists, `tests/register.test.ts:140-147` intercepts unknown `$.process.run` calls as fake JSON-RPC engine replies and its in-memory `$.fs.stat` mock returns `exists: false` for both directories.
- **Fix to the plan**:
  1. Keep `hooks/names.ts` free of both `node:*` and `claude-code` runtime imports: export constants, `envOf(get, key)`, `toolPrefix(pluginName)`, pure path resolution, and `migrateDataRoot(fs, opts)` that operates purely on an injected synchronous `fs` adapter (`lstat`, `rename`, `symlink`, `readFile`, `writeFile`, `mkdir`, `rm`, `realpath`, `kill0`).
  2. Provide the real Node/Bun `fs` adapter in a small `bin/` helper (or `hooks/names-node.ts` excluded from `tsconfig.json` and included in `tsconfig.bun.json`) used by `bin/update.ts`, `ui/server.ts`, `scripts/migrate-hal-m.ts`, and invoked once from `hooks/register.ts` at `session.start` (local mode) via `bunFs` / `bun -e`.
  3. In `tests/register.test.ts:77`, `tests/ui-launch.test.ts:88`, and `tests/session.test.ts:232`, update the `on('env.get')` test mock so it returns `'/home/u'` only when `name === 'HOME' || name === 'USERPROFILE'` (and `undefined` for unset `HALM_*` / `MNEMOSYNE_*` vars).

---

#### B4. Data-loss / data-orphan trap between `EMBEDDINGS_CACHE_DIR` (`PI_CONFIG_DIR`) and `migrateDataRoot()` when migration is deferred

- **Plan section**: Section 1 item 5, Section 3 T1, T2, T3; Inventory Section 2.2 ("1. If `hal-m` exists, use it and stop").
- **Code evidence**:
  - `hooks/engine.ts:15`: `export const EMBEDDINGS_CACHE_DIR = '.claude/mnemosyne/model-cache'`
  - `hooks/engine.ts:87`: sets `PI_CONFIG_DIR: options.modelCacheDir ?? EMBEDDINGS_CACHE_DIR` (which the engine resolves relative to `$HOME`).
  - `hooks/register.ts:457` (`embeddingsReady`): checks model files inside `${root}/model-cache/cache/fastembed`.
  - `hooks/register.ts:769` (`runAll`): calls `engineEnv(store, id, { embeddings: embeddingsOn })` **without** passing `modelCacheDir`, so `engineEnv` uses the global `EMBEDDINGS_CACHE_DIR` constant regardless of what `root` is!
- **Failure it would cause**:
  Suppose `migrateDataRoot()` is deferred on session start because a dashboard or lock is live in `~/.claude/mnemosyne`, so the session falls back to `root = ~/.claude/mnemosyne`.
  1. `embeddingsReady($, root)` checks `~/.claude/mnemosyne/model-cache/...` and returns `true`.
  2. `runAll()` spawns the engine with `PI_CONFIG_DIR = EMBEDDINGS_CACHE_DIR = '.hal-m/model-cache'`, which resolves to `~/.hal-m/model-cache`.
  3. Because `~/.hal-m/model-cache` does not exist yet, the engine creates `~/.hal-m/model-cache` (or `ensureSetup` / `syncWrapper` touches `~/.hal-m`).
  4. On the next session start, `~/.hal-m` now exists (containing only an empty or partial `model-cache/`), while the user's real `store/`, `config.json`, `vocabulary.json`, and `activity.jsonl` are still in `~/.claude/mnemosyne`. Under the rule "If `~/.hal-m` exists, use it and stop", `migrateDataRoot()` stops and **permanently orphans all of the user's data in `~/.claude/mnemosyne`**.
- **Fix to the plan**:
  1. Pass `modelCacheDir: `${root}/model-cache`` explicitly in `hooks/register.ts` whenever calling `engineEnv()` (`hooks/register.ts:769`) and `syncWrapper()` (`hooks/register.ts:653`) so `PI_CONFIG_DIR` always matches the active `root`.
  2. In `migrateDataRoot()`, never treat `~/.hal-m` as "already migrated" merely because `existsSync(newRoot)` is true when `oldRoot` (`~/.claude/mnemosyne`) is still a real directory (not a symlink or junction). Check `lstat(oldRoot)`:
     - If `oldRoot` is a symlink/junction (or does not exist), migration is done; ensure the link exists if `newRoot` exists and `oldRoot` is missing.
     - If `oldRoot` is a real directory and `newRoot` also exists as a real directory, check whether `newRoot` has `moved-from-mnemosyne.json` or `store/` / `config.json`. If `newRoot` lacks `moved-from-mnemosyne.json` and `store/` while `oldRoot` has `store/`, move/remove the stray `newRoot` cache or abort back to `oldRoot` with a clear warning instead of switching to an unmigrated `newRoot`.

---

#### B5. `bin/update.ts` staging self-spawn breaks on the `0.37.x` -> `0.38.0` update if `~/.claude/mnemosyne` is renamed while the `0.37.x` parent process holds `<oldRoot>/update-staging`

- **Plan section**: Section 3 T1, T3, T6; Inventory Section 2.2 ("called early in `session.start` and at the start of `bin/update.ts`").
- **Code evidence**:
  - `bin/update.ts:102`: `const root = join(home, '.claude', 'mnemosyne')`
  - `bin/update.ts:788-815`:
    When a user on `0.37.0` clicks Update in the dashboard or runs the Start Menu `Update Mnemosyne` shortcut:
    1. The `0.37.0` `bin/update.ts` checks `existsSync(layout.root)` (`~/.claude/mnemosyne`) and calls `process.chdir(layout.root)` (`bin/update.ts:799`).
    2. It clones `v0.38.0` into `staged = ~/.claude/mnemosyne/update-staging/run-<pid>-<now>` (`bin/update.ts:804-806`).
    3. It spawns the newly cloned `0.38.0` child: `[process.execPath, join(staged, 'bin', 'update.ts'), '--from', staged, ...rest]` with `cwd: ~/.claude/mnemosyne` (`bin/update.ts:810`).
    4. In its `finally` block (`bin/update.ts:813`), the `0.37.0` parent runs `rmSync(staged, { recursive: true, force: true })`.
- **Failure it would cause**:
  - If `0.38.0`'s `bin/update.ts` simply changes `homeLayout(home)` to `root = join(home, '.hal-m')` without finding `~/.claude/mnemosyne`, the `0.38.0` child spawned with `--from` throws `no HAL-M install at ~/.hal-m` at line 794 and the update from `0.37.0` fails immediately.
  - Conversely, if the `0.38.0` child calls `migrateDataRoot()` (`rename('~/.claude/mnemosyne', '~/.hal-m')`) at the start of `bin/update.ts`:
    1. On Windows, the `0.37.0` parent `bun.exe` process is still running with `cwd = ~/.claude/mnemosyne` and executing a child script inside `~/.claude/mnemosyne/update-staging/...`. Windows refuses `renameSync('~/.claude/mnemosyne', '~/.hal-m')` with `EPERM`/`EBUSY`.
    2. Even on POSIX, `--from` was passed as `<home>/.claude/mnemosyne/update-staging/run-...`; if `rename` runs before the symlink exists (or if symlink creation fails), `sourceDir` (`--from`) disappears mid-run.
- **Fix to the plan**:
  In `bin/update.ts`:
  1. When `--from` is inside `<home>/.claude/mnemosyne/update-staging/...` (or when `migrateDataRoot()` fails with `EBUSY`/`EPERM` on Windows because the parent `update.ts` holds `cwd` inside `~/.claude/mnemosyne`), allow `bin/update.ts` to complete the engine/plugin swap against the active root (`~/.claude/mnemosyne` if migration was deferred, or `~/.hal-m` via the compatibility symlink on POSIX), and run `migrateDataRoot()` either after the parent exits or on the next session/dashboard start.
  2. Always resolve `--from` after any POSIX root migration (or create the `~/.claude/mnemosyne -> ~/.hal-m` symlink before validating `sourceDir`).

---

### Majors

#### M1. `tsconfig.bun.json` has an explicit file list for `hooks/` and is missing from T1's file ownership

- **Plan section**: Section 3 T1 ("Files: new `hooks/names.ts`, new `tests/bun/names.spec.ts`").
- **Code evidence**:
  - `tsconfig.bun.json:8`:
    `"include": ["bin", "docker", "scripts", "tests/bun", "tests/embed", "hooks/surface.ts", "hooks/engine-build.ts", "hooks/tags.ts", "hooks/vocab.ts", "hooks/guard.ts", "hooks/import.ts", "hooks/settings.ts", "hooks/backfill.ts", "hooks/knowledge.ts", "hooks/activity-log.ts", "hooks/ui-pid.ts", "hooks/engine.ts", "hooks/launcher.ts", "hooks/owner.ts", "ui/server.ts", "ui/semantic-worker.ts"]`
- **Failure it would cause**:
  `tsconfig.bun.json` does not include `"hooks"` as a directory; it lists individual `hooks/*.ts` files. If T1 creates `hooks/names.ts` without adding `"hooks/names.ts"` to `tsconfig.bun.json`, `tsc -p tsconfig.bun.json` only checks it transitively once T3 imports it, and standalone typechecking in T1 misses it.
- **Fix to the plan**:
  Add `tsconfig.bun.json` to T1's owned files and add `"hooks/names.ts"` to its `include` array.

---

#### M2. `tests/bun/install-root.spec.ts` hardcodes the exact 13-file `EXPECTED_CLOSURE` of `bin/mcp-proxy.ts`

- **Plan section**: Section 3 T1 & T3.
- **Code evidence**:
  - `tests/bun/install-root.spec.ts:20-34`: hardcodes `EXPECTED_CLOSURE` (13 files reachable from `bin/mcp-proxy.ts`).
  - `tests/bun/install-root.spec.ts:122-123`:
    `expect(readdirSync(root).sort()).toEqual(['.mnemosyne-root', 'activity.jsonl', 'bin', 'config.json', 'engine', 'model-cache', 'plugin', 'store', 'vocabulary.json'])`
    `expect(readdirSync(layout.bin)).toEqual(['mnemosyne-mcp'])`
  - `tests/bun/install-root.spec.ts:145`:
    `expect(copied).toEqual(EXPECTED_CLOSURE)`
- **Failure it would cause**:
  As soon as `bin/mcp-proxy.ts` (or `hooks/surface.ts`) imports `hooks/names.ts`, `proxyClosure(ROOT)` copies 14 files (`'hooks/names.ts'` is added), failing `tests/bun/install-root.spec.ts:145`. Writing `.hal-m-root` and both `['hal-m-mcp', 'mnemosyne-mcp']` in `layout.bin` also fails lines 122–123 unless updated.
- **Fix to the plan**:
  Explicitly list `tests/bun/install-root.spec.ts:20-34,122-123,145` in T3's brief (`EXPECTED_CLOSURE` adds `'hooks/names.ts'`, root listing expects `'.hal-m-root'`, `layout.bin` expects `['hal-m-mcp', 'mnemosyne-mcp']`).

---

#### M3. Parallel-lane collisions between T2 and T3 over `hooks/engine.ts`, `hooks/launcher.ts`, `hooks/surface.ts`, and `tests/bun/knowledge-host.ts`

- **Plan section**: Section 3 Tasks table & items 2–3 ("T2, T3, T4 run in parallel").
- **Code evidence**:
  - T2 owns `hooks/register.ts`, `hooks/session.ts`, `hooks/surface.ts`, `hooks/ui-launch.ts`, and `tests/register.test.ts`.
  - T3 owns `hooks/engine.ts`, `hooks/launcher.ts`, `bin/mcp-proxy.ts`, and `tests/bun/*.spec.ts` (except `session.spec.ts`).
  - `hooks/register.ts:45-47` imports `EMBEDDINGS_CACHE_DIR` from `./engine` and `cmdWrapper`, `shWrapper` from `./launcher`.
  - `tests/register.test.ts:1322-1395` asserts the exact `PI_CONFIG_DIR` (`'.claude/mnemosyne/model-cache'`), `embeddings.json` (`cache`), and wrapper script text (`MNEMOSYNE_ACTIVITY_LOG=...`) produced by `hooks/engine.ts` and `hooks/launcher.ts`!
  - `hooks/surface.ts:6,10,43` defines `mnemosyneStats` (`provider: 'mnemosyne'`) and `mnemosyneGet`, imported by both `hooks/register.ts:49` (T2) and `bin/mcp-proxy.ts:36` (T3) and asserted in `tests/register.test.ts:2077` (T2), `tests/surface.test.ts:17` (unassigned in plan!), and `tests/bun/mcp-proxy.spec.ts:182` (T3).
  - `tests/bun/knowledge-host.ts:70,112,182,209` (listed in inventory under T2, omitted from plan T2!) hardcodes `join(home, '.claude', 'mnemosyne')`, `name: 'mnemosyne'`, and `'mcp__mnemosyne__'`, and is imported by 6 spec files owned by T3 (`knowledge-wiring-a.spec.ts`, `knowledge-wiring-b.spec.ts`, `knowledge-r3.spec.ts`, `remote-client.spec.ts`, `pinned.spec.ts`, `project-identity.spec.ts`).
- **Failure it would cause**:
  If T2 and T3 run in parallel worktrees branched from T1:
  1. In T2's worktree, `hooks/engine.ts` still has `EMBEDDINGS_CACHE_DIR = '.claude/mnemosyne/model-cache'` and `hooks/launcher.ts` still emits `MNEMOSYNE_*` lines. T2 cannot update `tests/register.test.ts` to assert `.hal-m/model-cache` and `HALM_*` launcher output without editing `hooks/engine.ts` and `hooks/launcher.ts` (owned by T3).
  2. If T2 edits `tests/bun/knowledge-host.ts` (or `hooks/surface.ts`), T3's worktree does not have those edits while running its 6 `knowledge-host`-based specs and `mcp-proxy.spec.ts`, and merging T2 + T3 breaks whichever branch ran against the old values.
- **Fix to the plan**:
  Move the tiny shared leaf modules `hooks/engine.ts` (line 15 `EMBEDDINGS_CACHE_DIR`), `hooks/launcher.ts` (93 lines, no imports), and `hooks/surface.ts` (53 lines) into **T1** alongside `hooks/names.ts`. That way both T2 (`hooks/register.ts` + `tests/register.test.ts`) and T3 (`bin/*`, `ui/*`, `tests/bun/*`) branch from T1 with the final `EMBEDDINGS_CACHE_DIR`, launcher template, and surface provider already in place. Also assign `tests/bun/knowledge-host.ts` to **T2** (and move the 6 `tests/bun/*` specs that test `hooks/register.ts` via `knowledge-host.ts`—`knowledge-wiring-a.spec.ts`, `knowledge-wiring-b.spec.ts`, `knowledge-r3.spec.ts`, `remote-client.spec.ts`, `pinned.spec.ts`, `project-identity.spec.ts`—to **T2**, since they test `hooks/register.ts`, not `bin/` or `ui/`!).

---

#### M4. `bin/update.ts` `launcherFor()` overwrites migrated `~/.hal-m` paths with legacy `~/.claude/mnemosyne` paths parsed from the existing launcher

- **Plan section**: Section 3 T3 ("the launcher parser in `bin/update.ts` reads both spellings so old launchers keep their settings").
- **Code evidence**:
  - `bin/update.ts:270-285`:
    ```ts
    export function launcherFor(layout: Layout, existing: string | undefined, embeddingsDefault: boolean): LauncherOptions {
      const { values, unset } = parseLauncher(existing ?? '')
      const keep = (key: string, fallback: string) => values.get(key) ?? fallback
      ...
      return {
        store: keep('MNEMOPI_DATA_DIR', slashes(layout.store)),
        ...
        activity: keep('MNEMOSYNE_ACTIVITY_LOG', slashes(layout.activity)),
        ...
        vocabulary: keep('MNEMOSYNE_VOCABULARY', slashes(layout.vocabulary)),
        root: keep('MNEMOSYNE_ROOT', slashes(layout.root)),
        modelCacheDir: keep('PI_CONFIG_DIR', EMBEDDINGS_CACHE_DIR),
      }
    }
    ```
- **Failure it would cause**:
  An existing `0.37.0` launcher on disk contains the default paths from when the root was `~/.claude/mnemosyne`:
  - `MNEMOPI_DATA_DIR='/Users/u/.claude/mnemosyne/store'`
  - `MNEMOSYNE_ACTIVITY_LOG='/Users/u/.claude/mnemosyne/activity.jsonl'`
  - `MNEMOSYNE_VOCABULARY='/Users/u/.claude/mnemosyne/vocabulary.json'`
  - `MNEMOSYNE_ROOT='/Users/u/.claude/mnemosyne'`
  - `PI_CONFIG_DIR=.claude/mnemosyne/model-cache`
  Because `keep()` prefers any path found in the old launcher over `layout.*` and `EMBEDDINGS_CACHE_DIR`, running `bin/update.ts` after moving the folder to `~/.hal-m` copies all five old `~/.claude/mnemosyne` paths into the new `hal-m-mcp` launcher instead of pointing them to `~/.hal-m`!
- **Fix to the plan**:
  In `bin/update.ts:270-285` (`launcherFor`), treat values read from the old launcher that equal the legacy default paths under `<home>/.claude/mnemosyne` (or `'.claude/mnemosyne/model-cache'`) as defaults and replace them with the new `layout.*` / `EMBEDDINGS_CACHE_DIR` paths, while still preserving genuinely custom paths (like `D:/memory/store` tested in `tests/bun/update.spec.ts:268-290`).

---

#### M5. Dual launcher write/delete (`hal-m-mcp` and `mnemosyne-mcp`) is in `hooks/register.ts` (owned by T2), not just T3, and must delete BOTH files when `externalMcp` is off

- **Plan section**: Section 3 T2 & T3 (T2: "Owns `hooks/register.ts` (every edit there goes through T2)"; T3: "the launcher writes new names and keeps the old file as a copy").
- **Code evidence**:
  - `hooks/register.ts:337`: `wrapper: `${root}/bin/mnemosyne-mcp${windows ? '.cmd' : ''}``
  - `hooks/register.ts:639-656` (`syncWrapper`):
    ```ts
    if (options.externalMcp !== true) {
      await bunFs($, 'fs.rmSync(a[0], { force: true })', wrapper)
      return
    }
    ...
    await bunFs($, `fs.writeFileSync(a[0], a[1]); ${windows ? '' : 'fs.chmodSync(a[0], 0o700);'}`, wrapper, text)
    ```
  - `bin/install-engine.ts:538-540` and `bin/update.ts:883-886` also write the wrapper in standalone installs.
- **Failure it would cause**:
  1. The plan assigns the dual-launcher behavior to T3 (`docs/plans/hal-m-stage2.md:50`), not T2 (`docs/plans/hal-m-stage2.md:49`), even though `syncWrapper()` lives in `hooks/register.ts` (exclusively owned by T2).
  2. When a user disables `externalMcp` (`options.externalMcp !== true`), `syncWrapper()` must remove **both** `bin/hal-m-mcp(.cmd)` and `bin/mnemosyne-mcp(.cmd)`. If it only removes `bin/hal-m-mcp`, turning `externalMcp` off leaves an active `bin/mnemosyne-mcp` executable on disk.
- **Fix to the plan**:
  Specify in **T2** that `paths()` and `syncWrapper()` in `hooks/register.ts:337,639-656` manage both `bin/hal-m-mcp(.cmd)` and legacy `bin/mnemosyne-mcp(.cmd)`: write both when `options.externalMcp === true`, and `rmSync` both when `options.externalMcp !== true`. Specify in **T3** that `bin/install-engine.ts:538-540` and `bin/update.ts:883-886` also write both files.

---

#### M6. `clearCookies()` on `/api/logout` (`ui/remote.ts`) leaves users unable to sign out if they authenticated with the old `mnemosyne_session` cookie

- **Plan section**: Section 1 item 6, Section 3 T1 & T3; Inventory Section 2.1 item 9 ("Cookies: read both names; set the new one only `ui/remote.ts:131-133` and its readers").
- **Code evidence**:
  - `ui/remote.ts:131-133`: `COOKIE_PLAIN = 'mnemosyne_session'`, `COOKIE_SECURE = '__Host-mnemosyne_session'`.
  - `ui/remote.ts:188-190` (`clearCookies`):
    ```ts
    export function clearCookies(): string[] {
      return [`${COOKIE_PLAIN}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, `${COOKIE_SECURE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`]
    }
    ```
  - `ui/remote.ts:193-196` (`signedIn`): checks `COOKIE_SECURE` and `COOKIE_PLAIN`.
- **Failure it would cause**:
  Session cookies last 30 days (`SESSION_DAYS = 30`). If `signedIn()` accepts both `hal-m_session` / `__Host-hal-m_session` and `mnemosyne_session` / `__Host-mnemosyne_session`, while `clearCookies()` only clears `hal-m_session` / `__Host-hal-m_session`, then any user whose browser still holds `mnemosyne_session` cannot sign out via `POST /api/logout` (`ui/server.ts:3214-3218`): the old cookie remains in the browser and `signedIn()` keeps returning `true`! (Note: the server deletes the server-side session token on logout if it extracts the token from the request cookie, so `server.ts:3215` must also extract the token from **either** the new or old cookie name before calling `remote.sessions.revoke(token)`, and `clearCookies()` must expire all four cookie names).
- **Fix to the plan**:
  In `ui/remote.ts` and `ui/server.ts:3214-3218`:
  1. `clearCookies()` must return `Max-Age=0` `Set-Cookie` headers for all 4 names (`hal-m_session`, `__Host-hal-m_session`, `mnemosyne_session`, `__Host-mnemosyne_session`).
  2. Any logout token extraction must check both new and old cookie names.

---

#### M7. `docker-compose.yml` required-variable gate and `docker/entrypoint.sh` variable export gaps

- **Plan section**: Section 3 T4 ("Shell reads `${HALM_X:-${MNEMOSYNE_X:-default}}`; password check accepts either").
- **Code evidence**:
  - `docker-compose.yml:39-45`:
    ```yaml
    environment:
      - MNEMOSYNE_UI_PASSWORD=${MNEMOSYNE_UI_PASSWORD:?set MNEMOSYNE_UI_PASSWORD (8+ characters)}
      - MNEMOSYNE_PUBLIC_URL=${MNEMOSYNE_PUBLIC_URL:-}
      - MNEMOSYNE_HOSTS=${MNEMOSYNE_HOSTS:-}
      - MNEMOSYNE_SECURE_COOKIE=auto
      - MNEMOSYNE_EXPIRE_UNUSED_DAYS=${MNEMOSYNE_EXPIRE_UNUSED_DAYS:-90}
    volumes:
      - ${MNEMOSYNE_DATA:-/mnt/cache/appdata/mnemosyne}:/data
    ```
  - `docker/entrypoint.sh:17,26-51`:
    Line 17 sets `ROOT="${MNEMOSYNE_ROOT:-/data}"`; lines 41–42 set `ROOT` and `STORE` as unexported shell variables; line 50 runs `bun /app/docker/init-data.ts "$ROOT"` (where `init-data.ts:70` reads `process.env.MNEMOSYNE_STORE || join(root, 'store')`); line 51 runs `exec bun /app/ui/server.ts --server` (where `ui/server.ts:186-189` reads `process.env`).
- **Failure it would cause**:
  1. In `docker-compose.yml`, writing `HALM_UI_PASSWORD=${HALM_UI_PASSWORD:?...}` breaks existing Dokploy `.env` files that only set `MNEMOSYNE_UI_PASSWORD` (`docker compose` aborts before starting the container). And nested `${HALM_X:-${MNEMOSYNE_X:?...}}` expansion is not supported consistently across all `docker compose` / `compose-go` versions.
  2. In `docker/entrypoint.sh`, if `ROOT` and `STORE` are resolved from `${HALM_ROOT:-${MNEMOSYNE_ROOT:-/data}}` and `${HALM_STORE:-${MNEMOSYNE_STORE:-$ROOT/store}}` as plain shell variables without `export HALM_ROOT="$ROOT" HALM_STORE="$STORE"`, and `Dockerfile` no longer hardcodes `ENV` (see B1), `init-data.ts` and `ui/server.ts` will not see the resolved values in `process.env`.
- **Fix to the plan**:
  1. In `docker-compose.yml`, pass both `HALM_*` and `MNEMOSYNE_*` through without `:?` in Compose (e.g. `HALM_UI_PASSWORD=${HALM_UI_PASSWORD:-}`, `MNEMOSYNE_UI_PASSWORD=${MNEMOSYNE_UI_PASSWORD:-}`), and let `docker/entrypoint.sh:26` enforce the 8-character password requirement as it already does (exiting 64 with a clear error message when neither is set).
  2. In `docker/entrypoint.sh`, resolve and `export` `HALM_ROOT`, `HALM_STORE`, `HALM_UI_PASSWORD`, and `HALM_EMBEDDINGS` before running `init-data.ts` and `ui/server.ts`.

---

#### M8. Windows `bin/update.ts` migration misses running dashboards from old `uiDir` (`~/.claude/mnemosyne-ui`) and fails to restart the old `'Mnemosyne dashboard'` scheduled task

- **Plan section**: Section 3 T3 ("Windows task and Start Menu names migrate").
- **Code evidence**:
  - `bin/update.ts:42-43`: `TASK_NAME = 'Mnemosyne dashboard'`, `SHORTCUT_NAME = 'Update Mnemosyne'`.
  - `bin/update.ts:103`: `uiDir = join(home, '.claude', 'mnemosyne-ui')`.
  - `bin/update.ts:314-315,358` (`classifyProcesses`): matches `join(layout.uiDir, 'run-ui.ps1')`, `join(layout.uiDir, 'start-ui.cmd')`, and excludes `'update-mnemosyne.ps1'`.
  - `bin/update.ts:589-615` (`installShortcut`): writes `update-mnemosyne.ps1`, `update-mnemosyne.vbs`, and `${SHORTCUT_NAME}.lnk`.
  - `bin/update.ts:725-740` (`taskExists`, `restartDashboard`): queries `schtasks.exe /Query /TN "Mnemosyne dashboard"`.
- **Failure it would cause**:
  1. When `0.38.0` runs on Windows, the currently running dashboard was started from the old paths (`~/.claude/mnemosyne/plugin/ui/server.ts` and `~/.claude/mnemosyne-ui/run-ui.ps1`). If `classifyProcesses` only checks the new `layout.root` (`~/.hal-m`) and new `layout.uiDir`, it will **not** recognize the running `0.37.0` dashboard process tree! `stopDashboard` won't stop it, and Windows will fail the folder move or engine swap with file-lock errors (`EPERM`/`EBUSY`).
  2. `bin/update.ts` does not create the Windows Scheduled Task—it only queries and runs `TASK_NAME` (`bin/update.ts:725-740`). If `TASK_NAME` is simply changed to `'HAL-M dashboard'`, `taskExists()` returns `false` on every existing Windows PC whose Task Scheduler task is still named `'Mnemosyne dashboard'`, and the dashboard is not restarted after update.
  3. Renaming `SHORTCUT_NAME` to `'Update HAL-M'` without removing `'Update Mnemosyne.lnk'` leaves two update shortcuts in the Start Menu, one of which points to `~/.claude/mnemosyne-ui/update-mnemosyne.vbs`.
- **Fix to the plan**:
  In `bin/update.ts` (and T6 `scripts/migrate-hal-m.ts`):
  1. `classifyProcesses` must match process command lines under **both** the new layout (`~/.hal-m`, `~/.hal-m-ui` or `~/.claude/hal-m-ui`) and the legacy layout (`~/.claude/mnemosyne`, `~/.claude/mnemosyne-ui`), and exclude both `update-hal-m.ps1` and `update-mnemosyne.ps1`.
  2. `restartDashboard` / `taskExists` must check `'HAL-M dashboard'` first and fall back to `'Mnemosyne dashboard'` if the scheduled task hasn't been renamed yet.
  3. `installShortcut` should write `update-hal-m.ps1`/`.vbs` + `Update HAL-M.lnk`, keep `update-mnemosyne.ps1`/`.vbs` as forwarding copies, and remove the duplicate `Update Mnemosyne.lnk` from the Start Menu Programs folder.

---

#### M9. `migrateDataRoot()` gaps: `lstatSync` vs `existsSync` on symlinks/junctions, interrupted-migration self-heal, and active lockfiles

- **Plan section**: Section 1 item 5, Section 3 T1 ("`migrateDataRoot()` (atomic rename, symlink or Windows junction at the old path, skipped while a dashboard or lock is live, retried next start)").
- **Code evidence**:
  - `hooks/ui-pid.ts:27-35`: `ui.json` stores `{ pid, port, ... }`.
  - `bin/install-engine.ts:437,448`: `<root>/engine.lock`, `<root>/engine.next`, `<root>/plugin.next`.
  - `hooks/register.ts:2185`: `<root>/expire-sweep.lock`.
  - `hooks/activity-log.ts:294,457` and `bin/ui-users.ts:39`: `.lock` files (`activity.jsonl.lock`, `activity-daily.json.lock`, `ui-users.json.lock`).
- **Failure it would cause**:
  1. **Symlink/junction detection**: Once `~/.claude/mnemosyne` is a symlink or junction pointing to `~/.hal-m`, `existsSync('~/.claude/mnemosyne')` and `statSync('~/.claude/mnemosyne').isDirectory()` both return `true`! Any check that does not use `lstatSync(oldRoot)` (checking `isSymbolicLink()`, and on Windows comparing `realpathSync(oldRoot)` with `realpathSync(newRoot)`) will misidentify the compatibility link as an unmigrated directory.
  2. **Crash between `rename(oldRoot, newRoot)` and `symlink(newRoot, oldRoot)`**: If a process is killed right after `rename(oldRoot, newRoot)` before creating the compatibility link at `oldRoot`, then on the next start `newRoot` exists and `oldRoot` is missing. If `migrateDataRoot()` returns immediately whenever `newRoot` exists, the compatibility link at `~/.claude/mnemosyne` is never created, breaking external MCP configs that still reference `~/.claude/mnemosyne/bin/mnemosyne-mcp`.
  3. **Active locks**: Checking only `ui.json` and `engine.lock` misses `engine.next`, `plugin.next`, and `expire-sweep.lock`; renaming the root while an install or sweep subprocess is mid-flight breaks its path renames.
  4. **Windows junction creation**: Spawning `cmd.exe /c mklink /J` is brittle with spaces or special characters in `%USERPROFILE%`. Node and Bun's `fs.symlinkSync(newRoot, oldRoot, 'junction')` creates a Windows directory junction directly via Win32 APIs without admin rights and without spawning a shell.
- **Fix to the plan**:
  Specify in T1 for `migrateDataRoot()`:
  1. Use `lstatSync` (plus `realpathSync` when `newRoot` exists) to check `oldRoot`.
  2. When `newRoot` already exists and `oldRoot` does not exist (and `dirname(oldRoot)` exists), still create the compatibility link `oldRoot -> newRoot` so an interrupted migration self-heals.
  3. Use `fs.symlinkSync(newRoot, oldRoot, platform === 'win32' ? 'junction' : 'dir')`.
  4. Defer migration if any of these are live in `oldRoot`: `ui.json` (with `kill(pid, 0)` alive), `engine.lock`, `engine.next`, `plugin.next`, or `expire-sweep.lock`.

---

#### M10. Stored `memoryDir: "~/.claude/mnemosyne/store"` in `settings.json` shows up as a custom override in the dashboard Settings tab and in `scripts/migrate-hal-m.ts`

- **Plan section**: Section 1 item 5, Section 3 T1, T2, T3, T6; Inventory Section 2.1 item 5.
- **Code evidence**:
  - `hooks/register.ts:877-895` (`fillDefaults`): on first setup, wrote `"memoryDir": "~/.claude/mnemosyne/store"` into `~/.claude/settings.json` under `pluginConfigs["mnemosyne@mnemosyne"].options` (confirmed present on Rohit's Mac in `docs/research/hal-m-stage2-external-refs.md:22`).
  - `ui/settings-routes.ts:230-234` (`optionState`): compares `inputs.memoryDir` against `schema.memoryDir.default` (`"~/.hal-m/store"`).
  - `hooks/register.ts:314-316` (`paths`): resolves `options.memoryDir`.
- **Failure it would cause**:
  1. If T6 (`scripts/migrate-hal-m.ts`) copies `options` verbatim from `mnemosyne@mnemosyne` to `hal-m@hal-m`, `pluginConfigs["hal-m@hal-m"].options.memoryDir` remains `"~/.claude/mnemosyne/store"`. Even if `paths()` at runtime remaps that literal string to `${root}/store`, `ui/settings-routes.ts:230-234` compares `"~/.claude/mnemosyne/store"` against the new manifest default `"~/.hal-m/store"` and displays `memoryDir` in the dashboard Settings UI as a user-modified override pointing at `~/.claude/mnemosyne/store`!
  2. In `paths()` (`hooks/register.ts:316`), if `"~/.claude/mnemosyne/store"` is mapped to hardcoded `"~/.hal-m/store"` instead of `${root}/store`, then setting `HALM_ROOT` or deferring migration to `~/.claude/mnemosyne` splits `store` from `root`.
- **Fix to the plan**:
  1. In T1/T2 (`paths()`), treat both `"~/.claude/mnemosyne/store"` and `"~/.hal-m/store"` (plus their expanded `<home>/...` forms) as the default store path `${root}/store`.
  2. In T6 (`scripts/migrate-hal-m.ts`), when copying `options` from `mnemosyne@mnemosyne` to `hal-m@hal-m`, rewrite `memoryDir` to `"~/.hal-m/store"` if its old value was `"~/.claude/mnemosyne/store"` (or `<home>/.claude/mnemosyne/store`).
  3. In T3 (`ui/settings-routes.ts:230-234`), normalize legacy `"~/.claude/mnemosyne/store"` to `"~/.hal-m/store"` when computing `optionState` so unmigrated configs don't show a false custom override.

---

### Minors

#### m1. `tests/bun/knowledge-host.ts:209` breaks if `hooks/register.ts` uses a `RegExp` or array matcher in `on('command.run', ...)`

- **Plan section**: Section 1 item 3, Section 3 T2; Inventory Section 6 Open Question 1 ("Does `command.run` accept a regex for `command`?").
- **Code evidence**:
  - `.claude-plugin/types/claude-code/index.d.ts:5940-5984`: Claude Code's `Matcher` type supports string, `RegExp`, or array (`{ command: ['hal-m-setup', 'mnemosyne-setup'] }` or `{ command: /^(?:hal-m|mnemosyne)-setup$/ }`).
  - `tests/bun/knowledge-host.ts:208-210`:
    ```ts
    command: async (command: string, args = '', signal?: AbortSignal) => {
      const fn = find('command.run', filter => String(filter?.command) === command)
      return (await fn($, { command, args }, passThrough(signal))) as { text: string }
    }
    ```
- **Failure it would cause**:
  In `tests/bun/knowledge-host.ts:209`, `String(filter?.command) === command` only matches when `filter.command` is a single string! If `hooks/register.ts` uses a `RegExp` or array filter to register both `/hal-m-*` and `/mnemosyne-*` in one `on('command.run', ...)` call, every command test using `knowledge-host.ts` (`knowledge-wiring-b.spec.ts`, `remote-client.spec.ts`) throws `Error: no command.run handler`.
- **Fix to the plan**:
  Either register a thin `for (const command of ['hal-m-...', 'mnemosyne-...']) on('command.run', { command }, handler)` loop in `hooks/register.ts`, OR update `tests/bun/knowledge-host.ts:209` to match string, `RegExp`, and array `filter.command` values.

---

#### m2. `bin/install-engine.ts:505` rejects existing standalone roots with `.mnemosyne-root` unless both marker names are accepted

- **Plan section**: Section 3 T1 & T3; Inventory Section 2.1 item 6.
- **Code evidence**:
  - `bin/install-engine.ts:437`: `export const ROOT_MARKER = '.mnemosyne-root'`
  - `bin/install-engine.ts:505-507`:
    ```ts
    if (existsSync(root) && !existsSync(layout.marker) && readdirSync(root).length > 0) {
      throw new InstallError(`${root} is not empty and has no ${ROOT_MARKER} from an earlier install; pass an empty or new folder`)
    }
    ```
- **Failure it would cause**:
  Plan T3 does not mention `.mnemosyne-root` / `.hal-m-root`. If `ROOT_MARKER` is renamed to `'.hal-m-root'` and line 505 only checks `existsSync(layout.marker)`, running `install-engine.ts --root` on an existing standalone install (which has `.mnemosyne-root`) throws `InstallError`.
- **Fix to the plan**:
  Explicitly note in T3's brief that `bin/install-engine.ts:505` must check `existsSync(layout.marker) || existsSync(join(root, LEGACY_ROOT_MARKER))`, and write `.hal-m-root`.

---

#### m3. `tests/bun/helpers.ts:37` model-cache symlink points only to `~/.claude/mnemosyne/model-cache/cache`

- **Plan section**: Section 3 T3 & Section 4 Testing.
- **Code evidence**:
  - `tests/bun/helpers.ts:30-39` (`isolatedEnv`):
    ```ts
    const cacheParent = join(home, '.claude', 'mnemosyne', 'model-cache')
    const realCache = join(REAL_HOME, '.claude', 'mnemosyne', 'model-cache', 'cache')
    ```
- **Failure it would cause**:
  Once the developer's home folder moves to `~/.hal-m` and `install-engine.ts` / `register.ts` look in `<tempHome>/.hal-m/model-cache/cache`, `isolatedEnv()` in `tests/bun/helpers.ts` won't find `REAL_HOME/.hal-m/model-cache/cache` and won't link it into `<tempHome>/.hal-m/model-cache/cache`, causing embed/install tests to attempt live 63 MB HuggingFace downloads or fail offline.
- **Fix to the plan**:
  In `tests/bun/helpers.ts:30-39`, check `join(REAL_HOME, '.hal-m', 'model-cache', 'cache')` first (falling back to `.claude/mnemosyne`), and symlink it into both `join(home, '.hal-m', 'model-cache', 'cache')` and `join(home, '.claude', 'mnemosyne', 'model-cache', 'cache')`.

---

#### m4. Untracked / dangerous-to-edit files in `scripts/` and `ui/`: `scripts/vendor-map.ts` and `ui/map-state.ts`

- **Plan section**: Section 3 T3 ("Owns ... `ui/*`, `scripts/*`").
- **Code evidence**:
  - `scripts/vendor-map.ts:64,110,407` and `ui/vendor/map-lib.inputs.json:212,222,232,251`: contain internal string `'mnemosyne-map-patches'` and comments. `package.json:21` runs `bun scripts/vendor-map.ts --check` as the first step of `bun run test:bun`!
  - `ui/map-state.ts:278`: `const random = randomOf(seedOf('mnemosyne-starfield'))`.
- **Failure it would cause**:
  1. If T3 edits comments or strings in `scripts/vendor-map.ts` without regenerating the vendor bundle, `bun scripts/vendor-map.ts --check` fails `bun run test:bun`.
  2. If T3 changes `'mnemosyne-starfield'` in `ui/map-state.ts:278`, the deterministic PRNG seed changes and breaks starfield/layout golden assertions in `tests/bun/map-state.spec.ts`.
- **Fix to the plan**:
  State in T3's brief: do **not** edit `scripts/vendor-map.ts`, `ui/vendor/*`, or the `'mnemosyne-starfield'` PRNG seed in `ui/map-state.ts:278`.

---

#### m5. Activity-log `client` tags (`mnemosyne-knowledge`, `mnemosyne-tags`, `mnemosyne-import`, `mnemosyne-session`, `mnemosyne-sweep`) need an explicit decision in T2/T3

- **Plan section**: Section 3 T2 & T3; Inventory Section 1d line 79 ("any filter that groups on them must accept both (not checked in `ui/`)").
- **Code evidence**:
  - `hooks/register.ts:1452,1548,1869,1870,2101,2148,2199,2203`: writes `client: 'mnemosyne-knowledge'`, `'mnemosyne-tags'`, `'mnemosyne-import'`, `'mnemosyne-session'`, `'mnemosyne-sweep'`.
  - `ui/remote.ts:580,582`: writes `client: 'mnemosyne-sweep'`.
  - `ui/recalls.ts:116-140`, `ui/app.ts:942`, `ui/server.ts:753`: UI filters check `origin` and `action` (plus `client === 'claude-code'`), not those 5 `mnemosyne-*` client strings.
  - However, `tests/register.test.ts:1744,1943,2006,2047` and `tests/bun/knowledge-wiring-b.spec.ts:116,133` assert exact `client: 'mnemosyne-knowledge'` / `'mnemosyne-sweep'` values.
- **Failure it would cause**:
  Because the plan does not state whether those 5 `client` strings rename to `hal-m-*` or stay `mnemosyne-*`, T2 and T3 could make opposite choices and break `knowledge-wiring-b.spec.ts` or `server-mode.spec.ts`.
- **Fix to the plan**:
  Specify in T1/T2/T3 whether internal activity `client` tags rename to `hal-m-knowledge`, `hal-m-tags`, `hal-m-import`, `hal-m-session`, `hal-m-sweep` (recommended, since no UI code filters on the old values) and update `tests/register.test.ts` and `tests/bun/knowledge-wiring-b.spec.ts` together.

---

#### m6. Test plan and rollback plan omissions (`claude plugin test .`, unassigned `tests/surface.test.ts`, Windows junction removal on rollback, server key revocation window)

- **Plan section**: Section 3 Rollback, Section 4 Testing, Section 6 Migration Sequence.
- **Code evidence**:
  - `tests/register.test.ts:2`, `tests/session.test.ts:2`, `tests/ui-launch.test.ts:2`, `tests/surface.test.ts:2`: all import from `'claude-code/testing'` and are not listed in `package.json` scripts (`bun run test:bun` only runs `tests/bun`).
  - `tests/surface.test.ts:17`: asserts `provider: 'mnemosyne'`, but is not listed in T2 or T3 in `docs/plans/hal-m-stage2.md:49-50`.
- **Failure it would cause**:
  1. Running `bun test tests/*.test.ts` directly fails module resolution on `'claude-code/testing'` unless run through the Claude Code plugin test runner (`claude plugin test .`).
  2. `tests/surface.test.ts` is unowned in the plan and will fail if `hooks/surface.ts:10` changes `provider` to `'hal-m'`.
  3. On rollback (`docs/plans/hal-m-stage2.md:53`): "remove the link at `~/.claude/mnemosyne` and rename `~/.hal-m` back". On Windows, if someone runs `rm -rf` or recursive `rmSync` on a junction carelessly, or runs `renameSync('~/.hal-m', '~/.claude/mnemosyne')` without removing the junction at `~/.claude/mnemosyne` first (`rmdirSync` / `unlinkSync` on the junction path only), either the target contents are deleted or `renameSync` fails with `EEXIST`/`EACCES`. Also, if the old device key for `mnemosyne@mnemosyne` was already revoked on the server at step 3 of the migration (`docs/plans/hal-m-stage2.md:83`), rolling back to `0.37.0` (`mnemosyne@mnemosyne`) immediately fails with HTTP `401` because the old Keychain `serverKey` is now revoked!
- **Fix to the plan**:
  1. Assign `tests/surface.test.ts` to T1/T2 and specify how top-level `tests/*.test.ts` are executed (`claude plugin test .` and `claude plugin validate .`).
  2. In the Rollback section and Migration Sequence: do **not** revoke the old `mnemosyne@mnemosyne` Claude Code device key on the server at the moment of switch; keep the old device key enabled during the rollback window (e.g. 48–72 hours) and revoke it only after `0.38.0` is verified stable. (By contrast, the two OMP/AGY tokens that were printed into an agent transcript during research—`docs/research/hal-m-stage2-external-refs.md:80`—should be rotated immediately).
  3. In the Rollback section (and via a `--rollback` flag on `scripts/migrate-hal-m.ts`), require verifying `lstatSync(oldRoot).isSymbolicLink()` before calling `unlinkSync(oldRoot)` (or `rmdirSync(oldRoot)` on Windows junctions), then `renameSync(newRoot, oldRoot)`, and regenerating `bin/mnemosyne-mcp` with `0.37.0` paths.

---

## Review of Specific Areas Requested

### 1. Wrong or Missing Touch Points
- **Missing from plan**:
  - `tsconfig.bun.json:8` (explicit `hooks/*.ts` list; needs `hooks/names.ts` — see **M1**).
  - `ui/update-routes.ts:68-72` (`claudeInstall` assumes `dirname(root)` is `~/.claude` — see **B2**).
  - `ui/update-routes.ts:168-175` (`updaterHome` assumes `dirname(dirname(root))` is `$HOME` — see **B2**).
  - `ui/settings-routes.ts:230-234,251` (`optionState` for legacy `memoryDir`, and `memoryDirProblem` guarding both `.hal-m` and `.claude/mnemosyne` — see **B2**, **M10**).
  - `tests/bun/install-root.spec.ts:20-34,122-123,145` (`EXPECTED_CLOSURE` of `proxyClosure` — see **M2**).
  - `tests/bun/helpers.ts:30-39` (`REAL_HOME` model-cache symlink in `isolatedEnv` — see **m3**).
  - `tests/bun/knowledge-host.ts:70,112,182,209` (omitted from plan T2 table, plus `String(filter?.command) === command` matcher — see **M3**, **m1**).
  - `tests/surface.test.ts:17` (unassigned in plan — see **m6**).
  - `bin/eval.ts:226` (`mkdtempSync(join(tmpdir(), 'mnemosyne-eval-'))` — should match the `hal-m-` prefix expected by `~/.headroom/bin/reap-temp-scratch.sh`).
- **Must NOT be touched**:
  - `scripts/vendor-map.ts` and `ui/vendor/*` (checked by `bun scripts/vendor-map.ts --check` in `test:bun` — see **m4**).
  - `ui/map-state.ts:278` (`seedOf('mnemosyne-starfield')` PRNG seed — see **m4**).

### 2. Data-Loss Risks in the Data Folder Move (`~/.claude/mnemosyne` -> `~/.hal-m`)
- **Partial/stray `~/.hal-m` creation when migration is deferred**: See **B4**. If `PI_CONFIG_DIR` defaults to `.hal-m/model-cache` while a session is still running against `~/.claude/mnemosyne`, creating `~/.hal-m/model-cache` causes the next startup to see `~/.hal-m` as existing and orphan `~/.claude/mnemosyne`.
- **`bin/update.ts` self-spawn staging directory**: See **B5**. Cloning `0.38.0` into `~/.claude/mnemosyne/update-staging/run-...` while the `0.37.0` parent holds `cwd: ~/.claude/mnemosyne` blocks `renameSync` on Windows and invalidates `--from` if moved mid-update.
- **`launcherFor()` in `bin/update.ts` re-baking old paths**: See **M4**. Without remapping legacy default paths, `bin/update.ts` copies the old `~/.claude/mnemosyne/*` paths from the old launcher into the new launcher.
- **Two Claude sessions starting at once**: Atomic `rename(oldRoot, newRoot)` on the same filesystem handles the directory move, provided the loser catches `ENOENT`/`EEXIST` and both sessions ensure the compatibility link `oldRoot -> newRoot` exists (using `lstatSync` so the link isn't mistaken for an unmigrated directory — see **M9**).
- **Server `/data`**: Inside the Docker container, `ROOT` is `/data` and `STORE` is `/data/store`. `migrateDataRoot()` only runs when the default home path (`~/.hal-m` vs `~/.claude/mnemosyne`) is used, never when `HALM_ROOT` / `MNEMOSYNE_ROOT` is explicitly `/data`. Thus the server's `/data` volume is untouched.

### 3. Back-Compat Gaps
- **`Dockerfile` `ENV` vs `MNEMOSYNE_*` runtime env**: See **B1**. Image `ENV HALM_BIND=0.0.0.0` would override `MNEMOSYNE_BIND=127.0.0.1` on 7of9 if `HALM_*` takes precedence and `Dockerfile` sets `HALM_BIND`.
- **`docker-compose.yml` & `docker/entrypoint.sh`**: See **M7**.
- **Old launchers on disk**: Covered once **M4** (`launcherFor` default-path remapping) and **M5** (writing/removing both `hal-m-mcp` and `mnemosyne-mcp` in `hooks/register.ts`, `bin/install-engine.ts`, and `bin/update.ts`) are applied.
- **`Mnemosyne-Owner` header**: Reading `Hal-M-Owner` first and `Mnemosyne-Owner` second in `ui/remote.ts:569`, while having `hooks/register.ts:289` and `bin/mcp-proxy.ts:99` send **both** headers during the alias window, is completely safe for mixed `0.37.0`/`0.38.0` client/server pairs.
- **Cookies**: `signedIn()` reading both new and old cookie names and `sessionCookie()` setting only the new name works for sign-in, **provided** `clearCookies()` and `/api/logout` clear and revoke both new and old cookie names (**M6**).

### 4. Stored Plugin Options and Keychain `serverKey` (`mnemosyne@mnemosyne` -> `hal-m@hal-m`)
- **Non-sensitive options (`memoryDir`, `serverUrl`, `autoRecall`, `captureMode`, etc.)**: Stored in `~/.claude/settings.json` under `pluginConfigs["mnemosyne@mnemosyne"].options`. `claude plugin configure hal-m@hal-m --values-stdin` (or `scripts/migrate-hal-m.ts`) can copy these over, **with the `memoryDir` normalization fix in M10** (`"~/.claude/mnemosyne/store"` -> `"~/.hal-m/store"`).
- **Sensitive `serverKey`**: Stored by Claude Code in the OS Keychain (macOS Keychain / Windows Credential Manager / `.credentials.json`) keyed by plugin ID (`mnemosyne@mnemosyne`). When the plugin ID changes to `hal-m@hal-m`, Claude Code passes `options.serverKey = undefined` until a key is stored for `hal-m@hal-m`.
  - In T2 Step 1, verify whether `claude plugin configure hal-m@hal-m --values-stdin` accepts `{"serverKey":"..."}` and writes it to the OS Keychain; if it does, `scripts/migrate-hal-m.ts --apply` can prompt the user for the new device key and pipe it to `claude plugin configure hal-m@hal-m --values-stdin` in one step.

### 5. Does the Tool Prefix Really Follow the Plugin Name?
- **Yes**: `.claude-plugin/types/claude-code/index.d.ts` and the existing `mcp__mnemosyne__memory_*` naming confirm that Claude Code prefixes tools registered via `$.tool.register` with `mcp__<plugin.name>__`.
- **Two implementation details to add to T2**:
  1. T2's Step 1 live check with a minimal plugin named `hal-m` is the right gate before bulk edits.
  2. In `hooks/register.ts`, at module scope (before `$` exists, such as `on('tool.call', { tool: ... })` at lines 2258, 2266, 2292, 2324, 2360), either use T1's `TOOL_PREFIX` (`'mcp__hal-m__'`) or match both `mcp__hal-m__` and `mcp__mnemosyne__` via `RegExp` / array so tests and alias setups never miss a `tool.call` hook.

### 6. Task Split, Dependencies, and File-Ownership Overlaps
- **T1 vs T2 vs T3 overlap**: See **M1**, **M3**, **M5**.
  - Move `tsconfig.bun.json`, `hooks/engine.ts` (`EMBEDDINGS_CACHE_DIR`), `hooks/launcher.ts`, `hooks/surface.ts`, and `tests/surface.test.ts` into **T1**.
  - Assign `tests/bun/knowledge-host.ts` and the 6 `tests/bun/*` specs that test `hooks/register.ts` (`knowledge-wiring-a.spec.ts`, `knowledge-wiring-b.spec.ts`, `knowledge-r3.spec.ts`, `remote-client.spec.ts`, `pinned.spec.ts`, `project-identity.spec.ts`) to **T2** rather than T3.
- **T5 and T6 dependency fix**:
  - The plan table (`docs/plans/hal-m-stage2.md:45-46`) lists `T5 Docs | Depends on: T1` and `T6 Migration script and runbook | Depends on: T2`.
  - In reality, T6 (`scripts/migrate-hal-m.ts` + runbook) depends on **T2, T3, and T4** (it exercises T3's `bin/update.ts` / launcher / Windows shortcut migration and documents T4's server env migration), and the final verification gate runs after T2, T3, T4, T5, and T6 merge. Make **T5 and T6 run after T2, T3, and T4 complete**.

### 7. Decisions Table (D1–D8): What to Keep and What to Decide Differently
- **D1 (`hal-m@hal-m`)**: **Agree.** Keeping plugin name and marketplace name identical preserves `${$.plugin.name}@${$.plugin.name}` in `hooks/register.ts:887` and `hooks/ui-launch.ts:175`.
- **D2 (`HALM_`)**: **Agree.** Clean single prefix token, distinct from engine-owned `MNEMOPI_*`.
- **D3 (`~/.hal-m`, link at old path)**: **Agree** with moving outside `~/.claude`, **provided** Blockers **B2, B4, B5** and Majors **M4, M8, M9, M10** are incorporated into the plan.
- **D4 (`/hal-m-*`, old as aliases)**: **Agree.**
- **D5 (Alias period: 3 releases or to 2027-03-01)**: **Agree.**
- **D6 (Server keys at switch: new key per PC, revoke old)**: **Decide differently on revocation timing.** Issue a new device key per PC for `hal-m@hal-m` at switch time, but **do not revoke the old `mnemosyne@mnemosyne` Claude Code device key until the rollback window closes** (e.g., 48–72 hours after cutover). If you revoke the old key immediately, rolling back to `0.37.0` breaks client-mode authentication on every rolled-back PC (see **m6**). However, **do** immediately rotate and revoke the two OMP/AGY tokens that were printed into an agent session during the external-refs research (`docs/research/hal-m-stage2-external-refs.md:80`).
- **D7 (Other agents' entry name: rename `mnemosyne-memory` -> `hal-m-memory` at switch)**: **Agree**, and pair the rename in `~/.omp/agent/mcp.json`, `~/.gemini/config/mcp_config.json`, and `~/.gemini/antigravity-cli/mcp_config.json` with immediate rotation of the two exposed bearer tokens.
- **D8 (Build route: Orca lanes on the Mac, T1 Opus high, T2–T6 Sonnet medium)**: **Decide differently on T2/T3 model tier and T5/T6 dependencies.** T2 (`hooks/register.ts` at 2,845 lines + `tests/register.test.ts` at 4,104 lines) and T3 (`bin/update.ts` + `ui/server.ts` at 3,460 lines + `ui/update-routes.ts` + `ui/settings-routes.ts`) carry all 5 blockers and most of the cross-file traps. Run **T2 and T3 on Opus high** (or move the shared leaf files into T1 as in **M3**), and sequence **T5/T6 after T2+T3+T4** rather than after T1/T2 alone.

---

## Verdict

**`ready after fixes`**

The staged architecture (T1 naming core, dual-read compatibility window, symlink/junction at `~/.claude/mnemosyne`, and dual headers/cookies) is the right design. Update the plan to fix the 5 blockers (**B1–B5**) and 10 major findings (**M1–M10**) before dispatching the build lanes.

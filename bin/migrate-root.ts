// HAL-M data-root link (docs/plans/hal-m-stage2.md 3.2 items 2-4, 7). When only
// the 0.37 root (~/.claude/mnemosyne) exists, makes ~/.hal-m a link to it (a
// junction on Windows), so the new path works and nothing moves. Link only in
// 0.38: the physical move ships in a later release. Never links an explicit
// root (HALM_ROOT, MNEMOSYNE_ROOT, --root); HALM_NO_MIGRATE=1 turns it off.
// The session hook starts it through $.process.run with the home folder the
// hook resolved (HOME first, even on Windows); it prints one JSON line.
import { lstatSync, realpathSync, rmdirSync, statSync, symlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { envOf, migrationOff, resolveRootSync, type RootDecision, type RootFs, type RootState } from '../hooks/names'

/** RootFs over node:fs; every error answers null. stat and realpath follow links. */
export const nodeRootFs: RootFs = {
  lstat(path) {
    try {
      return { link: lstatSync(path).isSymbolicLink() }
    } catch {
      return null
    }
  },
  stat(path) {
    try {
      return { dir: statSync(path).isDirectory() }
    } catch {
      return null
    }
  },
  realpath(path) {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  },
}

/** The two writes migrate-root may make: one link, and removing an empty folder. */
export type MigrateFs = RootFs & {
  symlink(target: string, path: string, type: 'dir' | 'junction'): void
  rmdir(path: string): void
}

export const nodeMigrateFs: MigrateFs = {
  ...nodeRootFs,
  symlink: (target, path, type) => symlinkSync(target, path, type),
  // Non-recursive: only an empty folder goes.
  rmdir: path => rmdirSync(path),
}

export type MigrateResult = {
  action: 'linked' | 'linked-by-other' | 'none' | 'disabled' | 'explicit' | 'failed'
  state: RootState
  root: string
  oldRoot: string
  newRoot: string
  warning?: string
  error?: string
}

export type MigrateOptions = {
  // An absolute home folder, from the caller (never os.homedir()).
  home: string
  env?: Record<string, string | undefined>
  // A --root flag; HALM_ROOT / MNEMOSYNE_ROOT in env count the same.
  explicit?: string
  platform?: string
  fs?: MigrateFs
}

const result = (action: MigrateResult['action'], d: RootDecision, extra: Partial<MigrateResult> = {}): MigrateResult => ({
  action,
  state: d.state,
  root: d.root,
  oldRoot: d.oldRoot,
  newRoot: d.newRoot,
  ...(d.warning ? { warning: d.warning } : {}),
  ...extra,
})

/** Links the new root to the old one when the state table allows it; otherwise changes nothing. */
export function migrateRoot(options: MigrateOptions): MigrateResult {
  const { home, platform } = options
  const env = options.env ?? {}
  const fs = options.fs ?? nodeMigrateFs
  const explicit = options.explicit?.trim() || envOf('ROOT', env)
  if (explicit?.trim()) return result('explicit', resolveRootSync(fs, home, { explicit, platform }))

  const resolve = () => resolveRootSync(fs, home, { platform })
  const decision = resolve()
  if (migrationOff(env)) return result('disabled', decision)

  const link = (d: RootDecision): MigrateResult => {
    try {
      fs.symlink(d.oldRoot, d.newRoot, platform === 'win32' ? 'junction' : 'dir')
    } catch (err) {
      const code = (err as { code?: unknown })?.code
      const message = err instanceof Error ? err.message : String(err)
      if (code !== 'EEXIST') return result('failed', d, { root: d.oldRoot, error: message })
      // A parallel start may have made the same link first: fine when it points at the old root.
      const again = resolve()
      if (again.state === 'new-links-old' || again.state === 'same-folder') return result('linked-by-other', again)
      const warning = again.warning ?? `HAL-M data folder: ${d.newRoot} appeared while linking and does not point at ${d.oldRoot}. Using ${d.oldRoot}.`
      return result('failed', again, { root: d.oldRoot, warning, error: message })
    }
    return result('linked', resolve())
  }

  if (decision.state === 'old-only') return link(decision)
  if (decision.state === 'both-real' && decision.root === decision.oldRoot) {
    // An empty new folder (say, made by hand) is no data: remove it and link. Anything inside stays.
    try {
      fs.rmdir(decision.newRoot)
    } catch {
      return result('none', decision)
    }
    const after = resolve()
    return after.state === 'old-only' ? link(after) : result('none', after)
  }
  // fresh, new-only, the linked states, foreign-link: nothing to do here (the caller creates a fresh root).
  return result('none', decision)
}

/** The data root for a Bun entry point that only reads it: never links. */
export function dataRoot(home: string, env: Record<string, string | undefined>, explicit?: string): RootDecision {
  return resolveRootSync(nodeRootFs, home, { explicit: explicit ?? envOf('ROOT', env) })
}

const USAGE = 'usage: bun bin/migrate-root.ts <home> [--root <path>]  (home must be absolute)'

if (import.meta.main) {
  const args = process.argv.slice(2)
  let home: string | undefined
  let root: string | undefined
  let bad = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '--root') {
      root = args[++i]
      if (root === undefined || root.trim() === '') bad = true
    } else if (home === undefined) home = arg
    else bad = true
  }
  if (bad || home === undefined || !isAbsolute(home)) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(2)
  }
  const outcome = migrateRoot({ home, env: process.env, explicit: root, platform: process.platform, fs: nodeMigrateFs })
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
}

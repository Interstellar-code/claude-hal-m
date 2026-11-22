// Specs for bin/migrate-root.ts (docs/plans/hal-m-stage2.md 3.2 items 2-4, 7):
// the ~/.hal-m link to the 0.37 root, never a move. Over an in-memory fs, a
// real fs in temp homes, and the CLI. Never the real home.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataRoot, migrateRoot, nodeMigrateFs, nodeRootFs, type MigrateFs } from '../../bin/migrate-root'
import { newRootOf, oldRootOf } from '../../hooks/names'
import { ROOT, isolatedEnv, tempDir } from './helpers'

type Entry = { kind: 'dir' } | { kind: 'file' } | { kind: 'link'; target: string }
type Hook = (target: string, path: string, type: string) => void

const errno = (code: string) => Object.assign(new Error(`${code}: test error`), { code })
const dir = (): Entry => ({ kind: 'dir' })
const link = (target: string): Entry => ({ kind: 'link', target })

/** A Map-based MigrateFs: every call is recorded; links are followed like a real fs. */
function memFs(entries: Record<string, Entry>, symlinkHook?: Hook) {
  const map = new Map(Object.entries(entries))
  const calls: unknown[][] = []
  const sepOf = (path: string) => (path.includes('\\') && !path.includes('/') ? '\\' : '/')
  const resolve = (path: string): string | null => {
    let p = path
    for (let hops = 0; hops < 40; hops++) {
      const sep = sepOf(p)
      let next: string | null = null
      for (const [key, entry] of map) {
        if (entry.kind !== 'link') continue
        if (p === key) next = entry.target
        else if (p.startsWith(key + sep)) next = entry.target + p.slice(key.length)
        if (next !== null) break
      }
      if (next === null) return map.has(p) ? p : null
      p = next
    }
    return null
  }
  const fs: MigrateFs = {
    lstat(path) {
      calls.push(['lstat', path])
      const entry = map.get(path)
      return entry ? { link: entry.kind === 'link' } : null
    },
    stat(path) {
      calls.push(['stat', path])
      const real = resolve(path)
      return real === null ? null : { dir: map.get(real)?.kind === 'dir' }
    },
    realpath(path) {
      calls.push(['realpath', path])
      return resolve(path)
    },
    symlink(target, path, type) {
      calls.push(['symlink', target, path, type])
      if (symlinkHook) return symlinkHook(target, path, type)
      if (map.has(path)) throw errno('EEXIST')
      map.set(path, link(target))
    },
    rmdir(path) {
      calls.push(['rmdir', path])
      const entry = map.get(path)
      if (!entry) throw errno('ENOENT')
      if (entry.kind !== 'dir') throw errno('ENOTDIR')
      const sep = sepOf(path)
      if ([...map.keys()].some(key => key.startsWith(path + sep))) throw errno('ENOTEMPTY')
      map.delete(path)
    },
  }
  const writes = () => calls.filter(call => call[0] === 'symlink' || call[0] === 'rmdir')
  return { fs, map, calls, writes }
}

const HOME = '/home/r'
const OLD = oldRootOf(HOME)
const NEW = newRootOf(HOME)
const base = (): Record<string, Entry> => ({ [HOME]: dir(), [`${HOME}/.claude`]: dir() })
const oldOnly = () => ({ ...base(), [OLD]: dir(), [`${OLD}/store`]: dir() })

describe('migrateRoot over an in-memory fs', () => {
  test('old-only: one symlink(old, new, dir), then linked on the new path', () => {
    const m = memFs(oldOnly())
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(m.writes()).toEqual([['symlink', OLD, NEW, 'dir']])
    expect(r).toMatchObject({ action: 'linked', state: 'new-links-old', root: NEW, oldRoot: OLD, newRoot: NEW })
    expect(r.warning).toBeUndefined()
  })

  test('Windows: a junction with the absolute old root as target, backslash paths', () => {
    const home = 'C:\\Users\\r'
    const old = 'C:\\Users\\r\\.claude\\mnemosyne'
    const neu = 'C:\\Users\\r\\.hal-m'
    expect(oldRootOf(home)).toBe(old)
    expect(newRootOf(home)).toBe(neu)
    const m = memFs({ [home]: dir(), ['C:\\Users\\r\\.claude']: dir(), [old]: dir() })
    const r = migrateRoot({ home, env: {}, platform: 'win32', fs: m.fs })
    expect(m.writes()).toEqual([['symlink', old, neu, 'junction']])
    expect(r).toMatchObject({ action: 'linked', state: 'new-links-old', root: neu, oldRoot: old, newRoot: neu })
  })

  test('EEXIST from a parallel start that already linked to the old root is success', () => {
    const m = memFs(oldOnly(), (target, path) => {
      m.map.set(path, link(target))
      throw errno('EEXIST')
    })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'linked-by-other', state: 'new-links-old', root: NEW })
    expect(r.error).toBeUndefined()
  })

  test('EEXIST with the new path pointing elsewhere fails and keeps the old root', () => {
    const m = memFs({ ...oldOnly(), '/elsewhere': dir() }, (_target, path) => {
      m.map.set(path, link('/elsewhere'))
      throw errno('EEXIST')
    })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r.action).toBe('failed')
    expect(r.root).toBe(OLD)
    expect(r.warning).toContain(NEW)
  })

  test('EPERM fails with the error, keeps the old root and leaves no link', () => {
    const m = memFs(oldOnly(), () => {
      throw errno('EPERM')
    })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'failed', state: 'old-only', root: OLD })
    expect(r.error).toContain('EPERM')
    expect(m.map.has(NEW)).toBe(false)
  })

  test.each([[{ HALM_NO_MIGRATE: '1' }], [{ MNEMOSYNE_NO_MIGRATE: '1' }], [{ HALM_NO_MIGRATE: 'yes' }]])('%p turns the link off', env => {
    const m = memFs(oldOnly())
    const r = migrateRoot({ home: HOME, env, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'disabled', state: 'old-only', root: OLD })
    expect(m.writes()).toEqual([])
  })

  test.each([[{ HALM_NO_MIGRATE: '0' }], [{ HALM_NO_MIGRATE: '0', MNEMOSYNE_NO_MIGRATE: '1' }], [{ MNEMOSYNE_NO_MIGRATE: ' 0 ' }]])('%p leaves the link on', env => {
    const m = memFs(oldOnly())
    const r = migrateRoot({ home: HOME, env, platform: 'linux', fs: m.fs })
    expect(r.action).toBe('linked')
    expect(m.writes()).toEqual([['symlink', OLD, NEW, 'dir']])
  })

  test.each([
    ['options.explicit', { explicit: '/x', env: {} }],
    ['HALM_ROOT', { env: { HALM_ROOT: '/x' } }],
    ['MNEMOSYNE_ROOT', { env: { MNEMOSYNE_ROOT: '/x' } }],
    ['HALM_ROOT with NO_MIGRATE 0', { env: { HALM_ROOT: '/x', HALM_NO_MIGRATE: '0' } }],
  ])('an explicit root from %s is never linked and needs no fs call', (_label, extra) => {
    const m = memFs(oldOnly())
    const r = migrateRoot({ home: HOME, platform: 'linux', fs: m.fs, ...extra })
    expect(r).toMatchObject({ action: 'explicit', state: 'explicit', root: '/x', oldRoot: OLD, newRoot: NEW })
    expect(m.calls).toEqual([])
  })

  test('fresh: nothing is created (the caller creates the root)', () => {
    const m = memFs(base())
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'none', state: 'fresh', root: NEW })
    expect(m.writes()).toEqual([])
    expect(m.map.size).toBe(2)
  })

  test.each([
    ['new-only', { [NEW]: dir() }, NEW],
    ['new-links-old', { [OLD]: dir(), [NEW]: link(OLD) }, NEW],
    ['old-links-new', { [NEW]: dir(), [OLD]: link(NEW) }, NEW],
    ['foreign-link', { [OLD]: dir(), '/elsewhere': dir(), [NEW]: link('/elsewhere') }, OLD],
    ['foreign-link', { [OLD]: dir(), [NEW]: link('/gone') }, OLD],
  ])('%s: action none, no writes', (state, extra, root) => {
    const m = memFs({ ...base(), ...extra })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'none', state, root })
    expect(m.writes()).toEqual([])
    if (state === 'foreign-link') expect(r.warning).toContain(NEW)
  })

  test('both-real with an empty new folder: rmdir, then linked', () => {
    const m = memFs({ ...oldOnly(), [NEW]: dir() })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(m.writes()).toEqual([
      ['rmdir', NEW],
      ['symlink', OLD, NEW, 'dir'],
    ])
    expect(r).toMatchObject({ action: 'linked', state: 'new-links-old', root: NEW })
  })

  test('both-real with a non-empty new folder: rmdir refuses, none with the warning', () => {
    const m = memFs({ ...oldOnly(), [NEW]: dir(), [`${NEW}/notes.txt`]: { kind: 'file' } })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(m.writes()).toEqual([['rmdir', NEW]])
    expect(r).toMatchObject({ action: 'none', state: 'both-real', root: OLD })
    expect(r.warning).toContain('two real folders')
    expect(m.map.get(`${NEW}/notes.txt`)).toEqual({ kind: 'file' })
  })

  test('both-real with the store only in the new folder: none, no rmdir', () => {
    const m = memFs({ ...base(), [OLD]: dir(), [NEW]: dir(), [`${NEW}/store`]: dir() })
    const r = migrateRoot({ home: HOME, env: {}, platform: 'linux', fs: m.fs })
    expect(r).toMatchObject({ action: 'none', state: 'both-real', root: NEW })
    expect(r.warning).toBeDefined()
    expect(m.writes()).toEqual([])
  })
})

const temps: { dispose: () => void }[] = []
const tempHome = (prefix: string) => {
  const t = tempDir(prefix)
  temps.push(t)
  return t.dir
}
afterAll(() => {
  for (const t of temps) t.dispose()
})

describe('migrateRoot over the real file system in temp homes', () => {
  test('old-only: a real link at <home>/.hal-m to the old root; a second run changes nothing', () => {
    const home = tempHome('migrate-real')
    mkdirSync(join(oldRootOf(home), 'store'), { recursive: true })
    const first = migrateRoot({ home, env: {}, platform: process.platform, fs: nodeMigrateFs })
    expect(first).toMatchObject({ action: 'linked', state: 'new-links-old', root: newRootOf(home) })
    expect(lstatSync(newRootOf(home)).isSymbolicLink()).toBe(true)
    expect(realpathSync(newRootOf(home))).toBe(realpathSync(oldRootOf(home)))
    expect(existsSync(join(newRootOf(home), 'store'))).toBe(true)
    const second = migrateRoot({ home, env: {}, platform: process.platform, fs: nodeMigrateFs })
    expect(second).toMatchObject({ action: 'none', state: 'new-links-old', root: newRootOf(home) })
  })

  test('both-real with an empty new folder: linked', () => {
    const home = tempHome('migrate-real')
    mkdirSync(join(oldRootOf(home), 'store'), { recursive: true })
    mkdirSync(newRootOf(home))
    const r = migrateRoot({ home, env: {}, platform: process.platform, fs: nodeMigrateFs })
    expect(r).toMatchObject({ action: 'linked', state: 'new-links-old' })
    expect(lstatSync(newRootOf(home)).isSymbolicLink()).toBe(true)
  })

  test('both-real with a file in the new folder: untouched', () => {
    const home = tempHome('migrate-real')
    mkdirSync(join(oldRootOf(home), 'store'), { recursive: true })
    mkdirSync(newRootOf(home))
    writeFileSync(join(newRootOf(home), 'keep.txt'), 'keep')
    const r = migrateRoot({ home, env: {}, platform: process.platform, fs: nodeMigrateFs })
    expect(r).toMatchObject({ action: 'none', state: 'both-real', root: oldRootOf(home) })
    expect(lstatSync(newRootOf(home)).isSymbolicLink()).toBe(false)
    expect(existsSync(join(newRootOf(home), 'keep.txt'))).toBe(true)
  })

  test('nodeRootFs on a dangling link: lstat link, stat and realpath null', () => {
    const home = tempHome('migrate-real')
    const path = join(home, 'dangling')
    symlinkSync(join(home, 'missing'), path, 'dir')
    expect(nodeRootFs.lstat(path)).toEqual({ link: true })
    expect(nodeRootFs.stat(path)).toBeNull()
    expect(nodeRootFs.realpath(path)).toBeNull()
    expect(nodeRootFs.lstat(join(home, 'nothing'))).toBeNull()
    expect(nodeRootFs.stat(home)).toEqual({ dir: true })
  })

  test('dataRoot: an explicit root wins, else the resolver over the disk', () => {
    const home = tempHome('migrate-real')
    expect(dataRoot(home, { HALM_ROOT: '/x' })).toMatchObject({ root: '/x', state: 'explicit' })
    expect(dataRoot(home, { MNEMOSYNE_ROOT: '/y' })).toMatchObject({ root: '/y', state: 'explicit' })
    expect(dataRoot(home, { HALM_ROOT: '/x' }, '/z').root).toBe('/z')
    expect(dataRoot(home, {})).toMatchObject({ root: newRootOf(home), state: 'fresh' })
    expect(existsSync(newRootOf(home))).toBe(false)
  })
})

const SCRIPT = join(ROOT, 'bin', 'migrate-root.ts')

/** One CLI run in an isolatedEnv() temp home (its old root already exists), with no inherited explicit root. */
function cli(iso: ReturnType<typeof isolatedEnv>, args: string[], noMigrate: string) {
  const child = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
    env: { ...(process.env as Record<string, string>), ...iso, USERPROFILE: iso.HOME, HALM_ROOT: '', MNEMOSYNE_ROOT: '', HALM_NO_MIGRATE: noMigrate, MNEMOSYNE_NO_MIGRATE: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = child.stdout.toString()
  return { exitCode: child.exitCode, stdout, stderr: child.stderr.toString(), json: () => JSON.parse(stdout.trim()) }
}

describe('bin/migrate-root.ts CLI', () => {
  test('HALM_NO_MIGRATE 0: links and prints one JSON line', () => {
    const iso = isolatedEnv('migrate-cli')
    const home = iso.HOME
    mkdirSync(oldRootOf(home), { recursive: true })
    const r = cli(iso, [home], '0')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim().split('\n')).toHaveLength(1)
    expect(r.json()).toMatchObject({ action: 'linked', root: newRootOf(home) })
    expect(lstatSync(newRootOf(home)).isSymbolicLink()).toBe(true)
  })

  test('HALM_NO_MIGRATE 1: disabled, no link', () => {
    const iso = isolatedEnv('migrate-cli')
    const home = iso.HOME
    mkdirSync(oldRootOf(home), { recursive: true })
    const r = cli(iso, [home], '1')
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ action: 'disabled', state: 'old-only', root: oldRootOf(home) })
    expect(existsSync(newRootOf(home))).toBe(false)
  })

  test('--root: explicit, no link', () => {
    const iso = isolatedEnv('migrate-cli')
    const home = iso.HOME
    mkdirSync(oldRootOf(home), { recursive: true })
    const r = cli(iso, [home, '--root', '/x'], '0')
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ action: 'explicit', root: '/x' })
    expect(existsSync(newRootOf(home))).toBe(false)
  })

  test('no home, a relative home or a bare --root: usage on stderr, exit 2', () => {
    const iso = isolatedEnv('migrate-cli')
    const home = iso.HOME
    for (const args of [[], ['relative/home'], [home, '--root']]) {
      const r = cli(iso, args, '0')
      expect(r.exitCode).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain('usage')
    }
    expect(existsSync(newRootOf(home))).toBe(false)
  })
})

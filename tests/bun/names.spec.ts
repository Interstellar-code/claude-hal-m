// Specs for hooks/names.ts (plan docs/plans/hal-m-stage2.md, 3.2-3.5): the
// names, the env helpers, the data-root resolver and the path rebaser. No
// disk: the resolver runs over an in-memory RootFs.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMAND_NAMES,
  COOKIE_NAMES,
  ENV_NAMES,
  KEPT,
  LAUNCHER_NAME,
  OLD_LAUNCHER_NAME,
  OLD_PLUGIN_ID,
  OLD_TOOL_PREFIX,
  OWNER_HEADERS,
  PLUGIN_ID,
  TOOL_PREFIX,
  childEnv,
  decideRoot,
  envOf,
  envOfAsync,
  hookChildEnv,
  isDefaultMemoryDir,
  isOwnClientLabel,
  joinPath,
  migrationOff,
  modelCacheDir,
  pickEnv,
  rebasePath,
  resolveRoot,
  resolveRootSync,
  stripStderrPrefix,
  type PathFacts,
  type RootDecision,
  type RootFs,
  type RootOptions,
} from '../../hooks/names'

describe('names', () => {
  test('plugin ids and tool prefixes', () => {
    expect(PLUGIN_ID).toBe('hal-m@hal-m')
    expect(OLD_PLUGIN_ID).toBe('mnemosyne@mnemosyne')
    expect(TOOL_PREFIX).toBe('mcp__hal-m__')
    expect(OLD_TOOL_PREFIX).toBe('mcp__mnemosyne__')
  })

  test('six commands, new hal-m-* and old mnemosyne-*', () => {
    const keys = ['setup', 'tags', 'import', 'ui', 'knowledge', 'embed'] as const
    expect(COMMAND_NAMES).toEqual(keys.map(key => ({ key, name: `hal-m-${key}` as const, old: `mnemosyne-${key}` as const })))
  })

  test('launcher names', () => {
    expect(LAUNCHER_NAME).toBe('hal-m-mcp')
    expect(OLD_LAUNCHER_NAME).toBe('mnemosyne-mcp')
  })

  test('owner headers, new first', () => {
    expect([...OWNER_HEADERS]).toEqual(['HAL-M-Owner', 'Mnemosyne-Owner'])
  })

  test('four distinct cookie names', () => {
    expect(new Set(COOKIE_NAMES).size).toBe(4)
    expect([...COOKIE_NAMES].sort()).toEqual(['__Host-halm_session', '__Host-mnemosyne_session', 'halm_session', 'mnemosyne_session'])
  })

  test('kept names stay mnemosyne in 0.38', () => {
    expect(KEPT).toEqual({
      stderrName: 'mnemosyne',
      serverInfoName: 'mnemosyne',
      rulesSectionId: 'mnemosyne:rules',
      statsProvider: 'mnemosyne',
      clientLabelPrefix: 'mnemosyne-',
    })
  })

  test('isOwnClientLabel takes both prefixes and nothing else', () => {
    expect(isOwnClientLabel('mnemosyne-knowledge')).toBe(true)
    expect(isOwnClientLabel('hal-m-session')).toBe(true)
    expect(isOwnClientLabel('claude-code')).toBe(false)
    expect(isOwnClientLabel('mnemosyne')).toBe(false)
    expect(isOwnClientLabel(undefined)).toBe(false)
    expect(isOwnClientLabel(42)).toBe(false)
  })
})

describe('stripStderrPrefix', () => {
  test('with a label, both names', () => {
    expect(stripStderrPrefix('mnemosyne remote: boom', 'remote')).toBe('boom')
    expect(stripStderrPrefix('hal-m remote: boom', 'remote')).toBe('boom')
  })

  test('a different label is left alone', () => {
    expect(stripStderrPrefix('mnemosyne other: boom', 'remote')).toBe('mnemosyne other: boom')
  })

  test('without a label, up to the first colon', () => {
    expect(stripStderrPrefix('mnemosyne server unreachable: ECONNREFUSED')).toBe('ECONNREFUSED')
    expect(stripStderrPrefix('hal-m server unreachable: ECONNREFUSED')).toBe('ECONNREFUSED')
    expect(stripStderrPrefix('mnemosyne: x: y')).toBe('x: y')
  })

  test('without a label, the name must end at a space or colon', () => {
    expect(stripStderrPrefix('hal-macro: x')).toBe('hal-macro: x')
    expect(stripStderrPrefix('mnemosynex: x')).toBe('mnemosynex: x')
  })

  test('case is ignored', () => {
    expect(stripStderrPrefix('MNEMOSYNE Remote: boom', 'remote')).toBe('boom')
    expect(stripStderrPrefix('HAL-M server unreachable: boom')).toBe('boom')
  })

  test('text without a prefix comes back unchanged', () => {
    expect(stripStderrPrefix('plain error: boom')).toBe('plain error: boom')
    expect(stripStderrPrefix('error: mnemosyne remote: boom', 'remote')).toBe('error: mnemosyne remote: boom')
    expect(stripStderrPrefix('')).toBe('')
  })

  test('a label with regex characters is matched literally', () => {
    expect(stripStderrPrefix('mnemosyne a.b(c)*[d]: boom', 'a.b(c)*[d]')).toBe('boom')
    expect(stripStderrPrefix('mnemosyne aXb(c)*[d]: boom', 'a.b(c)*[d]')).toBe('mnemosyne aXb(c)*[d]: boom')
  })
})

describe('env: pickEnv and envOf (3.3)', () => {
  test('new empty, old set: ACTIVITY_LOG empty wins, ROOT takes the old', () => {
    expect(pickEnv('ACTIVITY_LOG', '', '/old.log')).toBe('')
    expect(pickEnv('ROOT', '', '/old')).toBe('/old')
    expect(envOf('ACTIVITY_LOG', { HALM_ACTIVITY_LOG: '', MNEMOSYNE_ACTIVITY_LOG: '/old.log' })).toBe('')
    expect(envOf('ROOT', { HALM_ROOT: '', MNEMOSYNE_ROOT: '/old' })).toBe('/old')
  })

  test('both set: new wins', () => {
    expect(pickEnv('ROOT', '/new', '/old')).toBe('/new')
    expect(envOf('ROOT', { HALM_ROOT: '/new', MNEMOSYNE_ROOT: '/old' })).toBe('/new')
    expect(envOf('ACTIVITY_LOG', { HALM_ACTIVITY_LOG: '/n.log', MNEMOSYNE_ACTIVITY_LOG: '/o.log' })).toBe('/n.log')
  })

  test('only old, only new, neither', () => {
    expect(envOf('ROOT', { MNEMOSYNE_ROOT: '/old' })).toBe('/old')
    expect(envOf('ROOT', { HALM_ROOT: '/new' })).toBe('/new')
    expect(envOf('ROOT', {})).toBeUndefined()
    expect(envOf('ACTIVITY_LOG', {})).toBeUndefined()
    expect(pickEnv('ROOT', undefined, undefined)).toBeUndefined()
  })

  test('both empty: ACTIVITY_LOG is empty, ROOT is unset', () => {
    expect(envOf('ACTIVITY_LOG', { HALM_ACTIVITY_LOG: '', MNEMOSYNE_ACTIVITY_LOG: '' })).toBe('')
    expect(envOf('ROOT', { HALM_ROOT: '', MNEMOSYNE_ROOT: '' })).toBeUndefined()
  })

  test('old empty for ACTIVITY_LOG with new unset is still a value', () => {
    expect(envOf('ACTIVITY_LOG', { MNEMOSYNE_ACTIVITY_LOG: '' })).toBe('')
  })

  test('a function source', () => {
    const env: Record<string, string> = { MNEMOSYNE_STORE: '/old-store', HALM_PORT: '7777' }
    const seen: string[] = []
    const read = (key: string) => {
      seen.push(key)
      return env[key]
    }
    expect(envOf('STORE', read)).toBe('/old-store')
    expect(envOf('PORT', read)).toBe('7777')
    expect(seen).toEqual(['HALM_STORE', 'MNEMOSYNE_STORE', 'HALM_PORT', 'MNEMOSYNE_PORT'])
  })

  test('envOfAsync over an async reader', async () => {
    const env: Record<string, string> = { HALM_ROOT: '', MNEMOSYNE_ROOT: '/old', HALM_ACTIVITY_LOG: '', MNEMOSYNE_ACTIVITY_LOG: '/o.log' }
    const read = async (key: string) => env[key]
    expect(await envOfAsync('ROOT', read)).toBe('/old')
    expect(await envOfAsync('ACTIVITY_LOG', read)).toBe('')
    expect(await envOfAsync('STORE', read)).toBeUndefined()
    expect(await envOfAsync('PORT', async key => (key === 'HALM_PORT' ? '1' : '2'))).toBe('1')
  })
})

describe('env: childEnv, hookChildEnv, migrationOff, ENV_NAMES', () => {
  test('childEnv: the given names under the new spelling only', () => {
    const parent: Record<string, string | undefined> = {
      PATH: '/bin',
      MNEMOSYNE_ROOT: '/inherited-old',
      HALM_STORE: '/inherited-new-store',
      MNEMOSYNE_PORT: '1111',
      HALM_UI_PORT: '2222',
      MNEMOSYNE_DATA: '/d',
      GONE: undefined,
    }
    const before = { ...parent }
    const env = childEnv(parent, { ROOT: '/r', STORE: '/s' })
    // An inherited old ROOT is deleted, an inherited new STORE replaced.
    expect(env.HALM_ROOT).toBe('/r')
    expect('MNEMOSYNE_ROOT' in env).toBe(false)
    expect(env.HALM_STORE).toBe('/s')
    expect('MNEMOSYNE_STORE' in env).toBe(false)
    // Names not given pass through in either spelling.
    expect(env.MNEMOSYNE_PORT).toBe('1111')
    expect(env.HALM_UI_PORT).toBe('2222')
    expect(env.MNEMOSYNE_DATA).toBe('/d')
    expect(env.PATH).toBe('/bin')
    // Undefined parent values are dropped, not kept as keys.
    expect('GONE' in env).toBe(false)
    // The parent is not mutated.
    expect(parent).toEqual(before)
    expect(env).not.toBe(parent)
  })

  test('childEnv: an inherited new ROOT is replaced', () => {
    const env = childEnv({ HALM_ROOT: '/stale', MNEMOSYNE_ROOT: '/older' }, { ROOT: '/fresh' })
    expect(env).toEqual({ HALM_ROOT: '/fresh' })
  })

  test('childEnv: a value given as undefined changes nothing', () => {
    const env = childEnv({ MNEMOSYNE_STORE: '/keep' }, { STORE: undefined })
    expect(env).toEqual({ MNEMOSYNE_STORE: '/keep' })
  })

  test('hookChildEnv sets both spellings', () => {
    expect(hookChildEnv({ ROOT: '/r', ACTIVITY_LOG: '', STORE: undefined })).toEqual({
      HALM_ROOT: '/r',
      MNEMOSYNE_ROOT: '/r',
      HALM_ACTIVITY_LOG: '',
      MNEMOSYNE_ACTIVITY_LOG: '',
    })
  })

  test('migrationOff', () => {
    expect(migrationOff({ HALM_NO_MIGRATE: '1' })).toBe(true)
    expect(migrationOff({ HALM_NO_MIGRATE: '0' })).toBe(false)
    expect(migrationOff({ HALM_NO_MIGRATE: ' 0 ' })).toBe(false)
    expect(migrationOff({ HALM_NO_MIGRATE: '' })).toBe(false)
    expect(migrationOff({})).toBe(false)
    expect(migrationOff({ MNEMOSYNE_NO_MIGRATE: '1' })).toBe(true)
    expect(migrationOff(key => (key === 'HALM_NO_MIGRATE' ? 'yes' : undefined))).toBe(true)
  })

  test('ENV_NAMES: 35 unique, the 34 old ones plus NO_MIGRATE', () => {
    expect(ENV_NAMES.length).toBe(35)
    expect(new Set(ENV_NAMES).size).toBe(35)
    expect(ENV_NAMES[ENV_NAMES.length - 1]).toBe('NO_MIGRATE')
    expect(ENV_NAMES.filter(name => name !== 'NO_MIGRATE').length).toBe(34)
  })
})

// ---- Data root (3.2 item 1) ----

type Entry = { kind: 'dir' } | { kind: 'link'; target: string } | { kind: 'file' }
const DIR: Entry = { kind: 'dir' }
const FILE: Entry = { kind: 'file' }
const link = (target: string): Entry => ({ kind: 'link', target })

// An in-memory RootFs over path -> entry. Every part of a path is walked and
// links followed (lstat leaves the last part alone); missing or dangling is
// null. win: backslash paths, keys compared without case. Records each call.
function memFs(entries: Record<string, Entry>, win = false) {
  const sep = win ? '\\' : '/'
  const key = (path: string) => (win ? path.replace(/\//g, '\\').toLowerCase() : path)
  const map = new Map(Object.entries(entries).map(([path, entry]) => [key(path), entry]))
  const calls: string[] = []
  const str = (parts: string[]) => (win ? parts.join('\\') : '/' + parts.join('/'))
  const walk = (path: string, followLast: boolean, depth = 0): { real: string; entry: Entry } | null => {
    if (depth > 40) return null
    const parts = path.split(/[\\/]/).filter(Boolean)
    const done: string[] = win ? [parts.shift()!] : []
    let entry: Entry = DIR
    for (let i = 0; i < parts.length; i++) {
      if (entry.kind !== 'dir') return null
      done.push(parts[i]!)
      const found = map.get(key(str(done)))
      if (!found) return null
      const last = i === parts.length - 1
      if (found.kind === 'link' && (!last || followLast)) {
        const rest = parts.slice(i + 1)
        return walk(rest.length ? found.target + sep + rest.join(sep) : found.target, followLast, depth + 1)
      }
      entry = found
    }
    return { real: str(done), entry }
  }
  const fs: RootFs = {
    lstat(path) {
      calls.push(path)
      const hit = walk(path, false)
      return hit ? { link: hit.entry.kind === 'link' } : null
    },
    stat(path) {
      calls.push(path)
      const hit = walk(path, true)
      return hit ? { dir: hit.entry.kind === 'dir' } : null
    },
    realpath(path) {
      calls.push(path)
      return walk(path, true)?.real ?? null
    },
  }
  return { fs, calls }
}

// A host that does not report a junction as a link: lstat says "not a link".
const hideLinks = (fs: RootFs): RootFs => ({ ...fs, lstat: path => (fs.lstat(path) ? { link: false } : null) })

const asAsync = (fs: RootFs) => ({
  lstat: async (path: string) => fs.lstat(path),
  stat: async (path: string) => fs.stat(path),
  realpath: async (path: string) => fs.realpath(path),
})

const H = '/h'
const OLD = '/h/.claude/mnemosyne'
const NEW = '/h/.hal-m'
const BASE: Record<string, Entry> = { '/h': DIR, '/h/.claude': DIR }

const none: PathFacts = { present: false, link: false, dir: false, real: null, store: false }
const dirAt = (real: string, store = false): PathFacts => ({ present: true, link: false, dir: true, real, store })
const linkTo = (real: string, store = false): PathFacts => ({ present: true, link: true, dir: true, real, store })
const dangling: PathFacts = { present: true, link: true, dir: false, real: null, store: false }
const fileAt = (real: string): PathFacts => ({ present: true, link: false, dir: false, real, store: false })

type Row = {
  name: string
  facts: { old: PathFacts; new: PathFacts }
  disk: Record<string, Entry>
  hide?: boolean
  expect: Partial<RootDecision> & { warns?: string[] }
}

const rows: Row[] = [
  {
    name: 'row 1: only old',
    facts: { old: dirAt(OLD), new: none },
    disk: { [OLD]: DIR },
    expect: { state: 'old-only', root: OLD, link: true, create: false },
  },
  {
    name: 'row 2: new is a link to old',
    facts: { old: dirAt(OLD), new: linkTo(OLD) },
    disk: { [OLD]: DIR, [NEW]: link(OLD) },
    expect: { state: 'new-links-old', root: NEW, link: false, create: false },
  },
  {
    name: 'row 3: old is a link to new',
    facts: { old: linkTo(NEW), new: dirAt(NEW) },
    disk: { [NEW]: DIR, [OLD]: link(NEW) },
    expect: { state: 'old-links-new', root: NEW, link: false, create: false },
  },
  {
    name: 'same real path, neither reported as a link (a junction)',
    facts: { old: dirAt(OLD), new: dirAt(OLD) },
    disk: { [OLD]: DIR, [NEW]: link(OLD) },
    hide: true,
    expect: { state: 'same-folder', root: NEW, link: false, create: false },
  },
  {
    name: 'row 4: only new',
    facts: { old: none, new: dirAt(NEW) },
    disk: { [NEW]: DIR },
    expect: { state: 'new-only', root: NEW, link: false, create: false },
  },
  {
    name: 'row 5: neither',
    facts: { old: none, new: none },
    disk: {},
    expect: { state: 'fresh', root: NEW, link: false, create: true },
  },
  {
    name: 'row 6: both real, store only in new',
    facts: { old: dirAt(OLD), new: dirAt(NEW, true) },
    disk: { [OLD]: DIR, [NEW]: DIR, [NEW + '/store']: DIR },
    expect: { state: 'both-real', root: NEW, link: false, create: false, warns: [OLD, NEW] },
  },
  {
    name: 'row 6: both real, store only in old',
    facts: { old: dirAt(OLD, true), new: dirAt(NEW) },
    disk: { [OLD]: DIR, [NEW]: DIR, [OLD + '/store']: DIR },
    expect: { state: 'both-real', root: OLD, link: false, create: false, warns: [OLD, NEW] },
  },
  {
    name: 'row 6: both real, no store',
    facts: { old: dirAt(OLD), new: dirAt(NEW) },
    disk: { [OLD]: DIR, [NEW]: DIR },
    expect: { state: 'both-real', root: OLD, link: false, create: false, warns: [OLD, NEW] },
  },
  {
    name: 'row 6: both real, both hold a store',
    facts: { old: dirAt(OLD, true), new: dirAt(NEW, true) },
    disk: { [OLD]: DIR, [NEW]: DIR, [OLD + '/store']: DIR, [NEW + '/store']: DIR },
    expect: { state: 'both-real', root: OLD, link: false, create: false, warns: [OLD, NEW] },
  },
  {
    name: 'row 7: new is a link elsewhere, old real',
    facts: { old: dirAt(OLD), new: linkTo('/x') },
    disk: { [OLD]: DIR, [NEW]: link('/x'), '/x': DIR },
    expect: { state: 'foreign-link', root: OLD, link: false, create: false, warns: [NEW, '/x'] },
  },
  {
    name: 'row 7: new is a dangling link, old real',
    facts: { old: dirAt(OLD), new: dangling },
    disk: { [OLD]: DIR, [NEW]: link('/gone') },
    expect: { state: 'foreign-link', root: OLD, link: false, create: false, warns: [NEW, 'dangling'] },
  },
  {
    name: 'row 7: old is a link elsewhere, new missing',
    facts: { old: linkTo('/x'), new: none },
    disk: { [OLD]: link('/x'), '/x': DIR },
    expect: { state: 'foreign-link', root: OLD, link: false, create: false, warns: [OLD, '/x'] },
  },
  {
    name: 'row 7: old is a dangling link, new missing',
    facts: { old: dangling, new: none },
    disk: { [OLD]: link('/gone') },
    expect: { state: 'foreign-link', root: OLD, link: false, create: false, warns: [OLD, 'dangling'] },
  },
  {
    name: 'row 7: a file at the new path, old real',
    facts: { old: dirAt(OLD), new: fileAt(NEW) },
    disk: { [OLD]: DIR, [NEW]: FILE },
    expect: { state: 'foreign-link', root: OLD, link: false, create: false, warns: [NEW, 'not a folder'] },
  },
  {
    name: 'new is a link elsewhere, old absent: only new, no warning',
    facts: { old: none, new: linkTo('/x') },
    disk: { [NEW]: link('/x'), '/x': DIR },
    expect: { state: 'new-only', root: NEW, link: false, create: false },
  },
]

function check(decision: RootDecision, row: Row) {
  const { warns, ...want } = row.expect
  expect(decision).toMatchObject({ ...want, oldRoot: OLD, newRoot: NEW })
  if (warns) for (const part of warns) expect(decision.warning).toContain(part)
  else expect(decision.warning).toBeUndefined()
}

const diskFs = (row: Row) => {
  const mem = memFs({ ...BASE, ...row.disk })
  return { ...mem, fs: row.hide ? hideLinks(mem.fs) : mem.fs }
}

describe('decideRoot: the state table of 3.2 item 1', () => {
  for (const row of rows) test(row.name, () => check(decideRoot(H, row.facts), row))

  test('create is true only for fresh', () => {
    const creates = rows.filter(row => decideRoot(H, row.facts).create).map(row => row.expect.state)
    expect(creates).toEqual(['fresh'])
  })
})

describe('resolveRootSync over an in-memory RootFs', () => {
  for (const row of rows) {
    test(row.name, () => {
      const decision = resolveRootSync(diskFs(row).fs, H)
      check(decision, row)
      // The facts written by hand describe the same disk.
      expect(decision).toEqual(decideRoot(H, row.facts))
    })
  }

  test('it looks at both roots and their store folders', () => {
    const { fs, calls } = memFs({ ...BASE, [OLD]: DIR })
    resolveRootSync(fs, H)
    for (const path of [OLD, NEW, OLD + '/store', NEW + '/store']) expect(calls).toContain(path)
  })
})

describe('resolveRoot (async) matches resolveRootSync', () => {
  for (const row of rows) {
    test(row.name, async () => {
      const { fs } = diskFs(row)
      expect(await resolveRoot(asAsync(fs), H)).toEqual(resolveRootSync(fs, H))
    })
  }

  test('a mix of plain and promised answers', async () => {
    const { fs } = memFs({ ...BASE, [OLD]: DIR })
    const mixed = { lstat: fs.lstat, stat: async (path: string) => fs.stat(path), realpath: fs.realpath }
    expect(await resolveRoot(mixed, H)).toEqual(resolveRootSync(fs, H))
  })
})

describe('explicit root', () => {
  const throwing: RootFs = {
    lstat: () => {
      throw new Error('lstat called')
    },
    stat: () => {
      throw new Error('stat called')
    },
    realpath: () => {
      throw new Error('realpath called')
    },
  }
  const explicit: RootOptions = { explicit: '/custom/root' }
  const want: RootDecision = { root: '/custom/root', state: 'explicit', link: false, create: false, oldRoot: OLD, newRoot: NEW }

  test('decideRoot uses it as given, whatever the facts', () => {
    expect(decideRoot(H, { old: dirAt(OLD), new: none }, explicit)).toEqual(want)
    expect(decideRoot(H, { old: none, new: none }, { explicit: '  /custom/root  ' })).toEqual(want)
  })

  test('resolveRootSync and resolveRoot never touch the fs', async () => {
    expect(resolveRootSync(throwing, H, explicit)).toEqual(want)
    expect(await resolveRoot(throwing, H, explicit)).toEqual(want)
    const { fs, calls } = memFs({ ...BASE, [OLD]: DIR })
    resolveRootSync(fs, H, explicit)
    expect(calls).toEqual([])
  })

  test('a blank explicit value is no explicit root', () => {
    const { fs } = memFs({ ...BASE, [OLD]: DIR })
    expect(resolveRootSync(fs, H, { explicit: '   ' }).state).toBe('old-only')
  })
})

describe('Windows home', () => {
  const WH = 'C:\\Users\\r'
  const WOLD = 'C:\\Users\\r\\.claude\\mnemosyne'
  const WNEW = 'C:\\Users\\r\\.hal-m'

  test('roots join with backslashes', () => {
    const decision = decideRoot(WH, { old: none, new: none }, { platform: 'win32' })
    expect(decision.oldRoot).toBe(WOLD)
    expect(decision.newRoot).toBe(WNEW)
  })

  test('decideRoot compares real paths without case on win32 only', () => {
    const facts = { old: dirAt(WOLD), new: linkTo('c:\\USERS\\R\\.Claude\\MNEMOSYNE\\') }
    expect(decideRoot(WH, facts, { platform: 'win32' })).toMatchObject({ state: 'new-links-old', root: WNEW })
    // Default platform comes from the home path.
    expect(decideRoot(WH, facts)).toMatchObject({ state: 'new-links-old', root: WNEW })
    // A case-sensitive platform sees two folders.
    expect(decideRoot(WH, facts, { platform: 'linux' }).state).toBe('foreign-link')
  })

  test('resolveRootSync over a backslash fs', async () => {
    const { fs, calls } = memFs({ 'C:\\Users': DIR, [WH]: DIR, 'C:\\Users\\r\\.claude': DIR, [WOLD]: DIR, [WNEW]: link('C:\\USERS\\R\\.CLAUDE\\MNEMOSYNE') }, true)
    const decision = resolveRootSync(fs, WH, { platform: 'win32' })
    expect(decision).toMatchObject({ state: 'new-links-old', root: WNEW, oldRoot: WOLD, newRoot: WNEW, create: false, link: false })
    for (const path of [WOLD, WNEW, WOLD + '\\store', WNEW + '\\store']) expect(calls).toContain(path)
    expect(calls.some(path => path.includes('/'))).toBe(false)
    expect(await resolveRoot(asAsync(fs), WH, { platform: 'win32' })).toEqual(decision)
  })

  test('only the old root on Windows', () => {
    const { fs } = memFs({ 'C:\\Users': DIR, [WH]: DIR, 'C:\\Users\\r\\.claude': DIR, [WOLD]: DIR }, true)
    expect(resolveRootSync(fs, WH, { platform: 'win32' })).toMatchObject({ state: 'old-only', root: WOLD, link: true })
  })
})

describe('rebasePath (3.2 item 5)', () => {
  const R = '/h/.hal-m'

  test('an absolute path under the old root', () => {
    expect(rebasePath('/h/.claude/mnemosyne/store/memories.db', H, R)).toBe('/h/.hal-m/store/memories.db')
  })

  test('the old root itself, with or without a trailing slash', () => {
    expect(rebasePath('/h/.claude/mnemosyne', H, R)).toBe(R)
    expect(rebasePath('/h/.claude/mnemosyne/', H, R)).toBe(R)
  })

  test('the ~/ form and the HOME-relative form', () => {
    expect(rebasePath('~/.claude/mnemosyne/store', H, R)).toBe('/h/.hal-m/store')
    expect(rebasePath('.claude/mnemosyne/model-cache', H, R)).toBe('/h/.hal-m/model-cache')
  })

  test('a Windows backslash path in another case', () => {
    const got = rebasePath('c:\\users\\R\\.Claude\\Mnemosyne\\store', 'C:\\Users\\r', 'C:\\Users\\r\\.hal-m', { platform: 'win32' })
    expect(got).toBe('C:\\Users\\r\\.hal-m\\store')
  })

  test('case matters off Windows', () => {
    expect(rebasePath('/h/.Claude/Mnemosyne/store', H, R)).toBe('/h/.Claude/Mnemosyne/store')
  })

  test('a lookalike, an unrelated path and an empty string are unchanged', () => {
    expect(rebasePath('/h/.claude/mnemosyne-ui/x', H, R)).toBe('/h/.claude/mnemosyne-ui/x')
    expect(rebasePath('~/.claude/mnemosyne-ui/x', H, R)).toBe('~/.claude/mnemosyne-ui/x')
    expect(rebasePath('/srv/data/store', H, R)).toBe('/srv/data/store')
    expect(rebasePath('', H, R)).toBe('')
  })

  test('a root equal to the old root changes nothing', () => {
    expect(rebasePath('/h/.claude/mnemosyne/store', H, OLD)).toBe('/h/.claude/mnemosyne/store')
    expect(rebasePath('~/.claude/mnemosyne/store', H, OLD)).toBe('/h/.claude/mnemosyne/store')
  })
})

describe('isDefaultMemoryDir', () => {
  test('empty values and both default literals', () => {
    expect(isDefaultMemoryDir(undefined)).toBe(true)
    expect(isDefaultMemoryDir('')).toBe(true)
    expect(isDefaultMemoryDir('  ')).toBe(true)
    expect(isDefaultMemoryDir('~/.claude/mnemosyne/store')).toBe(true)
    expect(isDefaultMemoryDir('~/.hal-m/store')).toBe(true)
    expect(isDefaultMemoryDir('~/.hal-m/store/')).toBe(true)
    expect(isDefaultMemoryDir('~/.claude/mnemosyne/store/')).toBe(true)
  })

  test('a custom path or a non-string is not default', () => {
    expect(isDefaultMemoryDir('/data/memories')).toBe(false)
    expect(isDefaultMemoryDir('~/.hal-m/store2')).toBe(false)
    expect(isDefaultMemoryDir(42)).toBe(false)
  })
})

describe('joinPath and modelCacheDir', () => {
  test('slash homes', () => {
    expect(joinPath('/h', '.claude', 'mnemosyne')).toBe('/h/.claude/mnemosyne')
    expect(joinPath('/h/', 'a')).toBe('/h/a')
    expect(modelCacheDir('/h/.hal-m')).toBe('/h/.hal-m/model-cache')
  })

  test('backslash homes', () => {
    expect(joinPath('C:\\Users\\r', '.hal-m')).toBe('C:\\Users\\r\\.hal-m')
    expect(joinPath('C:\\Users\\r\\', 'a', 'b')).toBe('C:\\Users\\r\\a\\b')
    expect(modelCacheDir('C:\\Users\\r\\.hal-m')).toBe('C:\\Users\\r\\.hal-m\\model-cache')
  })

  test('the root folder', () => {
    expect(joinPath('/', 'a')).toBe('/a')
    expect(joinPath('/')).toBe('/')
    expect(modelCacheDir('/')).toBe('/model-cache')
  })
})

describe('hooks/names.ts imports nothing', () => {
  test('no import line and no require(', () => {
    const text = readFileSync(join(import.meta.dir, '..', '..', 'hooks', 'names.ts'), 'utf8')
    expect(text.split('\n').filter(line => /^\s*import\b/.test(line))).toEqual([])
    expect(text.includes('require(')).toBe(false)
  })
})

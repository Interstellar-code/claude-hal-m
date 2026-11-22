// HAL-M names (Stage 2, docs/plans/hal-m-stage2.md): every product name, old
// and new, decided once here, plus the env helper, the data-root resolver and
// the path rebaser. Imports nothing, so the hooks (no Node or Bun types), the
// proxy, bin scripts, ui and the specs can all load it.

// ---- Plugin, tools, commands, launcher files ----

export const PLUGIN_NAME = 'hal-m'
export const OLD_PLUGIN_NAME = 'mnemosyne'
export const MARKETPLACE_NAME = 'hal-m'
export const OLD_MARKETPLACE_NAME = 'mnemosyne'
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
export const OLD_PLUGIN_ID = `${OLD_PLUGIN_NAME}@${OLD_MARKETPLACE_NAME}`

// The prefix Claude Code gives this plugin's tools: mcp__<plugin>__<tool>. A
// constant, not $.plugin.name: the tool.call matcher is fixed when the module
// loads, before any $ exists (F-m1). Session start compares it with the full
// name $.tool.register returns.
export const TOOL_PREFIX = 'mcp__hal-m__'
export const OLD_TOOL_PREFIX = 'mcp__mnemosyne__'

// Slash commands: the new name is registered, the old one stays as an alias (D4).
export const COMMANDS = ['setup', 'tags', 'import', 'ui', 'knowledge', 'embed'] as const
export type CommandKey = (typeof COMMANDS)[number]
export const commandName = <K extends CommandKey>(key: K) => `hal-m-${key}` as const
export const oldCommandName = <K extends CommandKey>(key: K) => `mnemosyne-${key}` as const
export const COMMAND_NAMES = COMMANDS.map(key => ({ key, name: commandName(key), old: oldCommandName(key) }))

// The externalMcp launcher in <root>/bin (.cmd on Windows). The old name is
// rewritten as a shim that runs the new one (3.4 item 2).
export const LAUNCHER_NAME = 'hal-m-mcp'
export const OLD_LAUNCHER_NAME = 'mnemosyne-mcp'

// A standalone root's marker file; bin/install-engine.ts accepts both (A-m2).
export const ROOT_MARKER = '.hal-m-root'
export const OLD_ROOT_MARKER = '.mnemosyne-root'

// ---- Server sessions (3.5) ----

// Both headers are accepted; the new one is the name clients send.
export const OWNER_HEADER = 'HAL-M-Owner'
export const OLD_OWNER_HEADER = 'Mnemosyne-Owner'
export const OWNER_HEADERS = [OWNER_HEADER, OLD_OWNER_HEADER] as const

// Four cookie names: a session from any of them is valid, new sessions get the
// new name, sign-out clears all four.
export const COOKIE_PLAIN = 'halm_session'
export const COOKIE_SECURE = '__Host-halm_session'
export const OLD_COOKIE_PLAIN = 'mnemosyne_session'
export const OLD_COOKIE_SECURE = '__Host-mnemosyne_session'
export const COOKIE_NAMES = [COOKIE_SECURE, COOKIE_PLAIN, OLD_COOKIE_SECURE, OLD_COOKIE_PLAIN] as const

// ---- Names that stay in 0.38 (3.5 item 2, F-m3, A-m5) ----

// bin/remote.ts keeps writing "mnemosyne ..." on stderr in 0.38; every
// stripper accepts both spellings, so a later release can switch the writer.
export const STDERR_NAME = 'mnemosyne'
export const STDERR_NAMES = ['mnemosyne', 'hal-m'] as const

export const KEPT = {
  // bin/remote.ts stderr text: "mnemosyne server unreachable: ...".
  stderrName: STDERR_NAME,
  // The MCP serverInfo.name the proxy and the remote client report.
  serverInfoName: 'mnemosyne',
  // The id of the rules section the hook adds to the session.
  rulesSectionId: 'mnemosyne:rules',
  // memory_stats replies: { provider: 'mnemosyne', ... }.
  statsProvider: 'mnemosyne',
  // Activity-log client labels written by the plugin (mnemosyne-knowledge,
  // -tags, -import, -session, -sweep); readers accept both prefixes.
  clientLabelPrefix: 'mnemosyne-',
} as const
export const CLIENT_LABEL_PREFIXES = ['mnemosyne-', 'hal-m-'] as const
export const isOwnClientLabel = (client: unknown) =>
  typeof client === 'string' && CLIENT_LABEL_PREFIXES.some(prefix => client.startsWith(prefix))

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Text without a leading "mnemosyne <label>: " or "hal-m <label>: " (case
 * ignored). With no label, any "mnemosyne...: " or "hal-m...: " up to the first
 * colon goes. Text with neither prefix comes back unchanged.
 */
export function stripStderrPrefix(text: string, label?: string) {
  const names = STDERR_NAMES.map(escapeRegExp).join('|')
  const pattern = label === undefined ? `^(?:${names})(?=[\\s:])[^:]*:\\s*` : `^(?:${names}) ${escapeRegExp(label)}:\\s*`
  return text.replace(new RegExp(pattern, 'i'), '')
}

// ---- Environment (3.3) ----

export const ENV_PREFIX = 'HALM_'
export const OLD_ENV_PREFIX = 'MNEMOSYNE_'

// The 34 names of 0.37 (inventory 1d) plus NO_MIGRATE, new in 0.38.
export const ENV_NAMES = [
  'ACTIVITY_APPEND', 'ACTIVITY_LOG', 'BIND', 'BUILD_EMBEDDINGS', 'CAPTURE', 'CLAUDE_CLI', 'CLI', 'DATA',
  'DEV_ENGINE', 'EMBED_CACHE_HOME', 'EMBEDDINGS', 'EXPIRE_UNUSED_DAYS', 'EXTRACTION', 'GUARD_MODE', 'HOME',
  'HOSTS', 'LOCK_WAIT_MS', 'MODEL_CACHE', 'OWNER', 'PLUGIN_ID', 'PLUGIN_ROOT', 'PORT', 'PUBLIC_URL', 'ROOT',
  'SECURE_COOKIE', 'STORE', 'UI_DEV', 'UI_PARENT_CHECK_MS', 'UI_PASSWORD', 'UI_PORT', 'UI_TOKEN',
  'UPDATE_CMD', 'UPDATE_CWD', 'VOCABULARY', 'NO_MIGRATE',
] as const
export type EnvName = (typeof ENV_NAMES)[number]

export const envKey = (name: EnvName) => `${ENV_PREFIX}${name}`
export const oldEnvKey = (name: EnvName) => `${OLD_ENV_PREFIX}${name}`

// Names whose empty value is a value: ACTIVITY_LOG empty means "log off" and
// wins over an inherited old-name path. For every other name an empty value
// means "not set" (compose passes empty strings for unset values).
export const EMPTY_IS_VALUE: ReadonlySet<EnvName> = new Set<EnvName>(['ACTIVITY_LOG'])

export type EnvSource = Readonly<Record<string, string | undefined>> | ((key: string) => string | undefined)
const readSource = (source: EnvSource, key: string) => (typeof source === 'function' ? source(key) : source[key])

/** The value of a name from its two spellings, new first, by the empty-value rule above. */
export function pickEnv(name: EnvName, value: string | undefined, oldValue: string | undefined): string | undefined {
  const counts = (v: string | undefined) => v !== undefined && (v !== '' || EMPTY_IS_VALUE.has(name))
  if (counts(value)) return value
  if (counts(oldValue)) return oldValue
  return undefined
}

/** HALM_<name>, then MNEMOSYNE_<name>; undefined when neither counts as set. */
export const envOf = (name: EnvName, source: EnvSource) =>
  pickEnv(name, readSource(source, envKey(name)), readSource(source, oldEnvKey(name)))

/** envOf over an async reader such as a hook's $.env.get. */
export async function envOfAsync(name: EnvName, read: (key: string) => Promise<string | undefined> | string | undefined) {
  const [value, oldValue] = await Promise.all([read(envKey(name)), read(oldEnvKey(name))])
  return pickEnv(name, value ?? undefined, oldValue ?? undefined)
}

/**
 * A child process environment built by a Bun-side parent: the parent's own
 * environment, each given name set under the new spelling and its old spelling
 * deleted, so the child can never read a stale inherited value. Names not
 * given pass through as the parent has them.
 */
export function childEnv(parent: Readonly<Record<string, string | undefined>>, values: Partial<Record<EnvName, string>>) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) if (value !== undefined) env[key] = value
  for (const [name, value] of Object.entries(values) as [EnvName, string | undefined][]) {
    if (value === undefined) continue
    env[envKey(name)] = value
    delete env[oldEnvKey(name)]
  }
  return env
}

/**
 * The variables a hook sets for a child: a hook cannot delete an inherited
 * variable ($.process.run only sets values over the host's environment), so
 * both spellings get the same value.
 */
export function hookChildEnv(values: Partial<Record<EnvName, string>>) {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(values) as [EnvName, string | undefined][]) {
    if (value === undefined) continue
    env[envKey(name)] = value
    env[oldEnvKey(name)] = value
  }
  return env
}

/** HALM_NO_MIGRATE (or the old spelling) set to anything but 0 turns the root link off (3.2 item 7). */
export function migrationOff(source: EnvSource) {
  const value = envOf('NO_MIGRATE', source)
  return value !== undefined && value.trim() !== '0'
}

// ---- Data root (3.2) ----

export const NEW_ROOT_DIR = '.hal-m'
export const OLD_ROOT_REL = '.claude/mnemosyne'
// The memoryDir /mnemosyne-setup wrote into settings in 0.37: counts as "default" (3.2 item 5).
export const OLD_DEFAULT_MEMORY_DIR = '~/.claude/mnemosyne/store'
export const DEFAULT_MEMORY_DIR = '~/.hal-m/store'
// 0.37's PI_CONFIG_DIR, relative to HOME, baked into old launchers.
export const OLD_MODEL_CACHE_REL = '.claude/mnemosyne/model-cache'

// A path's separator: backslash only for a path that has backslashes and no slash.
const sepOf = (path: string) => (path.includes('\\') && !path.includes('/') ? '\\' : '/')
const trimEnd = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, '') : path)

/** base + parts, joined with base's own separator. */
export function joinPath(base: string, ...parts: string[]) {
  const sep = sepOf(base)
  const head = trimEnd(base)
  return [head === '/' || head === '\\' ? '' : head, ...parts].join(sep) || sep
}

export const oldRootOf = (home: string) => joinPath(home, '.claude', 'mnemosyne')
export const newRootOf = (home: string) => joinPath(home, NEW_ROOT_DIR)
/** The model cache (PI_CONFIG_DIR) under a root: a function of the root, not a constant (F-B3, A-B4). */
export const modelCacheDir = (root: string) => joinPath(root, 'model-cache')

const isWindowsPath = (path: string) => /^[A-Za-z]:/.test(path) || path.startsWith('\\\\')
const fold = (path: string, windows: boolean) => {
  const flat = trimEnd(path.replace(/\\/g, '/'))
  return windows ? flat.toLowerCase() : flat
}

export type RootState =
  | 'explicit' // HALM_ROOT, MNEMOSYNE_ROOT or --root: used as given, never linked
  | 'old-only' // row 1: only the old root, no link yet
  | 'new-links-old' // row 2: the new path is a link to the old root
  | 'old-links-new' // row 3: the old path is a link to the new root
  | 'same-folder' // rows 2-3 when neither reports as a link but the real paths match (a junction the host does not report)
  | 'new-only' // row 4: only the new root
  | 'fresh' // row 5: neither exists; the only row that creates the default new root
  | 'both-real' // row 6: two real folders
  | 'foreign-link' // row 7: a link to somewhere else, a dangling link, or something that is not a folder

export type RootDecision = {
  root: string
  state: RootState
  oldRoot: string
  newRoot: string
  // Create the root folder (only 'fresh').
  create: boolean
  // bin/migrate-root.ts may link newRoot -> oldRoot (only 'old-only').
  link: boolean
  // Shown at every start until a person resolves it.
  warning?: string
}

/** What one path looks like: an entry there at all, a link, a folder (following links), its real path, a store inside. */
export type PathFacts = { present: boolean; link: boolean; dir: boolean; real: string | null; store: boolean }

export type RootOptions = {
  // A root from an explicit setting: HALM_ROOT, MNEMOSYNE_ROOT or a --root flag.
  explicit?: string
  // 'win32' compares real paths without case; default: from the home path.
  platform?: string
}

/** The state table of 3.2 item 1, over facts already gathered. Pure. */
export function decideRoot(home: string, facts: { old: PathFacts; new: PathFacts }, options: RootOptions = {}): RootDecision {
  const oldRoot = oldRootOf(home)
  const newRoot = newRootOf(home)
  const base = { oldRoot, newRoot, create: false, link: false }
  const explicit = options.explicit?.trim()
  if (explicit) return { ...base, root: explicit, state: 'explicit' }
  const windows = options.platform === undefined ? isWindowsPath(home) : options.platform === 'win32'
  const o = facts.old
  const n = facts.new
  const oExists = o.dir && o.real !== null
  const nExists = n.dir && n.real !== null
  // Two folders are the same when their real paths are equal, not only when one reports as a link (R1).
  if (oExists && nExists && fold(o.real!, windows) === fold(n.real!, windows)) {
    return { ...base, root: newRoot, state: n.link ? 'new-links-old' : o.link ? 'old-links-new' : 'same-folder' }
  }
  if (!o.present && !n.present) return { ...base, root: newRoot, state: 'fresh', create: true }
  // A new path that is a link the person placed (say, to another disk), with no old root: just "only new".
  if (n.link && nExists && !o.present) return { ...base, root: newRoot, state: 'new-only' }
  if (o.link || n.link || (o.present && !oExists) || (n.present && !nExists)) {
    const root = oExists ? oldRoot : nExists ? newRoot : oldRoot
    const what = (path: string, f: PathFacts) =>
      f.link ? (f.real === null ? `${path} is a dangling link` : `${path} is a link to ${f.real}`) : `${path} is not a folder`
    const odd = [...(o.link || (o.present && !oExists) ? [what(oldRoot, o)] : []), ...(n.link || (n.present && !nExists) ? [what(newRoot, n)] : [])]
    return { ...base, root, state: 'foreign-link', warning: `HAL-M data folder: ${odd.join('; ')}. Using ${root} and changing nothing; fix the link by hand.` }
  }
  if (oExists && !n.present) return { ...base, root: oldRoot, state: 'old-only', link: true }
  if (nExists && !o.present) return { ...base, root: newRoot, state: 'new-only' }
  // Both real and different: never pick silently. The one holding a store; else the old root.
  const root = n.store && !o.store ? newRoot : oldRoot
  const stores = o.store && n.store ? 'both hold a store' : o.store ? `only ${oldRoot} holds a store` : n.store ? `only ${newRoot} holds a store` : 'neither holds a store'
  return {
    ...base,
    root,
    state: 'both-real',
    warning: `HAL-M data folder: ${oldRoot} and ${newRoot} are two real folders (${stores}). Using ${root}. Merge or remove one by hand; nothing was deleted.`,
  }
}

/** The file calls the resolver needs. lstat does not follow links; stat does. Each answers null when nothing is there. */
export type RootFs = {
  lstat(path: string): { link: boolean } | null
  stat(path: string): { dir: boolean } | null
  realpath(path: string): string | null
}
type Maybe<T> = T | Promise<T>
export type AsyncRootFs = { [K in keyof RootFs]: (path: string) => Maybe<ReturnType<RootFs[K]>> }

function facts(lstat: { link: boolean } | null, stat: { dir: boolean } | null, real: string | null, store: { dir: boolean } | null): PathFacts {
  return { present: lstat !== null, link: lstat?.link === true, dir: stat?.dir === true, real, store: store?.dir === true }
}

/** The data root from the disk, synchronously (Bun entry points). */
export function resolveRootSync(fs: RootFs, home: string, options: RootOptions = {}): RootDecision {
  if (options.explicit?.trim()) return decideRoot(home, { old: facts(null, null, null, null), new: facts(null, null, null, null) }, options)
  const look = (path: string) => facts(fs.lstat(path), fs.stat(path), fs.realpath(path), fs.stat(joinPath(path, 'store')))
  return decideRoot(home, { old: look(oldRootOf(home)), new: look(newRootOf(home)) }, options)
}

/** The data root from the disk over an async file API. */
export async function resolveRoot(fs: AsyncRootFs, home: string, options: RootOptions = {}): Promise<RootDecision> {
  if (options.explicit?.trim()) return decideRoot(home, { old: facts(null, null, null, null), new: facts(null, null, null, null) }, options)
  const look = async (path: string) => {
    const [l, s, r, st] = await Promise.all([fs.lstat(path), fs.stat(path), fs.realpath(path), fs.stat(joinPath(path, 'store'))])
    return facts(l, s, r, st)
  }
  const [o, n] = await Promise.all([look(oldRootOf(home)), look(newRootOf(home))])
  return decideRoot(home, { old: o, new: n }, options)
}

/**
 * A path at or under the old root, moved onto the resolved root (3.2 item 5).
 * Takes the absolute form (either separator), the ~/ form and the form relative
 * to HOME (0.37's PI_CONFIG_DIR). Anything else comes back unchanged, as does a
 * path that only shares a prefix (~/.claude/mnemosyne-ui).
 */
export function rebasePath(path: string, home: string, root: string, options: { platform?: string } = {}) {
  if (typeof path !== 'string' || path === '') return path
  const windows = options.platform === undefined ? isWindowsPath(home) || isWindowsPath(root) : options.platform === 'win32'
  const flat = path.replace(/\\/g, '/')
  const cmp = (text: string) => (windows ? text.toLowerCase() : text)
  const old = fold(oldRootOf(home), false)
  const prefixes = [old, `~/${OLD_ROOT_REL}`, OLD_ROOT_REL]
  for (const prefix of prefixes) {
    const head = flat.slice(0, prefix.length)
    const tail = flat.slice(prefix.length)
    if (cmp(head) !== cmp(prefix) || (tail !== '' && !tail.startsWith('/'))) continue
    const rest = tail.replace(/^\/+/, '')
    return rest === '' ? trimEnd(root) : joinPath(root, ...rest.split('/').filter(Boolean))
  }
  return path
}

/** A stored memoryDir that means "the default store": empty, or either default literal (3.2 item 5). */
export function isDefaultMemoryDir(value: unknown) {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string') return false
  const flat = trimEnd(value.trim().replace(/\\/g, '/'))
  return flat === '' || flat === OLD_DEFAULT_MEMORY_DIR || flat === DEFAULT_MEMORY_DIR
}

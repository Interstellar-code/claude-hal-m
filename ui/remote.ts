// Server mode (docs/plans/remote-server.md): the pieces ui/server.ts adds when it runs as a
// long-lived service in a container (`bun ui/server.ts --server`), reached over Tailscale.
//
//   - the dashboard password: a stateless session cookie signed with a key made from the
//     password and <root>/server-secret, so a restart keeps browsers signed in and a new
//     password signs every one of them out; 5 wrong tries in a row pause logins for 60 s.
//   - device keys: <root>/keys.json (0600) holds only the SHA-256 of each key, made and revoked
//     from the dashboard (cookie only, never with a key).
//   - the plugin routes (/api/plugin/*): the Claude Code plugin in client mode sends the engine
//     requests it would have run locally; only the eight engine tools the plugin uses pass.
//   - /mcp: Streamable HTTP for other MCP clients, stateless; each POST runs bin/mcp-proxy.ts
//     once, so a save keeps the proxy's provenance (mcp:<device>, EXTERNAL_WRITE) and its guard.
//
// Nothing here logs a key, a password or a cookie.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { callOutcome, callText } from '../hooks/activity-log'
import type { ActivityAction, ActivityFields } from '../hooks/activity-log'
import { engineEnv } from '../hooks/engine'
import { EMBEDDINGS_MODEL } from '../hooks/engine'
import { PROJECTS_FILE } from '../hooks/projects'
import { expireSetting, SESSION_ID } from '../hooks/session'
import type { ExpireSetting } from '../hooks/session'
import { VOCAB_FILE } from '../hooks/vocab'

const IS_WINDOWS = process.platform === 'win32'

export type ServerMode = {
  password: string
  port: number
  bind: string
  // Allowed Host header values; empty allows any (Tailscale already limits who can connect).
  hosts: string[]
  publicUrl: string
  secureCookie: 'auto' | 'on' | 'off'
  modelCacheDir: string | undefined
  // The daily unused-expiry sweep: MNEMOSYNE_EXPIRE_UNUSED_DAYS (90 by default, 0 off), the plugin's expireUnusedDays rule.
  expire: ExpireSetting
}

export const DEFAULT_SERVER_PORT = 8787
export const MIN_PASSWORD = 8
export const SESSION_DAYS = 30
export const LOGIN_MAX_FAILURES = 5
export const LOGIN_PAUSE_MS = 60_000
export const KEY_MAX_FAILURES = 20
export const KEY_WINDOW_MS = 60_000
export const KEY_NAME_MAX = 60
export const KEYS_FILE = 'keys.json'
export const SECRET_FILE = 'server-secret'
export const LAST_USED_EVERY_MS = 60_000
export const PLUGIN_BODY_MAX = 256 * 1024
export const PLUGIN_ENGINE_TIMEOUT_MS = 60_000
export const MCP_TIMEOUT_MS = 60_000

/** The engine tools the plugin's own requests use; anything else (export, sleep, shared_*) never runs from a key. */
export const PLUGIN_TOOLS: ReadonlySet<string> = new Set([
  'mnemopi_remember',
  'mnemopi_recall',
  'mnemopi_update',
  'mnemopi_forget',
  'mnemopi_get',
  'mnemopi_stats',
  'mnemopi_similar',
  'mnemopi_invalidate',
])
export const PLUGIN_MEMORIES_COMMANDS: ReadonlySet<string> = new Set(['first-prompt', 'row-info'])
export const OWNER = /^(?:global|project-[A-Za-z0-9_-]{1,300})$/

/** Server mode from the environment, or an Error naming what is wrong. */
export function serverModeFromEnv(env: Record<string, string | undefined>): ServerMode | Error {
  const password = env.MNEMOSYNE_UI_PASSWORD ?? ''
  if (password.length < MIN_PASSWORD) return new Error(`MNEMOSYNE_UI_PASSWORD must be set to at least ${MIN_PASSWORD} characters.`)
  const port = env.MNEMOSYNE_PORT ? Number(env.MNEMOSYNE_PORT) : DEFAULT_SERVER_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) return new Error('MNEMOSYNE_PORT must be a port number.')
  const secure = (env.MNEMOSYNE_SECURE_COOKIE ?? 'auto').trim().toLowerCase()
  const publicUrl = (env.MNEMOSYNE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
  if (publicUrl !== '' && !/^https?:\/\/[^\s/]+$/.test(publicUrl)) return new Error('MNEMOSYNE_PUBLIC_URL must be like https://hal-m.example.ts.net (no path).')
  const expire = expireSetting(env.MNEMOSYNE_EXPIRE_UNUSED_DAYS)
  if (expire.mode === 'refused') return new Error(`MNEMOSYNE_EXPIRE_UNUSED_DAYS: ${expire.reason}`)
  return {
    expire,
    password,
    port,
    bind: env.MNEMOSYNE_BIND || '0.0.0.0',
    hosts: (env.MNEMOSYNE_HOSTS ?? '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
    publicUrl,
    secureCookie: secure === '1' || secure === 'on' || secure === 'true' ? 'on' : secure === '0' || secure === 'off' || secure === 'false' ? 'off' : 'auto',
    modelCacheDir: env.MNEMOSYNE_MODEL_CACHE || undefined,
  }
}

// ---- files: written to a temp file, then renamed over the old one, owner-only ----

function writePrivate(file: string, text: string) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  rmSync(temp, { force: true })
  writeFileSync(temp, text, { mode: 0o600, flag: 'wx' })
  if (!IS_WINDOWS) chmodSync(temp, 0o600)
  renameSync(temp, file)
}

/** <root>/server-secret: 32 random bytes made once; the session key is derived from it and the password. */
export function serverSecret(root: string): Buffer {
  const file = join(root, SECRET_FILE)
  try {
    const text = readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9_-]{43,}$/.test(text)) return Buffer.from(text, 'base64url')
  } catch {
    // none yet
  }
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const secret = randomBytes(32)
  writePrivate(file, `${secret.toString('base64url')}\n`)
  return secret
}

const sameBytes = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ---- the dashboard session ----

export const COOKIE_PLAIN = 'mnemosyne_session'
// The __Host- prefix makes the browser refuse a cookie that is not Secure, host-only and Path=/.
export const COOKIE_SECURE = '__Host-mnemosyne_session'

export type Sessions = {
  issue(now?: number): string
  valid(value: string | undefined, now?: number): boolean
}

export function sessions(secret: Buffer, password: string, days = SESSION_DAYS): Sessions {
  const key = createHmac('sha256', secret).update(`session:${password}`).digest()
  const sign = (expires: string) => createHmac('sha256', key).update(expires).digest('base64url')
  return {
    issue(now = Date.now()) {
      const expires = String(now + days * 86_400_000)
      return `${expires}.${sign(expires)}`
    },
    valid(value, now = Date.now()) {
      const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(value ?? '')
      if (!match?.[1] || !match[2]) return false
      if (Number(match[1]) <= now) return false
      return sameBytes(match[2], sign(match[1]))
    },
  }
}

/** The value of cookie `name` in a Cookie header, or undefined. */
export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * Whether the browser reached this server over HTTPS: an X-Forwarded-Proto of https, or a *.ts.net name
 * (Tailscale serve gives those names their HTTPS certificate and may not send the header).
 */
export function viaHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')
  if (proto) return proto.toLowerCase() === 'https'
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '')
  return host.endsWith('.ts.net') || new URL(request.url).protocol === 'https:'
}

/** Whether the session cookie is Secure: the setting, or (auto) whether this request came over HTTPS. */
export function isSecure(mode: Pick<ServerMode, 'secureCookie'>, request: Request): boolean {
  if (mode.secureCookie === 'on') return true
  if (mode.secureCookie === 'off') return false
  return viaHttps(request)
}

export function sessionCookie(value: string, secure: boolean, days = SESSION_DAYS) {
  return `${secure ? COOKIE_SECURE : COOKIE_PLAIN}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${days * 86_400}${secure ? '; Secure' : ''}`
}

export function clearCookies(): string[] {
  return [`${COOKIE_PLAIN}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, `${COOKIE_SECURE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`]
}

/** A signed-in request: either cookie name carries a valid session. */
export function signedIn(request: Request, store: Sessions): boolean {
  const header = request.headers.get('cookie')
  return store.valid(cookieValue(header, COOKIE_SECURE)) || store.valid(cookieValue(header, COOKIE_PLAIN))
}

/** Wrong passwords in a row pause logins; a right one resets the count. */
export function loginLimiter(maxFailures = LOGIN_MAX_FAILURES, pauseMs = LOGIN_PAUSE_MS) {
  let failures = 0
  let until = 0
  return {
    /** Milliseconds left in the pause, or 0. */
    paused(now = Date.now()) {
      return until > now ? until - now : 0
    },
    failed(now = Date.now()) {
      failures += 1
      if (failures >= maxFailures) {
        failures = 0
        until = now + pauseMs
      }
    },
    passed() {
      failures = 0
      until = 0
    },
  }
}

/** Constant-time password check: both sides hashed first, so the length does not show. */
export function passwordMatches(given: unknown, password: string): boolean {
  if (typeof given !== 'string') return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(password).digest()
  return timingSafeEqual(a, b)
}

// ---- device keys ----

export type KeyRecord = { id: string; name: string; hash: string; created: string; lastUsed: string | null }
export type KeyView = Omit<KeyRecord, 'hash'>
const KEY_SHAPE = /^mn_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/
const KEY_CONTROL = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁦-⁩﻿]/g

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

/** A device name as stored: control and direction characters removed, trimmed, 1 to 60 code points; else undefined. */
export function cleanKeyName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const clean = Array.from(name.replace(KEY_CONTROL, '').trim()).slice(0, KEY_NAME_MAX).join('').trim()
  return clean === '' ? undefined : clean
}

export type Keys = ReturnType<typeof deviceKeys>

export function deviceKeys(root: string) {
  const file = join(root, KEYS_FILE)
  const read = (): KeyRecord[] => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { keys?: unknown }
      if (!Array.isArray(parsed?.keys)) return []
      return parsed.keys.filter(
        (k): k is KeyRecord =>
          k !== null && typeof k === 'object' && typeof k.id === 'string' && typeof k.name === 'string' && typeof k.hash === 'string' && typeof k.created === 'string',
      )
    } catch {
      return []
    }
  }
  const write = (keys: KeyRecord[]) => {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    writePrivate(file, `${JSON.stringify({ keys }, null, 2)}\n`)
  }
  const lastTouched = new Map<string, number>()
  return {
    list(): KeyView[] {
      return read().map(({ hash: _hash, ...view }) => ({ ...view, lastUsed: view.lastUsed ?? null }))
    },
    create(name: string, now = new Date()): KeyView & { key: string } {
      const keys = read()
      let id = randomBytes(6).toString('base64url')
      while (keys.some(k => k.id === id)) id = randomBytes(6).toString('base64url')
      const key = `mn_${id}_${randomBytes(32).toString('base64url')}`
      const record: KeyRecord = { id, name, hash: hashKey(key), created: now.toISOString(), lastUsed: null }
      write([...keys, record])
      return { id, name, created: record.created, lastUsed: null, key }
    },
    revoke(id: string): boolean {
      const keys = read()
      const left = keys.filter(k => k.id !== id)
      if (left.length === keys.length) return false
      write(left)
      return true
    },
    /** The key's record when `key` is a live device key; lastUsed is written at most once a minute per key. */
    verify(key: string | undefined, now = Date.now()): KeyView | undefined {
      const match = KEY_SHAPE.exec(key ?? '')
      if (!match?.[1] || key === undefined) return undefined
      const keys = read()
      const record = keys.find(k => k.id === match[1])
      if (record === undefined || !sameBytes(record.hash, hashKey(key))) return undefined
      if (now - (lastTouched.get(record.id) ?? 0) >= LAST_USED_EVERY_MS) {
        lastTouched.set(record.id, now)
        record.lastUsed = new Date(now).toISOString()
        try {
          write(keys)
        } catch {
          // a read-only moment must not refuse a valid key
        }
      }
      const { hash: _hash, ...view } = record
      return view
    },
  }
}

/** Bad keys in a sliding minute; past the cap the plugin routes answer 429 until the window moves on. */
export function badKeyLimiter(max = KEY_MAX_FAILURES, windowMs = KEY_WINDOW_MS) {
  let stamps: number[] = []
  return {
    blocked(now = Date.now()) {
      stamps = stamps.filter(t => now - t < windowMs)
      return stamps.length >= max
    },
    failed(now = Date.now()) {
      stamps.push(now)
    },
  }
}

export const bearerOf = (request: Request) => /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1]

// ---- running the engine and the plugin's scripts ----

export type RawRun = { stdout: string; stderr: string; exitCode: number | null }

export type RunContext = {
  root: string
  store: string
  cli: string
  pluginRoot: string
  activityLog: string
  embeddings: boolean
  modelCacheDir: string | undefined
}

async function spawnText(argv: string[], input: string, env: Record<string, string | undefined>, timeoutMs: number): Promise<RawRun> {
  const child = Bun.spawn(argv, { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), timeoutMs)
  try {
    child.stdin.write(input)
    await child.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { stdout, stderr: stderr.slice(-4000), exitCode }
  } finally {
    clearTimeout(timer)
  }
}

/** Why a plugin engine body is refused, or the checked owner and request text. */
export function checkEngineBody(body: unknown): { owner: string; requests: string; timeoutMs: number } | string {
  if (body === null || typeof body !== 'object') return 'the body must be a JSON object'
  const { owner, requests, timeoutMs } = body as Record<string, unknown>
  if (typeof owner !== 'string' || !OWNER.test(owner)) return 'owner must be global or a project-... id'
  if (typeof requests !== 'string' || requests.trim() === '') return 'requests must be the engine request lines'
  const lines = requests.split('\n').filter(line => line.trim() !== '')
  if (lines.length > 200) return 'too many requests in one call'
  for (const line of lines) {
    let message: { method?: unknown; params?: { name?: unknown } }
    try {
      message = JSON.parse(line)
    } catch {
      return 'every request line must be JSON'
    }
    if (message?.method !== 'tools/call' || typeof message.params?.name !== 'string' || !PLUGIN_TOOLS.has(message.params.name)) {
      return `only these engine tools can be called: ${[...PLUGIN_TOOLS].join(', ')}`
    }
  }
  const wait = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.min(Math.max(1_000, Math.round(timeoutMs)), PLUGIN_ENGINE_TIMEOUT_MS) : PLUGIN_ENGINE_TIMEOUT_MS
  return { owner, requests: lines.map(line => `${line}\n`).join(''), timeoutMs: wait }
}

export function runPluginEngine(ctx: RunContext, owner: string, requests: string, timeoutMs: number) {
  const env = { ...process.env, ...engineEnv(ctx.store, owner, { embeddings: ctx.embeddings, ...(ctx.modelCacheDir ? { modelCacheDir: ctx.modelCacheDir } : {}) }) }
  return spawnText([process.execPath, ctx.cli, 'mcp'], requests, env, timeoutMs)
}

export function checkMemoriesBody(body: unknown): string[] | string {
  const args = (body as { args?: unknown } | null)?.args
  if (!Array.isArray(args) || args.length < 2 || args.length > 3 || !args.every(a => typeof a === 'string' && a.length <= 400 && !a.startsWith('-'))) {
    return 'args must be [command, ...] with first-prompt or row-info'
  }
  if (!PLUGIN_MEMORIES_COMMANDS.has(args[0])) return 'only first-prompt and row-info run from a PC'
  return args as string[]
}

export function runPluginMemories(ctx: RunContext, args: readonly string[]) {
  return spawnText([process.execPath, join(ctx.pluginRoot, 'bin', 'memories.ts'), '--store', ctx.store, ...args], '', process.env, 20_000)
}

/** A PC's project record (name, kind, remote host and hash) into <root>/projects.json, through its one writer. */
export function runPluginProject(ctx: RunContext, input: unknown) {
  if (input === null || typeof input !== 'object') return Promise.resolve({ stdout: '', stderr: 'input must be a JSON object', exitCode: 1 })
  return spawnText([process.execPath, join(ctx.pluginRoot, 'bin', 'projects.ts'), 'write', join(ctx.root, PROJECTS_FILE)], JSON.stringify(input), process.env, 10_000)
}

export function runPluginResolve(ctx: RunContext, input: unknown) {
  if (input === null || typeof input !== 'object') return Promise.resolve({ stdout: '', stderr: 'input must be a JSON object', exitCode: 1 })
  return spawnText([process.execPath, join(ctx.pluginRoot, 'bin', 'projects.ts'), 'resolve', join(ctx.root, PROJECTS_FILE), ctx.store], JSON.stringify(input), process.env, 10_000)
}

// ---- /mcp: one proxy run per POST ----

/** The proxy's environment, as the externalMcp launcher sets it (hooks/launcher.ts), for one owner. */
export function proxyEnv(ctx: RunContext, owner: string): Record<string, string | undefined> {
  return {
    ...process.env,
    ...engineEnv(ctx.store, owner, { embeddings: ctx.embeddings, ...(ctx.modelCacheDir ? { modelCacheDir: ctx.modelCacheDir } : {}) }),
    MNEMOPI_EMBEDDING_MODEL: EMBEDDINGS_MODEL,
    MNEMOSYNE_CLI: ctx.cli,
    MNEMOSYNE_ACTIVITY_LOG: ctx.activityLog,
    MNEMOSYNE_GUARD_MODE: 'strict',
    MNEMOSYNE_VOCABULARY: join(ctx.root, VOCAB_FILE),
    MNEMOSYNE_ROOT: ctx.root,
  }
}

type JsonRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/**
 * One MCP POST: a message or a batch. Notifications get no reply (202 when nothing else is left).
 * Every request runs through the proxy after a synthetic initialize, so the proxy names the
 * device as its client and keeps its usual checks.
 */
export async function handleMcp(ctx: RunContext, device: string, owner: string, payload: unknown, timeoutMs = MCP_TIMEOUT_MS): Promise<{ status: number; body?: unknown }> {
  const batch = Array.isArray(payload)
  const messages = (batch ? payload : [payload]) as JsonRpc[]
  if (messages.length === 0 || messages.length > 50) return { status: 400, body: rpcError(null, -32600, 'Invalid Request') }
  const replies: unknown[] = []
  const forward: JsonRpc[] = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (message && typeof message === 'object' && 'id' in message && ('result' in message || 'error' in message)) continue
      replies.push(rpcError((message as JsonRpc | null)?.id, -32600, 'Invalid Request'))
      continue
    }
    const isNotification = !('id' in message)
    if (isNotification) continue
    if (message.method === 'initialize') {
      const asked = (message.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
      replies.push({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: typeof asked === 'string' ? asked : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mnemosyne', version: '1' },
        },
      })
      continue
    }
    if (message.method === 'ping') {
      replies.push({ jsonrpc: '2.0', id: message.id, result: {} })
      continue
    }
    forward.push(message)
  }
  if (forward.length > 0) {
    // Ids the proxy sees are ours (1..n), so a client id can never collide with the synthetic initialize (0).
    const lines = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: device, version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...forward.map((message, i) => ({ jsonrpc: '2.0', id: i + 1, method: message.method, ...(message.params === undefined ? {} : { params: message.params }) })),
    ]
    const ran = await spawnText([process.execPath, join(ctx.pluginRoot, 'bin', 'mcp-proxy.ts')], lines.map(line => `${JSON.stringify(line)}\n`).join(''), proxyEnv(ctx, owner), timeoutMs)
    const got = new Map<number, Record<string, unknown>>()
    for (const line of ran.stdout.split('\n')) {
      try {
        const reply = JSON.parse(line) as Record<string, unknown>
        if (typeof reply?.id === 'number') got.set(reply.id, reply)
      } catch {
        // proxy or engine chatter
      }
    }
    forward.forEach((message, i) => {
      const reply = got.get(i + 1)
      replies.push(reply === undefined ? rpcError(message.id, -32603, `the memory engine gave no reply (exit ${ran.exitCode})`) : { ...reply, id: message.id })
    })
  }
  if (replies.length === 0) return { status: 202 }
  return { status: 200, body: batch ? replies : replies[0] }
}

/** Whether a request's Origin names the same host the request was sent to (a POST from this page). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

/** The address copied into connection settings: the configured one, else the page's own origin. */
export function publicUrlOf(mode: Pick<ServerMode, 'publicUrl'>, request: Request): string {
  if (mode.publicUrl) return mode.publicUrl
  const host = request.headers.get('host') ?? new URL(request.url).host
  return `${viaHttps(request) ? 'https' : 'http'}://${host.replace(/:443$/, '')}`
}

export const hasStore = (store: string) => existsSync(join(store, 'mnemopi.db'))

// ---- the server's own upkeep: what a PC's session start did locally ----

export const UPKEEP_CHECK_MS = 60 * 60_000
export const UPKEEP_FIRST_MS = 60_000

/** The owners that hold rows in the store, read-only; none when there is no store yet. */
export function storeOwners(store: string): string[] {
  if (!hasStore(store)) return []
  const db = new Database(join(store, 'mnemopi.db'), { readonly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const rows = db.query("SELECT DISTINCT session_id AS owner FROM working_memory WHERE session_id IS NOT NULL AND session_id <> ''").all() as { owner: unknown }[]
    return rows.map(row => String(row.owner)).filter(owner => SESSION_ID.test(owner))
  } finally {
    db.close()
  }
}

export type UpkeepReport = { due: boolean; backup?: string; expired: { owner: string; count: number; ids: string[] }[]; error?: string }

/**
 * Once a day (the same <root>/sweep marker a PC's sweep uses, so a restart does not run it again): a backup of the store
 * (bin/memories.ts backup, keeping storage.backupsKeep copies), then the unused-expiry sweep for every owner with
 * MNEMOSYNE_EXPIRE_UNUSED_DAYS (90 by default; 0 turns the sweep off). A failed backup skips the sweep.
 */
export async function runUpkeep(ctx: RunContext, expire: ExpireSetting): Promise<UpkeepReport> {
  const script = join(ctx.pluginRoot, 'bin', 'memories.ts')
  const claim = await spawnText([process.execPath, script, 'sweep-claim', ctx.root], '', process.env, 10_000)
  let due = false
  try {
    due = (JSON.parse(claim.stdout) as { due?: unknown }).due === true
  } catch {
    return { due: false, expired: [], error: `sweep-claim failed: ${claim.stderr.trim().slice(0, 200)}` }
  }
  if (!due || !hasStore(ctx.store)) return { due, expired: [] }
  const backup = await spawnText([process.execPath, script, '--store', ctx.store, 'backup', ctx.root], '', process.env, 300_000)
  let path: string | undefined
  try {
    path = (JSON.parse(backup.stdout) as { path?: unknown }).path as string | undefined
  } catch {
    path = undefined
  }
  if (backup.exitCode !== 0 || typeof path !== 'string') return { due, expired: [], error: `backup failed: ${backup.stderr.trim().slice(0, 200)}` }
  const report: UpkeepReport = { due, backup: path, expired: [] }
  if (expire.mode !== 'on') return report
  for (const owner of storeOwners(ctx.store)) {
    const ran = await spawnText(
      [process.execPath, script, '--store', ctx.store, 'expire', '--apply', '--json', '--days', String(expire.days), '--owner', owner, '--root', ctx.root, '--cli', ctx.cli],
      '',
      process.env,
      300_000,
    )
    try {
      const out = JSON.parse(ran.stdout) as { count?: unknown; rows?: { id?: unknown }[] }
      const count = typeof out.count === 'number' ? out.count : 0
      if (count > 0) report.expired.push({ owner, count, ids: (out.rows ?? []).map(row => String(row?.id ?? '')).filter(Boolean) })
    } catch {
      report.error = `expire failed for ${owner}: ${ran.stderr.trim().slice(0, 200)}`
    }
  }
  return report
}

/** Starts the upkeep loop: a first look a minute after start, then hourly; the marker makes it daily. */
export function startUpkeep(ctx: RunContext, expire: ExpireSetting, log: (fields: ActivityFields) => void, firstMs = UPKEEP_FIRST_MS, everyMs = UPKEEP_CHECK_MS) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const report = await runUpkeep(ctx, expire)
      for (const done of report.expired) {
        log({ action: 'expire', origin: 'session', owner: done.owner, client: 'mnemosyne-sweep', text: `unused-expiry sweep: ${done.count} expired`, ids: done.ids, count: done.count, ok: true })
      }
      if (report.error) log({ action: 'expire', origin: 'session', owner: 'global', client: 'mnemosyne-sweep', text: 'server upkeep failed', ok: false, error: report.error })
    } catch {
      // the next tick tries again
    } finally {
      busy = false
    }
  }
  const first = setTimeout(() => void tick(), firstMs)
  const timer = setInterval(() => void tick(), everyMs)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}

// ---- activity lines for the plugin's engine calls (the PC keeps its own log; the server's dashboard reads this one) ----

const ENGINE_ACTIONS: Readonly<Record<string, ActivityAction>> = {
  mnemopi_remember: 'remember',
  mnemopi_recall: 'recall',
  mnemopi_update: 'update',
  mnemopi_forget: 'forget',
  mnemopi_get: 'get',
  mnemopi_stats: 'stats',
  mnemopi_invalidate: 'retire',
}

/**
 * One activity line per logged engine call of a plugin request: Claude's own call (client claude-code, so the map draws it
 * from Claude's writer), a remember the person asked for (source user) as a trigger. mnemopi_similar is the guard's look, not
 * a call of its own, and is left out, as the plugin leaves it out locally.
 */
export function pluginActivity(owner: string, requests: string, run: RawRun): ActivityFields[] {
  const replies = new Map<number, { text: string; failed?: string }>()
  for (const line of run.stdout.split('\n')) {
    try {
      const reply = JSON.parse(line) as { id?: unknown; error?: { message?: unknown }; result?: { isError?: unknown; content?: { text?: unknown }[] } }
      if (typeof reply?.id !== 'number') continue
      const text = String(reply.result?.content?.[0]?.text ?? '')
      replies.set(reply.id, reply.error ? { text: '', failed: String(reply.error.message ?? 'failed') } : reply.result?.isError ? { text, failed: text.slice(0, 200) || 'failed' } : { text })
    } catch {
      // engine chatter
    }
  }
  const lines: ActivityFields[] = []
  for (const line of requests.split('\n')) {
    let message: { id?: unknown; params?: { name?: unknown; arguments?: unknown } }
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    const action = ENGINE_ACTIONS[String(message.params?.name)]
    if (action === undefined) continue
    const args = (message.params?.arguments ?? {}) as Record<string, unknown>
    const reply = replies.get(Number(message.id))
    const outcome = reply === undefined ? { ok: false, ids: [], count: 0, error: `engine exited ${run.exitCode} without a reply` } : reply.failed !== undefined ? { ok: false, ids: [], count: 0, error: reply.failed } : callOutcome(action, args, reply.text)
    lines.push({ action, origin: action === 'remember' && args.source === 'user' ? 'trigger' : 'tool', owner, client: 'claude-code', text: callText(action, args), ...outcome })
  }
  return lines
}

// Server mode (docs/plans/remote-server.md): the dashboard password, device keys, the plugin's
// keyed routes and /mcp, run for real in-process against a temporary store made by the real
// engine (engine/src/cli.ts). Each server is started on a free port bound to 127.0.0.1.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildRequests } from '../../hooks/engine'
import {
  badKeyLimiter,
  checkEngineBody,
  checkMemoriesBody,
  cleanKeyName,
  cookieValue,
  deviceKeys,
  loginLimiter,
  passwordMatches,
  pluginActivity,
  publicUrlOf,
  runUpkeep,
  serverModeFromEnv,
  sessions,
  storeOwners,
  viaHttps,
} from '../../ui/remote'
import type { ServerMode } from '../../ui/remote'
import { startServer } from '../../ui/server'
import type { Started } from '../../ui/server'
import { engineCall, ROOT, tempDir, toolCall } from './helpers'

const CLI = join(ROOT, 'engine', 'src', 'cli.ts')
// A reply's JSON, loosely typed for the assertions.
// biome-ignore lint: test helper
const json = (response: Response): Promise<any> => response.json()
const PASSWORD = 'correct horse battery'

describe('server mode settings', () => {
  test('needs a password of 8+ characters and parses the rest', () => {
    expect(serverModeFromEnv({})).toBeInstanceOf(Error)
    expect(serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: 'short' })).toBeInstanceOf(Error)
    const mode = serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_HOSTS: 'A.ts.net, 7of9:8787', MNEMOSYNE_PUBLIC_URL: 'https://a.ts.net/', MNEMOSYNE_SECURE_COOKIE: 'off' }) as ServerMode
    expect(mode.port).toBe(8787)
    expect(mode.bind).toBe('0.0.0.0')
    expect(mode.hosts).toEqual(['a.ts.net', '7of9:8787'])
    expect(mode.publicUrl).toBe('https://a.ts.net')
    expect(mode.secureCookie).toBe('off')
    expect(serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_PUBLIC_URL: 'https://a.ts.net/path' })).toBeInstanceOf(Error)
    expect(serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_PORT: '99999' })).toBeInstanceOf(Error)
  })
})

describe('sessions and passwords', () => {
  const secret = Buffer.alloc(32, 7)
  test('a session is valid until it expires, and a new password ends it', () => {
    const store = sessions(secret, PASSWORD, 1)
    const value = store.issue(1_000_000_000_000)
    expect(store.valid(value, 1_000_000_000_001)).toBe(true)
    expect(store.valid(value, 1_000_000_000_000 + 86_400_001)).toBe(false)
    expect(sessions(secret, 'another password', 1).valid(value, 1_000_000_000_001)).toBe(false)
    expect(sessions(Buffer.alloc(32, 8), PASSWORD, 1).valid(value, 1_000_000_000_001)).toBe(false)
    expect(store.valid(`${value.slice(0, -1)}A`, 1_000_000_000_001)).toBe(value.endsWith('A'))
    expect(store.valid(undefined)).toBe(false)
  })
  test('password check and limiter', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true)
    expect(passwordMatches('nope', PASSWORD)).toBe(false)
    expect(passwordMatches(undefined, PASSWORD)).toBe(false)
    const limit = loginLimiter(3, 1000)
    limit.failed(0)
    limit.failed(0)
    expect(limit.paused(0)).toBe(0)
    limit.failed(0)
    expect(limit.paused(10)).toBe(990)
    expect(limit.paused(2000)).toBe(0)
    const bad = badKeyLimiter(2, 1000)
    bad.failed(0)
    bad.failed(0)
    expect(bad.blocked(10)).toBe(true)
    expect(bad.blocked(1500)).toBe(false)
  })
  test('https is seen from the forwarded header or a ts.net name', () => {
    const req = (host: string, proto?: string) => new Request(`http://${host}/`, { headers: { host, ...(proto ? { 'x-forwarded-proto': proto } : {}) } })
    expect(viaHttps(req('mnemosyne.tail1.ts.net'))).toBe(true)
    expect(viaHttps(req('7of9:8787'))).toBe(false)
    expect(viaHttps(req('7of9:8787', 'https'))).toBe(true)
    expect(publicUrlOf({ publicUrl: '' }, req('mnemosyne.tail1.ts.net'))).toBe('https://mnemosyne.tail1.ts.net')
    expect(publicUrlOf({ publicUrl: 'https://x.ts.net' }, req('7of9:8787'))).toBe('https://x.ts.net')
  })
  test('cookie parsing', () => {
    expect(cookieValue('a=1; mnemosyne_session=xyz; b=2', 'mnemosyne_session')).toBe('xyz')
    expect(cookieValue(null, 'x')).toBeUndefined()
  })
})

describe('device keys', () => {
  test('stores only hashes, verifies, revokes', () => {
    const root = tempDir('keys').dir
    const keys = deviceKeys(root)
    const made = keys.create('Laptop')
    expect(made.key).toMatch(/^mn_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/)
    const file = readFileSync(join(root, 'keys.json'), 'utf8')
    expect(file).not.toContain(made.key)
    if (process.platform !== 'win32') expect(statSync(join(root, 'keys.json')).mode & 0o777).toBe(0o600)
    expect(keys.verify(made.key)?.name).toBe('Laptop')
    expect(keys.list()[0]?.lastUsed).not.toBeNull()
    expect(keys.verify(`${made.key.slice(0, -1)}${made.key.endsWith('A') ? 'B' : 'A'}`)).toBeUndefined()
    expect(keys.verify('garbage')).toBeUndefined()
    expect(keys.revoke(made.id)).toBe(true)
    expect(keys.verify(made.key)).toBeUndefined()
    expect(keys.revoke(made.id)).toBe(false)
  })
  test('names are cleaned and bounded', () => {
    expect(cleanKeyName('  Work‮ PC ')).toBe('Work PC')
    expect(cleanKeyName('')).toBeUndefined()
    expect(cleanKeyName(5)).toBeUndefined()
    expect(Array.from(cleanKeyName('x'.repeat(100)) ?? '').length).toBe(60)
  })
})

describe('activity lines for plugin calls', () => {
  test('one line per logged call; similar is left out; a user save is a trigger', () => {
    const requests = buildRequests([
      ['mnemopi_similar', { content: 'x' }],
      ['mnemopi_remember', { content: 'Deploys are on Fridays.', source: 'user' }],
      ['mnemopi_recall', { query: 'deploys' }],
      ['mnemopi_forget', { memory_id: 'abc' }],
    ])
    const stdout = [
      { jsonrpc: '2.0', id: 1, result: { content: [{ text: '{"matches":[]}' }] } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ text: '{"status":"stored","memory_id":"m1"}' }] } },
      { jsonrpc: '2.0', id: 3, result: { content: [{ text: '{"results":[{"id":"m1"},{"id":"m2"}]}' }] } },
    ]
      .map(line => JSON.stringify(line))
      .join('\n')
    const lines = pluginActivity('global', requests, { stdout, stderr: '', exitCode: 0 })
    expect(lines.map(line => line.action)).toEqual(['remember', 'recall', 'forget'])
    expect(lines[0]).toMatchObject({ origin: 'trigger', client: 'claude-code', ok: true, ids: ['m1'] })
    expect(lines[1]).toMatchObject({ origin: 'tool', ok: true, count: 2 })
    expect(lines[2]?.ok).toBe(false)
  })
  test('the expiry setting comes from the environment', () => {
    expect((serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD }) as ServerMode).expire).toEqual({ mode: 'on', days: 90 })
    expect((serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_EXPIRE_UNUSED_DAYS: '0' }) as ServerMode).expire).toEqual({ mode: 'off' })
    expect(serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_EXPIRE_UNUSED_DAYS: '5' })).toBeInstanceOf(Error)
  })
})

describe('plugin body checks', () => {
  test('only the plugin engine tools pass', () => {
    const ok = checkEngineBody({ owner: 'global', requests: buildRequests([['mnemopi_recall', { query: 'x' }]]) })
    expect(typeof ok).toBe('object')
    expect(checkEngineBody({ owner: 'global', requests: buildRequests([['mnemopi_export', {}]]) })).toContain('only these engine tools')
    expect(checkEngineBody({ owner: 'someone', requests: buildRequests([['mnemopi_recall', {}]]) })).toContain('owner')
    expect(checkEngineBody({ owner: 'global', requests: '{"method":"initialize"}\n' })).toContain('only these engine tools')
    expect(checkMemoriesBody({ args: ['first-prompt', 'global', '5'] })).toEqual(['first-prompt', 'global', '5'])
    expect(checkMemoriesBody({ args: ['backup', '/tmp'] })).toContain('only first-prompt')
    expect(checkMemoriesBody({ args: ['row-info', '--store'] })).toContain('args must be')
  })
})

describe('the server, end to end', () => {
  let started: Started
  let base: string
  let root: string
  let store: string
  let activity: string
  const port = 18_000 + Math.floor(Math.random() * 20_000)

  beforeAll(async () => {
    const temp = tempDir('server-mode')
    root = join(temp.dir, 'root')
    store = join(temp.dir, 'store')
    activity = join(temp.dir, 'activity.jsonl')
    // The real engine makes the store, with one global memory to recall.
    await engineCall(CLI, store, 'global', [toolCall(1, 'mnemopi_remember', { content: 'We deploy the memory server on Fridays.', scope: 'global', memory_type: 'fact' })])
    const mode = serverModeFromEnv({ MNEMOSYNE_UI_PASSWORD: PASSWORD, MNEMOSYNE_PORT: String(port), MNEMOSYNE_BIND: '127.0.0.1', MNEMOSYNE_SECURE_COOKIE: 'off' }) as ServerMode
    started = await startServer({ root, store, cli: CLI, activityLog: activity, pluginRoot: ROOT, mode }, { warm: null, upkeep: false })
    base = `http://127.0.0.1:${started.port}`
  }, 60_000)

  afterAll(() => started?.stop())

  const origin = () => ({ Origin: base, 'Content-Type': 'application/json' })

  async function signIn() {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: origin(), body: JSON.stringify({ password: PASSWORD }) })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    return cookie.split(';')[0] ?? ''
  }

  test('session says server mode; data routes need a sign-in', async () => {
    const session = await json(await fetch(`${base}/api/session`))
    expect(session).toEqual({ server: true, signedIn: false, publicUrl: base })
    expect((await fetch(`${base}/api/memories`)).status).toBe(401)
    expect((await fetch(`${base}/`)).status).toBe(200)
  })

  test('wrong password is refused, right one signs in', async () => {
    const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: origin(), body: JSON.stringify({ password: 'nope nope' }) })
    expect(wrong.status).toBe(401)
    const foreign = await fetch(`${base}/api/login`, { method: 'POST', headers: { ...origin(), Origin: 'http://evil.example' }, body: JSON.stringify({ password: PASSWORD }) })
    expect(foreign.status).toBe(403)
    const cookie = await signIn()
    const session = await json(await fetch(`${base}/api/session`, { headers: { Cookie: cookie } }))
    expect(session.signedIn).toBe(true)
    const memories = await fetch(`${base}/api/memories`, { headers: { Cookie: cookie } })
    expect(memories.status).toBe(200)
    const health = await json(await fetch(`${base}/api/health`, { headers: { Cookie: cookie } }))
    expect(health.server).toBe(true)
    expect((await fetch(`${base}/api/update`, { headers: { Cookie: cookie } })).status).toBe(404)
  })

  test('keys: created with the cookie, never with a key; plugin routes and /mcp take them', async () => {
    const cookie = await signIn()
    const noCookie = await fetch(`${base}/api/keys/create`, { method: 'POST', headers: origin(), body: JSON.stringify({ name: 'Laptop' }) })
    expect(noCookie.status).toBe(401)
    const made = await json(await fetch(`${base}/api/keys/create`, { method: 'POST', headers: { ...origin(), Cookie: cookie }, body: JSON.stringify({ name: 'Laptop' }) }))
    expect(made.key).toMatch(/^mn_/)
    const auth = { Authorization: `Bearer ${made.key}`, 'Content-Type': 'application/json' }
    // A key cannot make keys.
    expect((await fetch(`${base}/api/keys/create`, { method: 'POST', headers: { ...auth, Origin: base }, body: JSON.stringify({ name: 'x' }) })).status).toBe(401)

    const hello = await json(await fetch(`${base}/api/plugin/hello`, { headers: auth }))
    expect(hello.ok).toBe(true)
    expect(hello.device).toBe('Laptop')
    expect((await fetch(`${base}/api/plugin/hello`, { headers: { Authorization: 'Bearer mn_aaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } })).status).toBe(401)

    const engine = await json(
      await fetch(`${base}/api/plugin/engine`, { method: 'POST', headers: auth, body: JSON.stringify({ owner: 'global', requests: buildRequests([['mnemopi_recall', { query: 'deploy Fridays', limit: 5 }]]) }) }),
    )
    expect(engine.exitCode).toBe(0)
    expect(engine.stdout).toContain('Fridays')
    const refused = await fetch(`${base}/api/plugin/engine`, { method: 'POST', headers: auth, body: JSON.stringify({ owner: 'global', requests: buildRequests([['mnemopi_export', {}]]) }) })
    expect(refused.status).toBe(400)
    // The plugin's recall left a line in the server's own activity log, as Claude's, naming the device.
    const logged = readFileSync(activity, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(logged.some(line => line.action === 'recall' && line.client === 'claude-code' && line.device === 'Laptop' && line.ok === true)).toBe(true)

    // A PC's project record reaches the server's registry (the map's project names).
    const project = await json(
      await fetch(`${base}/api/plugin/project`, { method: 'POST', headers: auth, body: JSON.stringify({ input: { owner: 'project-mnemosyne-abc123', name: 'claude-mnemosyne', kind: 'repo', remoteHost: 'github.com', remoteKey: null } }) }),
    )
    expect(project.exitCode).toBe(0)
    expect(readFileSync(join(root, 'projects.json'), 'utf8')).toContain('claude-mnemosyne')

    const listed = await json(await fetch(`${base}/api/keys`, { headers: { Cookie: cookie } }))
    expect(listed.keys.map((k: { name: string }) => k.name)).toContain('Laptop')
    expect(JSON.stringify(listed)).not.toContain(made.key)

    // /mcp: initialize answered here; tools/list and a recall go through the proxy.
    const init = await json(await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1' } } }) }))
    expect(init.result.serverInfo.name).toBe('mnemosyne')
    const note = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(note.status).toBe(202)
    const list = await json(await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }) }))
    expect(list.id).toBe('a')
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('memory_recall')
    const recall = await json(await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'memory_recall', arguments: { query: 'deploy Fridays' } } }) }))
    expect(recall.id).toBe(7)
    expect(JSON.stringify(recall)).toContain('Fridays')
    expect((await fetch(`${base}/mcp`, { headers: auth })).status).toBe(405)

    const revoked = await fetch(`${base}/api/keys/revoke`, { method: 'POST', headers: { ...origin(), Cookie: cookie }, body: JSON.stringify({ id: made.id }) })
    expect(revoked.status).toBe(200)
    expect((await fetch(`${base}/api/plugin/hello`, { headers: auth })).status).toBe(401)
  }, 120_000)

  test('daily upkeep: a backup and the sweep once a day, then nothing until the marker is a day old', async () => {
    const ctx = { root, store, cli: CLI, pluginRoot: ROOT, activityLog: '', embeddings: false, modelCacheDir: undefined }
    expect(storeOwners(store)).toContain('global')
    const first = await runUpkeep(ctx, { mode: 'on', days: 90 })
    expect(first.error).toBeUndefined()
    expect(first.due).toBe(true)
    expect(first.backup).toBeDefined()
    expect(existsSync(first.backup ?? '')).toBe(true)
    const again = await runUpkeep(ctx, { mode: 'on', days: 90 })
    expect(again.due).toBe(false)
    expect(again.backup).toBeUndefined()
  }, 120_000)

  test('sign out clears the cookie', async () => {
    const response = await fetch(`${base}/api/logout`, { method: 'POST', headers: origin() })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

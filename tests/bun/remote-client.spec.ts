// Plugin client mode (docs/plans/remote-server.md, "Plugin client mode"): bin/remote.ts against a fake server, and the real
// hooks/register.ts with serverUrl set, driven by knowledge-host.ts (real processes over a temp HOME; the server is a
// Bun.serve stand-in on 127.0.0.1). Nothing here reaches the network or the real ~/.claude/mnemosyne.
import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { hooks, makeHost } from './knowledge-host'
import type { Host } from './knowledge-host'
import { isolatedEnv, ROOT } from './helpers'

setDefaultTimeout(60_000)
const REMOTE = join(ROOT, 'bin', 'remote.ts')
const KEY = 'mn_test_7f3a9c2e1b5d4f6a8c0e'

type Seen = { method: string; path: string; auth: string | null; body: any }
type Answer = (seen: Seen) => Response | Promise<Response>

/** A fake HAL-M server; `answer` decides each reply. */
function fakeServer(answer: Answer) {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async request => {
      const url = new URL(request.url)
      const text = request.method === 'POST' ? await request.text() : ''
      const entry: Seen = { method: request.method, path: url.pathname, auth: request.headers.get('authorization'), body: text ? JSON.parse(text) : undefined }
      seen.push(entry)
      return answer(entry)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) }
}
const servers: { stop: () => void }[] = []
const serve = (answer: Answer) => {
  const made = fakeServer(answer)
  servers.push(made)
  return made
}
afterAll(() => {
  for (const server of servers.splice(0)) server.stop()
})

/** A port nothing listens on: one the OS just gave out and took back. */
function deadPort() {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = server.port
  server.stop(true)
  return port
}

async function remote(op: string, input: Record<string, unknown>) {
  const child = Bun.spawn([process.execPath, REMOTE, op], {
    env: { ...(process.env as Record<string, string>), ...isolatedEnv('remote') },
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  // The key never appears in what the script prints.
  expect(stdout).not.toContain(KEY)
  expect(stderr).not.toContain(KEY)
  return { stdout, stderr, exitCode }
}

const json = (value: unknown, status = 200) => Response.json(value, { status })
const engineReply = (texts: readonly string[]) => texts.map((text, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, result: { content: [{ type: 'text', text }] } })).join('\n') + '\n'

describe('bin/remote.ts', () => {
  test('engine: POSTs the body with the bearer key and replays stdout, stderr and the exit code', async () => {
    const server = serve(() => json({ stdout: 'out line\n', stderr: 'engine warning\n', exitCode: 3 }))
    const body = { owner: 'global', requests: 'x\n', timeoutMs: 1000 }
    const done = await remote('engine', { url: `${server.url}//`, key: KEY, body, timeoutMs: 5_000 })
    expect(done).toEqual({ stdout: 'out line\n', stderr: 'engine warning\n', exitCode: 3 })
    expect(server.seen).toEqual([{ method: 'POST', path: '/api/plugin/engine', auth: `Bearer ${KEY}`, body }])
  })

  test('hello: a GET whose JSON is printed, exit 0', async () => {
    const server = serve(() => json({ ok: true, plugin: '0.35.0', engine: 'b1', embeddings: false }))
    const done = await remote('hello', { url: server.url, key: KEY, timeoutMs: 5_000 })
    expect(done.exitCode).toBe(0)
    expect(JSON.parse(done.stdout)).toEqual({ ok: true, plugin: '0.35.0', engine: 'b1', embeddings: false })
    expect(server.seen[0]).toMatchObject({ method: 'GET', path: '/api/plugin/hello', auth: `Bearer ${KEY}` })
  })

  test('401 exits 77 and says the key was refused', async () => {
    const server = serve(() => json({ error: 'unauthorized' }, 401))
    const done = await remote('memories', { url: server.url, key: KEY, body: { args: ['row-info', 'a'] }, timeoutMs: 5_000 })
    expect(done.exitCode).toBe(77)
    expect(done.stderr).toContain('mnemosyne server refused the key')
  })

  test('another status exits 1 with the status and the error text; an echoed key is masked', async () => {
    const server = serve(() => json({ error: `boom for ${KEY}` }, 500))
    const done = await remote('resolve', { url: server.url, key: KEY, body: { input: {} }, timeoutMs: 5_000 })
    expect(done.exitCode).toBe(1)
    expect(done.stderr).toContain('500')
    expect(done.stderr).toContain('boom')
  })

  test('an unreachable port exits 75', async () => {
    const done = await remote('engine', { url: `http://127.0.0.1:${deadPort()}`, key: KEY, body: {}, timeoutMs: 5_000 })
    expect(done.exitCode).toBe(75)
    expect(done.stderr).toStartWith('mnemosyne server unreachable:')
  })

  test('a server that does not answer in time exits 75', async () => {
    const server = serve(async () => {
      await Bun.sleep(3_000)
      return json({ stdout: '', stderr: '', exitCode: 0 })
    })
    const started = Date.now()
    const done = await remote('engine', { url: server.url, key: KEY, body: {}, timeoutMs: 400 })
    expect(done.exitCode).toBe(75)
    expect(done.stderr).toContain('no answer within 400 ms')
    expect(Date.now() - started).toBeLessThan(2_900)
  })

  test('a URL that is not http(s) is refused before any request', async () => {
    const done = await remote('hello', { url: 'file:///etc/passwd', key: KEY, timeoutMs: 1_000 })
    expect(done.exitCode).toBe(1)
    expect(done.stderr).toContain('http:// or https://')
  })
})

// ---- hooks/register.ts in client mode ----

const hosts: Host[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose()
})

async function clientHost(url: string, extra: Record<string, unknown> = {}) {
  // A placeholder engine (no symlink, which Windows may refuse): client mode never runs a local one.
  const host = await makeHost({ options: { serverUrl: url, serverKey: KEY, ...extra }, engineBuild: '0.0.0-not-used' })
  hosts.push(host)
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  host.$.ui.toast = ((text: string) => void toasts.push(text)) as () => undefined
  host.$.ui.status = ((text?: string) => void statuses.push(text)) as () => undefined
  const remoteRuns = () => host.ran('/bin/remote.ts')
  return { host, toasts, statuses, remoteRuns }
}

/** The fake server's answer for each plugin route; engine replies come from `engine`. */
function pluginServer(engine: (body: any) => string[] = () => ['ok']) {
  return serve(seen => {
    if (seen.auth !== `Bearer ${KEY}`) return json({ error: 'unauthorized' }, 401)
    switch (seen.path) {
      case '/api/plugin/hello':
        return json({ ok: true, plugin: '0.35.0', engine: '18.12.3-mnemosyne.9', embeddings: true })
      case '/api/plugin/resolve':
        return json({ stdout: 'project-fromserver\n', stderr: '', exitCode: 0 })
      case '/api/plugin/memories':
        return json({ stdout: seen.body.args[0] === 'row-info' ? 'null\n' : '{}\n', stderr: '', exitCode: 0 })
      case '/api/plugin/engine':
        return json({ stdout: engineReply(engine(seen.body)), stderr: '', exitCode: 0 })
      default:
        return json({ error: 'not found' }, 404)
    }
  })
}

describe('hooks/register.ts client mode', () => {
  test('an engine call goes to the server as its owner, with the key on stdin only', async () => {
    const server = pluginServer(() => ['Forgot memory abc123.'])
    const { host, remoteRuns } = await clientHost(server.url, { scope: 'per-project' })
    const answer = await host.tool('memory_forget', { memory_id: 'abc123' })
    expect(answer.result).toBe('Forgot memory abc123.')
    // No local engine process ran.
    expect(host.engineRuns()).toEqual([])
    const resolve = server.seen.find(seen => seen.path === '/api/plugin/resolve')!
    expect(resolve.body.input).toMatchObject({ legacy: expect.stringMatching(/^project-/) })
    const engine = server.seen.find(seen => seen.path === '/api/plugin/engine')!
    expect(engine.body.owner).toBe('project-fromserver')
    expect(engine.body.requests).toContain('"name":"mnemopi_forget"')
    expect(engine.body.requests).toContain('"memory_id":"abc123"')
    for (const run of remoteRuns()) {
      expect(run.argv.join(' ')).not.toContain(KEY)
      expect(JSON.stringify(run.env ?? {})).not.toContain(KEY)
      expect(JSON.parse(run.stdin!)).toMatchObject({ url: server.url, key: KEY })
    }
    expect(remoteRuns().map(run => run.argv[2])).toEqual(['resolve', 'engine'])
  })

  test('memory_get reads row-info from the server; the store-wide reads and commands are refused', async () => {
    const server = pluginServer()
    const { host } = await clientHost(server.url)
    const answer = await host.tool('memory_get', { memory_id: 'abcdef12' })
    expect(answer.result).toContain('not')
    expect(server.seen.find(seen => seen.path === '/api/plugin/memories')!.body).toEqual({ args: ['row-info', 'abcdef12'] })
    // Any other bin/memories.ts command is the server's.
    await expect((hooks.knowledgeDryRun as (...args: unknown[]) => Promise<string>)(host.$, host.options)).rejects.toThrow('This runs on the HAL-M server')
    for (const command of ['mnemosyne-tags', 'mnemosyne-import', 'mnemosyne-knowledge', 'mnemosyne-embed']) {
      expect((await host.command(command, command === 'mnemosyne-import' ? 'apply' : '')).text).toBe(`/${command} runs on the HAL-M server (${server.url}): open its dashboard or run it there.`)
    }
    expect(host.memoriesRuns()).toEqual([])
  })

  test('session start runs only a hello; /mnemosyne-setup and /mnemosyne-ui name the server', async () => {
    const server = pluginServer()
    const { host, toasts, remoteRuns } = await clientHost(`${server.url}/`)
    await host.sessionStart()
    await host.settled()
    expect(toasts).toEqual([])
    expect(host.runs.map(run => run.argv[1])).toEqual([`${ROOT.replaceAll('\\', '/')}/bin/remote.ts`])
    expect(remoteRuns()[0]!.argv[2]).toBe('hello')
    const setup = (await host.command('mnemosyne-setup')).text
    expect(setup).toContain(`uses the server at ${server.url} and needs no local engine`)
    expect(setup).toContain('engine build 18.12.3-mnemosyne.9')
    expect((await host.command('mnemosyne-ui')).text).toContain(server.url)
  })

  test('a refused key says so at session start', async () => {
    const server = pluginServer()
    const { host, toasts } = await clientHost(server.url)
    ;(host.options as Record<string, unknown>).serverKey = 'mn_wrong'
    await host.sessionStart()
    await host.settled()
    expect(toasts).toEqual([`HAL-M server ${server.url} refused the key: check serverKey.`])
  })

  test('an unreachable server marks memory offline: one try, then calls fail at once until it answers again', async () => {
    const dead = `http://127.0.0.1:${deadPort()}`
    const { host, toasts, statuses, remoteRuns } = await clientHost(dead)
    await host.sessionStart()
    await host.settled()
    expect(toasts).toEqual([`HAL-M server ${dead} is not reachable: memory is off until it is back.`])
    expect(statuses).toEqual(['HAL-M · memory offline'])
    // The breaker is open: no process, the plain offline error.
    const denied = await host.tool('memory_forget', { memory_id: 'abc123' })
    expect(denied.deny).toBe('HAL-M: HAL-M server unreachable (memory offline)')
    expect(remoteRuns()).toHaveLength(1)
    // The first prompt goes on at once without a recall.
    const started = Date.now()
    const passed = (await host.prompt('What did we decide about deploys?')) as { context?: string[] }
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(passed.context ?? []).toEqual([])
    expect(remoteRuns()).toHaveLength(1)
    // The server comes back; /mnemosyne-setup looks past the breaker, and memory is on again.
    const server = pluginServer(() => ['Forgot memory abc123.'])
    ;(host.options as Record<string, unknown>).serverUrl = server.url
    expect((await host.command('mnemosyne-setup')).text).toContain('The server answered')
    expect(statuses.at(-1)).toBeUndefined()
    expect((await host.tool('memory_forget', { memory_id: 'abc123' })).result).toBe('Forgot memory abc123.')
  })

  test('a down server costs the first prompt about one connect budget', async () => {
    const dead = `http://127.0.0.1:${deadPort()}`
    const { host } = await clientHost(dead, { scope: 'per-project' })
    const started = Date.now()
    const passed = (await host.prompt('Which database do we use?')) as { context?: string[] }
    expect(Date.now() - started).toBeLessThan(6_000)
    expect(passed.context ?? []).toEqual([])
  })
})

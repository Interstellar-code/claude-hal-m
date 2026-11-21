#!/usr/bin/env bun
// Plugin client mode (docs/plans/remote-server.md, "Plugin client mode"): one call to a HAL-M server.
//
//   bun bin/remote.ts <engine|memories|resolve|project|hello>
//   stdin: { url, key, body, timeoutMs, connectMs? }
//
// A hook has no fetch, only subprocesses, so every remote call is one short Bun process. The key comes on
// stdin only (never argv or env, which other accounts may read) and is never printed. engine, memories and
// resolve POST `body` as JSON to <url>/api/plugin/<op> and replay the reply's { stdout, stderr, exitCode }
// as this process's own, so the caller reads it exactly as it reads a local run. hello GETs and prints the
// reply's JSON. Before the request a plain TCP connect to the server must succeed within connectMs (3 s by
// default), so a server that is down fails fast even when the request itself may take longer.
//
// Exit codes: the server's exitCode on 200; 75 the server is unreachable (connect failed, timeout, network
// error); 77 the server refused the key (401); 1 anything else (a bad stdin, another HTTP status).
import { connect } from 'node:net'

export const OPS = ['engine', 'memories', 'resolve', 'project', 'hello'] as const
export type Op = (typeof OPS)[number]
export const EXIT_UNREACHABLE = 75
export const EXIT_REFUSED = 77
const DEFAULT_CONNECT_MS = 3_000
const DEFAULT_TIMEOUT_MS = 20_000

type Input = { url: string; key: string; body?: unknown; timeoutMs?: number; connectMs?: number }

/** The server URL without its trailing slashes, or undefined when it is not an http(s) URL. */
export function serverBase(raw: unknown): URL | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let url: URL
  try {
    url = new URL(raw.trim().replace(/\/+$/, ''))
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  return url
}

const positive = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 3_600_000) : fallback)

/** Resolves when a TCP connection to the server's host and port opens within `ms`; rejects with the reason otherwise. */
function probe(url: URL, ms: number): Promise<void> {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`no connection within ${ms} ms`))
    }, ms)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve()
    })
    socket.once('error', (err: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    })
  })
}

/** Removes the key from a text the server sent back, should it ever echo it. */
const masked = (text: string, key: string) => (key.length >= 4 ? text.split(key).join('[key]') : text)

async function main(): Promise<number> {
  const op = process.argv[2]
  if (!OPS.includes(op as Op)) {
    process.stderr.write(`usage: bun bin/remote.ts <${OPS.join('|')}> (stdin: { url, key, body, timeoutMs })\n`)
    return 1
  }
  let input: Input
  try {
    input = JSON.parse(await Bun.stdin.text()) as Input
  } catch {
    process.stderr.write('remote.ts: stdin is not JSON\n')
    return 1
  }
  const base = serverBase(input?.url)
  if (base === undefined) {
    process.stderr.write('mnemosyne serverUrl must be an http:// or https:// URL\n')
    return 1
  }
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  const timeoutMs = positive(input.timeoutMs, DEFAULT_TIMEOUT_MS)
  const connectMs = Math.min(positive(input.connectMs, DEFAULT_CONNECT_MS), timeoutMs)
  const target = `${base.href.replace(/\/+$/, '')}/api/plugin/${op}`

  try {
    await probe(base, connectMs)
  } catch (err) {
    process.stderr.write(`mnemosyne server unreachable: ${masked((err as Error)?.message ?? 'connect failed', key)}\n`)
    return EXIT_UNREACHABLE
  }

  let response: Response
  try {
    response = await fetch(target, {
      method: op === 'hello' ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(op === 'hello' ? {} : { 'content-type': 'application/json' }) },
      ...(op === 'hello' ? {} : { body: JSON.stringify(input.body ?? {}) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const error = err as Error
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? `no answer within ${timeoutMs} ms` : (error?.message ?? 'request failed')
    process.stderr.write(`mnemosyne server unreachable: ${masked(reason, key)}\n`)
    return EXIT_UNREACHABLE
  }

  let text: string
  try {
    text = await response.text()
  } catch (err) {
    process.stderr.write(`mnemosyne server unreachable: ${masked((err as Error)?.message ?? 'the reply was cut', key)}\n`)
    return EXIT_UNREACHABLE
  }
  if (response.status === 401) {
    process.stderr.write('mnemosyne server refused the key\n')
    return EXIT_REFUSED
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (response.status !== 200) {
    const error = json !== null && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : text.slice(0, 300)
    process.stderr.write(`mnemosyne server answered ${response.status}${error.trim() ? `: ${masked(error.trim(), key)}` : ''}\n`)
    return 1
  }
  if (op === 'hello') {
    if (json === undefined) {
      process.stderr.write('mnemosyne server answered hello with something that is not JSON\n')
      return 1
    }
    process.stdout.write(`${JSON.stringify(json)}\n`)
    return 0
  }
  const reply = json as { stdout?: unknown; stderr?: unknown; exitCode?: unknown } | undefined
  if (reply === undefined || reply === null || typeof reply !== 'object' || typeof reply.exitCode !== 'number') {
    process.stderr.write(`mnemosyne server answered ${op} without { stdout, stderr, exitCode }\n`)
    return 1
  }
  if (typeof reply.stdout === 'string') process.stdout.write(reply.stdout)
  if (typeof reply.stderr === 'string') process.stderr.write(masked(reply.stderr, key))
  return Math.max(0, Math.min(255, Math.trunc(reply.exitCode)))
}

if (import.meta.main) {
  const code = await main()
  // Let stdout drain before the exit code is set (a large engine reply).
  process.exitCode = code
}

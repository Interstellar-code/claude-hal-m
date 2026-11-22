// docker/init-data.ts: the Docker image's first start lays out the data volume and
// never overwrites what is there. docker/entrypoint.sh and the Dockerfile: each operator
// setting is HALM_<X>, else MNEMOSYNE_<X>, else the entrypoint's default; the image bakes
// none of them (plan 3.1).
import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataPaths, initData } from '../../docker/init-data'
import { configText, emptyConfig } from '../../hooks/settings'
import { parseVocabulary, VOCAB_FILE } from '../../hooks/vocab'
import { isolatedEnv, tempDir } from './helpers'

const POSIX = process.platform !== 'win32'
const mode = (path: string) => statSync(path).mode & 0o777

describe('docker init-data', () => {
  const temp = tempDir('docker-init')
  const root = join(temp.dir, 'data')
  afterAll(() => temp.dispose())

  test('a new data root gets the store, backups, config, vocabulary and activity log', () => {
    const done = initData(root)
    expect(done.store).toBe(join(root, 'store'))
    for (const dir of ['store', 'backups']) expect(statSync(join(root, dir)).isDirectory()).toBe(true)
    expect(readFileSync(join(root, 'config.json'), 'utf8')).toBe(configText(emptyConfig()))
    // An empty store (no mnemopi.db yet) seeds only the agent tags.
    const vocab = parseVocabulary(readFileSync(join(root, VOCAB_FILE), 'utf8'))
    expect(Object.values(vocab.tags).every(entry => entry.admitted === 'seed')).toBe(true)
    expect(readFileSync(join(root, 'activity.jsonl'), 'utf8')).toBe('')
    expect(existsSync(join(root, 'store', 'mnemopi.db'))).toBe(false)
    expect(done.created.length).toBe(6)
    if (POSIX) {
      for (const dir of ['', 'store', 'backups']) expect(mode(join(root, dir))).toBe(0o700)
      for (const file of ['config.json', VOCAB_FILE, 'activity.jsonl']) expect(mode(join(root, file))).toBe(0o600)
    }
  })

  test('a second start keeps every file as it was', () => {
    writeFileSync(join(root, 'config.json'), '{"edited":true}\n')
    writeFileSync(join(root, VOCAB_FILE), 'curated\n')
    writeFileSync(join(root, 'activity.jsonl'), '{"line":1}\n')
    const done = initData(root)
    expect(done.created).toEqual([])
    expect(readFileSync(join(root, 'config.json'), 'utf8')).toBe('{"edited":true}\n')
    expect(readFileSync(join(root, VOCAB_FILE), 'utf8')).toBe('curated\n')
    expect(readFileSync(join(root, 'activity.jsonl'), 'utf8')).toBe('{"line":1}\n')
  })

  test('a store elsewhere is created there; relative paths are refused', () => {
    const other = join(temp.dir, 'other')
    const store = join(temp.dir, 'elsewhere', 'store')
    expect(initData(other, store).store).toBe(store)
    expect(statSync(store).isDirectory()).toBe(true)
    expect(() => initData('data')).toThrow(/absolute/)
    expect(() => initData(other, 'store')).toThrow(/absolute/)
  })
})

describe('docker init-data paths', () => {
  test('the store and root come from the new name, then the old one, then the defaults', () => {
    expect(dataPaths(undefined, {})).toEqual({ root: '/data', store: '/data/store' })
    expect(dataPaths(undefined, { MNEMOSYNE_ROOT: '/old', MNEMOSYNE_STORE: '/old-store' })).toEqual({ root: '/old', store: '/old-store' })
    expect(dataPaths(undefined, { HALM_STORE: '/new-store', MNEMOSYNE_STORE: '/old-store' }).store).toBe('/new-store')
    // An empty new name (compose passes unset values as empty) counts as not set.
    expect(dataPaths(undefined, { HALM_STORE: '', MNEMOSYNE_STORE: '/old-store' }).store).toBe('/old-store')
    expect(dataPaths('/arg', { HALM_ROOT: '/new' })).toEqual({ root: '/arg', store: '/arg/store' })
  })
})

const REPO = join(import.meta.dir, '..', '..')
const OPERATOR = ['BIND', 'PORT', 'SECURE_COOKIE', 'ROOT', 'STORE', 'EMBEDDINGS', 'PUBLIC_URL', 'HOSTS', 'EXPIRE_UNUSED_DAYS', 'UI_PASSWORD']

describe('Dockerfile', () => {
  const dockerfile = readFileSync(join(REPO, 'Dockerfile'), 'utf8')
  // ENV lines joined with their continuations.
  const envBlock = dockerfile.replace(/\\\n/g, ' ').split('\n').filter(line => /^ENV\s/.test(line)).join('\n')

  test('bakes no operator setting under either name', () => {
    expect(envBlock).not.toBe('')
    for (const name of OPERATOR) {
      expect(envBlock).not.toMatch(new RegExp(`\\b(HALM|MNEMOSYNE)_${name}=`))
    }
    for (const name of ['CLI', 'PLUGIN_ROOT', 'MODEL_CACHE']) expect(envBlock).toMatch(new RegExp(`\\bHALM_${name}=`))
  })

  test('the health check reads the port under both names, new first', () => {
    const check = dockerfile.slice(dockerfile.indexOf('HEALTHCHECK'))
    expect(check).toMatch(/HALM_PORT\|\|e\.MNEMOSYNE_PORT\|\|'8787'/)
  })
})

// The entrypoint, run as a non-root user with a stub bun that records the environment it
// was given and its arguments, instead of starting the server.
describe.skipIf(!POSIX)('docker entrypoint', () => {
  const temp = tempDir('docker-entry')
  afterAll(() => temp.dispose())
  const iso = isolatedEnv('docker-entry')
  const bin = join(temp.dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\n{ echo "ARGS $*"; env | grep -E "^(HALM|MNEMOSYNE)_" | sort; echo END; } >> "$STUB_OUT"\n')
  chmodSync(join(bin, 'bun'), 0o755)
  let run = 0

  function entrypoint(vars: Record<string, string>) {
    const dir = join(temp.dir, `run${++run}`)
    const out = join(dir, 'out.txt')
    mkdirSync(dir, { recursive: true })
    // Only what is given here: no HALM_ or MNEMOSYNE_ name leaks in from the test's own shell.
    const env: Record<string, string> = { PATH: `${bin}:/usr/bin:/bin`, STUB_OUT: out, HALM_ROOT: join(dir, 'data'), ...vars }
    for (const key of Object.keys(env)) if (env[key] === '\u0000') delete env[key]
    const result = spawnSync('/bin/sh', [join(REPO, 'docker', 'entrypoint.sh')], { env: { ...env, ...iso }, encoding: 'utf8' })
    const calls = existsSync(out)
      ? readFileSync(out, 'utf8').split('END\n').filter(Boolean).map(block => {
          const lines = block.trim().split('\n')
          const seen: Record<string, string> = {}
          for (const line of lines.slice(1)) {
            const at = line.indexOf('=')
            seen[line.slice(0, at)] = line.slice(at + 1)
          }
          return { args: (lines[0] ?? '').replace(/^ARGS ?/, ''), env: seen }
        })
      : []
    return { status: result.status, stderr: result.stderr, calls, dir }
  }

  test("today's Unraid template (old names only) keeps its bind address and settings", () => {
    const r = entrypoint({
      HALM_ROOT: '\u0000',
      MNEMOSYNE_ROOT: join(temp.dir, 'unraid-data'),
      MNEMOSYNE_UI_PASSWORD: 'old-password-123',
      MNEMOSYNE_BIND: '127.0.0.1',
      MNEMOSYNE_PUBLIC_URL: 'https://hal-m.example.ts.net',
      MNEMOSYNE_EXPIRE_UNUSED_DAYS: '90',
    })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.calls.map(call => call.args)).toEqual([`/app/docker/init-data.ts ${join(temp.dir, 'unraid-data')}`, '/app/ui/server.ts --server'])
    const env = r.calls[1]?.env ?? {}
    expect(env.HALM_BIND).toBe('127.0.0.1')
    expect(env.HALM_UI_PASSWORD).toBe('old-password-123')
    expect(env.HALM_PUBLIC_URL).toBe('https://hal-m.example.ts.net')
    expect(env.HALM_EXPIRE_UNUSED_DAYS).toBe('90')
    expect(env.HALM_ROOT).toBe(join(temp.dir, 'unraid-data'))
    expect(env.HALM_STORE).toBe(join(temp.dir, 'unraid-data', 'store'))
    expect(env.HALM_PORT).toBe('8787')
    expect(env.HALM_SECURE_COOKIE).toBe('auto')
    expect(env.HALM_EMBEDDINGS).toBe('off') // no /opt/mnemosyne/embeddings outside the image
    expect(statSync(join(temp.dir, 'unraid-data', 'store')).isDirectory()).toBe(true)
  })

  test('the new name wins over the old one; an empty new name falls back to the old', () => {
    const store = join(temp.dir, 'old-store')
    const r = entrypoint({
      HALM_UI_PASSWORD: 'new-password-123',
      MNEMOSYNE_UI_PASSWORD: 'old-password-123',
      HALM_BIND: '127.0.0.1',
      MNEMOSYNE_BIND: '0.0.0.0',
      HALM_STORE: '',
      MNEMOSYNE_STORE: store,
      HALM_PORT: '',
      MNEMOSYNE_PORT: '9000',
      HALM_EMBEDDINGS: 'on',
      MNEMOSYNE_HOSTS: 'a.example,b.example',
    })
    expect(r.status).toBe(0)
    const env = r.calls[1]?.env ?? {}
    expect(env.HALM_UI_PASSWORD).toBe('new-password-123')
    expect(env.HALM_BIND).toBe('127.0.0.1')
    expect(env.HALM_STORE).toBe(store)
    expect(env.HALM_PORT).toBe('9000')
    expect(env.HALM_EMBEDDINGS).toBe('on')
    expect(env.HALM_HOSTS).toBe('a.example,b.example')
    expect(statSync(store).isDirectory()).toBe(true)
    // init-data gets the same store through the exported new name.
    expect(r.calls[0]?.env.HALM_STORE).toBe(store)
  })

  test('new names only get the defaults; unset optional settings stay unset', () => {
    const r = entrypoint({ HALM_UI_PASSWORD: 'new-password-123' })
    expect(r.status).toBe(0)
    const env = r.calls[1]?.env ?? {}
    expect(env.HALM_BIND).toBe('0.0.0.0')
    expect(env.HALM_PORT).toBe('8787')
    expect(env.HALM_STORE).toBe(join(r.dir, 'data', 'store'))
    for (const name of ['PUBLIC_URL', 'HOSTS', 'EXPIRE_UNUSED_DAYS']) expect(env[`HALM_${name}`]).toBeUndefined()
    expect(Object.keys(env).some(key => key.startsWith('MNEMOSYNE_'))).toBe(false)
  })

  test('a missing or short password under either name stops the start', () => {
    const none = entrypoint({})
    expect(none.status).toBe(64)
    expect(none.stderr).toContain('HALM_UI_PASSWORD (or MNEMOSYNE_UI_PASSWORD) is not set')
    expect(none.calls).toEqual([])
    const short = entrypoint({ HALM_UI_PASSWORD: '', MNEMOSYNE_UI_PASSWORD: 'short' })
    expect(short.status).toBe(64)
    expect(short.stderr).toContain('shorter than 8 characters')
  })
})

/// <reference lib="dom" />
// Server mode on the page (ui/server-mode.ts): reading /api/session and /api/keys, the sign-in error lines,
// the copy snippets, and the Settings tab's "MCP connection" card drawn against a DOM-free stand-in document
// with a fake host (no network). The sign-in card and the cookie path of ui/app.ts are wired to the ids in
// ui/index.html, checked here too.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers'
import { baseUrl, checkKeyName, drawMcp, loadKeys, loginErrorText, mcpJson, newMcpState, parseKeys, parseSession, pluginSettingsText, retryAfterSeconds, type McpHost } from '../../ui/server-mode'

const MARKUP = '<img src=x onerror=alert(1)>'

describe('reading the server-mode replies', () => {
  test('parseSession: only a 200 with server: true is server mode', () => {
    expect(parseSession(200, { server: true, signedIn: false, publicUrl: 'https://mnemosyne.tail.ts.net' })).toEqual({ server: true, signedIn: false, publicUrl: 'https://mnemosyne.tail.ts.net' })
    expect(parseSession(200, { server: true, signedIn: true })).toEqual({ server: true, signedIn: true, publicUrl: '' })
    expect(parseSession(401, { error: 'unauthorized' })).toBeNull()
    expect(parseSession(200, { server: false })).toBeNull()
    expect(parseSession(200, null)).toBeNull()
    expect(parseSession(404, {})).toBeNull()
  })

  test('baseUrl: the public URL, else the origin, never a trailing slash', () => {
    expect(baseUrl('https://m.ts.net/', 'http://127.0.0.1:8787')).toBe('https://m.ts.net')
    expect(baseUrl('', 'http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(baseUrl('  ', 'https://x/')).toBe('https://x')
  })

  test('loginErrorText and retryAfterSeconds: wrong password, too many tries, other failures', () => {
    expect(loginErrorText(401, { error: 'wrong password' })).toBe('That password is not right.')
    expect(loginErrorText(429, { error: 'slow down', retryAfter: 42 })).toBe('Too many tries, wait 42 s.')
    expect(loginErrorText(429, {})).toBe('Too many tries, wait 60 s.')
    expect(loginErrorText(0, { error: 'Could not reach the server: down' })).toBe('Could not reach the server: down')
    expect(loginErrorText(500, {})).toBe('The server answered 500.')
    expect(retryAfterSeconds(429, { retryAfter: 12.2 })).toBe(13)
    expect(retryAfterSeconds(429, {})).toBe(60)
    expect(retryAfterSeconds(401, { retryAfter: 5 })).toBe(0)
  })

  test('parseKeys: keeps well-formed rows, lastUsed null when never', () => {
    expect(parseKeys({ keys: [{ id: 'abcd1234', name: 'Laptop', created: '2026-11-20T10:00:00.000Z', lastUsed: null }, { name: 'no id' }, 'junk', { id: 'efgh5678', name: 'Desk', created: '2026-11-20T10:00:00.000Z', lastUsed: '2026-11-21T08:30:00.000Z' }] })).toEqual([
      { id: 'abcd1234', name: 'Laptop', created: '2026-11-20T10:00:00.000Z', lastUsed: null },
      { id: 'efgh5678', name: 'Desk', created: '2026-11-20T10:00:00.000Z', lastUsed: '2026-11-21T08:30:00.000Z' },
    ])
    expect(parseKeys({})).toBeNull()
    expect(parseKeys(null)).toBeNull()
  })

  test('checkKeyName: 1 to 60 characters, trimmed', () => {
    expect(checkKeyName('  Work laptop ')).toEqual({ ok: true, name: 'Work laptop' })
    expect(checkKeyName('   ').ok).toBe(false)
    expect(checkKeyName('x'.repeat(61)).ok).toBe(false)
    expect(checkKeyName('x'.repeat(60)).ok).toBe(true)
  })

  test('the snippets: plugin settings on two lines, MCP JSON for Cursor and Claude Desktop', () => {
    const key = 'mn_abcd1234_' + 'k'.repeat(43)
    expect(pluginSettingsText('https://m.ts.net', key)).toBe(`serverUrl: https://m.ts.net\nserverKey: ${key}`)
    const json = mcpJson('https://m.ts.net', key)
    expect(JSON.parse(json)).toEqual({ mcpServers: { mnemosyne: { type: 'http', url: 'https://m.ts.net/mcp', headers: { Authorization: `Bearer ${key}` } } } })
    expect(json).toContain('\n  "mcpServers"')
  })
})

// ---- The MCP connection card on a stand-in document ----

class FakeText {
  constructor(public data: string) {}
  get textContent() {
    return this.data
  }
}

class FakeNode {
  children: (FakeNode | FakeText)[] = []
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  className = ''
  hidden = false
  disabled = false
  readOnly = false
  value = ''
  id = ''
  type = ''
  htmlFor = ''
  placeholder = ''
  maxLength = 0
  rows = 0
  selected = false
  listeners = new Map<string, ((event: unknown) => void)[]>()
  constructor(public tagName: string) {}
  get textContent(): string {
    return this.children.map(child => child.textContent).join('')
  }
  set textContent(value: string) {
    this.children = value === '' ? [] : [new FakeText(String(value))]
  }
  set innerHTML(_: string) {
    throw new Error('innerHTML must never be used')
  }
  append(...nodes: (FakeNode | FakeText | string)[]) {
    for (const node of nodes) this.children.push(typeof node === 'string' ? new FakeText(node) : node)
  }
  replaceChildren(...nodes: (FakeNode | FakeText | string)[]) {
    this.children = []
    this.append(...nodes)
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({})
  }
  focus() {}
  select() {
    this.selected = true
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap(child => (child instanceof FakeNode ? child.all() : []))]
  }
  button(label: string) {
    const found = this.all().find(node => node.tagName === 'button' && node.textContent === label)
    if (!found) throw new Error(`no button "${label}"`)
    return found
  }
}

const tick = () => new Promise(done => setTimeout(done, 0))

describe('the MCP connection card', () => {
  let saved: unknown
  beforeAll(() => {
    const g = globalThis as Record<string, unknown>
    saved = g.document
    g.document = { createElement: (tag: string) => new FakeNode(tag.toLowerCase()) }
  })
  afterAll(() => {
    ;(globalThis as Record<string, unknown>).document = saved
  })

  function setup(copyOk = true) {
    const calls: { path: string; body?: unknown }[] = []
    const copied: string[] = []
    let keys = [{ id: 'abcd1234', name: MARKUP, created: '2026-11-20T10:00:00.000Z', lastUsed: null as string | null }]
    const host: McpHost = {
      get: async path => {
        calls.push({ path })
        return { status: 200, body: { keys } }
      },
      post: async (path, body) => {
        calls.push({ path, body })
        if (path === '/api/keys/create') {
          const name = (body as { name: string }).name
          keys = [...keys, { id: 'efgh5678', name, created: '2026-11-21T09:00:00.000Z', lastUsed: null }]
          return { status: 200, body: { id: 'efgh5678', name, created: '2026-11-21T09:00:00.000Z', key: 'mn_efgh5678_secret' } }
        }
        if (path === '/api/keys/revoke') return { status: 200, body: { ok: true } }
        return { status: 404, body: {} }
      },
      copy: async text => {
        copied.push(text)
        return copyOk
      },
      url: () => 'https://m.ts.net',
    }
    const state = newMcpState()
    const box = new FakeNode('div')
    const redraw = () => box.replaceChildren(drawMcp(state, host, redraw) as unknown as FakeNode)
    return { calls, copied, host, state, box, redraw }
  }

  test('lists the keys as text (never markup), "never" for an unused key', async () => {
    const { host, state, box, redraw } = setup()
    redraw()
    expect(box.textContent).toContain('Keys let your PCs and apps use this memory. A key is shown once.')
    expect(box.textContent).toContain('Loading the keys…')
    await loadKeys(state, host, redraw)
    const cells = box.all().filter(node => node.tagName === 'td').map(node => node.textContent)
    expect(cells).toContain(MARKUP)
    expect(cells).toContain('never')
    expect(cells).toContain('2026-11-20 10:00 UTC')
    expect(box.all().some(node => node.tagName === 'img')).toBe(false)
  })

  test('Create key: refuses an empty name, then shows the key once with the three copies', async () => {
    const { calls, copied, host, state, box, redraw } = setup()
    await loadKeys(state, host, redraw)
    box.button('Create key').fire('click')
    expect(box.textContent).toContain('Give the device a name')
    expect(calls.some(call => call.path === '/api/keys/create')).toBe(false)
    const name = box.all().find(node => node.tagName === 'input' && node.type === 'text')!
    name.value = ' Work laptop '
    name.fire('input')
    box.button('Create key').fire('click')
    await tick()
    await tick()
    expect(calls.find(call => call.path === '/api/keys/create')?.body).toEqual({ name: 'Work laptop' })
    expect(box.textContent).toContain('Copy it now: it is not shown again.')
    expect(box.textContent).toContain("/plugin → mnemosyne → configure")
    box.button('Copy key').fire('click')
    box.button('Copy plugin settings').fire('click')
    box.button('Copy MCP JSON').fire('click')
    await tick()
    expect(copied[0]).toBe('mn_efgh5678_secret')
    expect(copied[1]).toBe('serverUrl: https://m.ts.net\nserverKey: mn_efgh5678_secret')
    expect(JSON.parse(copied[2]!).mcpServers.mnemosyne.url).toBe('https://m.ts.net/mcp')
    expect(box.all().filter(node => node.tagName === 'td').map(node => node.textContent)).toContain('Work laptop')
    box.button('Done').fire('click')
    expect(box.textContent).not.toContain('mn_efgh5678_secret')
  })

  test('a refused copy selects the text instead', async () => {
    const { host, state, box, redraw } = setup(false)
    state.created = { name: 'Desk', key: 'mn_x_y' }
    await loadKeys(state, host, redraw)
    const copy = box.button('Copy key')
    copy.fire('click')
    await tick()
    expect(copy.textContent).toBe('Copy failed: the text is selected, press Ctrl+C')
    const field = box.all().find(node => node.tagName === 'input' && node.value === 'mn_x_y')!
    expect(field.readOnly).toBe(true)
    expect(field.selected).toBe(true)
  })

  test('Revoke takes two clicks; Cancel keeps the key', async () => {
    const { calls, host, state, box, redraw } = setup()
    await loadKeys(state, host, redraw)
    box.button('Revoke').fire('click')
    expect(calls.some(call => call.path === '/api/keys/revoke')).toBe(false)
    box.button('Cancel').fire('click')
    expect(state.confirming).toBeNull()
    box.button('Revoke').fire('click')
    box.button('Revoke key').fire('click')
    await tick()
    expect(calls.find(call => call.path === '/api/keys/revoke')?.body).toEqual({ id: 'abcd1234' })
    expect(box.textContent).toContain('No keys yet.')
  })
})

describe('the page wiring', () => {
  test('index.html has the sign-in card, the Sign out button and the MCP box, all hidden at first', () => {
    const html = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf8')
    for (const id of ['signin', 'signout', 'settings-mcp']) expect(html).toMatch(new RegExp(`id="${id}"[^>]*\\bhidden\\b`))
    for (const id of ['signin-form', 'signin-password', 'signin-submit', 'signin-error']) expect(html).toContain(`id="${id}"`)
    expect(html).toMatch(/id="signin-password"[^>]*type="password"/)
  })

  test('app.ts sends no Authorization header in server mode and skips the update check there', () => {
    const app = readFileSync(join(ROOT, 'ui', 'app.ts'), 'utf8')
    expect(app).toContain("serverMode ? {} : { Authorization: `Bearer ${token}` }")
    expect(app).toContain("health.server !== true) void loadUpdate(value)")
    expect(app).not.toMatch(/headers: \{ Authorization: `Bearer \$\{token\}` \}/)
  })
})

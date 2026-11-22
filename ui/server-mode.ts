// Server mode on the page (docs/plans/remote-server.md, "Dashboard API in server mode").
//
// The dashboard can run on a home server (Docker, reached over Tailscale) instead of on this computer.
// There the page has no #token= link: it asks GET /api/session (no auth), signs in with a password
// (a cookie, same origin) and sends no Authorization header. This file holds the pure parts the page
// and the specs share (reading /api/session and /api/keys, the sign-in error lines, the copy snippets)
// and the Settings tab's "MCP connection" card. Elements are built with createElement and textContent
// only: no HTML is ever parsed from data (tests/bun/inert.spec.ts scans this file too).
import { dateText, failureText } from './settings'

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---- Reading the replies ----

export type Session = { server: true; signedIn: boolean; publicUrl: string }

/** The GET /api/session answer when the page is in server mode; null otherwise (a local server answers 401 without the token). */
export function parseSession(status: number, body: unknown): Session | null {
  if (status !== 200 || !isObject(body) || body.server !== true) return null
  return { server: true, signedIn: body.signedIn === true, publicUrl: typeof body.publicUrl === 'string' ? body.publicUrl : '' }
}

/** The address the snippets name: the server's public URL, else this page's origin, with no trailing slash. */
export function baseUrl(publicUrl: string, origin: string): string {
  return (publicUrl.trim() || origin).replace(/\/+$/, '')
}

/** The line under the password field for a refused sign-in. */
export function loginErrorText(status: number, body: unknown): string {
  if (status === 401) return 'That password is not right.'
  if (status === 429) return `Too many tries, wait ${retryAfterSeconds(status, body)} s.`
  return failureText(status, body)
}

/** Seconds to keep Sign in off after a 429 (the server's retryAfter, else its 60 s pause); 0 for any other answer. */
export function retryAfterSeconds(status: number, body: unknown): number {
  if (status !== 429) return 0
  return isObject(body) && typeof body.retryAfter === 'number' && body.retryAfter > 0 ? Math.ceil(body.retryAfter) : 60
}

export type DeviceKey = { id: string; name: string; created: string; lastUsed: string | null }

/** The GET /api/keys answer made safe to draw; null when it is not a key list. */
export function parseKeys(body: unknown): DeviceKey[] | null {
  if (!isObject(body) || !Array.isArray(body.keys)) return null
  return body.keys.flatMap(item =>
    isObject(item) && typeof item.id === 'string' && item.id !== ''
      ? [{ id: item.id, name: typeof item.name === 'string' ? item.name : '', created: typeof item.created === 'string' ? item.created : '', lastUsed: typeof item.lastUsed === 'string' ? item.lastUsed : null }]
      : [],
  )
}

/** A device name as the server takes it (1 to 60 characters, trimmed), or the reason it is refused. */
export function checkKeyName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim()
  if (name === '') return { ok: false, error: 'Give the device a name, for example "Work laptop".' }
  if (name.length > 60) return { ok: false, error: 'Keep the name to 60 characters or fewer.' }
  return { ok: true, name }
}

// ---- What the copy buttons copy ----

/** The two plugin settings, one per line. */
export function pluginSettingsText(url: string, key: string): string {
  return `serverUrl: ${url}\nserverKey: ${key}`
}

/**
 * The MCP server entry for Cursor or Claude Desktop, pretty-printed. Its key is 'hal-m-memory', never 'hal-m', so
 * another client's tools never share the plugin's mcp__hal-m__ prefix (F-m4).
 */
export const MCP_SERVER_KEY = 'hal-m-memory'
export function mcpJson(url: string, key: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
}

export const PLUGIN_NOTE = 'These go into the HAL-M plugin\'s settings in Claude Code: /plugin → hal-m → configure.'

// ---- The Settings card ----

/** What the page gives the card: GET and POST through its own api (the cookie), the clipboard, and the server's address. */
export type McpHost = {
  get: (path: string) => Promise<{ status: number; body: unknown }>
  post: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>
  copy: (text: string) => Promise<boolean>
  url: () => string
}

/** The card's state, kept across redraws of the Settings tab. `created` is the key shown once, until Done or a reload. */
export type McpState = {
  keys: DeviceKey[] | null
  loading: boolean
  error: string
  name: string
  busy: boolean
  message: string
  created: { name: string; key: string } | null
  confirming: string | null
}

export const newMcpState = (): McpState => ({ keys: null, loading: false, error: '', name: '', busy: false, message: '', created: null, confirming: null })

function el<K extends keyof HTMLElementTagNameMap>(tag: K, content?: string, className?: string) {
  const element = document.createElement(tag)
  if (content !== undefined) element.textContent = content
  if (className) element.className = className
  return element
}

function button(label: string, className: string, onClick: () => void) {
  const element = el('button', label, `btn ${className}`.trim())
  element.type = 'button'
  element.addEventListener('click', onClick)
  return element
}

let fieldCount = 0

/** Reads the key list into the state and redraws; one read at a time. */
export async function loadKeys(state: McpState, host: McpHost, redraw: () => void) {
  if (state.loading) return
  state.loading = true
  try {
    const reply = await host.get('/api/keys')
    const keys = reply.status === 200 ? parseKeys(reply.body) : null
    if (keys === null) state.error = `Could not read the keys: ${failureText(reply.status, reply.body)}`
    else {
      state.keys = keys
      state.error = ''
    }
  } finally {
    state.loading = false
  }
  redraw()
}

/** A read-only field holding `value` and a button that copies it; when the clipboard refuses, the text is selected instead. */
function copyBlock(label: string, value: string, host: McpHost, multiline: boolean): HTMLElement {
  const wrap = el('div', undefined, 'mcp-copy')
  const field = multiline ? el('textarea', undefined, 'input mono mcp-text') : el('input', undefined, 'input mono mcp-text')
  field.readOnly = true
  field.value = value
  if (multiline) (field as HTMLTextAreaElement).rows = value.split('\n').length
  field.id = `mcp-f-${++fieldCount}`
  field.setAttribute('aria-label', label)
  const copy = button(label, 'small', () => {
    void (async () => {
      const ok = await host.copy(value)
      if (ok) copy.textContent = 'Copied'
      else {
        field.focus?.()
        field.select?.()
        copy.textContent = 'Copy failed: the text is selected, press Ctrl+C'
      }
    })()
  })
  wrap.append(field, copy)
  return wrap
}

/** The "MCP connection" card: create a key (shown once, with its snippets) and the list of keys with Revoke. */
export function drawMcp(state: McpState, host: McpHost, redraw: () => void): HTMLElement {
  const card = el('section', undefined, 'card set-group mcp-card')
  card.setAttribute('aria-label', 'MCP connection')
  card.dataset.group = 'mcp'
  card.append(el('h2', 'MCP connection', 'card-title'), el('p', 'Keys let your PCs and apps use this memory. A key is shown once.', 'set-help small muted'))

  // Create a key.
  const form = el('div', undefined, 'mcp-create')
  const name = el('input', undefined, 'input')
  name.type = 'text'
  name.maxLength = 60
  name.placeholder = 'Device name, e.g. Work laptop'
  name.value = state.name
  name.id = `mcp-name-${++fieldCount}`
  name.addEventListener('input', () => (state.name = name.value))
  const label = el('label', 'Device name', 'set-label')
  label.htmlFor = name.id
  const message = el('p', state.message, 'set-msg warn')
  message.hidden = state.message === ''
  const create = button('Create key', 'primary', () => {
    const checked = checkKeyName(name.value)
    if (!checked.ok) {
      state.message = checked.error
      return redraw()
    }
    if (state.busy) return
    state.busy = true
    create.disabled = true
    void (async () => {
      try {
        const reply = await host.post('/api/keys/create', { name: checked.name })
        const body = reply.body
        if (reply.status === 200 && isObject(body) && typeof body.key === 'string') {
          state.created = { name: typeof body.name === 'string' ? body.name : checked.name, key: body.key }
          state.name = ''
          state.message = ''
        } else state.message = failureText(reply.status, body)
      } finally {
        state.busy = false
      }
      redraw()
      void loadKeys(state, host, redraw)
    })()
  })
  create.disabled = state.busy
  const line = el('div', undefined, 'mcp-create-line')
  line.append(name, create)
  form.append(label, line, message)
  card.append(form)

  // The new key, once.
  if (state.created !== null) {
    const { key } = state.created
    const url = host.url()
    const box = el('div', undefined, 'mcp-new')
    box.setAttribute('role', 'status')
    box.append(el('p', `Key for "${state.created.name}". Copy it now: it is not shown again.`, 'mcp-new-title'))
    box.append(copyBlock('Copy key', key, host, false))
    box.append(el('p', 'Claude Code (HAL-M plugin)', 'set-label'), copyBlock('Copy plugin settings', pluginSettingsText(url, key), host, true), el('p', PLUGIN_NOTE, 'small muted'))
    box.append(el('p', 'Cursor or Claude Desktop', 'set-label'), copyBlock('Copy MCP JSON', mcpJson(url, key), host, true))
    box.append(
      button('Done', '', () => {
        state.created = null
        redraw()
      }),
    )
    card.append(box)
  }

  // The keys.
  if (state.error) card.append(el('p', state.error, 'set-msg warn'))
  if (state.keys === null) {
    if (!state.error) card.append(el('p', 'Loading the keys…', 'small muted'))
  } else if (state.keys.length === 0) card.append(el('p', 'No keys yet.', 'small muted'))
  else {
    const table = el('table', undefined, 'mcp-table')
    const head = el('tr')
    for (const title of ['Name', 'Created', 'Last used', '']) head.append(el('th', title))
    const thead = el('thead')
    thead.append(head)
    const tbody = el('tbody')
    for (const item of state.keys) {
      const row = el('tr')
      const action = el('div', undefined, 'mcp-action')
      const actionCell = el('td')
      actionCell.append(action)
      if (state.confirming === item.id) {
        const sure = el('span', 'Revoke? Devices using it stop working.', 'small')
        const go = button('Revoke key', 'danger small', () => {
          if (state.busy) return
          state.busy = true
          go.disabled = true
          void (async () => {
            try {
              const reply = await host.post('/api/keys/revoke', { id: item.id })
              if ((reply.status === 200 && isObject(reply.body) && reply.body.ok === true) || reply.status === 404) {
                // 404: it was already gone; either way it leaves the list.
                state.keys = (state.keys ?? []).filter(other => other.id !== item.id)
                state.message = ''
              } else state.message = `Could not revoke "${item.name}": ${failureText(reply.status, reply.body)}`
            } finally {
              state.busy = false
              state.confirming = null
            }
            redraw()
          })()
        })
        const cancel = button('Cancel', 'small', () => {
          state.confirming = null
          redraw()
        })
        action.append(sure, go, cancel)
      } else
        action.append(
          button('Revoke', 'danger-outline small', () => {
            state.confirming = item.id
            redraw()
          }),
        )
      row.append(el('td', item.name), el('td', item.created ? dateText(item.created) : '', 'mono small'), el('td', item.lastUsed === null ? 'never' : dateText(item.lastUsed), 'mono small'), actionCell)
      tbody.append(row)
    }
    table.append(thead, tbody)
    card.append(table)
  }
  return card
}

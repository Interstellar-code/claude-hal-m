// A dev dashboard straight from this checkout, beside the installed one.
//
//   bun run dev:ui                 starts it on 127.0.0.1:47175 and opens the link
//   HALM_UI_PORT=47200 bun run dev:ui   another port (MNEMOSYNE_UI_PORT still works)
//
// It runs ui/server.ts under `bun --watch` with HALM_UI_DEV=1: the page,
// style and app are read and built again on every request, and the page reloads
// itself within a second when a file in ui/ changes. An edit to the server
// restarts it on the same port with the same token, so the open tab keeps
// working. It reads the real store (read-only, as the installed dashboard does)
// and writes its own ui.json under <HAL-M data folder>/dev-ui, so the installed
// dashboard and its /hal-m-ui link are left alone. A search or forget from
// it goes through the engine and the activity log like the installed one's.
// Ctrl-C stops it.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dataRoot } from '../bin/migrate-root'
import { childEnv, commandName, envOf } from '../hooks/names'

const REPO = join(import.meta.dir, '..')
// HALM_HOME (or MNEMOSYNE_HOME) names the data folder by hand; else the resolver's root (~/.hal-m, or the 0.37 folder
// when only that exists). Read-only: never links.
const BASE = envOf('HOME', process.env) ?? dataRoot(homedir(), process.env).root
const port = Number(envOf('UI_PORT', process.env) ?? 47175)
// One token for this run: every restart under --watch keeps it, so the tab's stored token stays good.
const token = randomBytes(32).toString('base64url')

// HALM_DEV_ENGINE=repo runs this checkout's engine/src instead of the installed one (to try an engine change before installing it).
const cli = envOf('DEV_ENGINE', process.env) === 'repo' ? join(REPO, 'engine', 'src', 'cli.ts') : join(BASE, 'engine', 'node_modules', '@oh-my-pi', 'pi-mnemopi', 'src', 'cli.ts')
if (!existsSync(cli)) {
  console.error(`No installed engine at ${cli}. Run /${commandName('setup')} once in Claude Code first.`)
  process.exit(1)
}

const child = Bun.spawn(['bun', '--watch', join(REPO, 'ui', 'server.ts')], {
  cwd: REPO,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'inherit',
  // Each name set as HALM_<X>, its MNEMOSYNE_<X> spelling deleted, so the server never reads a stale inherited value.
  env: childEnv(process.env, {
    UI_DEV: '1',
    UI_PORT: String(port),
    UI_TOKEN: token,
    ROOT: join(BASE, 'dev-ui'),
    STORE: join(BASE, 'store'),
    CLI: cli,
    // Empty HALM_ACTIVITY_LOG is a value (log off) and passes through as empty.
    ACTIVITY_LOG: envOf('ACTIVITY_LOG', process.env) ?? join(BASE, 'activity.jsonl'),
    PLUGIN_ROOT: REPO,
    EXTRACTION: envOf('EXTRACTION', process.env) ?? 'unknown',
    // On when /hal-m-setup downloaded the model (its marker file), as the installed dashboard sees it.
    EMBEDDINGS: envOf('EMBEDDINGS', process.env) ?? (existsSync(join(BASE, 'embeddings.json')) ? 'on' : 'off'),
  }),
})

const link = `http://127.0.0.1:${port}/#token=${token}`
let opened = false
void (async () => {
  const decoder = new TextDecoder()
  for await (const chunk of child.stdout) {
    const text = decoder.decode(chunk)
    // The server's ready line ({"port","pid"}) comes once per start; the link is shown and opened on the first.
    if (!opened && text.includes('"port"')) {
      opened = true
      console.log(`Dev dashboard: ${link}`)
      console.log('Edits in ui/ reload the page; edits to ui/server.ts restart the server. Ctrl-C stops it.')
      if (process.platform === 'darwin') Bun.spawn(['open', link])
      else if (process.platform === 'linux') Bun.spawn(['xdg-open', link])
    } else if (text.includes('"port"')) {
      console.log('Server restarted.')
    } else {
      process.stdout.write(text)
    }
  }
})()

const stop = () => {
  child.kill()
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop)
process.exit(await child.exited)

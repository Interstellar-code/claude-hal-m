// bin/update.ts (issue #43): the one-step update for Claude Desktop machines.
// Planning, refusals, process sorting, launcher and staging logic only: no real
// network, no process listing, no install. Release staging runs against a fake
// runner and a fake fetch in a temp folder.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDINGS_CACHE_DIR } from '../../hooks/engine'
import { cmdWrapper, launcherFile, oldLauncherFile, shimText, shWrapper } from '../../hooks/launcher'
import { modelCacheDir, newRootOf, oldRootOf } from '../../hooks/names'
import { slashes } from '../../hooks/owner'
import { cliOf } from '../../bin/install-engine'
import {
  fileList,
  isSwapFailure,
  pluginCopyProblems,
  pruneStaging,
  REQUIRED_PLUGIN_FILES,
  runStagingDir,
  swapFolder,
  writeLauncher,
  lockedMessage,
  nextStatus,
  classifyProcesses,
  compareVersions,
  defaultModelCache,
  EXIT,
  findTask,
  forwardingScript,
  forwardingVbs,
  homeLayout,
  OLD_TASK_NAME,
  SHORTCUT_NAME,
  sourceProblem,
  TASK_NAME,
  type InstallState,
  latestReleaseTag,
  launcherFor,
  launcherText,
  main,
  parseArgs,
  parseLauncher,
  parseLsRemoteTags,
  parseProcessList,
  planUpdate,
  pluginCopyIncludes,
  type Proc,
  type Runner,
  readInstalled,
  readSource,
  shortcutScript,
  shortcutVbs,
  type SourceState,
  stageRelease,
  summary,
  UpdateError,
} from '../../bin/update'
import { tempDir } from './helpers'

const HOME = join(tempDir('update-home').dir, 'home')
// No HALM_ROOT from the shell running the tests: the layout comes from the temp home alone.
const layout = homeLayout(HOME, join(HOME, 'AppData', 'Roaming'), {})
const NONE = { chats: [], dashboard: [], others: [] }

describe('parseArgs', () => {
  test('defaults and flags', () => {
    expect(parseArgs([])).toEqual({ waitSeconds: 0, stopEngines: false, force: false, installShortcut: false })
    expect(parseArgs(['--from', '/x', '--wait', '600', '--stop-engines', '--force'])).toMatchObject({ from: '/x', waitSeconds: 600, stopEngines: true, force: true })
    expect(parseArgs(['--tag', 'v0.28.0']).tag).toBe('v0.28.0')
    expect(parseArgs(['--install-shortcut']).installShortcut).toBe(true)
  })
  test('refuses bad input', () => {
    expect(() => parseArgs(['--tag', 'latest'])).toThrow('--tag must look like v1.2.3')
    expect(() => parseArgs(['--from'])).toThrow('--from needs a value')
    expect(() => parseArgs(['--from', '--force'])).toThrow('--from needs a value')
    expect(() => parseArgs(['--wait', '-1'])).toThrow('--wait needs a number')
    expect(() => parseArgs(['--from', '/x', '--tag', 'v1.0.0'])).toThrow('cannot be used together')
    expect(() => parseArgs(['--kill'])).toThrow('unknown argument "--kill"')
  })
})

describe('versions and tags', () => {
  test('compareVersions is numeric', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.27.0', '0.27.0')).toBe(0)
    expect(compareVersions('v0.11.0', '0.27.0')).toBe(-1)
    expect(compareVersions(undefined, '0.1.0')).toBe(-1)
    expect(compareVersions('0.1.0', undefined)).toBe(1)
  })
  test('latest release tag from ls-remote output, ignoring peeled refs and pre-releases', () => {
    const text = ['aaa\trefs/tags/v0.9.0', 'bbb\trefs/tags/v0.10.0', 'ccc\trefs/tags/v0.10.0^{}', 'ddd\trefs/tags/v0.11.0-rc1', 'eee\trefs/tags/nightly', 'fff\trefs/heads/main', ''].join('\n')
    expect(parseLsRemoteTags(text)).toEqual(['v0.9.0', 'v0.10.0', 'v0.11.0-rc1', 'nightly'])
    expect(latestReleaseTag(parseLsRemoteTags(text))).toBe('v0.10.0')
    expect(latestReleaseTag(['nightly'])).toBeUndefined()
  })
})

// Shaped like the real Windows process list: Claude Desktop's proxies and engines,
// the always-on dashboard (loop, holder, server, its engine), a repo dev server.
function processes(): Proc[] {
  const engine = `bun ${slashes(cliOf(layout.engine))} mcp`
  const proxy = `bun  "${slashes(join(layout.plugin, 'bin', 'mcp-proxy.ts'))}"`
  return [
    { pid: 10, ppid: 1, command: proxy },
    { pid: 11, ppid: 10, command: engine },
    { pid: 20, ppid: 2, command: proxy },
    { pid: 21, ppid: 20, command: engine },
    { pid: 30, ppid: 3, command: `powershell.exe -WindowStyle Hidden -File "${join(layout.uiDir, 'run-ui.ps1')}"` },
    // start-ui.cmd's cmd.exe: its current folder is the plugin copy, and its command line names only start-ui.cmd.
    { pid: 34, ppid: 4, command: `"C:\\WINDOWS\\System32\\cmd.exe" /d /c ""${join(layout.uiDir, 'start-ui.cmd')}""` },
    { pid: 31, ppid: 34, command: `bun.exe "${join(layout.plugin, 'ui', 'server.ts')}" --hold` },
    { pid: 32, ppid: 31, command: `bun.exe ${join(layout.plugin, 'ui', 'server.ts')}` },
    { pid: 33, ppid: 32, command: engine },
    { pid: 35, ppid: 32, command: 'git.exe status' },
    { pid: 40, ppid: 5, command: engine },
    { pid: 50, ppid: 6, command: 'bun --watch C:\\code\\claude-mnemosyne\\ui\\server.ts' },
    { pid: 60, ppid: 7, command: `bun ${slashes(cliOf(`${layout.engine}.next`))} mcp` },
    { pid: 70, ppid: 8, command: `"C:\\Program Files\\Editor\\editor.exe" "${join(layout.plugin, 'ui', 'app.ts')}"` },
    { pid: 80, ppid: 9, command: `bun "${join(layout.plugin, 'bin', 'update.ts')}"` },
  ]
}

describe('classifyProcesses', () => {
  const sorted = classifyProcesses(processes(), layout)
  test('chats: one per proxy with its engine, an engine with no proxy alone', () => {
    expect(sorted.chats.map(chat => [chat.proxy?.pid, chat.engines.map(e => e.pid)])).toEqual([
      [10, [11]],
      [20, [21]],
      [undefined, [40]],
    ])
  })
  test('the dashboard: loop, the start-ui.cmd cmd.exe, holder, server and everything below them', () => {
    expect(sorted.dashboard.map(p => p.pid).sort()).toEqual([30, 31, 32, 33, 34, 35])
  })
  test('others: a program naming a file of the install, never the updater itself', () => {
    expect(sorted.others.map(p => p.pid)).toEqual([70])
  })
  test('a repo dev server and the install check engine are not ours', () => {
    const pids = [...sorted.dashboard.map(p => p.pid), ...sorted.chats.flatMap(chat => [chat.proxy?.pid, ...chat.engines.map(e => e.pid)])]
    expect(pids).not.toContain(50)
    expect(pids).not.toContain(60)
  })
  test('Windows paths match case-insensitively and with either slash', () => {
    const upper: Proc = { pid: 70, ppid: 1, command: `BUN ${cliOf(layout.engine).toUpperCase().replace(/\//g, '\\')} mcp` }
    expect(classifyProcesses([upper], layout, true).chats).toHaveLength(1)
  })
})

describe('parseProcessList', () => {
  test('PowerShell JSON: an array, a single object, empty output', () => {
    expect(parseProcessList('[{"ProcessId":1,"ParentProcessId":0,"CommandLine":"a"},{"ProcessId":2,"ParentProcessId":1,"CommandLine":null}]', true)).toEqual([
      { pid: 1, ppid: 0, command: 'a' },
      { pid: 2, ppid: 1, command: '' },
    ])
    expect(parseProcessList('{"ProcessId":5,"ParentProcessId":4,"CommandLine":"b"}', true)).toEqual([{ pid: 5, ppid: 4, command: 'b' }])
    expect(parseProcessList('', true)).toEqual([])
  })
  test('ps output', () => {
    expect(parseProcessList('  12   1 bun /x/cli.ts mcp\n13 12 sh -c a b\n', false)).toEqual([
      { pid: 12, ppid: 1, command: 'bun /x/cli.ts mcp' },
      { pid: 13, ppid: 12, command: 'sh -c a b' },
    ])
  })
})

describe('planUpdate', () => {
  const source: SourceState = { dir: '/src', pluginVersion: '0.28.0', engineBuild: '18.12.3-mnemosyne.12', hasUpdater: true }
  const installed: InstallState = { pluginVersion: '0.11.0', engineBuild: '18.12.3-mnemosyne.11', launcherText: 'old' }
  const base = { installed, source, expectedLauncher: 'new', processes: NONE, windows: true, force: false, stopEngines: false }

  test('everything that differs is updated; nothing running, nothing stopped', () => {
    expect(planUpdate(base)).toEqual({ kind: 'update', engine: true, plugin: true, launcher: true, stopChats: [], stopDashboard: [], notes: [] })
  })
  test('up to date when versions and launcher match; --force reinstalls', () => {
    const current = { ...base, installed: { pluginVersion: '0.28.0', engineBuild: '18.12.3-mnemosyne.12', launcherText: 'new' } }
    expect(planUpdate(current).kind).toBe('up-to-date')
    expect(planUpdate({ ...current, force: true })).toMatchObject({ kind: 'update', engine: true, plugin: true, launcher: true })
  })
  test('the engine is left alone when its build matches', () => {
    expect(planUpdate({ ...base, installed: { ...installed, engineBuild: source.engineBuild } })).toMatchObject({ engine: false, plugin: true })
  })
  test('an older source is refused unless forced', () => {
    const older = { ...base, source: { ...source, pluginVersion: '0.10.0' } }
    expect(planUpdate(older)).toMatchObject({ kind: 'refused', code: EXIT.failed })
    expect(planUpdate({ ...older, force: true }).kind).toBe('update')
  })
  test('a folder that is not a checkout is refused', () => {
    expect(planUpdate({ ...base, source: { ...source, engineBuild: undefined } })).toMatchObject({ kind: 'refused', message: expect.stringContaining('not a claude-hal-m checkout') })
    expect(planUpdate({ ...base, source: { ...source, pluginVersion: undefined } })).toMatchObject({ kind: 'refused', message: expect.stringContaining('not a claude-hal-m checkout') })
  })
  test('Windows: running chats do not refuse the plan (the swap is tried; a running engine does not always lock it)', () => {
    const plan = planUpdate({ ...base, processes: classifyProcesses(processes(), layout) })
    expect(plan).toMatchObject({ kind: 'update', engine: true, plugin: true, stopChats: [] })
    expect((plan as { notes: string[] }).notes[0]).toBe('3 running MCP connection(s) keep the old version until their app is restarted.')
  })
  test('a refused swap is reported with each connection, how many, and whether anything changed', () => {
    const sorted = classifyProcesses(processes(), layout)
    const message = lockedMessage(sorted, true, 'C:/home/.claude/mnemosyne/plugin')
    expect(message).toContain('Windows would not let the update replace C:/home/.claude/mnemosyne/plugin: a program has a file or the folder open.')
    expect(message).toContain('(3 MCP connections running) and may be holding it')
    expect(message).toContain('proxy pid 10 with engine pid 11')
    expect(message).toContain('proxy pid 20 with engine pid 21')
    expect(message).toContain('engine pid 40')
    expect(message).toContain('Dashboard processes still running: powershell.exe 30, cmd.exe 34')
    expect(message).toContain('Other programs using the install: editor.exe 70')
    expect(message).toContain('Nothing was changed; the previous version keeps working.')
    expect(message).toContain('Quit Claude Desktop')
    expect(lockedMessage(sorted, false)).toContain('Part of the update is in place')
    expect(lockedMessage({ chats: [{ engines: [{ pid: 9, ppid: 1, command: '' }] }], dashboard: [], others: [] }, true)).toContain('A Claude chat uses HAL-M (1 MCP connection running)')
  })
  test('nothing of HAL-M found: no chats are blamed, another program is named as the likely holder', () => {
    const message = lockedMessage({ chats: [], dashboard: [], others: [] }, true)
    expect(message).not.toContain('Claude chat')
    expect(message).not.toContain('Quit Claude Desktop')
    expect(message).toContain('No HAL-M process was found')
    expect(message).toContain('Close what holds it, then update again.')
  })
  test('the message names the folder the refused rename was for', () => {
    expect(swapFolder(new Error('could not move the new plugin copy into place (the old one is kept): EPERM'), layout)).toBe(layout.plugin)
    expect(swapFolder(new Error('could not move the new engine into place: EBUSY'), layout)).toBe(layout.engine)
  })
  test('only a refused rename counts as a locked swap, not a failed build or check', () => {
    expect(isSwapFailure(new Error('could not move the new engine into place: EBUSY'))).toBe(true)
    expect(isSwapFailure(new Error('could not move the new plugin copy into place (the old one is kept): EPERM'))).toBe(true)
    expect(isSwapFailure(new Error('bun install failed (exit 1)'))).toBe(false)
    expect(isSwapFailure(undefined)).toBe(false)
  })
  test('Windows: --stop-engines stops the chats only; the dashboard is stopped for the swap', () => {
    const plan = planUpdate({ ...base, stopEngines: true, processes: classifyProcesses(processes(), layout) })
    expect(plan).toMatchObject({ kind: 'update', stopChats: [10, 11, 20, 21, 40] })
    expect((plan as { stopDashboard: Proc[] }).stopDashboard.map(p => p.pid).sort()).toEqual([30, 31, 32, 33, 34, 35])
  })
  test('processes are never stopped without --stop-engines', () => {
    for (const windows of [true, false]) {
      const plan = planUpdate({ ...base, windows, processes: classifyProcesses(processes(), layout) })
      if (plan.kind === 'update') expect(plan.stopChats).toEqual([])
    }
  })
  test('elsewhere running chats do not block: they keep the old version until restarted', () => {
    const plan = planUpdate({ ...base, windows: false, processes: classifyProcesses(processes(), layout) })
    expect(plan).toMatchObject({ kind: 'update', stopChats: [], stopDashboard: [] })
    expect((plan as { notes: string[] }).notes[0]).toContain('keep the old version')
  })
  test('a launcher-only rewrite neither blocks nor stops anything', () => {
    const plan = planUpdate({ ...base, installed: { pluginVersion: '0.28.0', engineBuild: source.engineBuild, launcherText: 'old' }, processes: classifyProcesses(processes(), layout) })
    expect(plan).toEqual({ kind: 'update', engine: false, plugin: false, launcher: true, stopChats: [], stopDashboard: [], notes: [] })
  })
})

describe('the progress file (--status)', () => {
  const at = (iso: string) => new Date(iso)
  test('lines append, the state moves to running, then to a final state with the exit code', () => {
    const begun = nextStatus(undefined, { state: 'starting', lines: ['Starting'] }, at('2026-11-07T10:00:00Z'))!
    expect(begun).toEqual({ state: 'starting', lines: ['Starting'], started: '2026-11-07T10:00:00.000Z', updated: '2026-11-07T10:00:00.000Z' })
    const mid = nextStatus(begun, { lines: ['Installing'] }, at('2026-11-07T10:01:00Z'))!
    expect(mid).toMatchObject({ state: 'running', lines: ['Starting', 'Installing'], started: '2026-11-07T10:00:00.000Z' })
    expect(nextStatus(mid, { state: 'blocked', code: EXIT.blocked })).toMatchObject({ state: 'blocked', code: 2 })
  })
  test('a final state is not replaced by another (the staging parent keeps its child result)', () => {
    const done = nextStatus(undefined, { state: 'done', code: 0 })!
    expect(nextStatus(done, { state: 'failed', code: 1 })).toBeUndefined()
    expect(nextStatus(done, { lines: ['late line'] })).toMatchObject({ state: 'done', lines: ['late line'] })
  })
  test('only the last 200 lines are kept', () => {
    const many = Array.from({ length: 250 }, (_, i) => `line ${i}`)
    const status = nextStatus(undefined, { lines: many })!
    expect(status.lines).toHaveLength(200)
    expect(status.lines[0]).toBe('line 50')
  })
  test('--status is an option', () => {
    expect(parseArgs(['--status', '/x/update-status.json']).status).toBe('/x/update-status.json')
  })
})

describe('the launcher', () => {
  // The launcher 0.9.0 wrote on the author's machine (paths made up), with embeddings on and the bare default cache dir.
  const existing = cmdWrapper({
    store: 'D:/memory/store',
    cli: 'C:/old/engine/cli.ts',
    proxy: 'C:/old/plugin/bin/mcp-proxy.ts',
    activity: '',
    embeddings: true,
    guardMode: 'warn',
    vocabulary: 'D:/memory/vocabulary.json',
    root: 'D:/memory',
    modelCacheDir: EMBEDDINGS_CACHE_DIR,
  })
  test('keeps every user choice, points engine and proxy at the install', () => {
    expect(launcherFor(layout, existing, false)).toEqual({
      store: 'D:/memory/store',
      cli: slashes(cliOf(layout.engine)),
      proxy: slashes(join(layout.plugin, 'bin', 'mcp-proxy.ts')),
      activity: '',
      embeddings: true,
      guardMode: 'warn',
      vocabulary: 'D:/memory/vocabulary.json',
      root: 'D:/memory',
      // The 0.37 relative default names the old root: it follows the resolved root (here the new one).
      modelCacheDir: slashes(modelCacheDir(layout.root)),
    })
  })
  test('the rewrite uses the current templates (0.27.2 clears MNEMOPI_OWNER_PER_CALL)', () => {
    expect(launcherText(launcherFor(layout, existing, false), true)).toContain('set "MNEMOPI_OWNER_PER_CALL="')
    expect(launcherText(launcherFor(layout, existing, false), false)).toContain('export MNEMOPI_OWNER_PER_CALL=\n')
  })
  test('no launcher yet: the default layout, embeddings from the marker', () => {
    expect(launcherFor(layout, undefined, true)).toMatchObject({ store: slashes(layout.store), activity: slashes(layout.activity), embeddings: true, guardMode: 'strict', root: slashes(layout.root) })
    expect(launcherFor(layout, undefined, false).embeddings).toBe(false)
  })
  test('sh launchers: quoted values and unset embeddings', () => {
    const sh = "#!/bin/sh\nexport MNEMOPI_DATA_DIR='/home/o'\\''neil/store'\nunset MNEMOPI_NO_EMBEDDINGS\nexport MNEMOSYNE_GUARD_MODE=strict\n"
    expect(parseLauncher(sh).values.get('MNEMOPI_DATA_DIR')).toBe("/home/o'neil/store")
    expect(launcherFor(layout, sh, false)).toMatchObject({ store: "/home/o'neil/store", embeddings: true })
  })
  test('rewriting a current launcher gives the same bytes, so no rewrite is planned', () => {
    const current = launcherText(launcherFor(layout, existing, false), true)
    expect(launcherText(launcherFor(layout, current, false), true)).toBe(current)
  })
})

describe('the plugin copy', () => {
  test('leaves out git, packages, tests and the engine tests', () => {
    for (const rel of ['', 'bin/mcp-proxy.ts', 'ui/server.ts', 'engine/src/cli.ts', '.claude-plugin/plugin.json', 'ui/vendor/x.js']) expect(pluginCopyIncludes(rel)).toBe(true)
    for (const rel of ['.git', '.git/config', 'node_modules', 'engine/node_modules/a', 'ui/node_modules/x', 'tests/bun/a.spec.ts', 'engine\\test\\a.ts']) expect(pluginCopyIncludes(rel)).toBe(false)
  })
})

describe('reading versions', () => {
  test('installed and source state from their files', () => {
    const { dir } = tempDir('update-read')
    const home = homeLayout(dir)
    mkdirSync(join(home.plugin, '.claude-plugin'), { recursive: true })
    writeFileSync(join(home.plugin, '.claude-plugin', 'plugin.json'), '{"version":"0.11.0"}')
    mkdirSync(join(home.engine, 'node_modules', '@oh-my-pi', 'pi-mnemopi'), { recursive: true })
    writeFileSync(join(home.engine, 'node_modules', '@oh-my-pi', 'pi-mnemopi', 'package.json'), '{"version":"18.12.3-mnemosyne.11"}')
    expect(readInstalled(home)).toEqual({ pluginVersion: '0.11.0', engineBuild: '18.12.3-mnemosyne.11', launcherText: undefined })
    expect(readInstalled(homeLayout(join(dir, 'nobody')))).toEqual({ pluginVersion: undefined, engineBuild: undefined, launcherText: undefined })
    const repo = join(import.meta.dir, '..', '..')
    const self = readSource(repo)
    expect(self.hasUpdater).toBe(true)
    expect(self.pluginVersion).toBe(JSON.parse(readFileSync(join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version)
    expect(self.engineBuild).toBe(JSON.parse(readFileSync(join(repo, 'engine', 'package.json'), 'utf8')).version)
  })
})

describe('summary', () => {
  test('old -> new, unchanged parts said so', () => {
    const plan = { kind: 'update' as const, engine: false, plugin: true, launcher: true, stopChats: [], stopDashboard: [], notes: [] }
    const text = summary({ pluginVersion: '0.11.0', engineBuild: 'b12' }, { pluginVersion: '0.28.0', engineBuild: 'b12' }, plan)
    expect(text).toContain('plugin 0.11.0 -> 0.28.0')
    expect(text).toContain('engine b12 (unchanged)')
    expect(text).toContain('launcher rewritten')
  })
})

describe('the Windows shortcut scripts', () => {
  test('run the installed updater hidden, offer --stop-engines only after asking', () => {
    const home = homeLayout("C:\\Users\\o'neil", undefined, {})
    const script = shortcutScript(home, 'C:\\bun.exe')
    // A fresh home: the new root; the quote in the path doubled for PowerShell.
    expect(home.root).toBe("C:\\Users\\o'neil\\.hal-m")
    expect(script).toContain(`$updater = '${join(home.plugin, 'bin', 'update.ts').replace(/'/g, "''")}'`)
    expect(script).toContain(`the Start Menu entry "${SHORTCUT_NAME}" runs it through update-hal-m.vbs`)
    expect(script).toContain(`if ($code -eq ${EXIT.blocked})`)
    expect(script).toContain("'YesNo'")
    expect(script).toContain("if ($answer -eq 'Yes') { & $PSCommandPath -StopEngines }")
    expect(script).toContain('"`r?`n"')
    expect(shortcutVbs()).toContain('update-hal-m.ps1""", 0, False')
    expect(SHORTCUT_NAME).toBe('Update HAL-M')
  })
  test('the 0.37 script names forward to the new scripts', () => {
    expect(forwardingScript("C:\\Users\\o'neil\\.hal-m-ui\\update-hal-m.ps1")).toContain("& 'C:\\Users\\o''neil\\.hal-m-ui\\update-hal-m.ps1' @args")
    expect(forwardingVbs('C:\\u\\.hal-m-ui\\update-hal-m.vbs')).toContain('.Run "wscript.exe //B //Nologo ""C:\\u\\.hal-m-ui\\update-hal-m.vbs""", 0, False')
  })
})

describe('stageRelease (fake runner and fetch, no network)', () => {
  test('with git: lists tags and clones the newest release', async () => {
    const { dir } = tempDir('update-stage')
    const calls: string[][] = []
    const runner: Runner = async argv => {
      calls.push(argv)
      if (argv[1] === 'ls-remote') return { stdout: 'a\trefs/tags/v0.9.0\nb\trefs/tags/v0.27.0\nc\trefs/tags/v0.28.0-rc1\n', stderr: '', exitCode: 0 }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const fetcher = (() => {
      throw new Error('no network in tests')
    }) as unknown as typeof fetch
    expect(await stageRelease(join(dir, 'staging'), undefined, runner, fetcher)).toBe('v0.27.0')
    expect(calls.at(-1)).toEqual(['git', '-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', 'v0.27.0', 'https://github.com/Interstellar-code/claude-hal-m.git', join(dir, 'staging')])
  })
  test('with git and --tag: no listing', async () => {
    const { dir } = tempDir('update-stage')
    const calls: string[][] = []
    const runner: Runner = async argv => (calls.push(argv), { stdout: '', stderr: '', exitCode: 0 })
    expect(await stageRelease(join(dir, 'staging'), 'v0.20.0', runner)).toBe('v0.20.0')
    expect(calls.some(argv => argv[1] === 'ls-remote')).toBe(false)
  })
  test('a failed clone is an UpdateError naming the tag', async () => {
    const { dir } = tempDir('update-stage')
    const runner: Runner = async argv => ({ stdout: '', stderr: 'fatal: unreachable', exitCode: argv[1] === 'clone' || argv[3] === 'clone' ? 128 : 0 })
    await expect(stageRelease(join(dir, 'staging'), 'v0.20.0', runner)).rejects.toThrow('could not download v0.20.0: fatal: unreachable')
  })
  test('without git: the tags API, the tarball and tar', async () => {
    const { dir } = tempDir('update-stage')
    const staging = join(dir, 'staging')
    const urls: string[] = []
    const fetcher = (async (url: string) => {
      urls.push(url)
      if (url.includes('/tags?')) return Response.json([{ name: 'v0.26.1' }, { name: 'v0.27.0' }, { name: 'junk' }])
      return new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const calls: string[][] = []
    let tarballSeen = false
    const runner: Runner = async argv => {
      calls.push(argv)
      if (argv[0] === 'git') return { stdout: '', stderr: 'not found', exitCode: 127 }
      tarballSeen = existsSync(argv[2]!)
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    expect(await stageRelease(staging, undefined, runner, fetcher)).toBe('v0.27.0')
    expect(urls[1]).toBe('https://codeload.github.com/Interstellar-code/claude-hal-m/tar.gz/refs/tags/v0.27.0')
    expect(calls.at(-1)).toEqual(['tar', '-xzf', `${staging}.tar.gz`, '-C', staging, '--strip-components=1'])
    expect(tarballSeen).toBe(true)
    expect(existsSync(`${staging}.tar.gz`)).toBe(false)
  })
})

describe('main refusals before anything runs', () => {
  test('no install under the home', async () => {
    const { dir } = tempDir('update-main')
    const error = await main(['--from', dir, '--home', join(dir, 'nobody')], () => {}).catch(e => e)
    expect(error).toBeInstanceOf(UpdateError)
    expect((error as UpdateError).message).toContain('no HAL-M install at')
    expect((error as UpdateError).code).toBe(EXIT.failed)
  })
  test('a source inside the install is refused', async () => {
    const { dir } = tempDir('update-main')
    const home = homeLayout(dir)
    mkdirSync(join(home.plugin, 'x'), { recursive: true })
    await expect(main(['--from', join(home.plugin, 'x'), '--home', dir], () => {})).rejects.toThrow('inside')
  })
})

describe('staging per run (two runs never share a download)', () => {
  test('each run gets its own folder', () => {
    expect(runStagingDir('/s', 10, 1000)).toBe(join('/s', 'run-10-1000'))
    expect(runStagingDir('/s', 10, 1000)).not.toBe(runStagingDir('/s', 11, 1000))
    expect(runStagingDir('/s', 10, 1000)).not.toBe(runStagingDir('/s', 10, 1001))
  })
  test('pruneStaging removes only run folders older than a day, nothing else', () => {
    const { dir } = tempDir('update-prune')
    const now = Date.now()
    for (const name of ['run-1-1', 'run-2-2', 'run-3-3.tar.gz', 'keep-me']) {
      if (name.endsWith('.tar.gz') || name === 'keep-me') writeFileSync(join(dir, name), 'x')
      else mkdirSync(join(dir, name))
    }
    const old = new Date(now - 2 * 24 * 60 * 60 * 1000)
    for (const name of ['run-1-1', 'run-3-3.tar.gz', 'keep-me']) utimesSync(join(dir, name), old, old)
    expect(pruneStaging(dir, now)).toBe(2)
    expect(existsSync(join(dir, 'run-1-1'))).toBe(false)
    expect(existsSync(join(dir, 'run-3-3.tar.gz'))).toBe(false)
    expect(existsSync(join(dir, 'run-2-2'))).toBe(true)
    expect(existsSync(join(dir, 'keep-me'))).toBe(true)
    expect(pruneStaging(join(dir, 'missing'), now)).toBe(0)
  })
})

describe('the staged plugin copy is checked before the swap', () => {
  /** A minimal checkout: every required file, a proxy with no imports. */
  function checkout(version = '0.28.0') {
    const { dir } = tempDir('update-copy')
    const source = join(dir, 'src')
    for (const rel of REQUIRED_PLUGIN_FILES) {
      mkdirSync(join(source, rel, '..'), { recursive: true })
      writeFileSync(join(source, rel), rel === '.claude-plugin/plugin.json' ? JSON.stringify({ version }) : `// ${rel}\n`)
    }
    mkdirSync(join(source, 'tests'), { recursive: true })
    writeFileSync(join(source, 'tests', 'a.spec.ts'), 'left out')
    return { dir, source }
  }
  const copy = (from: string, to: string) => {
    for (const [rel] of fileList(from, pluginCopyIncludes)) {
      mkdirSync(join(to, rel, '..'), { recursive: true })
      writeFileSync(join(to, rel), readFileSync(join(from, rel)))
    }
  }
  test('a whole copy passes', () => {
    const { dir, source } = checkout()
    copy(source, join(dir, 'copy'))
    expect(pluginCopyProblems(source, join(dir, 'copy'), '0.28.0')).toEqual([])
  })
  test('a missing or cut file, a wrong version, a missing required file are each refused', () => {
    const { dir, source } = checkout()
    const target = join(dir, 'copy')
    copy(source, target)
    writeFileSync(join(target, 'ui/app.ts'), '')
    expect(pluginCopyProblems(source, target, '0.28.0')).toEqual(['ui/app.ts differs from the source'])
    expect(pluginCopyProblems(source, target, '0.29.0')).toContain('the copy is version 0.28.0, expected 0.29.0')
    const { dir: dir2, source: half } = checkout()
    const bare = join(dir2, 'copy')
    copy(half, bare)
    for (const rel of ['ui/server.ts']) writeFileSync(join(half, 'ui', 'extra.ts'), rel)
    expect(pluginCopyProblems(half, bare, '0.28.0')).toEqual(['ui/extra.ts was not copied'])
    const { dir: dir3, source: broken } = checkout()
    rmSync(join(broken, 'bin', 'mcp-proxy.ts'))
    copy(broken, join(dir3, 'copy'))
    const problems = pluginCopyProblems(broken, join(dir3, 'copy'), '0.28.0')
    expect(problems).toContain('the source has no bin/mcp-proxy.ts')
    expect(problems.some(p => p.includes('bin/mcp-proxy.ts, which does not exist'))).toBe(true)
  })
})

describe('the launcher is replaced by rename', () => {
  test('written whole; a failure keeps the old one and says why', () => {
    const { dir } = tempDir('update-launcher')
    const file = join(dir, 'bin', 'mnemosyne-mcp.cmd')
    expect(writeLauncher(file, 'one\r\n')).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('one\r\n')
    expect(writeLauncher(file, 'two\r\n')).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('two\r\n')
    // A folder where the launcher should be: the rename fails, nothing is left behind.
    const blocked = join(dir, 'blocked.cmd')
    mkdirSync(join(blocked, 'inside'), { recursive: true })
    expect(writeLauncher(blocked, 'three')).not.toBe(true)
    expect(existsSync(join(blocked, 'inside'))).toBe(true)
    expect(readdirSync(dir).filter(name => name.includes('.next'))).toEqual([])
  })
})

// ---- HAL-M Stage 2: the data root, the launcher names, the dashboard task (docs/plans/hal-m-stage2.md 3.2, 3.4) ----

/** A temp home: the 0.37 root, the new one, or the new one as a link to the old (what the session hook makes). */
function stage2Home(kind: 'old' | 'new' | 'linked' | 'both' | 'none') {
  const { dir } = tempDir('update-root')
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  if (kind === 'old' || kind === 'linked' || kind === 'both') mkdirSync(oldRootOf(home), { recursive: true })
  if (kind === 'new' || kind === 'both') mkdirSync(newRootOf(home), { recursive: true })
  if (kind === 'linked') symlinkSync(oldRootOf(home), newRootOf(home), 'dir')
  return home
}

describe('homeLayout: the root from the resolver (F-B3, F-M5, A-B5)', () => {
  test('a standalone 0.37 install with no link: the old root, every path under it', () => {
    const home = stage2Home('old')
    const l = homeLayout(home, undefined, {})
    expect(l.root).toBe(oldRootOf(home))
    expect(l.rootState).toBe('old-only')
    expect(l.rootWarning).toBeUndefined()
    expect(l.plugin).toBe(join(oldRootOf(home), 'plugin'))
    expect(l.staging).toBe(join(oldRootOf(home), 'update-staging'))
    expect(l.launcher).toBe(join(oldRootOf(home), 'bin', launcherFile(process.platform)))
    expect(l.oldLauncher).toBe(join(oldRootOf(home), 'bin', oldLauncherFile(process.platform)))
    // The updater never makes the link: nothing appeared at the new path.
    expect(existsSync(newRootOf(home))).toBe(false)
  })
  test('the 0.37 parent staged 0.38 under <old>/update-staging and ran it with --from: the child finds its install and accepts the source', () => {
    const home = stage2Home('old')
    const staged = join(oldRootOf(home), 'update-staging', 'run-1-1')
    mkdirSync(staged, { recursive: true })
    const l = homeLayout(home, undefined, {})
    expect(existsSync(l.root)).toBe(true)
    expect(sourceProblem(staged, l)).toBeUndefined()
    expect(sourceProblem(join(l.plugin, 'x'), l)).toContain('is inside')
  })
  test('linked (new -> old): the new spelling, every spelling known; staging under the old spelling stays valid', () => {
    const home = stage2Home('linked')
    const l = homeLayout(home, undefined, {})
    expect(l.root).toBe(newRootOf(home))
    expect(l.rootState).toBe('new-links-old')
    expect(l.roots).toContain(newRootOf(home))
    expect(l.roots).toContain(oldRootOf(home))
    expect(l.roots).toContain(realpathSync(oldRootOf(home)))
    const staged = join(oldRootOf(home), 'update-staging', 'run-2-2')
    mkdirSync(staged, { recursive: true })
    expect(sourceProblem(staged, l)).toBeUndefined()
    // A source inside the plugin copy is refused whichever spelling names it (real paths).
    mkdirSync(join(oldRootOf(home), 'plugin', 'x'), { recursive: true })
    expect(sourceProblem(join(oldRootOf(home), 'plugin', 'x'), l)).toContain('is inside')
    expect(sourceProblem(join(oldRootOf(home), 'engine'), l)).toContain('is inside')
  })
  test('HALM_ROOT, then MNEMOSYNE_ROOT: used as given, never linked', () => {
    const home = stage2Home('old')
    expect(homeLayout(home, undefined, { HALM_ROOT: '/data/hal-m' })).toMatchObject({ root: '/data/hal-m', rootState: 'explicit' })
    expect(homeLayout(home, undefined, { MNEMOSYNE_ROOT: '/data/old' })).toMatchObject({ root: '/data/old', rootState: 'explicit' })
    expect(homeLayout(home, undefined, { HALM_ROOT: '/data/hal-m', MNEMOSYNE_ROOT: '/data/old' }).root).toBe('/data/hal-m')
    expect(homeLayout(home, undefined, { HALM_ROOT: '', MNEMOSYNE_ROOT: '/data/old' }).root).toBe('/data/old')
  })
  test('only the new root, or a fresh home: the new root', () => {
    expect(homeLayout(stage2Home('new'), undefined, {}).rootState).toBe('new-only')
    const fresh = stage2Home('none')
    expect(homeLayout(fresh, undefined, {})).toMatchObject({ root: newRootOf(fresh), rootState: 'fresh' })
  })
  test('two real roots: the resolver warning is in the layout (printed once by the run)', () => {
    const home = stage2Home('both')
    const l = homeLayout(home, undefined, {})
    expect(l.rootState).toBe('both-real')
    expect(l.root).toBe(oldRootOf(home))
    expect(l.rootWarning).toContain('two real folders')
  })
  test('the dashboard folder: the new one unless only the 0.37 one exists; both are kept', () => {
    const home = stage2Home('old')
    const fresh = homeLayout(home, undefined, {})
    expect(fresh.uiDirs).toEqual([join(home, '.hal-m-ui'), join(home, '.claude', 'mnemosyne-ui')])
    expect(fresh.uiDir).toBe(join(home, '.hal-m-ui'))
    mkdirSync(join(home, '.claude', 'mnemosyne-ui'))
    expect(homeLayout(home, undefined, {}).uiDir).toBe(join(home, '.claude', 'mnemosyne-ui'))
    mkdirSync(join(home, '.hal-m-ui'))
    expect(homeLayout(home, undefined, {}).uiDir).toBe(join(home, '.hal-m-ui'))
  })
})

describe('the launcher files (F-M1)', () => {
  test('the old-name launcher is read when the new one is missing; the new one wins; a shim is never read as settings', () => {
    const home = stage2Home('old')
    const l = homeLayout(home, undefined, {})
    mkdirSync(join(l.root, 'bin'), { recursive: true })
    writeFileSync(l.oldLauncher, 'OLD')
    expect(readInstalled(l)).toMatchObject({ launcherText: 'OLD', shimText: 'OLD' })
    writeFileSync(l.launcher, 'NEW')
    expect(readInstalled(l)).toMatchObject({ launcherText: 'NEW', shimText: 'OLD' })
    rmSync(l.launcher)
    writeFileSync(l.oldLauncher, shimText(process.platform))
    expect(readInstalled(l).launcherText).toBeUndefined()
    expect(readInstalled(l).shimText).toBe(shimText(process.platform))
  })
  test('a 0.37 launcher read from the old name keeps a custom store through the first 0.38 run', () => {
    const home = stage2Home('old')
    const l = homeLayout(home, undefined, {})
    mkdirSync(join(l.root, 'bin'), { recursive: true })
    const old = shWrapper({ store: '/srv/memory/store', cli: '/x/cli.ts', proxy: '/x/mcp-proxy.ts', activity: '', embeddings: true, guardMode: 'warn', vocabulary: '/srv/memory/vocabulary.json', root: '/srv/memory', modelCacheDir: EMBEDDINGS_CACHE_DIR })
    writeFileSync(l.oldLauncher, old)
    expect(launcherFor(l, readInstalled(l).launcherText, false)).toMatchObject({ store: '/srv/memory/store', guardMode: 'warn', activity: '', root: '/srv/memory' })
  })
  test('a missing or stale shim makes the launcher part of the plan; a written one does not', () => {
    const source: SourceState = { dir: '/src', pluginVersion: '0.38.0', engineBuild: 'b', hasUpdater: true }
    const shim = shimText('win32')
    const base = { source, expectedLauncher: 'L', expectedShim: shim, processes: NONE, windows: true, force: false, stopEngines: false }
    const installed: InstallState = { pluginVersion: '0.38.0', engineBuild: 'b', launcherText: 'L' }
    expect(planUpdate({ ...base, installed })).toMatchObject({ kind: 'update', launcher: true, engine: false, plugin: false })
    expect(planUpdate({ ...base, installed: { ...installed, shimText: 'L' } })).toMatchObject({ kind: 'update', launcher: true })
    expect(planUpdate({ ...base, installed: { ...installed, shimText: shim } }).kind).toBe('up-to-date')
  })
})

describe('launcherFor: kept paths follow the resolved root (F-B3, A-M4)', () => {
  /** A 0.37 launcher with every default under the old root (what 0.37 wrote on a Claude Desktop PC). */
  const oldDefaults = (home: string) => {
    const old = slashes(oldRootOf(home))
    return shWrapper({ store: `${old}/store`, cli: `${old}/engine/cli.ts`, proxy: `${old}/plugin/bin/mcp-proxy.ts`, activity: `${old}/activity.jsonl`, embeddings: true, guardMode: 'strict', vocabulary: `${old}/vocabulary.json`, root: old, modelCacheDir: EMBEDDINGS_CACHE_DIR })
  }
  test('on the new root (linked): every old-root default moves onto it, the model cache too', () => {
    const home = stage2Home('linked')
    const l = homeLayout(home, undefined, {})
    const root = slashes(newRootOf(home))
    expect(launcherFor(l, oldDefaults(home), false)).toMatchObject({
      store: `${root}/store`,
      activity: `${root}/activity.jsonl`,
      vocabulary: `${root}/vocabulary.json`,
      root,
      modelCacheDir: `${root}/model-cache`,
    })
  })
  test('on the old root: the values and the relative model cache stay as written (no rewrite for the bytes)', () => {
    const home = stage2Home('old')
    const l = homeLayout(home, undefined, {})
    const old = slashes(oldRootOf(home))
    expect(launcherFor(l, oldDefaults(home), false)).toMatchObject({ store: `${old}/store`, root: old, modelCacheDir: EMBEDDINGS_CACHE_DIR })
    expect(defaultModelCache(l)).toBe(EMBEDDINGS_CACHE_DIR)
    expect(launcherFor(l, undefined, false).modelCacheDir).toBe(EMBEDDINGS_CACHE_DIR)
  })
  test('no launcher on the new root: the model cache under the root', () => {
    const home = stage2Home('new')
    const l = homeLayout(home, undefined, {})
    expect(launcherFor(l, undefined, false).modelCacheDir).toBe(slashes(modelCacheDir(newRootOf(home))))
  })
  test('custom paths stay; the ~/ and relative old forms move', () => {
    const home = stage2Home('new')
    const l = homeLayout(home, undefined, {})
    const text = ["export MNEMOPI_DATA_DIR='D:/memory/store'", "export MNEMOSYNE_VOCABULARY='~/.claude/mnemosyne/vocabulary.json'", 'export PI_CONFIG_DIR=/cache/models', ''].join('\n')
    expect(launcherFor(l, text, false)).toMatchObject({ store: 'D:/memory/store', vocabulary: `${slashes(newRootOf(home))}/vocabulary.json`, modelCacheDir: '/cache/models' })
    // ~/.claude/mnemosyne-ui only shares a prefix: not under the old root.
    expect(launcherFor(l, "export MNEMOPI_DATA_DIR='~/.claude/mnemosyne-ui/store'\n", false).store).toBe('~/.claude/mnemosyne-ui/store')
  })
  test('HALM_<X> is read before MNEMOSYNE_<X>; an empty HALM_ACTIVITY_LOG (log off) wins over an old path', () => {
    const text = ['export HALM_GUARD_MODE=warn', 'export MNEMOSYNE_GUARD_MODE=strict', 'export HALM_ACTIVITY_LOG=', "export MNEMOSYNE_ACTIVITY_LOG='/x/activity.jsonl'", "export HALM_ROOT='/r/new'", "export MNEMOSYNE_ROOT='/r/old'", "export MNEMOSYNE_VOCABULARY='/v/old.json'", ''].join('\n')
    expect(launcherFor(layout, text, false)).toMatchObject({ guardMode: 'warn', activity: '', root: '/r/new', vocabulary: '/v/old.json' })
    // An empty guard mode is "not set": the old name, then the default.
    expect(launcherFor(layout, 'export HALM_GUARD_MODE=\nexport MNEMOSYNE_GUARD_MODE=warn\n', false).guardMode).toBe('warn')
  })
})

describe('Windows: both dashboard folders, both root spellings, both task names (A-M8)', () => {
  test('classifyProcesses: a 0.37 dashboard from the old folder and old root spelling is the dashboard; both updater scripts are left alone', () => {
    const home = stage2Home('linked')
    const l = homeLayout(home, undefined, {})
    const old = oldRootOf(home)
    const procs: Proc[] = [
      { pid: 1, ppid: 0, command: `powershell.exe -File "${join(home, '.claude', 'mnemosyne-ui', 'run-ui.ps1')}"` },
      { pid: 2, ppid: 1, command: `bun.exe "${join(old, 'plugin', 'ui', 'server.ts')}"` },
      { pid: 3, ppid: 9, command: `bun "${join(old, 'plugin', 'bin', 'mcp-proxy.ts')}"` },
      { pid: 4, ppid: 3, command: `bun ${cliOf(join(old, 'engine'))} mcp` },
      { pid: 5, ppid: 9, command: `bun "${join(l.root, 'plugin', 'bin', 'mcp-proxy.ts')}"` },
      { pid: 6, ppid: 9, command: `powershell.exe -File "${join(home, '.hal-m-ui', 'start-ui.cmd')}"` },
      { pid: 7, ppid: 9, command: `powershell.exe -File "${join(old, 'plugin', 'update-mnemosyne.ps1')}"` },
      { pid: 8, ppid: 9, command: `powershell.exe -File "${join(old, 'plugin', 'update-hal-m.ps1')}"` },
      { pid: 10, ppid: 9, command: `editor "${join(old, 'plugin', 'ui', 'app.ts')}"` },
    ]
    const sorted = classifyProcesses(procs, l, false)
    expect(sorted.dashboard.map(p => p.pid).sort()).toEqual([1, 2, 6])
    expect(sorted.chats.map(chat => [chat.proxy?.pid, chat.engines.map(e => e.pid)])).toEqual([
      [3, [4]],
      [5, []],
    ])
    expect(sorted.others.map(p => p.pid)).toEqual([10])
  })
  test('classifyProcesses: a root spelling given in the layout matches case-insensitively on Windows', () => {
    const l = { ...layout, roots: [layout.root, 'C:/Users/u/.claude/mnemosyne'] }
    const proc: Proc = { pid: 1, ppid: 0, command: 'BUN "C:\\USERS\\U\\.CLAUDE\\MNEMOSYNE\\PLUGIN\\BIN\\MCP-PROXY.TS"' }
    expect(classifyProcesses([proc], l, true).chats).toHaveLength(1)
  })
  test('the task: "HAL-M dashboard" first, then the 0.37 "Mnemosyne dashboard"', async () => {
    const runnerWith = (names: string[]): Runner => async argv => ({ stdout: '', stderr: '', exitCode: names.includes(argv[3]!) ? 0 : 1 })
    expect(TASK_NAME).toBe('HAL-M dashboard')
    expect(OLD_TASK_NAME).toBe('Mnemosyne dashboard')
    expect(await findTask(runnerWith([OLD_TASK_NAME]))).toBe(OLD_TASK_NAME)
    expect(await findTask(runnerWith([TASK_NAME, OLD_TASK_NAME]))).toBe(TASK_NAME)
    expect(await findTask(runnerWith([]))).toBeUndefined()
  })
})

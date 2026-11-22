// scripts/migrate-hal-m.ts: the 0.37 -> 0.38 switch builds only claude plugin steps,
// in the plan's order (section 6), and never copies the server key.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { copiedOptions, finishSteps, openSessions, readState, rollbackSteps, runSteps, switchSteps, type PluginState, type Run } from '../../scripts/migrate-hal-m'
import { tempDir } from './helpers'

const state = (installed: string[], enabled: string[], marketplaces: string[]): PluginState => ({
  installed: new Set(installed),
  enabled: new Set(enabled),
  marketplaces: new Set(marketplaces),
})
const OLD = 'mnemosyne@mnemosyne'
const NEW = 'hal-m@hal-m'

describe('migrate-hal-m', () => {
  test('readState reads claude plugin list --json and marketplace list --json', () => {
    const run: Run = args =>
      args[1] === 'list'
        ? { code: 0, out: JSON.stringify([{ id: OLD, enabled: false }, { id: NEW, enabled: true }]) }
        : { code: 0, out: JSON.stringify([{ name: 'mnemosyne' }, { name: 'hal-m' }]) }
    const s = readState(run)
    expect([...s.installed].sort()).toEqual([NEW, OLD])
    expect([...s.enabled]).toEqual([NEW])
    expect([...s.marketplaces]).toEqual(['mnemosyne', 'hal-m'])
  })

  test('copiedOptions keeps configured options, drops the key and the old default memoryDir', () => {
    const json = JSON.stringify({
      inputs: { scope: 'per-project', serverUrl: 'https://x.ts.net', serverKey: '', memoryDir: '~/.claude/mnemosyne/store', guardMode: 'strict' },
      configured: ['scope', 'serverUrl', 'serverKey', 'memoryDir'],
    })
    expect(copiedOptions(json)).toEqual({ values: { scope: 'per-project', serverUrl: 'https://x.ts.net' }, hadKey: true })
    const custom = JSON.stringify({ inputs: { memoryDir: '/srv/store' }, configured: ['memoryDir'] })
    expect(copiedOptions(custom)).toEqual({ values: { memoryDir: '/srv/store' }, hadKey: false })
  })

  test('switch: backup, own marketplace, disable, install, options, in that order', () => {
    const home = tempDir('switch-home')
    mkdirSync(join(home.dir, '.claude', 'mnemosyne'), { recursive: true })
    const steps = switchSteps(state([OLD], [OLD], ['mnemosyne']), { values: { scope: 'global' }, hadKey: false }, home.dir, 'Interstellar-code/hal-m', 'stamp')
    expect(steps.map(s => s.shell?.[0] ?? s.args?.slice(0, 3).join(' '))).toEqual([
      'tar',
      'plugin marketplace add',
      'plugin disable ' + OLD,
      'plugin install ' + NEW,
      'plugin configure ' + NEW,
    ])
    expect(steps[1]?.args).toEqual(['plugin', 'marketplace', 'add', 'Interstellar-code/hal-m'])
    expect(steps[4]?.stdin).toBe('{"scope":"global"}')
    expect(JSON.stringify(steps)).not.toContain('serverKey')
    home.dispose()
  })

  test('switch skips what is already done and backs up nothing when there is no old root', () => {
    const home = tempDir('switch-none')
    const steps = switchSteps(state([OLD, NEW], [NEW], ['mnemosyne', 'hal-m']), null, home.dir, 'x', 's')
    expect(steps).toEqual([])
    home.dispose()
  })

  test('finish removes the old plugin and marketplace, only once hal-m is installed', () => {
    expect(() => finishSteps(state([OLD], [OLD], ['mnemosyne']))).toThrow(/run switch first/)
    expect(finishSteps(state([OLD, NEW], [NEW], ['mnemosyne', 'hal-m'])).map(s => s.args)).toEqual([
      ['plugin', 'uninstall', OLD, '--keep-data'],
      ['plugin', 'marketplace', 'remove', 'mnemosyne'],
    ])
  })

  test('rollback before finish re-enables the old plugin; after finish it points at the runbook', () => {
    expect(rollbackSteps(state([OLD, NEW], [NEW], ['mnemosyne', 'hal-m'])).map(s => s.args)).toEqual([
      ['plugin', 'uninstall', NEW, '--keep-data'],
      ['plugin', 'enable', OLD],
    ])
    expect(() => rollbackSteps(state([NEW], [NEW], ['hal-m']))).toThrow(/runbook/)
  })

  test('the session check uses tasklist on Windows and pgrep elsewhere; a missing tool finds none', () => {
    expect(openSessions('win32', cmd => (cmd[0] === 'tasklist' ? 'claude.exe   1234 Console' : ''))).toBe('claude.exe')
    expect(openSessions('win32', () => 'INFO: No tasks are running')).toBe('')
    expect(openSessions('darwin', cmd => (cmd[0] === 'pgrep' ? '11\n22\n' : ''))).toBe('pid 11, 22')
    expect(openSessions('linux', () => { throw new Error('Executable not found') })).toBe('')
  })

  test('a linked old root is backed up through its real folder', () => {
    const home = tempDir('switch-link')
    const real = join(home.dir, 'elsewhere', 'mn')
    mkdirSync(real, { recursive: true })
    mkdirSync(join(home.dir, '.claude'))
    symlinkSync(real, join(home.dir, '.claude', 'mnemosyne'))
    const tar = switchSteps(state([], [], []), null, home.dir, 'x', 's')[0]?.shell ?? []
    expect(tar.slice(-3)).toEqual(['-C', realpathSync(join(home.dir, 'elsewhere')), 'mn'])
    home.dispose()
  })

  test('a dry run runs nothing; --apply stops at the first failure', () => {
    const calls: string[][] = []
    const lines: string[] = []
    const steps = [
      { say: 'a', args: ['plugin', 'disable', OLD] },
      { say: 'b', args: ['plugin', 'install', NEW] },
      { say: 'c', args: ['plugin', 'configure', NEW] },
    ]
    const run: Run = args => (calls.push(args), { code: args[1] === 'install' ? 1 : 0, out: 'boom' })
    expect(runSteps(steps, false, run, run, l => lines.push(l))).toBe(true)
    expect(calls).toEqual([])
    expect(runSteps(steps, true, run, run, l => lines.push(l))).toBe(false)
    expect(calls.map(c => c[1])).toEqual(['disable', 'install'])
    expect(lines.at(-1)).toContain('Stopped')
  })
})

// Switches one PC from the 0.37 plugin (mnemosyne@mnemosyne) to 0.38 (hal-m@hal-m),
// and back. Plan: docs/plans/hal-m-stage2.md section 6; runbook:
// docs/plans/hal-m-stage2-runbook.md. Run it from a plain terminal with no Claude
// Code session open, as your normal user (the server key lives in the keychain).
//
//   bun scripts/migrate-hal-m.ts [switch|finish|rollback] [--apply] [--marketplace <source>]
//
//   switch    tar backup of ~/.claude/mnemosyne, add the hal-m marketplace beside the
//             old one, disable mnemosyne@mnemosyne, install hal-m@hal-m, copy its options.
//   finish    after a session showed recall and save working: uninstall the old plugin
//             and remove the old marketplace.
//   rollback  before finish: uninstall hal-m@hal-m and enable the old plugin again.
//             After finish: prints the reinstall-from-tag steps (runbook).
//
// Dry run by default: prints each step. --apply runs them, stopping at the first
// failure. Only claude plugin commands change Claude Code's settings; the script
// never edits settings.json, never handles the server key, and never removes ~/.hal-m.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MARKETPLACE_NAME, OLD_MARKETPLACE_NAME, OLD_PLUGIN_ID, PLUGIN_ID } from '../hooks/names'

export const REPO_SOURCE = 'Interstellar-code/hal-m'
export const OLD_MEMORY_DIR_DEFAULT = '~/.claude/mnemosyne/store'
// Options that are never copied: the key is sensitive (re-entered by hand with a new
// device key), and memoryDir is dropped when it is the old default (0.38's default).
const NOT_COPIED = new Set(['serverKey'])

export type Run = (args: string[], stdin?: string) => { code: number; out: string }
export type Step = { say: string; args?: string[]; stdin?: string; shell?: string[] }

export type PluginState = {
  installed: Set<string>
  enabled: Set<string>
  marketplaces: Set<string>
}

/** Parses claude plugin list --json and claude plugin marketplace list --json. */
export function readState(run: Run): PluginState {
  const list = run(['plugin', 'list', '--json'])
  const markets = run(['plugin', 'marketplace', 'list', '--json'])
  if (list.code !== 0) throw new Error('claude plugin list --json failed: ' + list.out.trim())
  if (markets.code !== 0) throw new Error('claude plugin marketplace list --json failed: ' + markets.out.trim())
  const plugins = jsonArray(list.out, 'plugins')
  const installed = new Set<string>()
  const enabled = new Set<string>()
  for (const p of plugins) {
    const id = String(p.id ?? p.pluginId ?? (p.name && p.marketplace ? p.name + '@' + p.marketplace : ''))
    if (!id) continue
    installed.add(id)
    if (p.enabled !== false) enabled.add(id)
  }
  const marketplaces = new Set(jsonArray(markets.out, 'marketplaces').map(m => String(m.name ?? '')).filter(Boolean))
  return { installed, enabled, marketplaces }
}

function jsonArray(text: string, key: string): Record<string, unknown>[] {
  const data = JSON.parse(text) as unknown
  const arr = Array.isArray(data) ? data : (data as Record<string, unknown>)?.[key]
  return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []
}

/** The old plugin's configured options, minus the ones never copied. */
export function copiedOptions(configureJson: string): { values: Record<string, string>; hadKey: boolean } {
  const data = JSON.parse(configureJson) as { inputs?: Record<string, unknown>; configured?: string[] }
  const configured = data.configured ?? []
  const values: Record<string, string> = {}
  for (const key of configured) {
    if (NOT_COPIED.has(key)) continue
    const value = String(data.inputs?.[key] ?? '')
    if (key === 'memoryDir' && (value === '' || value === OLD_MEMORY_DIR_DEFAULT)) continue
    if (value.includes('\n')) continue // --values-stdin takes single-line strings only
    values[key] = value
  }
  return { values, hadKey: configured.includes('serverKey') }
}

export function switchSteps(state: PluginState, options: { values: Record<string, string>; hadKey: boolean } | null, home: string, source: string, stamp: string): Step[] {
  const steps: Step[] = []
  const oldRoot = join(home, '.claude', 'mnemosyne')
  if (existsSync(oldRoot)) {
    const tarball = join(home, 'hal-m-switch-backup-' + stamp + '.tgz')
    steps.push({ say: 'Back up ' + oldRoot + ' to ' + tarball, shell: ['tar', '-czf', tarball, '-C', join(home, '.claude'), 'mnemosyne'] })
  }
  if (!state.marketplaces.has(MARKETPLACE_NAME)) steps.push({ say: 'Add the hal-m marketplace beside the old one', args: ['plugin', 'marketplace', 'add', source] })
  if (state.enabled.has(OLD_PLUGIN_ID)) steps.push({ say: 'Disable ' + OLD_PLUGIN_ID + ' (its options and key stay)', args: ['plugin', 'disable', OLD_PLUGIN_ID] })
  if (!state.installed.has(PLUGIN_ID)) steps.push({ say: 'Install ' + PLUGIN_ID, args: ['plugin', 'install', PLUGIN_ID] })
  if (options && Object.keys(options.values).length > 0) {
    steps.push({ say: 'Copy options to ' + PLUGIN_ID + ': ' + Object.keys(options.values).join(', '), args: ['plugin', 'configure', PLUGIN_ID, '--values-stdin'], stdin: JSON.stringify(options.values) })
  }
  return steps
}

export function finishSteps(state: PluginState): Step[] {
  if (!state.installed.has(PLUGIN_ID)) throw new Error(PLUGIN_ID + ' is not installed: run switch first.')
  const steps: Step[] = []
  if (state.installed.has(OLD_PLUGIN_ID)) steps.push({ say: 'Uninstall ' + OLD_PLUGIN_ID, args: ['plugin', 'uninstall', OLD_PLUGIN_ID, '--keep-data'] })
  if (state.marketplaces.has(OLD_MARKETPLACE_NAME)) steps.push({ say: 'Remove the old marketplace', args: ['plugin', 'marketplace', 'remove', OLD_MARKETPLACE_NAME] })
  return steps
}

export function rollbackSteps(state: PluginState): Step[] {
  if (!state.installed.has(OLD_PLUGIN_ID)) {
    throw new Error(OLD_PLUGIN_ID + ' is no longer installed (finish already ran). Follow "Rollback after finish" in docs/plans/hal-m-stage2-runbook.md: reinstall it from the v0.37.0 tag.')
  }
  const steps: Step[] = []
  if (state.installed.has(PLUGIN_ID)) steps.push({ say: 'Uninstall ' + PLUGIN_ID, args: ['plugin', 'uninstall', PLUGIN_ID, '--keep-data'] })
  if (!state.enabled.has(OLD_PLUGIN_ID)) steps.push({ say: 'Enable ' + OLD_PLUGIN_ID, args: ['plugin', 'enable', OLD_PLUGIN_ID] })
  return steps
}

const describe = (step: Step) => (step.shell ?? ['claude', ...(step.args ?? [])]).join(' ') + (step.stdin ? '  <<< ' + step.stdin : '')

export function runSteps(steps: Step[], apply: boolean, run: Run, shell: Run, log: (line: string) => void): boolean {
  if (steps.length === 0) {
    log('Nothing to do.')
    return true
  }
  for (const [i, step] of steps.entries()) {
    log((apply ? '' : '[dry run] ') + (i + 1) + '. ' + step.say + '\n     ' + describe(step))
    if (!apply) continue
    const result = step.shell ? shell(step.shell) : run(step.args ?? [], step.stdin)
    if (result.code !== 0) {
      log('   failed (exit ' + result.code + '): ' + result.out.trim() + '\n   Stopped. Nothing after this step ran.')
      return false
    }
  }
  return true
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const mode = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--marketplace') ?? 'switch'
  const apply = argv.includes('--apply')
  const at = argv.indexOf('--marketplace')
  const source = at >= 0 ? argv[at + 1] : REPO_SOURCE
  const home = process.env.HOME || homedir()
  const run: Run = (args, stdin) => {
    const p = Bun.spawnSync(['claude', ...args], { stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() }
  }
  const shell: Run = args => {
    const p = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() }
  }
  try {
    if (!['switch', 'finish', 'rollback'].includes(mode) || !source) throw new Error('usage: bun scripts/migrate-hal-m.ts [switch|finish|rollback] [--apply] [--marketplace <source>]')
    const sessions = Bun.spawnSync(['pgrep', '-x', 'claude'], { stdout: 'pipe' }).stdout.toString().trim()
    if (apply && sessions && !process.env.HALM_SWITCH_ALLOW_SESSIONS) throw new Error('A Claude Code session is running (pid ' + sessions.split('\n').join(', ') + '). Close every session and run this from a plain terminal.')
    const state = readState(run)
    let steps: Step[]
    let hadKey = false
    if (mode === 'switch') {
      let options = null
      if (state.installed.has(OLD_PLUGIN_ID)) {
        const conf = run(['plugin', 'configure', OLD_PLUGIN_ID, '--json'])
        if (conf.code !== 0) throw new Error('claude plugin configure ' + OLD_PLUGIN_ID + ' --json failed: ' + conf.out.trim())
        options = copiedOptions(conf.out)
        hadKey = options.hadKey
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      steps = switchSteps(state, options, home, source, stamp)
    } else steps = mode === 'finish' ? finishSteps(state) : rollbackSteps(state)
    const ok = runSteps(steps, apply, run, shell, line => console.log(line))
    if (ok && mode === 'switch') {
      if (hadKey) console.log('\nThe server key is not copied. Make a new device key on the dashboard, then run: claude plugin configure ' + PLUGIN_ID + '  (or /plugin in Claude Code) and paste it as serverKey.')
      console.log('Next: start one Claude Code session, check that recall and a save reach your memory, then run: bun scripts/migrate-hal-m.ts finish --apply')
    }
    if (!apply && steps.length > 0) console.log('\nDry run: nothing changed. Add --apply to run these steps.')
    process.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('migrate-hal-m: ' + (error as Error).message)
    process.exit(1)
  }
}

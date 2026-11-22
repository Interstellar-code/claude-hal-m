// The externalMcp launcher: a script other MCP clients (Cursor, Codex, `claude
// mcp add», Switch) start as a stdio server against one store, plus the shim
// written under the old launcher name. One generator for each (launcherText,
// shimText): the plugin (register.ts) and the installers and updater only call
// them. This file imports nothing from claude-code, so a plain script can load it.
import { EMBEDDINGS_CACHE_DIR, EMBEDDINGS_MODEL } from './engine'
import { envKey, LAUNCHER_NAME, OLD_LAUNCHER_NAME, oldEnvKey } from './names'
import type { EnvName } from './names'

export type LauncherOptions = {
  store: string
  cli: string
  proxy: string
  // The activity log; empty when activityLog is off.
  activity: string
  embeddings: boolean
  guardMode: string
  vocabulary: string
  root: string
  // PI_CONFIG_DIR: relative to $HOME (the plugin's EMBEDDINGS_CACHE_DIR) or absolute.
  modelCacheDir: string
}

// The launcher files in <root>/bin: .cmd on Windows.
export const launcherFile = (platform: string) => (platform === 'win32' ? `${LAUNCHER_NAME}.cmd` : LAUNCHER_NAME)
export const oldLauncherFile = (platform: string) => (platform === 'win32' ? `${OLD_LAUNCHER_NAME}.cmd` : OLD_LAUNCHER_NAME)

// Single-quoted for sh: the store path comes from settings and may hold anything.
export const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

// The plugin's default PI_CONFIG_DIR is written bare, as 0.9.0 wrote it (its bytes
// stay the same); any other folder is quoted, since a --root may hold a space or a $.
const shCacheDir = (dir: string) => (dir === EMBEDDINGS_CACHE_DIR ? dir : shellQuote(dir))

// The owner: HALM_OWNER, then MNEMOSYNE_OWNER (other agents' scripts keep their owner), then global.
const OWNER = envKey('OWNER')
const OLD_OWNER = oldEnvKey('OWNER')

// The five values the proxy reads, set under both spellings with the same value,
// new name first: bin/mcp-proxy.ts of 0.37 reads only MNEMOSYNE_*, and equal
// values make the empty-value rule moot (ACTIVITY_LOG empty under both = log off).
const proxyValues = ({ cli, activity, guardMode, vocabulary, root }: LauncherOptions): [EnvName, string][] => [
  ['CLI', cli],
  ['ACTIVITY_LOG', activity],
  ['GUARD_MODE', guardMode],
  ['VOCABULARY', vocabulary],
  ['ROOT', root],
]
const bothKeys = (name: EnvName) => [envKey(name), oldEnvKey(name)]
// sh: the guard mode is a bare word and an empty log stays bare; paths are quoted.
const shValue = (name: EnvName, value: string) => (name === 'GUARD_MODE' || (name === 'ACTIVITY_LOG' && !value) ? value : shellQuote(value))

export const WRAPPER_NOTE = `Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,
serving only remember / recall / update / forget / stats / get.
HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).
HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.
HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.
HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.
HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).
HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).`

export const shWrapper = (options: LauncherOptions) => {
  const { store, proxy, embeddings, modelCacheDir } = options
  const values = proxyValues(options).flatMap(([name, value]) => bothKeys(name).map(key => `export ${key}=${shValue(name, value)}`))
  return `#!/bin/sh
${WRAPPER_NOTE.replace(/^/gm, '# ')}
export MNEMOPI_DATA_DIR=${shellQuote(store)}
export MNEMOPI_SESSION_ID="\${${OWNER}:-\${${OLD_OWNER}:-global}}"
export MNEMOPI_CHANNEL_ID="$MNEMOPI_SESSION_ID"
export MNEMOPI_OWNER_PER_CALL=
${embeddings ? 'unset MNEMOPI_NO_EMBEDDINGS' : 'export MNEMOPI_NO_EMBEDDINGS=1'}
export MNEMOPI_MCP_BANK=default
export MNEMOPI_LLM_BASE_URL=
export MNEMOPI_HOST_LLM_ENABLED=
export MNEMOPI_AUTHOR_ID=
export MNEMOPI_AUTHOR_TYPE=
export MNEMOPI_POLYPHONIC_RECALL=0
export MNEMOPI_EMBEDDING_API_URL=
export MNEMOPI_EMBEDDINGS_VIA_API=
export MNEMOPI_EMBEDDING_API_KEY=
export MNEMOPI_EMBEDDING_MODEL=${EMBEDDINGS_MODEL}
export MNEMOPI_EMBEDDING_DIM=
export OPENROUTER_BASE_URL=
export OPENROUTER_API_KEY=
export OPENAI_API_KEY=
export MNEMOPI_EMBEDDINGS_API_OPT_IN=0
export HF_ENDPOINT=https://huggingface.co
export PI_CONFIG_DIR=${shCacheDir(modelCacheDir)}
${values.join('\n')}
exec bun ${shellQuote(proxy)}
`
}

// cmd has no safe quoting for " or %; callers refuse paths holding either.
// Lines are joined with an explicit \r\n, so the source file's own line endings never reach the .cmd.
export const cmdWrapper = (options: LauncherOptions) => {
  const { store, proxy, embeddings, modelCacheDir } = options
  return `${[
    '@echo off',
    ...WRAPPER_NOTE.split('\n').map(line => `rem ${line}`),
    `set "MNEMOPI_DATA_DIR=${store}"`,
    // cmd treats an empty variable as not defined, so an empty HALM_OWNER falls through too.
    `if not defined ${OWNER} if defined ${OLD_OWNER} set "${OWNER}=%${OLD_OWNER}%"`,
    `if not defined ${OWNER} set "${OWNER}=global"`,
    `set "MNEMOPI_SESSION_ID=%${OWNER}%"`,
    `set "MNEMOPI_CHANNEL_ID=%${OWNER}%"`,
    // 0.27.2: an MCP client never picks the owner per call (engine change 21).
    'set "MNEMOPI_OWNER_PER_CALL="',
    embeddings ? 'set "MNEMOPI_NO_EMBEDDINGS="' : 'set "MNEMOPI_NO_EMBEDDINGS=1"',
    'set "MNEMOPI_MCP_BANK=default"',
    'set "MNEMOPI_LLM_BASE_URL="',
    'set "MNEMOPI_HOST_LLM_ENABLED="',
    'set "MNEMOPI_AUTHOR_ID="',
    'set "MNEMOPI_AUTHOR_TYPE="',
    'set "MNEMOPI_POLYPHONIC_RECALL=0"',
    'set "MNEMOPI_EMBEDDING_API_URL="',
    'set "MNEMOPI_EMBEDDINGS_VIA_API="',
    'set "MNEMOPI_EMBEDDING_API_KEY="',
    `set "MNEMOPI_EMBEDDING_MODEL=${EMBEDDINGS_MODEL}"`,
    'set "MNEMOPI_EMBEDDING_DIM="',
    'set "OPENROUTER_BASE_URL="',
    'set "OPENROUTER_API_KEY="',
    'set "OPENAI_API_KEY="',
    'set "MNEMOPI_EMBEDDINGS_API_OPT_IN=0"',
    'set "HF_ENDPOINT=https://huggingface.co"',
    `set "PI_CONFIG_DIR=${modelCacheDir}"`,
    ...proxyValues(options).flatMap(([name, value]) => bothKeys(name).map(key => `set "${key}=${value}"`)),
    `bun "${proxy}"`,
  ].join('\r\n')}\r\n`
}

/** The launcher for a platform: cmd on win32, sh everywhere else (the one launcher generator). */
export const launcherText = (options: LauncherOptions, platform: string) =>
  platform === 'win32' ? cmdWrapper(options) : shWrapper(options)

const shimNote = (platform: string) =>
  `Written by the HAL-M plugin: the old launcher name, kept so MCP configs that name it still work.
It runs ${launcherFile(platform)} next to it.`

/**
 * The file written under the old launcher name (the one shim generator). It
 * holds no paths: it runs the launcher in its own folder, so it keeps working
 * if the root folder is renamed later.
 */
export const shimText = (platform: string) =>
  platform === 'win32'
    ? `${['@echo off', ...shimNote(platform).split('\n').map(line => `rem ${line}`), `"%~dp0${launcherFile(platform)}" %*`].join('\r\n')}\r\n`
    : `#!/bin/sh\n${shimNote(platform).replace(/^/gm, '# ')}\nexec "$(dirname "$0")/${launcherFile(platform)}" "$@"\n`

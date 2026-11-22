import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cmdWrapper, launcherFile, launcherText, oldLauncherFile, shellQuote, shimText, shWrapper } from '../../hooks/launcher'
import type { LauncherOptions } from '../../hooks/launcher'
import { EMBEDDINGS_CACHE_DIR } from '../../hooks/engine'
import { envKey, LAUNCHER_NAME, OLD_LAUNCHER_NAME, oldEnvKey } from '../../hooks/names'
import { isolatedEnv, tempDir } from './helpers'

// The launcher bytes, pinned. 0.38 (Stage 2, plan 3.4) changed them on purpose:
// the owner reads HALM_OWNER, then MNEMOSYNE_OWNER, then global, and the five
// values the proxy reads are set under both spellings, new first. Any other
// change to these bytes is a regression.
const BASE = {
  store: "/h/o'b/.claude/mnemosyne/store",
  cli: '/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts',
  proxy: '/p/plugin/bin/mcp-proxy.ts',
  activity: '/h/o/.claude/mnemosyne/activity.jsonl',
  vocabulary: '/h/o/.claude/mnemosyne/vocabulary.json',
  root: '/h/o/.claude/mnemosyne',
  modelCacheDir: EMBEDDINGS_CACHE_DIR,
}

const GOLDEN: Record<string, string> = {
  "sh-emb-strict-log": [
    "#!/bin/sh",
    "# Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "# serving only remember / recall / update / forget / stats / get.",
    "# HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "# HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "# HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "# HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "# HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "# HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "export MNEMOPI_DATA_DIR='/h/o'\\''b/.claude/mnemosyne/store'",
    "export MNEMOPI_SESSION_ID=\"${HALM_OWNER:-${MNEMOSYNE_OWNER:-global}}\"",
    "export MNEMOPI_CHANNEL_ID=\"$MNEMOPI_SESSION_ID\"",
    "export MNEMOPI_OWNER_PER_CALL=",
    "unset MNEMOPI_NO_EMBEDDINGS",
    "export MNEMOPI_MCP_BANK=default",
    "export MNEMOPI_LLM_BASE_URL=",
    "export MNEMOPI_HOST_LLM_ENABLED=",
    "export MNEMOPI_AUTHOR_ID=",
    "export MNEMOPI_AUTHOR_TYPE=",
    "export MNEMOPI_POLYPHONIC_RECALL=0",
    "export MNEMOPI_EMBEDDING_API_URL=",
    "export MNEMOPI_EMBEDDINGS_VIA_API=",
    "export MNEMOPI_EMBEDDING_API_KEY=",
    "export MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5",
    "export MNEMOPI_EMBEDDING_DIM=",
    "export OPENROUTER_BASE_URL=",
    "export OPENROUTER_API_KEY=",
    "export OPENAI_API_KEY=",
    "export MNEMOPI_EMBEDDINGS_API_OPT_IN=0",
    "export HF_ENDPOINT=https://huggingface.co",
    "export PI_CONFIG_DIR=.claude/mnemosyne/model-cache",
    "export HALM_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export MNEMOSYNE_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export HALM_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export MNEMOSYNE_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export HALM_GUARD_MODE=strict",
    "export MNEMOSYNE_GUARD_MODE=strict",
    "export HALM_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export MNEMOSYNE_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export HALM_ROOT='/h/o/.claude/mnemosyne'",
    "export MNEMOSYNE_ROOT='/h/o/.claude/mnemosyne'",
    "exec bun '/p/plugin/bin/mcp-proxy.ts'",
  ].join("\n") + "\n",
  "sh-emb-warn-log": [
    "#!/bin/sh",
    "# Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "# serving only remember / recall / update / forget / stats / get.",
    "# HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "# HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "# HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "# HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "# HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "# HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "export MNEMOPI_DATA_DIR='/h/o'\\''b/.claude/mnemosyne/store'",
    "export MNEMOPI_SESSION_ID=\"${HALM_OWNER:-${MNEMOSYNE_OWNER:-global}}\"",
    "export MNEMOPI_CHANNEL_ID=\"$MNEMOPI_SESSION_ID\"",
    "export MNEMOPI_OWNER_PER_CALL=",
    "unset MNEMOPI_NO_EMBEDDINGS",
    "export MNEMOPI_MCP_BANK=default",
    "export MNEMOPI_LLM_BASE_URL=",
    "export MNEMOPI_HOST_LLM_ENABLED=",
    "export MNEMOPI_AUTHOR_ID=",
    "export MNEMOPI_AUTHOR_TYPE=",
    "export MNEMOPI_POLYPHONIC_RECALL=0",
    "export MNEMOPI_EMBEDDING_API_URL=",
    "export MNEMOPI_EMBEDDINGS_VIA_API=",
    "export MNEMOPI_EMBEDDING_API_KEY=",
    "export MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5",
    "export MNEMOPI_EMBEDDING_DIM=",
    "export OPENROUTER_BASE_URL=",
    "export OPENROUTER_API_KEY=",
    "export OPENAI_API_KEY=",
    "export MNEMOPI_EMBEDDINGS_API_OPT_IN=0",
    "export HF_ENDPOINT=https://huggingface.co",
    "export PI_CONFIG_DIR=.claude/mnemosyne/model-cache",
    "export HALM_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export MNEMOSYNE_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export HALM_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export MNEMOSYNE_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export HALM_GUARD_MODE=warn",
    "export MNEMOSYNE_GUARD_MODE=warn",
    "export HALM_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export MNEMOSYNE_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export HALM_ROOT='/h/o/.claude/mnemosyne'",
    "export MNEMOSYNE_ROOT='/h/o/.claude/mnemosyne'",
    "exec bun '/p/plugin/bin/mcp-proxy.ts'",
  ].join("\n") + "\n",
  "sh-noemb-strict-log": [
    "#!/bin/sh",
    "# Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "# serving only remember / recall / update / forget / stats / get.",
    "# HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "# HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "# HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "# HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "# HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "# HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "export MNEMOPI_DATA_DIR='/h/o'\\''b/.claude/mnemosyne/store'",
    "export MNEMOPI_SESSION_ID=\"${HALM_OWNER:-${MNEMOSYNE_OWNER:-global}}\"",
    "export MNEMOPI_CHANNEL_ID=\"$MNEMOPI_SESSION_ID\"",
    "export MNEMOPI_OWNER_PER_CALL=",
    "export MNEMOPI_NO_EMBEDDINGS=1",
    "export MNEMOPI_MCP_BANK=default",
    "export MNEMOPI_LLM_BASE_URL=",
    "export MNEMOPI_HOST_LLM_ENABLED=",
    "export MNEMOPI_AUTHOR_ID=",
    "export MNEMOPI_AUTHOR_TYPE=",
    "export MNEMOPI_POLYPHONIC_RECALL=0",
    "export MNEMOPI_EMBEDDING_API_URL=",
    "export MNEMOPI_EMBEDDINGS_VIA_API=",
    "export MNEMOPI_EMBEDDING_API_KEY=",
    "export MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5",
    "export MNEMOPI_EMBEDDING_DIM=",
    "export OPENROUTER_BASE_URL=",
    "export OPENROUTER_API_KEY=",
    "export OPENAI_API_KEY=",
    "export MNEMOPI_EMBEDDINGS_API_OPT_IN=0",
    "export HF_ENDPOINT=https://huggingface.co",
    "export PI_CONFIG_DIR=.claude/mnemosyne/model-cache",
    "export HALM_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export MNEMOSYNE_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export HALM_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export MNEMOSYNE_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export HALM_GUARD_MODE=strict",
    "export MNEMOSYNE_GUARD_MODE=strict",
    "export HALM_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export MNEMOSYNE_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export HALM_ROOT='/h/o/.claude/mnemosyne'",
    "export MNEMOSYNE_ROOT='/h/o/.claude/mnemosyne'",
    "exec bun '/p/plugin/bin/mcp-proxy.ts'",
  ].join("\n") + "\n",
  "sh-noemb-warn-log": [
    "#!/bin/sh",
    "# Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "# serving only remember / recall / update / forget / stats / get.",
    "# HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "# HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "# HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "# HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "# HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "# HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "export MNEMOPI_DATA_DIR='/h/o'\\''b/.claude/mnemosyne/store'",
    "export MNEMOPI_SESSION_ID=\"${HALM_OWNER:-${MNEMOSYNE_OWNER:-global}}\"",
    "export MNEMOPI_CHANNEL_ID=\"$MNEMOPI_SESSION_ID\"",
    "export MNEMOPI_OWNER_PER_CALL=",
    "export MNEMOPI_NO_EMBEDDINGS=1",
    "export MNEMOPI_MCP_BANK=default",
    "export MNEMOPI_LLM_BASE_URL=",
    "export MNEMOPI_HOST_LLM_ENABLED=",
    "export MNEMOPI_AUTHOR_ID=",
    "export MNEMOPI_AUTHOR_TYPE=",
    "export MNEMOPI_POLYPHONIC_RECALL=0",
    "export MNEMOPI_EMBEDDING_API_URL=",
    "export MNEMOPI_EMBEDDINGS_VIA_API=",
    "export MNEMOPI_EMBEDDING_API_KEY=",
    "export MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5",
    "export MNEMOPI_EMBEDDING_DIM=",
    "export OPENROUTER_BASE_URL=",
    "export OPENROUTER_API_KEY=",
    "export OPENAI_API_KEY=",
    "export MNEMOPI_EMBEDDINGS_API_OPT_IN=0",
    "export HF_ENDPOINT=https://huggingface.co",
    "export PI_CONFIG_DIR=.claude/mnemosyne/model-cache",
    "export HALM_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export MNEMOSYNE_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export HALM_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export MNEMOSYNE_ACTIVITY_LOG='/h/o/.claude/mnemosyne/activity.jsonl'",
    "export HALM_GUARD_MODE=warn",
    "export MNEMOSYNE_GUARD_MODE=warn",
    "export HALM_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export MNEMOSYNE_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export HALM_ROOT='/h/o/.claude/mnemosyne'",
    "export MNEMOSYNE_ROOT='/h/o/.claude/mnemosyne'",
    "exec bun '/p/plugin/bin/mcp-proxy.ts'",
  ].join("\n") + "\n",
  "sh-noemb-warn-nolog": [
    "#!/bin/sh",
    "# Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "# serving only remember / recall / update / forget / stats / get.",
    "# HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "# HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "# HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "# HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "# HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "# HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "export MNEMOPI_DATA_DIR='/h/o'\\''b/.claude/mnemosyne/store'",
    "export MNEMOPI_SESSION_ID=\"${HALM_OWNER:-${MNEMOSYNE_OWNER:-global}}\"",
    "export MNEMOPI_CHANNEL_ID=\"$MNEMOPI_SESSION_ID\"",
    "export MNEMOPI_OWNER_PER_CALL=",
    "export MNEMOPI_NO_EMBEDDINGS=1",
    "export MNEMOPI_MCP_BANK=default",
    "export MNEMOPI_LLM_BASE_URL=",
    "export MNEMOPI_HOST_LLM_ENABLED=",
    "export MNEMOPI_AUTHOR_ID=",
    "export MNEMOPI_AUTHOR_TYPE=",
    "export MNEMOPI_POLYPHONIC_RECALL=0",
    "export MNEMOPI_EMBEDDING_API_URL=",
    "export MNEMOPI_EMBEDDINGS_VIA_API=",
    "export MNEMOPI_EMBEDDING_API_KEY=",
    "export MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5",
    "export MNEMOPI_EMBEDDING_DIM=",
    "export OPENROUTER_BASE_URL=",
    "export OPENROUTER_API_KEY=",
    "export OPENAI_API_KEY=",
    "export MNEMOPI_EMBEDDINGS_API_OPT_IN=0",
    "export HF_ENDPOINT=https://huggingface.co",
    "export PI_CONFIG_DIR=.claude/mnemosyne/model-cache",
    "export HALM_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export MNEMOSYNE_CLI='/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts'",
    "export HALM_ACTIVITY_LOG=",
    "export MNEMOSYNE_ACTIVITY_LOG=",
    "export HALM_GUARD_MODE=warn",
    "export MNEMOSYNE_GUARD_MODE=warn",
    "export HALM_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export MNEMOSYNE_VOCABULARY='/h/o/.claude/mnemosyne/vocabulary.json'",
    "export HALM_ROOT='/h/o/.claude/mnemosyne'",
    "export MNEMOSYNE_ROOT='/h/o/.claude/mnemosyne'",
    "exec bun '/p/plugin/bin/mcp-proxy.ts'",
  ].join("\n") + "\n",
  "cmd-emb-strict-log": [
    "@echo off",
    "rem Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "rem serving only remember / recall / update / forget / stats / get.",
    "rem HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "rem HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "rem HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "rem HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "rem HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "rem HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "set \"MNEMOPI_DATA_DIR=/h/o'b/.claude/mnemosyne/store\"",
    "if not defined HALM_OWNER if defined MNEMOSYNE_OWNER set \"HALM_OWNER=%MNEMOSYNE_OWNER%\"",
    "if not defined HALM_OWNER set \"HALM_OWNER=global\"",
    "set \"MNEMOPI_SESSION_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_CHANNEL_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_OWNER_PER_CALL=\"",
    "set \"MNEMOPI_NO_EMBEDDINGS=\"",
    "set \"MNEMOPI_MCP_BANK=default\"",
    "set \"MNEMOPI_LLM_BASE_URL=\"",
    "set \"MNEMOPI_HOST_LLM_ENABLED=\"",
    "set \"MNEMOPI_AUTHOR_ID=\"",
    "set \"MNEMOPI_AUTHOR_TYPE=\"",
    "set \"MNEMOPI_POLYPHONIC_RECALL=0\"",
    "set \"MNEMOPI_EMBEDDING_API_URL=\"",
    "set \"MNEMOPI_EMBEDDINGS_VIA_API=\"",
    "set \"MNEMOPI_EMBEDDING_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5\"",
    "set \"MNEMOPI_EMBEDDING_DIM=\"",
    "set \"OPENROUTER_BASE_URL=\"",
    "set \"OPENROUTER_API_KEY=\"",
    "set \"OPENAI_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDINGS_API_OPT_IN=0\"",
    "set \"HF_ENDPOINT=https://huggingface.co\"",
    "set \"PI_CONFIG_DIR=.claude/mnemosyne/model-cache\"",
    "set \"HALM_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"MNEMOSYNE_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"HALM_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"MNEMOSYNE_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"HALM_GUARD_MODE=strict\"",
    "set \"MNEMOSYNE_GUARD_MODE=strict\"",
    "set \"HALM_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"MNEMOSYNE_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"HALM_ROOT=/h/o/.claude/mnemosyne\"",
    "set \"MNEMOSYNE_ROOT=/h/o/.claude/mnemosyne\"",
    "bun \"/p/plugin/bin/mcp-proxy.ts\"",
  ].join("\r\n") + "\r\n",
  "cmd-emb-warn-log": [
    "@echo off",
    "rem Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "rem serving only remember / recall / update / forget / stats / get.",
    "rem HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "rem HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "rem HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "rem HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "rem HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "rem HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "set \"MNEMOPI_DATA_DIR=/h/o'b/.claude/mnemosyne/store\"",
    "if not defined HALM_OWNER if defined MNEMOSYNE_OWNER set \"HALM_OWNER=%MNEMOSYNE_OWNER%\"",
    "if not defined HALM_OWNER set \"HALM_OWNER=global\"",
    "set \"MNEMOPI_SESSION_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_CHANNEL_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_OWNER_PER_CALL=\"",
    "set \"MNEMOPI_NO_EMBEDDINGS=\"",
    "set \"MNEMOPI_MCP_BANK=default\"",
    "set \"MNEMOPI_LLM_BASE_URL=\"",
    "set \"MNEMOPI_HOST_LLM_ENABLED=\"",
    "set \"MNEMOPI_AUTHOR_ID=\"",
    "set \"MNEMOPI_AUTHOR_TYPE=\"",
    "set \"MNEMOPI_POLYPHONIC_RECALL=0\"",
    "set \"MNEMOPI_EMBEDDING_API_URL=\"",
    "set \"MNEMOPI_EMBEDDINGS_VIA_API=\"",
    "set \"MNEMOPI_EMBEDDING_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5\"",
    "set \"MNEMOPI_EMBEDDING_DIM=\"",
    "set \"OPENROUTER_BASE_URL=\"",
    "set \"OPENROUTER_API_KEY=\"",
    "set \"OPENAI_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDINGS_API_OPT_IN=0\"",
    "set \"HF_ENDPOINT=https://huggingface.co\"",
    "set \"PI_CONFIG_DIR=.claude/mnemosyne/model-cache\"",
    "set \"HALM_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"MNEMOSYNE_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"HALM_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"MNEMOSYNE_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"HALM_GUARD_MODE=warn\"",
    "set \"MNEMOSYNE_GUARD_MODE=warn\"",
    "set \"HALM_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"MNEMOSYNE_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"HALM_ROOT=/h/o/.claude/mnemosyne\"",
    "set \"MNEMOSYNE_ROOT=/h/o/.claude/mnemosyne\"",
    "bun \"/p/plugin/bin/mcp-proxy.ts\"",
  ].join("\r\n") + "\r\n",
  "cmd-noemb-strict-log": [
    "@echo off",
    "rem Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "rem serving only remember / recall / update / forget / stats / get.",
    "rem HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "rem HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "rem HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "rem HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "rem HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "rem HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "set \"MNEMOPI_DATA_DIR=/h/o'b/.claude/mnemosyne/store\"",
    "if not defined HALM_OWNER if defined MNEMOSYNE_OWNER set \"HALM_OWNER=%MNEMOSYNE_OWNER%\"",
    "if not defined HALM_OWNER set \"HALM_OWNER=global\"",
    "set \"MNEMOPI_SESSION_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_CHANNEL_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_OWNER_PER_CALL=\"",
    "set \"MNEMOPI_NO_EMBEDDINGS=1\"",
    "set \"MNEMOPI_MCP_BANK=default\"",
    "set \"MNEMOPI_LLM_BASE_URL=\"",
    "set \"MNEMOPI_HOST_LLM_ENABLED=\"",
    "set \"MNEMOPI_AUTHOR_ID=\"",
    "set \"MNEMOPI_AUTHOR_TYPE=\"",
    "set \"MNEMOPI_POLYPHONIC_RECALL=0\"",
    "set \"MNEMOPI_EMBEDDING_API_URL=\"",
    "set \"MNEMOPI_EMBEDDINGS_VIA_API=\"",
    "set \"MNEMOPI_EMBEDDING_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5\"",
    "set \"MNEMOPI_EMBEDDING_DIM=\"",
    "set \"OPENROUTER_BASE_URL=\"",
    "set \"OPENROUTER_API_KEY=\"",
    "set \"OPENAI_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDINGS_API_OPT_IN=0\"",
    "set \"HF_ENDPOINT=https://huggingface.co\"",
    "set \"PI_CONFIG_DIR=.claude/mnemosyne/model-cache\"",
    "set \"HALM_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"MNEMOSYNE_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"HALM_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"MNEMOSYNE_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"HALM_GUARD_MODE=strict\"",
    "set \"MNEMOSYNE_GUARD_MODE=strict\"",
    "set \"HALM_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"MNEMOSYNE_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"HALM_ROOT=/h/o/.claude/mnemosyne\"",
    "set \"MNEMOSYNE_ROOT=/h/o/.claude/mnemosyne\"",
    "bun \"/p/plugin/bin/mcp-proxy.ts\"",
  ].join("\r\n") + "\r\n",
  "cmd-noemb-warn-log": [
    "@echo off",
    "rem Written by the HAL-M plugin (externalMcp). A stdio MCP server over its store,",
    "rem serving only remember / recall / update / forget / stats / get.",
    "rem HALM_OWNER picks the owner: global (default) or a project-... id (MNEMOSYNE_OWNER is still read).",
    "rem HALM_CLI (also set as MNEMOSYNE_CLI) is the engine cli the proxy starts.",
    "rem HALM_ACTIVITY_LOG (also set as MNEMOSYNE_ACTIVITY_LOG) is the activity log each call is recorded in; empty when activityLog is off.",
    "rem HALM_GUARD_MODE (also set as MNEMOSYNE_GUARD_MODE) is the guardMode option: strict refuses a warned save unless the call passes confirm: true, warn saves it.",
    "rem HALM_VOCABULARY (also set as MNEMOSYNE_VOCABULARY) is the tag vocabulary file its tags are cleaned with (aliases folded).",
    "rem HALM_ROOT (also set as MNEMOSYNE_ROOT) is the folder holding config.json, the settings it reads at each call (guard limits, tag count, tools served).",
    "set \"MNEMOPI_DATA_DIR=/h/o'b/.claude/mnemosyne/store\"",
    "if not defined HALM_OWNER if defined MNEMOSYNE_OWNER set \"HALM_OWNER=%MNEMOSYNE_OWNER%\"",
    "if not defined HALM_OWNER set \"HALM_OWNER=global\"",
    "set \"MNEMOPI_SESSION_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_CHANNEL_ID=%HALM_OWNER%\"",
    "set \"MNEMOPI_OWNER_PER_CALL=\"",
    "set \"MNEMOPI_NO_EMBEDDINGS=1\"",
    "set \"MNEMOPI_MCP_BANK=default\"",
    "set \"MNEMOPI_LLM_BASE_URL=\"",
    "set \"MNEMOPI_HOST_LLM_ENABLED=\"",
    "set \"MNEMOPI_AUTHOR_ID=\"",
    "set \"MNEMOPI_AUTHOR_TYPE=\"",
    "set \"MNEMOPI_POLYPHONIC_RECALL=0\"",
    "set \"MNEMOPI_EMBEDDING_API_URL=\"",
    "set \"MNEMOPI_EMBEDDINGS_VIA_API=\"",
    "set \"MNEMOPI_EMBEDDING_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDING_MODEL=BAAI/bge-small-en-v1.5\"",
    "set \"MNEMOPI_EMBEDDING_DIM=\"",
    "set \"OPENROUTER_BASE_URL=\"",
    "set \"OPENROUTER_API_KEY=\"",
    "set \"OPENAI_API_KEY=\"",
    "set \"MNEMOPI_EMBEDDINGS_API_OPT_IN=0\"",
    "set \"HF_ENDPOINT=https://huggingface.co\"",
    "set \"PI_CONFIG_DIR=.claude/mnemosyne/model-cache\"",
    "set \"HALM_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"MNEMOSYNE_CLI=/h/o/.claude/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts\"",
    "set \"HALM_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"MNEMOSYNE_ACTIVITY_LOG=/h/o/.claude/mnemosyne/activity.jsonl\"",
    "set \"HALM_GUARD_MODE=warn\"",
    "set \"MNEMOSYNE_GUARD_MODE=warn\"",
    "set \"HALM_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"MNEMOSYNE_VOCABULARY=/h/o/.claude/mnemosyne/vocabulary.json\"",
    "set \"HALM_ROOT=/h/o/.claude/mnemosyne\"",
    "set \"MNEMOSYNE_ROOT=/h/o/.claude/mnemosyne\"",
    "bun \"/p/plugin/bin/mcp-proxy.ts\"",
  ].join("\r\n") + "\r\n",
}

const CASES = [
  { key: 'emb-strict-log', embeddings: true, guardMode: 'strict', activity: BASE.activity },
  { key: 'emb-warn-log', embeddings: true, guardMode: 'warn', activity: BASE.activity },
  { key: 'noemb-strict-log', embeddings: false, guardMode: 'strict', activity: BASE.activity },
  { key: 'noemb-warn-log', embeddings: false, guardMode: 'warn', activity: BASE.activity },
]
const options = (c: { embeddings: boolean; guardMode: string; activity: string }): LauncherOptions => ({ ...BASE, ...c })

// Every variable the launcher blanks or pins so an inherited one cannot route memory text out (C1, C1b).
const BLANKED = [
  'MNEMOPI_EMBEDDING_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'MNEMOPI_EMBEDDING_API_URL',
  'MNEMOPI_EMBEDDINGS_VIA_API',
  'MNEMOPI_EMBEDDING_DIM',
  'OPENROUTER_BASE_URL',
  'MNEMOPI_LLM_BASE_URL',
  'MNEMOPI_HOST_LLM_ENABLED',
  'MNEMOPI_AUTHOR_ID',
  'MNEMOPI_AUTHOR_TYPE',
]

// The five values the proxy reads, each set under both spellings (plan 3.4).
const PROXY_NAMES = ['CLI', 'ACTIVITY_LOG', 'GUARD_MODE', 'VOCABULARY', 'ROOT'] as const
const proxyValue = (o: LauncherOptions, name: (typeof PROXY_NAMES)[number]) =>
  ({ CLI: o.cli, ACTIVITY_LOG: o.activity, GUARD_MODE: o.guardMode, VOCABULARY: o.vocabulary, ROOT: o.root })[name]

// A child environment for a launcher run for real: this process's own minus every
// HALM_/MNEMOSYNE_ name (so nothing inherited picks the owner), HOME in a temp home.
const HOME_ENV = isolatedEnv('launcher-sh')
const runEnv = (extra: Record<string, string> = {}) => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(HALM|MNEMOSYNE)_/.test(key)) env[key] = value
  return { ...env, ...HOME_ENV, HALM_NO_MIGRATE: '1', ...extra }
}

// Runs a sh launcher with /bin/sh up to its exec line, which is swapped for print.
const runSh = (o: LauncherOptions, print: string, extra: Record<string, string> = {}, cwd?: string) => {
  const text = launcherText(o, 'darwin').replace(/^exec bun .*$/m, print)
  const ran = Bun.spawnSync(['/bin/sh', '-c', text], { cwd, env: runEnv(extra), stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: ran.exitCode, stdout: ran.stdout.toString(), stderr: ran.stderr.toString() }
}

describe('launcher templates match the pinned bytes', () => {
  for (const c of CASES) {
    test(`sh ${c.key}`, () => expect(shWrapper(options(c))).toBe(GOLDEN[`sh-${c.key}`]!))
    test(`cmd ${c.key}`, () => expect(cmdWrapper(options(c))).toBe(GOLDEN[`cmd-${c.key}`]!))
  }
  test('sh with the activity log off', () => {
    expect(shWrapper(options({ embeddings: false, guardMode: 'warn', activity: '' }))).toBe(GOLDEN['sh-noemb-warn-nolog']!)
  })

  test('cmd lines end in exactly one \\r\\n, whatever the source file uses', () => {
    const texts = [...CASES.map(c => cmdWrapper(options(c))), launcherText(options(CASES[0]!), 'win32'), shimText('win32')]
    for (const text of texts) {
      expect(text).not.toMatch(/\r\r\n/)
      expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
      expect(text.endsWith('\r\n')).toBe(true)
    }
  })

  test('both launchers set every API and author variable blank, and pin the opt-in to 0', () => {
    for (const c of CASES) {
      const sh = shWrapper(options(c)).split('\n')
      const cmd = cmdWrapper(options(c)).split('\r\n')
      for (const name of BLANKED) {
        expect(sh).toContain(`export ${name}=`)
        expect(cmd).toContain(`set "${name}="`)
      }
      expect(sh).toContain('export MNEMOPI_EMBEDDINGS_API_OPT_IN=0')
      expect(cmd).toContain('set "MNEMOPI_EMBEDDINGS_API_OPT_IN=0"')
    }
  })

  test('modelCacheDir sets PI_CONFIG_DIR, absolute or relative', () => {
    const abs = { ...options(CASES[0]!), modelCacheDir: '/s/memory/model-cache' }
    expect(shWrapper(abs)).toContain(`\nexport PI_CONFIG_DIR='/s/memory/model-cache'\n`)
    expect(cmdWrapper(abs)).toContain('\r\nset "PI_CONFIG_DIR=/s/memory/model-cache"\r\n')
    expect(shWrapper(options(CASES[0]!))).toContain(`\nexport PI_CONFIG_DIR=${EMBEDDINGS_CACHE_DIR}\n`)
  })

  test('sh: a cache folder with a space, a $ and $( ) reaches PI_CONFIG_DIR exactly and runs nothing', () => {
    const work = tempDir('launcher')
    try {
      for (const dir of [`${work.dir}/my memory/model-cache`, `${work.dir}/$HOME/$(touch pwned)/model-cache`, `${work.dir}/it's \`touch pwned\`/cache`]) {
        const ran = runSh({ ...options(CASES[0]!), modelCacheDir: dir }, 'printf %s "$PI_CONFIG_DIR"', {}, work.dir)
        expect([dir, ran.exitCode, ran.stdout]).toEqual([dir, 0, dir])
        expect(existsSync(join(work.dir, 'pwned'))).toBe(false)
      }
    } finally {
      work.dispose()
    }
  })

  test('the plugin default PI_CONFIG_DIR stays bare (0.9.0 bytes), any other folder is quoted', () => {
    expect(shWrapper(options(CASES[0]!))).toContain(`\nexport PI_CONFIG_DIR=${EMBEDDINGS_CACHE_DIR}\n`)
    expect(shWrapper({ ...options(CASES[0]!), modelCacheDir: '/a b/c' })).toContain(`\nexport PI_CONFIG_DIR='/a b/c'\n`)
  })

  test('shellQuote survives a single quote', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('launcherText and the launcher file names', () => {
  test('launcherText writes cmd on win32 and sh everywhere else', () => {
    for (const c of CASES) {
      expect(launcherText(options(c), 'win32')).toBe(cmdWrapper(options(c)))
      for (const platform of ['darwin', 'linux', 'freebsd']) expect(launcherText(options(c), platform)).toBe(shWrapper(options(c)))
    }
  })

  test('launcherFile and oldLauncherFile add .cmd on win32 only', () => {
    expect(launcherFile('win32')).toBe('hal-m-mcp.cmd')
    expect(launcherFile('darwin')).toBe('hal-m-mcp')
    expect(launcherFile('linux')).toBe('hal-m-mcp')
    expect(oldLauncherFile('win32')).toBe('mnemosyne-mcp.cmd')
    expect(oldLauncherFile('darwin')).toBe('mnemosyne-mcp')
    expect(oldLauncherFile('linux')).toBe('mnemosyne-mcp')
    expect([LAUNCHER_NAME, OLD_LAUNCHER_NAME]).toEqual([launcherFile('linux'), oldLauncherFile('linux')])
  })
})

describe('sh launcher run for real: owner order and both spellings', () => {
  const OWNER = 'printf %s "$MNEMOPI_SESSION_ID|$MNEMOPI_CHANNEL_ID"'
  const owner = (extra: Record<string, string>) => runSh(options(CASES[0]!), OWNER, extra)

  test('HALM_OWNER wins over MNEMOSYNE_OWNER', () => {
    expect(owner({ HALM_OWNER: 'project-new', MNEMOSYNE_OWNER: 'project-old' })).toEqual({ exitCode: 0, stdout: 'project-new|project-new', stderr: '' })
    expect(owner({ HALM_OWNER: 'project-new' }).stdout).toBe('project-new|project-new')
  })

  test('MNEMOSYNE_OWNER alone is used, so older agent scripts keep their owner', () => {
    expect(owner({ MNEMOSYNE_OWNER: 'project-old' }).stdout).toBe('project-old|project-old')
  })

  test('neither owner gives global', () => {
    expect(owner({}).stdout).toBe('global|global')
    expect(owner({ HALM_OWNER: '', MNEMOSYNE_OWNER: '' }).stdout).toBe('global|global')
  })

  test('an empty HALM_OWNER falls to MNEMOSYNE_OWNER', () => {
    expect(owner({ HALM_OWNER: '', MNEMOSYNE_OWNER: 'project-old' }).stdout).toBe('project-old|project-old')
  })

  // NAME=<value>, or NAME=<unset>, for both spellings of the five values.
  const keys = PROXY_NAMES.flatMap(name => [envKey(name), oldEnvKey(name)])
  const PRINT = keys.map(key => `printf '%s=%s\\n' ${key} "\${${key}-<unset>}"`).join('\n')
  const exported = (o: LauncherOptions, extra: Record<string, string> = {}) => {
    const ran = runSh(o, PRINT, extra)
    expect([ran.exitCode, ran.stderr]).toEqual([0, ''])
    return Object.fromEntries(ran.stdout.trimEnd().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
  }

  test('the five values are exported under both spellings, equal, even over inherited ones', () => {
    const o = { ...options(CASES[0]!), root: "/h/o'b/my root", vocabulary: '/h/$HOME/v $(x).json' }
    const stale = Object.fromEntries(keys.map(key => [key, `/stale/${key}`]))
    for (const extra of [{}, stale]) {
      const seen = exported(o, extra)
      for (const name of PROXY_NAMES) expect([name, seen[envKey(name)], seen[oldEnvKey(name)]]).toEqual([name, proxyValue(o, name), proxyValue(o, name)])
    }
  })

  test('an empty activity log is exported empty (log off) under both names, over inherited paths', () => {
    const o = options({ embeddings: false, guardMode: 'warn', activity: '' })
    const seen = exported(o, { HALM_ACTIVITY_LOG: '/stale/new.jsonl', MNEMOSYNE_ACTIVITY_LOG: '/stale/old.jsonl' })
    expect([seen.HALM_ACTIVITY_LOG, seen.MNEMOSYNE_ACTIVITY_LOG]).toEqual(['', ''])
  })

  test('sh text: each new name comes right before its old name', () => {
    const lines = shWrapper(options(CASES[0]!)).split('\n')
    for (const name of PROXY_NAMES) {
      const at = lines.findIndex(line => line.startsWith(`export ${envKey(name)}=`))
      expect(at).toBeGreaterThan(0)
      expect(lines[at + 1]!.startsWith(`export ${oldEnvKey(name)}=`)).toBe(true)
    }
  })
})

describe('cmd launcher text: owner lines and both spellings', () => {
  const OWNER_LINES = [
    'if not defined HALM_OWNER if defined MNEMOSYNE_OWNER set "HALM_OWNER=%MNEMOSYNE_OWNER%"',
    'if not defined HALM_OWNER set "HALM_OWNER=global"',
    'set "MNEMOPI_SESSION_ID=%HALM_OWNER%"',
    'set "MNEMOPI_CHANNEL_ID=%HALM_OWNER%"',
  ]

  test('the owner lines come in order, before anything reads HALM_OWNER', () => {
    for (const c of CASES) {
      const lines = launcherText(options(c), 'win32').split('\r\n')
      const at = lines.indexOf(OWNER_LINES[0]!)
      expect(at).toBeGreaterThan(0)
      expect(lines.slice(at, at + OWNER_LINES.length)).toEqual(OWNER_LINES)
      expect(lines.findIndex(line => !line.startsWith('rem ') && line.includes('HALM_OWNER'))).toBe(at)
    }
  })

  test('every value is set under both names, new first, the empty activity log too', () => {
    for (const o of [...CASES.map(options), options({ embeddings: false, guardMode: 'warn', activity: '' })]) {
      const lines = cmdWrapper(o).split('\r\n')
      for (const name of PROXY_NAMES) {
        const at = lines.indexOf(`set "${envKey(name)}=${proxyValue(o, name)}"`)
        expect([name, at > 0]).toEqual([name, true])
        expect(lines[at + 1]).toBe(`set "${oldEnvKey(name)}=${proxyValue(o, name)}"`)
      }
    }
  })
})

describe('the old-name shim', () => {
  test('sh text', () => {
    expect(shimText('darwin')).toBe(
      [
        '#!/bin/sh',
        '# Written by the HAL-M plugin: the old launcher name, kept so MCP configs that name it still work.',
        '# It runs hal-m-mcp next to it.',
        'exec "$(dirname "$0")/hal-m-mcp" "$@"',
      ].join('\n') + '\n',
    )
    expect(shimText('linux')).toBe(shimText('darwin'))
  })

  test('cmd text', () => {
    expect(shimText('win32')).toBe(
      [
        '@echo off',
        'rem Written by the HAL-M plugin: the old launcher name, kept so MCP configs that name it still work.',
        'rem It runs hal-m-mcp.cmd next to it.',
        '"%~dp0hal-m-mcp.cmd" %*',
      ].join('\r\n') + '\r\n',
    )
  })

  test('sh run for real: by an absolute path and a relative one with spaces, args unchanged', () => {
    const work = tempDir('launcher-shim')
    try {
      const args = ['plain', 'two words', "it's", '$HOME', '$(touch pwned)', '*', '', '--flag=a b', 'tab\there']
      const expected = args.map(arg => `[${arg}]\n`).join('')
      const run = (bin: string) => {
        const dir = join(work.dir, bin)
        mkdirSync(dir, { recursive: true })
        // A fake launcher that prints each argument it gets.
        writeFileSync(join(dir, launcherFile('darwin')), '#!/bin/sh\nfor arg in "$@"; do printf \'[%s]\\n\' "$arg"; done\n')
        writeFileSync(join(dir, oldLauncherFile('darwin')), shimText('darwin'))
        chmodSync(join(dir, launcherFile('darwin')), 0o755)
        chmodSync(join(dir, oldLauncherFile('darwin')), 0o755)
        const spawn = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: work.dir, env: runEnv(), stdout: 'pipe', stderr: 'pipe' })
        const absolute = spawn([join(dir, oldLauncherFile('darwin')), ...args])
        // sh starts the shim by a path relative to the working folder.
        const relative = spawn(['/bin/sh', '-c', '"$0" "$@"', `./${bin}/${oldLauncherFile('darwin')}`, ...args])
        return [absolute, relative].map(ran => [ran.exitCode, ran.stdout.toString(), ran.stderr.toString()])
      }
      for (const bin of ['bin', 'my folder/b i n']) {
        expect([bin, ...run(bin)]).toEqual([bin, [0, expected, ''], [0, expected, '']])
      }
      expect(existsSync(join(work.dir, 'pwned'))).toBe(false)
    } finally {
      work.dispose()
    }
  })
})

// Claude HAL-M — first start of the Docker image: lays out the data volume.
//
//   bun docker/init-data.ts [<data root>]      (default: $MNEMOSYNE_ROOT, else /data)
//
// Creates what is missing and never overwrites a file that exists:
//   <root>/store/          the memory store (700); the engine makes mnemopi.db on its first run
//   <root>/backups/        (700)
//   <root>/config.json     default settings (600)
//   <root>/vocabulary.json the tag vocabulary, seeded from the store (600)
//   <root>/activity.jsonl  the activity log, empty (600)
// The store is $MNEMOSYNE_STORE when set, else <root>/store. Prints one JSON line
// naming the files it created.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { configText, emptyConfig } from '../hooks/settings'
import { VOCAB_FILE } from '../hooks/vocab'
import { configFile } from '../bin/settings'
import { initVocabulary } from '../bin/vocab'

const IS_WINDOWS = process.platform === 'win32'

function ownerOnly(path: string, mode: number) {
  if (!IS_WINDOWS) chmodSync(path, mode)
}

function folder(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  ownerOnly(path, 0o700)
}

/** Writes `text` to `path` only when no file is there (O_EXCL): true when it wrote. */
function createOnly(path: string, text: string) {
  try {
    writeFileSync(path, text, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  ownerOnly(path, 0o600)
  return true
}

export function initData(root: string, store = join(root, 'store')): { root: string; store: string; created: string[] } {
  if (!isAbsolute(root)) throw new Error(`the data root must be an absolute path (got "${root}")`)
  if (!isAbsolute(store)) throw new Error(`the store must be an absolute path (got "${store}")`)
  root = resolve(root)
  store = resolve(store)
  const created: string[] = []
  for (const dir of [root, store, join(root, 'backups')]) {
    if (!existsSync(dir)) created.push(dir)
    folder(dir)
  }
  if (createOnly(configFile(root), configText(emptyConfig()))) created.push(configFile(root))
  // Seeded from the store, which exists by now; a new store has no database yet,
  // which initVocabulary reads as no tags (only the agent seeds).
  const vocabulary = join(root, VOCAB_FILE)
  if (!existsSync(vocabulary)) {
    initVocabulary(store, root)
    ownerOnly(vocabulary, 0o600)
    created.push(vocabulary)
  }
  const activity = join(root, 'activity.jsonl')
  if (createOnly(activity, '')) created.push(activity)
  return { root, store, created }
}

if (import.meta.main) {
  try {
    const root = process.argv[2] || process.env.MNEMOSYNE_ROOT || '/data'
    const done = initData(root, process.env.MNEMOSYNE_STORE || join(root, 'store'))
    console.log(JSON.stringify({ ok: true, ...done }))
  } catch (error) {
    console.error(`init-data: ${(error as Error).message}`)
    process.exit(1)
  }
}

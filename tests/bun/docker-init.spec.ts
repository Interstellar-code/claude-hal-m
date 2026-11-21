// docker/init-data.ts: the Docker image's first start lays out the data volume and
// never overwrites what is there.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initData } from '../../docker/init-data'
import { configText, emptyConfig } from '../../hooks/settings'
import { parseVocabulary, VOCAB_FILE } from '../../hooks/vocab'
import { tempDir } from './helpers'

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

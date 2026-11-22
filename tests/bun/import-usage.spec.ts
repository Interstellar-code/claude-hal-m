// HAL-M Stage 2 (plan 1 item 3): the import usage text names the new slash command; the old one stays an alias.
import { describe, expect, test } from 'bun:test'
import { IMPORT_USAGE, parseImportArgs } from '../../hooks/import'
import { commandName, oldCommandName } from '../../hooks/names'

describe('IMPORT_USAGE', () => {
  test('names /hal-m-import for every mode and never the old name', () => {
    expect(IMPORT_USAGE.startsWith(`Usage: /${commandName('import')} doc <path>`)).toBe(true)
    expect(IMPORT_USAGE).toContain('/hal-m-import session <id | last>')
    expect(IMPORT_USAGE).toContain('/hal-m-import apply [confirm]')
    expect(IMPORT_USAGE).not.toContain(`/${oldCommandName('import')}`)
  })

  test('an empty or unknown argument still asks for the usage', () => {
    expect(parseImportArgs('')).toEqual({ mode: 'usage' })
    expect(parseImportArgs('tags')).toEqual({ mode: 'usage' })
  })
})

// N01 (polish 3): the DES examples HELP offers as command links must land on evidence the demo actually holds.
// rebal_v0 DES is a card, but its tear sheet is a designed gap in the demo, so the examples name volmanaged_v0,
// a real registry row with a captured tear sheet. Only the test reads the demo dataset; the copy imports none of it.
import { describe, expect, it } from 'vitest'
import { evidenceInDemo } from '../demo/data/analytics'
import noticesFile from '../../public/third-party-notices.txt?raw'
import { HELP, HELP_KEYBOARD, HELP_KEYS, helpKeyboardFor, helpKeysFor } from './help'
import { HELP_TOPICS } from './helpTopics'

const DES_EXAMPLE = /^\{(\S+) DES <GO>\}$/

/** The hypothesis a `{<name> DES <GO>}` example names, or null for an example of another line. */
function desName(example: string): string | null {
  return DES_EXAMPLE.exec(example)?.[1] ?? null
}

describe('HELP examples that open DES', () => {
  it('reads the demo dataset: volmanaged_v0 has a tear sheet in it', () => {
    expect(evidenceInDemo().hypotheses).toContain('volmanaged_v0')
  })

  it('every {<name> DES <GO>} example on the HELP page names volmanaged_v0, which the demo holds', () => {
    const named = HELP.examples.map(desName).filter((name): name is string => name !== null)
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) {
      expect(name).toBe('volmanaged_v0')
      expect(evidenceInDemo().hypotheses).toContain(name)
    }
  })

  it('the first example of the DES topic names volmanaged_v0, and the hypothesis examples keep rebal_v0 and an instrument beside it', () => {
    const examples = HELP_TOPICS['DES']?.examples ?? []
    expect(desName(examples[0] ?? '')).toBe('volmanaged_v0')
    expect(evidenceInDemo().hypotheses).toContain(desName(examples[0] ?? ''))
    expect(examples).toEqual(['{volmanaged_v0 DES <GO>}', '{rebal_v0 DES <GO>}', '{TY1 COMDTY DES <GO>}'])
  })
})

// D7.4: HELP shows the bindings of the platform it runs on. A Mac binding on Windows (or the reverse) tells the reader to
// press a key that does nothing, so the two tables are kept apart here.
const MAC_WORDS = /Cmd|Option|\u2318|\u2325|Fn\+|Fn /
const PC_WORDS = /Ctrl|Alt\+|Alt |Windows/

const rowText = (rows: ReadonlyArray<readonly [string, string]>) => rows.map(([k, a]) => `${k} ${a}`).join('\n')

describe('HELP keys per platform (D7.4)', () => {
  it('born failing: no mac binding is shown on the pc table', () => {
    const rows = helpKeysFor('pc')
    expect(rowText(rows)).not.toMatch(MAC_WORDS)
    expect(helpKeyboardFor('pc').map((k) => k.key).join(' ')).not.toMatch(MAC_WORDS)
    expect(rows.map(([k]) => k)).toContain('Ctrl+K')
    expect(rows.map(([k]) => k)).toContain('Alt+K')
  })

  it('no pc-only binding is shown on the mac table: Cmd and Option take the place of Ctrl and Alt', () => {
    const rows = helpKeysFor('mac')
    expect(rowText(rows)).not.toMatch(PC_WORDS)
    expect(helpKeyboardFor('mac').map((k) => k.key).join(' ')).not.toMatch(PC_WORDS)
    const keys = rows.map(([k]) => k)
    expect(keys).toContain('Cmd+K')
    expect(keys).toContain('Option+K')
    expect(keys).toContain('Option+1 to Option+9')
    expect(keys).toContain('Cmd+[')
    expect(keys).toContain('Cmd+]')
  })

  it('the pc table is what HELP_KEYS and HELP_KEYBOARD have always been', () => {
    expect(helpKeysFor('pc')).toEqual(HELP_KEYS)
    expect(helpKeyboardFor('pc')).toEqual(HELP_KEYBOARD)
  })

  it('the mac table lists the same actions: every pc row has a mac row for the same action, plus the two bracket keys', () => {
    expect(helpKeysFor('mac')).toHaveLength(HELP_KEYS.length + 2)
  })

  it('the mac rows for Home, End and the page keys name the Fn key a laptop needs', () => {
    const text = (k: string) => helpKeysFor('mac').find(([key]) => key.startsWith(k))?.join(' ') ?? ''
    expect(text('Home')).toMatch(/Fn\+Left/)
    expect(text('End')).toMatch(/Fn\+Right/)
    expect(text('PgUp')).toMatch(/Fn\+Up/)
  })

  it('every F-key row on the mac table says to hold Fn unless the keyboard setting is on', () => {
    const fRows = helpKeysFor('mac').filter(([k]) => /^F\d/.test(k))
    expect(fRows.length).toBeGreaterThan(0)
    for (const [, action] of fRows) expect(action).toMatch(/Fn/)
  })
})

describe('HELP third-party notices link (D7.4)', () => {
  it('names the notices page file, which the app serves from web/public', () => {
    expect(HELP.noticesUrl).toBe('third-party-notices.txt')
    expect(noticesFile).toContain('PACKAGES')
    expect(noticesFile).toMatch(/page libraries/i)
    // The linked file holds the page libraries only, so the copy must not claim the desktop shell's notices are in it.
    expect(HELP.noticesText).toMatch(/page/i)
    expect(HELP.noticesText).toMatch(/not the desktop shell/i)
    expect(HELP.noticesText).not.toMatch(/\bevery\b/i)
    expect(HELP.noticesText).not.toMatch(/page and the desktop shell/i)
    expect(HELP.noticesLink.length).toBeGreaterThan(0)
  })

  it('uses UK spelling, no em or en dashes', () => {
    expect(`${HELP.noticesHeading} ${HELP.noticesText} ${HELP.noticesLink}`).not.toMatch(/[\u2013\u2014]/)
  })
})

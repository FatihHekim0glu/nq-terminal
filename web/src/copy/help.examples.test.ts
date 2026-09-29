// N01 (polish 3): the DES examples HELP offers as command links must land on evidence the demo actually holds.
// rebal_v0 DES is a card, but its tear sheet is a designed gap in the demo, so the examples name volmanaged_v0,
// a real registry row with a captured tear sheet. Only the test reads the demo dataset; the copy imports none of it.
import { describe, expect, it } from 'vitest'
import { evidenceInDemo } from '../demo/data/analytics'
import { HELP } from './help'
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

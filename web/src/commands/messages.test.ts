import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../copy/copyRules'
import { parseLine } from './line'
import { parseCommand, type ParseErrorCode } from './parser'
import { describeError } from './messages'
import type { CommandIndexData } from './types'

const INDEX: CommandIndexData = {
  grammar: '',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['za_v0'],
  confirmations: [],
  runs: ['nt_a'],
  registry_error: null,
}

// One line per error code, so every message template is exercised.
const CASES: Record<ParseErrorCode, string> = {
  empty: '',
  'too-long': 'x'.repeat(300),
  'bad-character': 'NQ; GP',
  'unknown-command': 'FOO',
  'unknown-function': 'NQ FOO',
  'unknown-context': 'XX GP',
  'index-unavailable': 'NQ GP',
  // parseLine turns a lone context into its function menu; the bare parser still reports it.
  'missing-function': 'NQ',
  'missing-context': 'GP',
  'context-not-accepted': 'NQ RUN',
  'no-context-taken': 'NQ REG',
  'missing-argument': 'NQ GIP',
  'bad-argument': 'NQ GIP 2019-02-30',
  'too-many-arguments': 'NQ GP 1h 1d',
  'sector-mismatch': 'NQ COMDTY GP',
  'sector-not-taken': '27F INDEX CORR',
  'missing-command': 'NXTW',
  'extra-after-word': 'LAST 3',
}

describe('parse error messages', () => {
  for (const [code, line] of Object.entries(CASES)) {
    it(`${code}: a filled-in sentence with no placeholder left and no copy-rule breach`, () => {
      const options = { index: code === 'index-unavailable' ? null : INDEX }
      const result = code === 'missing-function' ? parseCommand(line, options) : parseLine(line, options)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe(code)
      const text = describeError(result.error)
      expect(text).not.toMatch(/[{}]/)
      expect(text.length).toBeGreaterThan(10)
      expect(findCopyViolations({ text })).toEqual([])
    })
  }

  it('names the kinds a function takes', () => {
    const result = parseLine('NQ RUN', { index: INDEX })
    if (result.ok) throw new Error('expected an error')
    expect(describeError(result.error)).toBe('RUN takes a run; NQ is not one.')
    const eq = parseLine('NQ EQ', { index: INDEX })
    if (eq.ok) throw new Error('expected an error')
    expect(describeError(eq.error)).toBe('EQ takes a run or a hypothesis; NQ is not one.')
  })
})

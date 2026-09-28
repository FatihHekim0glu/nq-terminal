// @vitest-environment jsdom
// D08: MON drill-down '2) GIP' sent a GIP line with no date, and GIP's argument is required, so the
// parser always rejected it. Every drill row must produce a line the parser accepts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLine } from '../../commands/line'
import type { CommandIndexData } from '../../commands/types'
import FunctionsMenu, { drillFunctions } from './FunctionsMenu'

afterEach(cleanup)

const FIXTURE_INDEX: CommandIndexData = {
  grammar: '',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
}

describe('drillFunctions: every row the MON drill-down offers must parse (D08)', () => {
  it('born failing: 2) GIP needs a date argument, so the row must supply one', () => {
    for (const f of drillFunctions('NQ')) {
      const result = parseLine(f.line, { index: FIXTURE_INDEX, fallbackContext: null })
      expect(result.ok, `${f.code}: ${f.line} -> ${result.ok ? 'ok' : result.error.code}`).toBe(true)
    }
  })

  it('born failing: clicking 2) GIP in the rendered menu asks for a line the parser accepts', () => {
    const onRun = vi.fn()
    render(<FunctionsMenu panelId="p1" root="NQ" ticker="NQ1 Index" onRun={onRun} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /2\)\s*GIP/ }))
    expect(onRun).toHaveBeenCalledTimes(1)
    const line = onRun.mock.calls[0]?.[0] as string
    expect(parseLine(line, { index: FIXTURE_INDEX, fallbackContext: null }).ok).toBe(true)
  })
})

// U17: REG's 'n' column (trades, months or sessions depending on the trial) and MT's DSR table 'n'
// (always sessions, SV3a basis) were both headed the plain 'n'. New file, next to regColumns.tsx
// (owned), rather than editing copy/reg.ts, which this polish-2 wave does not hand to this worker.
import { describe, expect, it } from 'vitest'
import { DEFLATED } from '../../copy/deflated'
import { REG_COLUMNS, REG_COMPACT_COLUMNS } from './regColumns'

describe("REG_COLUMNS 'n' column labelled for U17", () => {
  it("heads the n column with the units it can take, not the bare 'n'", () => {
    const col = REG_COLUMNS.find((c) => c.id === 'n')
    expect(col?.header).toBe(DEFLATED.regNColumn)
    expect(col?.header).not.toBe('n')
  })

  it('keeps the n column in the compact set (a narrow panel still needs it)', () => {
    expect(REG_COMPACT_COLUMNS.some((c) => c.id === 'n')).toBe(true)
  })
})

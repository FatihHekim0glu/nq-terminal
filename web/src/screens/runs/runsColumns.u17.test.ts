// U17: RUNS' 'Hit rate' is per trade, while the tear sheet's is per non-zero session (already labelled
// there, TEAR_RET.rows.hitRate). New file, next to runsColumns.tsx (owned), rather than editing the
// existing runsColumns.test.ts (U14) or copy/runs.ts, neither of which this polish-2 wave hands to this
// worker.
import { describe, expect, it } from 'vitest'
import { DEFLATED } from '../../copy/deflated'
import { statsById } from './model'
import { runsColumns } from './runsColumns'

describe("RUNS 'Hit rate' column labelled for U17", () => {
  it("heads the hit column 'Hit rate (trades)', not the bare 'Hit rate'", () => {
    const columns = runsColumns(statsById([]))
    const hit = columns.find((c) => c.id === 'hit')
    expect(hit?.header).toBe(DEFLATED.runsHitRateColumn)
    expect(hit?.header).not.toBe('Hit rate')
  })
})

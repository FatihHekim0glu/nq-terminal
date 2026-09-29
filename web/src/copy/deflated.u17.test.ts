// U17: 'n' and 'Kurtosis' need their convention named, since they otherwise mean different things in
// different tables (REG's registry n against MT's DSR table n, and MT's raw Kurtosis against RET's
// excess kurtosis). copyRules.test.ts already lints every copy module for dashes and US spelling; this
// file checks the specific U17 wording lives here. New file, next to copy/deflated.ts (owned), rather
// than editing copy/reg.ts or copy/runs.ts, which this polish-2 wave does not hand to this worker.
import { describe, expect, it } from 'vitest'
import { DEFLATED } from './deflated'

describe('DEFLATED labels disambiguated for U17', () => {
  it("MT's DSR table 'n' names its basis: always sessions, per SV3a", () => {
    expect(DEFLATED.cols.n).toBe('n sessions (SV3a basis)')
  })

  it("MT's Kurtosis names the raw, normal = 3 convention (RET's is excess)", () => {
    expect(DEFLATED.cols.kurt).toBe('Kurtosis (raw, normal = 3)')
  })

  it("carries REG's 'n' column override, naming the units it can take", () => {
    expect(DEFLATED.regNColumn).toBe('n (trades/months/sessions)')
  })

  it("carries RUNS' 'Hit rate' column override, naming it per trade (the tear sheet's is per non-zero session)", () => {
    expect(DEFLATED.runsHitRateColumn).toBe('Hit rate (trades)')
  })
})

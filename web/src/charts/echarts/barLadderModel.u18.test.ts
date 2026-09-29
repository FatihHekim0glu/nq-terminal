// U18: BarLadder repeated the full unit on every y tick ('6 alpha, % per year, 1 tick per side'). On
// COST, BLK and DES costs the axis took about 200px (18% of the card) and squeezed the bars at 1366.
// Ticks now print numbers only, or '%' alone; the long unit stays in the card's existing 'Unit:' line
// (DesCosts.tsx, CostScreen.tsx, BlkScreen.tsx, RunBooks.tsx, RunTradePaths.tsx, SeasScreen.tsx, TearViews.tsx
// all already print one beside their ladder; MT's DSR ladder, deflatedModel.ts's deflatedLadder, sets no
// unit at all). New file, next to barLadderModel.ts (owned); barLadderModel.test.ts's one stale
// assertion for this behaviour ('so a bare number is never read in the wrong unit') is updated there,
// since no other polish-2 worker owns BarLadder or barLadderModel.
import { describe, expect, it } from 'vitest'
import { barLadderOption, type BarLadderInput } from './barLadderModel'
import { uniqueTokens } from './echartsTestUtil'

const T = uniqueTokens()

const LONG_UNIT = 'alpha, % per year, 1 tick per side'

const ladder: BarLadderInput = {
  name: 'Cost ladder',
  unit: LONG_UNIT,
  bars: [
    { label: '0 ticks', value: 0.06 },
    { label: '1 tick', value: -0.03 },
  ],
}

function yFormatter(input: BarLadderInput): (value: number) => string {
  const option = barLadderOption(input, T) as Record<string, any>
  return [option.yAxis].flat()[0].axisLabel.formatter
}

describe('BarLadder y-axis ticks (U18)', () => {
  it('prints a bare number for a long cost-ladder unit, never the full phrase', () => {
    const format = yFormatter(ladder)
    expect(format(0.06)).toBe('0.06')
    expect(format(0.06)).not.toContain(LONG_UNIT)
    expect(format(-0.03)).toBe('-0.03')
  })

  it('still prints a bare number for a short unit (R, USD): the card carries it, not every tick', () => {
    expect(yFormatter({ ...ladder, unit: 'R' })(-0.2)).toBe('-0.2')
    expect(yFormatter({ ...ladder, unit: 'USD' })(1500)).toBe('1500')
  })

  it("keeps '%' attached to the tick: short and self-evident on its own axis", () => {
    expect(yFormatter({ ...ladder, unit: '%' })(0.05)).toBe('0.05%')
  })

  it('prints a bare number when no unit is given at all (MT\'s DSR ladder)', () => {
    expect(yFormatter({ ...ladder, unit: undefined })(0.5)).toBe('0.5')
  })
})

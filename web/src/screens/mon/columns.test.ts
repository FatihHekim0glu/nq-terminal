// MON columns (look spec 7.7): every header names its unit, and the price units column only shows in a
// panel wide enough to hold it without a horizontal scrollbar (the HOME row budget).
import { describe, expect, it } from 'vitest'
import { monColumns } from './columns'
import { HORIZONS } from './testUniverse'

describe('monColumns', () => {
  it('names the unit of every horizon in its header', () => {
    expect(monColumns(HORIZONS, 'returns', false, true).filter((c) => c.id.startsWith('h-')).map((c) => c.header)).toEqual(
      ['1D %', '1W %', '1M %', '3M %', 'YTD %', '12M %'],
    )
    expect(monColumns(HORIZONS, 'normalised', false, true).find((c) => c.id === 'h-1D')?.header).toBe('1D sd')
  })

  it('adds the price units column only when the panel is wide', () => {
    expect(monColumns(HORIZONS, 'returns', false, true).at(-1)?.id).toBe('units')
    expect(monColumns(HORIZONS, 'returns', false, false).map((c) => c.id)).not.toContain('units')
  })

  it('fits a HOME panel (959 px less a 15 px scrollbar) without the units column', () => {
    const numberColumn = 45
    const width = monColumns(HORIZONS, 'returns', true, false).reduce((sum, c) => sum + c.width, numberColumn)
    expect(width).toBeLessThanOrEqual(944)
  })
})

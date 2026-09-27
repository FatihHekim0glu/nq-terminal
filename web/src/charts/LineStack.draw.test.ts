import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS, tagPolygon } from './theme'
import { drawMinorYTicks, drawTags, drawTimeAxis, drawZeroLine, labelLeavesCanvas, lastValueTags, tagBlocksLabel } from './LineStack.draw'
import { fakePlot, type CtxCall } from './LineStack.testUtil'
import { timeAxisLayout } from './LineStack.time'

const c = DEFAULT_CHART_TOKENS.color
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m - 1, d) / 1000
const named = (calls: CtxCall[], name: string) => calls.filter((x) => x[0] === name)

describe('zero line (UI_SPEC honest zero baseline, look spec 6.2)', () => {
  it('draws a solid 1px line across the plot at zero', () => {
    const u = fakePlot({ xMin: 0, xMax: 10, yMin: -2, yMax: 2, pxRatio: 2 })
    drawZeroLine(u, c.chartS1)
    const y = Math.round(u.valToPos(0, 'y', true)) + 0.5
    expect(named(u.ctx.calls, 'moveTo')).toEqual([['moveTo', u.bbox.left, y]])
    expect(named(u.ctx.calls, 'lineTo')).toEqual([['lineTo', u.bbox.left + u.bbox.width, y]])
    expect(u.ctx.calls).toContainEqual(['set:strokeStyle', '#FFFFFF'])
    expect(u.ctx.calls).toContainEqual(['set:lineWidth', 2])
    expect(u.ctx.calls).toContainEqual(['setLineDash', []])
  })

  it('draws nothing when zero is outside the value range', () => {
    const u = fakePlot({ xMin: 0, xMax: 10, yMin: 1, yMax: 3 })
    drawZeroLine(u, c.chartS1)
    expect(u.ctx.calls).toEqual([])
  })
})

describe('value labels that would be cut by the canvas edge', () => {
  it('drops a label whose text would cross the bottom or top of the canvas, keeps one with room', () => {
    // No time axis below this pane: the plot runs to the canvas bottom, where the splitter starts.
    const base = fakePlot({ xMin: 0, xMax: 10, yMin: 0.9, yMax: 1.1, height: 300, pxRatio: 2 })
    const flush = { ...base, height: 300 - 45 }
    expect(labelLeavesCanvas(flush, 0.9)).toBe(true)
    expect(labelLeavesCanvas(flush, 1.0)).toBe(false)
    expect(labelLeavesCanvas(base, 0.9)).toBe(false)
    // The top tick sits 8px below the canvas top: half a 13px label fits.
    expect(labelLeavesCanvas(base, 1.1)).toBe(false)
  })
})

describe('3px minor ticks halfway between the labelled ticks (look spec 6)', () => {
  it('on the value axis, right of the axis line', () => {
    const u = fakePlot({ xMin: 0, xMax: 10, yMin: 0, yMax: 1 })
    drawMinorYTicks(u, [0, 0.5, 1], c.chartAxis)
    const axisX = u.bbox.left + u.bbox.width
    const mid = (u.valToPos(0, 'y', true) + u.valToPos(0.5, 'y', true)) / 2
    expect(named(u.ctx.calls, 'moveTo')[0]).toEqual(['moveTo', axisX, Math.round(mid) + 0.5])
    expect(named(u.ctx.calls, 'lineTo')[0]).toEqual(['lineTo', axisX + 3, Math.round(mid) + 0.5])
    expect(named(u.ctx.calls, 'moveTo')).toHaveLength(2)
  })
})

describe('two-row time axis drawing (look spec 6.1)', () => {
  it('draws minor ticks, the month row, the year row and the year dividers', () => {
    const min = utc(2019, 1)
    const max = utc(2021, 12, 31)
    const u = fakePlot({ xMin: min, xMax: max, width: 1300, height: 400 })
    const layout = timeAxisLayout(min, max, u.over.clientWidth)
    drawTimeAxis(u, layout, { axis: c.chartAxis, divider: c.chartYearDiv, font: DEFAULT_CHART_TOKENS.font })
    const texts = named(u.ctx.calls, 'fillText').map((x) => x[1])
    expect(texts).toContain('Jan')
    expect(texts).toContain('2020')
    const jan = named(u.ctx.calls, 'fillText').find((x) => x[1] === 'Jan')!
    expect(jan[2]).toBeCloseTo(u.valToPos((utc(2019, 1) + utc(2019, 2)) / 2, 'x', true), 6)
    // Row 1 starts 8px under the plot (6px tick, 2px gap); row 2 16px lower.
    const plotBottom = u.bbox.top + u.bbox.height
    expect(jan[3]).toBe(plotBottom + 8)
    const y2020 = named(u.ctx.calls, 'fillText').find((x) => x[1] === '2020')!
    expect(y2020[3]).toBe(plotBottom + 24)
    expect(u.ctx.calls).toContainEqual(['set:fillStyle', '#808080'])
    expect(u.ctx.calls).toContainEqual(['set:textAlign', 'center'])
  })

  it('skips a label that does not fit its visible span', () => {
    const min = utc(2019, 1, 30)
    const max = utc(2021, 12, 31)
    const u = fakePlot({ xMin: min, xMax: max, width: 1300 })
    drawTimeAxis(u, timeAxisLayout(min, max, u.over.clientWidth), { axis: c.chartAxis, divider: c.chartYearDiv, font: DEFAULT_CHART_TOKENS.font })
    const first = named(u.ctx.calls, 'fillText')[0]!
    // January 2019 has two visible days: no room for "Jan".
    expect(first[1]).not.toBe('Jan')
  })
})

describe('last-value pentagon tags (look spec 6.1)', () => {
  const t = [0, 1, 2, 3, 4]

  it('tags the last visible value of each series in its colour, text black or white by contrast', () => {
    const u = fakePlot({ xMin: 0, xMax: 3, yMin: 0, yMax: 10 })
    const tags = lastValueTags(u, t, [
      { values: [1, 2, 3, 4, 5], colour: c.chartS1 },
      { values: [9, 8, null, null, 1], colour: c.candleDn },
    ], 2, '')
    expect(tags.map((x) => x.text)).toEqual(['4.00', '8.00'])
    expect(tags[0]!.fill).toBe('#FFFFFF')
    expect(tags[0]!.textColour).toBe('#000000')
    expect(tags[1]!.textColour).toBe('#000000')
  })

  it('pushes overlapping tags apart by one tag height', () => {
    const u = fakePlot({ xMin: 0, xMax: 4, yMin: 0, yMax: 100 })
    const tags = lastValueTags(u, t, [
      { values: [0, 0, 0, 0, 50], colour: c.chartS1 },
      { values: [0, 0, 0, 0, 50.5], colour: c.accent2 },
    ], 1, '')
    const ys = tags.map((x) => x.y).sort((a, b) => a - b)
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(17)
  })

  it('draws each tag as the pentagon from the theme geometry, with its text', () => {
    const u = fakePlot({ xMin: 0, xMax: 4, yMin: 0, yMax: 10, pxRatio: 1 })
    const tags = lastValueTags(u, t, [{ values: [1, 2, 3, 4, 5], colour: c.accent2 }], 2, '')
    drawTags(u, tags, DEFAULT_CHART_TOKENS.font)
    const axisX = u.bbox.left + u.bbox.width
    const poly = tagPolygon(axisX, tags[0]!.y, tags[0]!.width)
    expect(named(u.ctx.calls, 'moveTo')[0]).toEqual(['moveTo', ...poly[0]!])
    expect(named(u.ctx.calls, 'lineTo').map((x) => [x[1], x[2]])).toEqual(poly.slice(1))
    expect(u.ctx.calls).toContainEqual(['set:fillStyle', '#F06000'])
    expect(named(u.ctx.calls, 'fillText')[0]![1]).toBe('5.00')
  })

  it('hides an axis label that a tag covers', () => {
    const u = fakePlot({ xMin: 0, xMax: 4, yMin: 0, yMax: 10 })
    const tags = lastValueTags(u, t, [{ values: [1, 2, 3, 4, 5], colour: c.chartS1 }], 2, '')
    expect(tagBlocksLabel(u, tags, 5)).toBe(true)
    expect(tagBlocksLabel(u, tags, 6)).toBe(false)
    // A 13px label 14px from a 17px tag would touch it: half the tag plus half the text.
    const px = (v: number) => u.valToPos(v, 'y', true)
    const near = 5 + 14 / (px(0) - px(1))
    expect(tagBlocksLabel(u, tags, near)).toBe(true)
  })
})

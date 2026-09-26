import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from './chartTokens'
import { collectColours } from './themeTestUtil'
import { echartsPresets, echartsTheme, echartsWithGrid, makeEchartsTheme } from './echartsTheme'
import { corrHeat } from './scales'

const C = DEFAULT_CHART_TOKENS.color
const TOKEN_VALUES = new Set(Object.values(C))

describe('echartsTheme (look spec 6.3: heatmaps, distribution, ladders, scatter, swimlane)', () => {
  it('paints a black background with white 13px Bergoom text and no animation', () => {
    expect(echartsTheme.backgroundColor).toBe(C.bg)
    expect(echartsTheme.textStyle).toEqual({ fontFamily: DEFAULT_CHART_TOKENS.font.family, fontSize: 13, color: C.chartAxis })
    expect(echartsTheme.animation).toBe(false)
    expect(echartsTheme.legend).toEqual({ show: false })
  })

  it('puts the value axis on the right: white line, 6px major and 3px minor ticks, labels 2px out', () => {
    expect(echartsTheme.yAxis).toEqual({
      position: 'right',
      axisLine: { show: true, lineStyle: { color: C.chartAxis } },
      axisTick: { show: true, length: 6, lineStyle: { color: C.chartAxis } },
      minorTick: { show: true, splitNumber: 2, length: 3, lineStyle: { color: C.chartAxis } },
      splitLine: { show: false, lineStyle: { color: C.chartGrid, width: 1, type: [2, 2] } },
      axisLabel: { color: C.chartAxis, margin: 2 },
    })
  })

  it('draws the category or time axis with a white baseline and no grid', () => {
    expect(echartsTheme.xAxis).toEqual({
      axisLine: { show: true, lineStyle: { color: C.chartAxis } },
      axisTick: { show: true, lineStyle: { color: C.chartAxis } },
      splitLine: { show: false, lineStyle: { color: C.chartGrid, width: 1, type: [2, 2] } },
      axisLabel: { color: C.chartAxis },
    })
  })

  it('switches the dotted grid on and off without touching the input', () => {
    const on = echartsWithGrid(echartsTheme)
    expect(on.yAxis.splitLine.show).toBe(true)
    expect(on.xAxis.splitLine.show).toBe(true)
    expect(echartsTheme.yAxis.splitLine.show).toBe(false)
    expect(echartsWithGrid(on, false).xAxis.splitLine.show).toBe(false)
  })

  it('uses a token value for every colour in the theme and the presets (no stray hex)', () => {
    for (const found of [...collectColours(echartsTheme), ...collectColours(echartsPresets())]) {
      expect(TOKEN_VALUES.has(found.value), found.path).toBe(true)
    }
    expect(makeEchartsTheme()).toEqual(echartsTheme)
  })
})

describe('echartsPresets', () => {
  it('builds the CORR piecewise scale with the MOVERS fills and white text', () => {
    const { corr } = echartsPresets()
    expect(corr.pieces).toEqual([
      { lt: -0.4, color: C.corrDn2 },
      { gte: -0.4, lte: -0.1, color: C.corrDn1 },
      { gt: -0.1, lt: 0.1, color: C.corr0 },
      { gte: 0.1, lte: 0.4, color: C.corrUp1 },
      { gt: 0.4, color: C.corrUp2 },
    ])
    expect(corr.diagonal).toBe(C.corrDiag)
    expect(corr.label).toEqual({ color: C.white })
  })

  it('agrees with corrHeat at every piece boundary', () => {
    const { corr } = echartsPresets()
    const pieceFor = (r: number) =>
      corr.pieces.find((p) =>
        ('lt' in p && p.lt !== undefined ? r < p.lt : true) &&
        ('lte' in p && p.lte !== undefined ? r <= p.lte : true) &&
        ('gt' in p && p.gt !== undefined ? r > p.gt : true) &&
        ('gte' in p && p.gte !== undefined ? r >= p.gte : true),
      )?.color
    for (const r of [-1, -0.41, -0.4, -0.25, -0.1, -0.09, 0, 0.09, 0.1, 0.25, 0.4, 0.41, 1]) {
      expect(pieceFor(r), String(r)).toBe(corrHeat(r).fill)
    }
  })

  it('colours signed bars, whiskers, scatter boundaries, distribution and swimlane from tokens', () => {
    const p = echartsPresets()
    expect(p.barLadder).toEqual({ pos: C.barPos, neg: C.barNeg, whisker: C.white })
    expect(p.pScatter).toEqual({ point: C.white, bonferroni: C.chartMagenta, holm: C.chartGreen, bh: C.accent2 })
    expect(p.distribution).toEqual({ pos: C.barPos, neg: C.barNeg, curve: C.distCurve, risk: C.data })
    expect(p.swimlane).toEqual({ label: C.data, sealed: C.marker })
    expect(p.fence).toEqual({ color: C.fence, width: 1, type: [4, 3] })
  })
})

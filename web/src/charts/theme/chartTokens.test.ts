import { describe, expect, it } from 'vitest'
import tokensCss from '../../theme/tokens.css?raw'
import {
  CHART_TOKENS,
  DEFAULT_CHART_TOKENS,
  readChartTokens,
  seriesColor,
  type StyleSource,
} from './chartTokens'

// Every `--name: value;` declaration in tokens.css, skipping the Tailwind `var()` aliases. The first
// literal wins: the default dark theme sits before the CVD overrides.
function declared(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const value = m[2]!.trim()
    if (!out.has(m[1]!) && !value.startsWith('var(')) out.set(m[1]!, value)
  }
  return out
}

function fakeStyle(values: Record<string, string>): StyleSource {
  return { getPropertyValue: (name: string) => values[name] ?? '' }
}

const HEX = /^#[0-9A-F]{6}$/

describe('chart token defaults (look spec sections 2 and 6)', () => {
  it('match the spec values for the chart tokens of section 2.2', () => {
    const c = DEFAULT_CHART_TOKENS.color
    expect(c.bg).toBe('#000000')
    expect(c.chartGrid).toBe('#505050')
    expect(c.chartAxis).toBe('#FFFFFF')
    expect(c.chartS1).toBe('#FFFFFF')
    expect(c.chartArea).toBe('#031D38')
    expect(c.chartVol).toBe('#7189AA')
    expect(c.chartSplitOuter).toBe('#242424')
    expect(c.chartSplitInner).toBe('#484848')
    expect(c.chartYearDiv).toBe('#808080')
    expect(c.candleUp).toBe('#FFFFFF')
    expect(c.candleDn).toBe('#0080FF')
    expect(c.lastLine).toBe('#F09000')
    expect(c.perfPos).toBe('#007219')
    expect(c.perfNeg).toBe('#6A1020')
    expect(c.distCurve).toBe('#F79400')
    expect(c.rollVol).toBe('#00B5F7')
    expect(c.zeroLine).toBe('#848484')
    expect(c.accent2).toBe('#F06000')
    expect(c.legendBg).toBe('#0C0C0C')
    expect(c.marker).toBe('#FFFF00')
    expect(c.fence).toBe('#FFA028')
  })

  it('match the heat scales of section 2.2 (MON, CORR MOVERS, SEAG ramp ends)', () => {
    const c = DEFAULT_CHART_TOKENS.color
    expect([c.heatUp2, c.heatUp1, c.heatDn1, c.heatDn2]).toEqual(['#51EE6C', '#39A74C', '#BA152D', '#FF1E3E'])
    expect([c.corrDn2, c.corrDn1, c.corr0, c.corrUp1, c.corrUp2, c.corrDiag]).toEqual([
      '#6C0820', '#390014', '#000000', '#002D09', '#005713', '#4B4B4B',
    ])
    expect([c.seagDnFloor, c.seagDnMax, c.seagUpFloor, c.seagUpMax]).toEqual([
      '#5E0A1D', '#DE1831', '#014D10', '#18BD39',
    ])
  })

  it('are all upper-case 6-digit hex and never a banned pre-flat-black value', () => {
    const banned = ['#070A0E', '#94D53C', '#FFB000', '#063856', '#0B51A8']
    for (const [key, value] of Object.entries(DEFAULT_CHART_TOKENS.color)) {
      expect(value, key).toMatch(HEX)
      expect(banned, key).not.toContain(value)
    }
  })

  it('use the Bergoom stack at the 13px chart size', () => {
    expect(DEFAULT_CHART_TOKENS.font.family.startsWith('"Bergoom"')).toBe(true)
    expect(DEFAULT_CHART_TOKENS.font.size).toBe(13)
  })

  it('read the chart-only values under the names tokens.css gives them', () => {
    expect({
      split: CHART_TOKENS.chartSplitHover.css,
      minibarBg: CHART_TOKENS.chartMinibarBg.css,
      minibarFg: CHART_TOKENS.chartMinibarFg.css,
      cross: CHART_TOKENS.chartCross.css,
      crossLabel: CHART_TOKENS.chartCrossLabel.css,
      magenta: CHART_TOKENS.chartMagenta.css,
      green: CHART_TOKENS.chartGreen.css,
      btnHover: CHART_TOKENS.chartBtnHover.css,
      seag: [CHART_TOKENS.seagDnFloor.css, CHART_TOKENS.seagDnMax.css, CHART_TOKENS.seagUpFloor.css, CHART_TOKENS.seagUpMax.css],
    }).toEqual({
      split: '--chart-split-hover',
      minibarBg: '--minibar-bg',
      minibarFg: '--minibar-fg',
      cross: '--crosshair',
      crossLabel: '--crosshair-label',
      magenta: '--study-upper',
      green: '--study-lower',
      btnHover: '--toggle-hover',
      seag: ['--mret-dn-floor', '--mret-dn-max', '--mret-up-floor', '--mret-up-max'],
    })
  })
})

describe('tokens.css agrees with the chart token reader', () => {
  const css = declared(tokensCss)

  it('declares every chart token with exactly the reader default', () => {
    const wrong = Object.values(CHART_TOKENS)
      .filter((t) => css.get(t.css)?.toUpperCase() !== t.value)
      .map((t) => `${t.css}: tokens.css ${css.get(t.css) ?? 'missing'}, reader ${t.value}`)
    expect(wrong).toEqual([])
  })

  it('carries the font stack and chart size the reader falls back to', () => {
    expect(css.get('--font-sans')).toBe(DEFAULT_CHART_TOKENS.font.family)
    expect(css.get('--fs-chart')).toBe(`${DEFAULT_CHART_TOKENS.font.size}px`)
  })
})

describe('readChartTokens', () => {
  it('reads live custom properties, trimmed and upper-cased', () => {
    const t = readChartTokens(fakeStyle({ '--candle-dn': ' #0a0b0c', '--c-up': '#3399ff ' }))
    expect(t.color.candleDn).toBe('#0A0B0C')
    expect(t.color.cUp).toBe('#3399FF')
    expect(t.color.candleUp).toBe('#FFFFFF')
  })

  it('falls back to the default when a value is empty or not a 6-digit hex', () => {
    const t = readChartTokens(fakeStyle({ '--chart-vol': '', '--chart-grid': 'rgb(1, 2, 3)', '--last-line': '#FFF' }))
    expect(t.color.chartVol).toBe('#7189AA')
    expect(t.color.chartGrid).toBe('#505050')
    expect(t.color.lastLine).toBe('#F09000')
  })

  it('reads the font stack and size', () => {
    const t = readChartTokens(fakeStyle({ '--font-sans': ' "Source Sans 3", sans-serif', '--fs-chart': '11px' }))
    expect(t.font).toEqual({ family: '"Source Sans 3", sans-serif', size: 11 })
    expect(readChartTokens(fakeStyle({ '--fs-chart': 'large' })).font.size).toBe(13)
  })

  it('returns the defaults without a style source (no DOM)', () => {
    expect(readChartTokens(null)).toEqual(DEFAULT_CHART_TOKENS)
  })
})

describe('seriesColor', () => {
  it('is white, then the benchmark orange, then the sector palette in house order', () => {
    const c = DEFAULT_CHART_TOKENS.color
    expect(seriesColor(0)).toBe(c.chartS1)
    expect(seriesColor(1)).toBe(c.accent2)
    expect([2, 3, 4, 5, 6, 7, 8].map((i) => seriesColor(i))).toEqual([
      c.secEquity, c.secRates, c.secFx, c.secEnergy, c.secMetals, c.secGrains, c.secLivestock,
    ])
    expect(seriesColor(9)).toBe(c.secEquity)
  })
})

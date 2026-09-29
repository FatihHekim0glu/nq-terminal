// Chart colours and type, read from the CSS custom properties of src/theme/tokens.css
// (look spec sections 2 and 6). This file and tokens.css are the only places a chart colour is
// written as hex: every option object in this folder takes its colours from a ChartTokens value.
//
// tokens.css declares every token below with the same value (checked by chartTokens.test.ts), so
// it stays the one source. The chart-only values the spec gives without a name (sections 2.2, 6.1 to
// 6.3 and 9.2) use the names tokens.css gives them.
//
// Canvas libraries cannot resolve var(), so charts read the live values once per mount with
// readChartTokens(). The CVD themes (data-cvd) change what the reader returns, not this file.

interface TokenDef {
  readonly css: `--${string}`
  readonly value: string
}

export const CHART_TOKENS = {
  bg: { css: '--bg', value: '#000000' },
  text: { css: '--text', value: '#D7D7D7' },
  white: { css: '--white', value: '#FFFFFF' },
  data: { css: '--data', value: '#FFA028' },
  accent2: { css: '--accent-2', value: '#F06000' },
  cUp: { css: '--c-up', value: '#51EE6C' },
  cDown: { css: '--c-down', value: '#FF2C4A' },
  fence: { css: '--fence', value: '#FFA028' },
  secEquity: { css: '--sec-equity', value: '#6CB6FF' },
  secRates: { css: '--sec-rates', value: '#B39DFF' },
  secFx: { css: '--sec-fx', value: '#38C7E8' },
  secEnergy: { css: '--sec-energy', value: '#FF8A3D' },
  secMetals: { css: '--sec-metals', value: '#E0C060' },
  secGrains: { css: '--sec-grains', value: '#9CCC65' },
  secLivestock: { css: '--sec-livestock', value: '#F48FB1' },
  legendBg: { css: '--legend-bg', value: '#0C0C0C' },
  cyanChart: { css: '--cyan-chart', value: '#89FFF1' },
  marker: { css: '--marker', value: '#FFFF00' },
  datatipBg: { css: '--datatip-bg', value: '#99CACB' },
  barPos: { css: '--bar-pos', value: '#00851C' },
  barNeg: { css: '--bar-neg', value: '#C31834' },
  barMag: { css: '--bar-mag', value: '#0051BA' },
  heatUp2: { css: '--heat-up-2', value: '#51EE6C' },
  heatUp1: { css: '--heat-up-1', value: '#39A74C' },
  heatDn1: { css: '--heat-dn-1', value: '#BA152D' },
  heatDn2: { css: '--heat-dn-2', value: '#FF1E3E' },
  chartGrid: { css: '--chart-grid', value: '#505050' },
  chartAxis: { css: '--chart-axis', value: '#FFFFFF' },
  chartS1: { css: '--chart-s1', value: '#FFFFFF' },
  chartArea: { css: '--chart-area', value: '#031D38' },
  chartVol: { css: '--chart-vol', value: '#7189AA' },
  chartSplitOuter: { css: '--chart-split-outer', value: '#242424' },
  chartSplitInner: { css: '--chart-split-inner', value: '#484848' },
  chartYearDiv: { css: '--chart-year-div', value: '#808080' },
  candleUp: { css: '--candle-up', value: '#FFFFFF' },
  candleDn: { css: '--candle-dn', value: '#0080FF' },
  lastLine: { css: '--last-line', value: '#F09000' },
  perfPos: { css: '--perf-pos', value: '#007219' },
  perfNeg: { css: '--perf-neg', value: '#6A1020' },
  distCurve: { css: '--dist-curve', value: '#F79400' },
  rollVol: { css: '--roll-vol', value: '#00B5F7' },
  zeroLine: { css: '--zero-line', value: '#848484' },
  // LineStack's regime strip: one blue ramp, low to high (the CVD themes leave it alone).
  regimeLow: { css: '--regime-low', value: '#3A6EA5' },
  regimeMid: { css: '--regime-mid', value: '#5FA8E8' },
  regimeHigh: { css: '--regime-high', value: '#CFE8FF' },
  // 6.3: pane separator hover in lightweight-charts (resize is off, so it rarely shows).
  chartSplitHover: { css: '--chart-split-hover', value: '#626262' },
  // 6.1: floating Track | Table | Zoom toolbar.
  chartMinibarBg: { css: '--minibar-bg', value: '#111111' },
  chartMinibarFg: { css: '--minibar-fg', value: '#D8D8D8' },
  // 9.2, best guess shown as a house choice: crosshair lines and axis labels.
  chartCross: { css: '--crosshair', value: '#BFBFBF' },
  chartCrossLabel: { css: '--crosshair-label', value: '#C0FFFF' },
  // 6.2 Bollinger upper and lower; 6.3 PScatter Bonferroni and Holm lines.
  chartMagenta: { css: '--study-upper', value: '#FF00FF' },
  chartGreen: { css: '--study-lower', value: '#00FF00' },
  // 4.5: toggle and range button hover (one frame, low confidence).
  chartBtnHover: { css: '--toggle-hover', value: '#414141' },
  // 2.2 CORR: the 2018 MOVERS tiles; neutral black; diagonal grey.
  corrDn2: { css: '--corr-dn-2', value: '#6C0820' },
  corrDn1: { css: '--corr-dn-1', value: '#390014' },
  corr0: { css: '--corr-0', value: '#000000' },
  corrUp1: { css: '--corr-up-1', value: '#002D09' },
  corrUp2: { css: '--corr-up-2', value: '#005713' },
  corrDiag: { css: '--corr-diag', value: '#4B4B4B' },
  // 2.2 MRET: the SEAG ramp, floor to max on each side.
  seagDnFloor: { css: '--mret-dn-floor', value: '#5E0A1D' },
  seagDnMax: { css: '--mret-dn-max', value: '#DE1831' },
  seagUpFloor: { css: '--mret-up-floor', value: '#014D10' },
  seagUpMax: { css: '--mret-up-max', value: '#18BD39' },
} as const satisfies Record<string, TokenDef>

const FONT_SANS: TokenDef = { css: '--font-sans', value: '"Bergoom", "Source Sans 3", system-ui, sans-serif' }
const FS_CHART: TokenDef = { css: '--fs-chart', value: '13px' }

export type ChartColorKey = keyof typeof CHART_TOKENS
export type ChartColors = Readonly<Record<ChartColorKey, string>>

export interface ChartTokens {
  readonly color: ChartColors
  readonly font: { readonly family: string; readonly size: number }
}

/** What readChartTokens needs from a CSSStyleDeclaration (getComputedStyle of the root). */
export interface StyleSource {
  getPropertyValue(name: string): string
}

const HEX6 = /^#[0-9A-F]{6}$/
const HEX3 = /^#([0-9A-F])([0-9A-F])([0-9A-F])$/
const PX = /^(\d+(?:\.\d+)?)px$/

const ALL_TOKENS: Readonly<Record<ChartColorKey, TokenDef>> = CHART_TOKENS

/**
 * A custom property's hex colour as `#RRGGBB`, or null. A production build minifies the stylesheet, so
 * `#3399FF` reaches getComputedStyle as `#39f` (each digit doubles): both spellings are read.
 */
function expandHex(raw: string): string | null {
  if (HEX6.test(raw)) return raw
  const short = HEX3.exec(raw)
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null
}

function readColour(source: StyleSource | null, def: TokenDef): string {
  const raw = source?.getPropertyValue(def.css).trim().toUpperCase() ?? ''
  return expandHex(raw) ?? def.value
}

function readFont(source: StyleSource | null): ChartTokens['font'] {
  const family = source?.getPropertyValue(FONT_SANS.css).trim() || FONT_SANS.value
  const size = PX.exec(source?.getPropertyValue(FS_CHART.css).trim() ?? '') ?? PX.exec(FS_CHART.value)
  return { family, size: Number(size![1]) }
}

function rootStyle(): StyleSource | null {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return null
  return getComputedStyle(document.documentElement)
}

/**
 * The chart tokens as the page currently resolves them. With no DOM (tests, or before mount) and for
 * any value that is not a 6-digit or 3-digit hex, the spec default is used.
 */
export function readChartTokens(source: StyleSource | null = rootStyle()): ChartTokens {
  const entries = (Object.keys(ALL_TOKENS) as ChartColorKey[]).map((k) => [k, readColour(source, ALL_TOKENS[k])] as const)
  return { color: Object.fromEntries(entries) as ChartColors, font: readFont(source) }
}

export const DEFAULT_CHART_TOKENS: ChartTokens = readChartTokens(null)

const SERIES_REST: readonly ChartColorKey[] = [
  'secEquity', 'secRates', 'secFx', 'secEnergy', 'secMetals', 'secGrains', 'secLivestock',
]

/** Series colour by index (6.2): white, the benchmark orange, then the sector palette in house order. */
export function seriesColor(index: number, tokens: ChartTokens = DEFAULT_CHART_TOKENS): string {
  if (index === 0) return tokens.color.chartS1
  if (index === 1) return tokens.color.accent2
  return tokens.color[SERIES_REST[(index - 2) % SERIES_REST.length]!]
}

/** A canvas font string at the chart size, for example `13px "Bergoom", ...`. */
export function canvasFont(tokens: ChartTokens = DEFAULT_CHART_TOKENS): string {
  return `${tokens.font.size}px ${tokens.font.family}`
}

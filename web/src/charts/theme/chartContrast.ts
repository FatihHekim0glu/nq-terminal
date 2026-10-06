// Chart colours under the operating system's contrast settings (roadmap Phase D9). Canvas charts are
// drawn by script, so the browser's forced colours never reach them and CSS cannot restyle them: the
// chart kit reads the contrast mode itself and resolves the tokens to match.
//
// - forced-colors: active (a Windows contrast theme): every chart token maps to one of five CSS system
//   colours (Canvas, CanvasText, Highlight, GrayText, LinkText), resolved through a hidden probe
//   element's computed style, so the canvas matches the theme the user chose. With so few colours,
//   series that differ only by colour also get a dash pattern (forcedDash) as a second cue.
// - prefers-contrast: more: the default palette with stronger gridlines, dividers and axes.
// - neither: the default palette, untouched (the default look must not change).
//
// subscribeChartContrast reports a change of either query (and of the colour scheme, which is how a
// switch between a dark and a light contrast theme shows) and, under forced colours, of the system
// colours themselves (a switch between two dark or two light themes), so charts redraw.
import { COMPONENT_MIN, TEXT_MIN, contrastRatio } from '../../theme/contrast'
import {
  SYSTEM_COLOUR_FALLBACK,
  readChartTokens,
  type ChartColorKey,
  type ChartColors,
  type ChartContrast,
  type ChartTokens,
  type StyleSource,
  type SystemColours,
} from './chartTokens'

export const FORCED_COLOURS_QUERY = '(forced-colors: active)'
export const MORE_CONTRAST_QUERY = '(prefers-contrast: more)'
/** Watched too: switching between a dark and a light contrast theme keeps forced colours active. */
export const COLOUR_SCHEME_QUERY = '(prefers-color-scheme: dark)'
const WATCHED_QUERIES = [FORCED_COLOURS_QUERY, MORE_CONTRAST_QUERY, COLOUR_SCHEME_QUERY] as const

/** What the chart kit needs from a MediaQueryList (the old addListener pair for older engines). */
export interface ContrastMediaList {
  readonly matches: boolean
  addEventListener?(type: 'change', listener: () => void): void
  removeEventListener?(type: 'change', listener: () => void): void
  addListener?(listener: () => void): void
  removeListener?(listener: () => void): void
}

export type MediaMatcher = (query: string) => ContrastMediaList

function defaultMatcher(): MediaMatcher | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return (query) => window.matchMedia(query)
}

function matches(match: MediaMatcher, query: string): boolean {
  try {
    return match(query).matches === true
  } catch {
    return false
  }
}

/** The contrast mode the page is in: forced colours win over prefers-contrast more. */
export function readChartContrast(match: MediaMatcher | null = defaultMatcher()): ChartContrast | undefined {
  if (match === null) return undefined
  if (matches(match, FORCED_COLOURS_QUERY)) return 'forced'
  if (matches(match, MORE_CONTRAST_QUERY)) return 'more'
  return undefined
}

// ---------- system colours ----------

type SystemRole = keyof SystemColours

const SYSTEM_KEYWORDS: Readonly<Record<SystemRole, string>> = {
  canvas: 'Canvas',
  canvasText: 'CanvasText',
  highlight: 'Highlight',
  grayText: 'GrayText',
  linkText: 'LinkText',
}

const ROLES = Object.keys(SYSTEM_KEYWORDS) as SystemRole[]

/** Reads raw computed colours for CSS colour keywords, one per keyword, in order. */
export type KeywordReader = (keywords: readonly string[]) => readonly string[]

/**
 * The computed `color` of a hidden probe element set to each keyword in turn. The probe opts out of
 * forced colours itself, so the computed value is the system colour and not the browser's override
 * of an author colour. It is removed before returning.
 */
export const probeKeywords: KeywordReader = (keywords) => {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return keywords.map(() => '')
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  probe.style.setProperty('forced-color-adjust', 'none')
  const parent = document.body ?? document.documentElement
  parent.append(probe)
  try {
    return keywords.map((k) => {
      probe.style.color = ''
      probe.style.color = k
      return probe.style.color === '' ? '' : getComputedStyle(probe).color
    })
  } finally {
    probe.remove()
  }
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function byte(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
}

/** A computed colour as upper-case `#RRGGBB`, or null for anything else (a keyword, a transparent value). */
export function computedToHex(raw: string): string | null {
  const s = raw.trim()
  const hex = HEX.exec(s)
  if (hex) {
    const d = hex[1]!
    const full = d.length === 3 ? [...d].map((ch) => ch + ch).join('') : d
    return `#${full.toUpperCase()}`
  }
  const m = RGB.exec(s)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4])
  if (!(alpha > 0)) return null
  return `#${[m[1], m[2], m[3]].map((v) => byte(Number(v))).join('').toUpperCase()}`
}

/** The five system colours as hex; any one the reader cannot resolve falls back on its own. */
export function readSystemColours(read: KeywordReader = probeKeywords, fallback: SystemColours = SYSTEM_COLOUR_FALLBACK): SystemColours {
  let raw: readonly string[]
  try {
    raw = read(ROLES.map((r) => SYSTEM_KEYWORDS[r]))
  } catch {
    raw = []
  }
  const entries = ROLES.map((role, i) => [role, computedToHex(raw[i] ?? '') ?? fallback[role]] as const)
  return Object.fromEntries(entries) as unknown as SystemColours
}

// ---------- forced colours ----------

/**
 * The system colour each chart token takes under forced colours. Text, axes, the lead series and
 * outlines are CanvasText on Canvas; the benchmark and alerts are Highlight; further series and
 * reference curves LinkText; grids, dividers and quiet fills GrayText. Heat cells keep their sign
 * in the printed value, and the text on each cell is still chosen by contrast (scales.ts textOn).
 */
const FORCED_ROLE = {
  bg: 'canvas',
  text: 'canvasText',
  white: 'canvasText',
  data: 'highlight',
  accent2: 'highlight',
  cUp: 'canvasText',
  cDown: 'highlight',
  fence: 'linkText',
  secEquity: 'linkText',
  secRates: 'canvasText',
  secFx: 'highlight',
  secEnergy: 'linkText',
  secMetals: 'canvasText',
  secGrains: 'highlight',
  secLivestock: 'linkText',
  legendBg: 'canvas',
  cyanChart: 'canvasText',
  marker: 'highlight',
  datatipBg: 'canvas',
  barPos: 'canvasText',
  barNeg: 'highlight',
  barMag: 'linkText',
  heatUp2: 'linkText',
  heatUp1: 'grayText',
  heatDn1: 'grayText',
  heatDn2: 'highlight',
  chartGrid: 'grayText',
  chartAxis: 'canvasText',
  chartS1: 'canvasText',
  chartArea: 'canvas',
  chartVol: 'grayText',
  chartSplitOuter: 'grayText',
  chartSplitInner: 'grayText',
  chartYearDiv: 'grayText',
  candleUp: 'canvasText',
  candleDn: 'highlight',
  lastLine: 'highlight',
  perfPos: 'grayText',
  perfNeg: 'grayText',
  distCurve: 'linkText',
  rollVol: 'linkText',
  zeroLine: 'grayText',
  regimeLow: 'grayText',
  regimeMid: 'linkText',
  regimeHigh: 'canvasText',
  chartSplitHover: 'highlight',
  chartMinibarBg: 'canvas',
  chartMinibarFg: 'canvasText',
  chartCross: 'canvasText',
  chartCrossLabel: 'highlight',
  chartMagenta: 'highlight',
  chartGreen: 'linkText',
  chartBtnHover: 'highlight',
  corrDn2: 'highlight',
  corrDn1: 'grayText',
  corr0: 'canvas',
  corrUp1: 'grayText',
  corrUp2: 'linkText',
  corrDiag: 'grayText',
  seagDnFloor: 'grayText',
  seagDnMax: 'highlight',
  seagUpFloor: 'grayText',
  seagUpMax: 'linkText',
} as const satisfies Record<ChartColorKey, SystemRole>

/** The chart tokens under forced colours: system colours only, the font kept. */
export function forcedChartTokens(system: SystemColours, base: ChartTokens): ChartTokens {
  const keys = Object.keys(FORCED_ROLE) as ChartColorKey[]
  const color = Object.fromEntries(keys.map((k) => [k, system[FORCED_ROLE[k]]])) as ChartColors
  return { color, font: base.font, contrast: 'forced' }
}

/**
 * Second cues for series that differ only by colour under forced colours: one dash pattern per series
 * position, all distinct, and none equal to the grid (2 on 2), fence (4 on 3) or day divider (3 on 3).
 * Position 0, the lead series, stays solid.
 */
export const FORCED_DASHES: readonly (readonly number[])[] = [
  [],
  [10, 4],
  [2, 5],
  [10, 3, 2, 3],
  [6, 3],
  [16, 4],
  [6, 3, 2, 3, 2, 3],
  [3, 7],
]

/** The dash for series position `index` under forced colours ([] is solid); undefined in any other mode. */
export function forcedDash(tokens: ChartTokens, index: number): number[] | undefined {
  if (tokens.contrast !== 'forced') return undefined
  return [...FORCED_DASHES[Math.abs(Math.trunc(index)) % FORCED_DASHES.length]!]
}

// ---------- prefers-contrast: more ----------

/** The first candidate that reaches `min` against `bg`, else the strongest of them. */
function firstReaching(bg: string, min: number, candidates: readonly string[]): string {
  const hit = candidates.find((v) => contrastRatio(v, bg) >= min)
  if (hit !== undefined) return hit
  return candidates.reduce((best, v) => (contrastRatio(v, bg) > contrastRatio(best, bg) ? v : best))
}

/**
 * The palette with stronger structure for prefers-contrast more: gridlines, zero lines and year
 * dividers reach text contrast (4.5:1), pane separators reach 3:1 and axes take the strongest of the
 * axis, white and text tokens. Every value is still a token of the active theme.
 */
export function moreContrastTokens(base: ChartTokens): ChartTokens {
  const c = base.color
  const strong = [c.chartYearDiv, c.chartCross, c.white]
  const color: ChartColors = {
    ...c,
    chartGrid: firstReaching(c.bg, TEXT_MIN, [c.chartGrid, ...strong]),
    zeroLine: firstReaching(c.bg, TEXT_MIN, [c.zeroLine, ...strong]),
    chartYearDiv: firstReaching(c.bg, TEXT_MIN, [c.chartYearDiv, c.chartCross, c.white]),
    chartSplitInner: firstReaching(c.bg, COMPONENT_MIN, [c.chartSplitInner, ...strong]),
    chartSplitOuter: firstReaching(c.bg, COMPONENT_MIN, [c.chartSplitOuter, ...strong]),
    chartAxis: firstReaching(c.bg, Number.POSITIVE_INFINITY, [c.chartAxis, c.white, c.text]),
  }
  return { ...base, color, contrast: 'more' }
}

// ---------- the live reader and change subscription ----------

export interface ContrastEnv {
  readonly match?: MediaMatcher | null
  readonly style?: StyleSource | null
  readonly keywords?: KeywordReader
}

/**
 * The chart tokens for the page as it is now: system colours under forced colours, the stronger
 * palette under prefers-contrast more, otherwise exactly readChartTokens() (CVD themes included).
 */
export function readLiveChartTokens(env: ContrastEnv = {}): ChartTokens {
  const mode = readChartContrast(env.match === undefined ? defaultMatcher() : env.match)
  const base = env.style === undefined ? readChartTokens() : readChartTokens(env.style)
  if (mode === 'forced') return forcedChartTokens(readSystemColours(env.keywords), base)
  if (mode === 'more') return moreContrastTokens(base)
  return base
}

const WATCH_ATTRIBUTE = 'data-chart-contrast-watch'
const WATCH_STYLE =
  'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;border:0 solid;' +
  'forced-color-adjust:none;color:Highlight;background-color:Canvas;border-top-color:CanvasText;' +
  'border-bottom-color:LinkText;outline-color:GrayText;' +
  'transition:color 1ms,background-color 1ms,border-top-color 1ms,border-bottom-color 1ms,outline-color 1ms'

/**
 * Reports a change of the five system colours themselves while forced colours stay active: a switch
 * between two dark (or two light) contrast themes changes none of the media queries. A hidden element
 * transitions its system-coloured properties, so the browser's own style update raises transition events
 * when the theme changes; window focus and page visibility re-probe too, as a fallback. Each trigger
 * compares the probed colours with the last ones seen and calls `onChange` only when they differ.
 * `rebase` records the current colours without reporting.
 */
function watchSystemColours(
  isForced: () => boolean,
  read: KeywordReader,
  onChange: () => void,
): { readonly stop: () => void; readonly rebase: () => void } {
  if (typeof document === 'undefined' || typeof window === 'undefined') return { stop: () => undefined, rebase: () => undefined }
  const signature = () => Object.values(readSystemColours(read)).join(',')
  let last = signature()
  const rebase = () => {
    last = signature()
  }
  const check = () => {
    if (!isForced()) return
    const now = signature()
    if (now === last) return
    last = now
    onChange()
  }
  const watcher = document.createElement('span')
  watcher.setAttribute('aria-hidden', 'true')
  watcher.setAttribute(WATCH_ATTRIBUTE, '')
  watcher.style.cssText = WATCH_STYLE
  watcher.addEventListener('transitionrun', check)
  watcher.addEventListener('transitionend', check)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
  ;(document.body ?? document.documentElement).append(watcher)
  return {
    rebase,
    stop: () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      watcher.remove()
    },
  }
}

/**
 * Calls `onChange` whenever forced colours, prefers-contrast or the colour scheme changes, and while
 * forced colours are active whenever the system colours change (a switch between two contrast themes of
 * the same scheme). Returns the unsubscribe. With no matchMedia (tests, old engines) it subscribes to
 * nothing. `read` is for tests; the page probes the real system colours.
 */
export function subscribeChartContrast(
  onChange: () => void,
  match: MediaMatcher | null = defaultMatcher(),
  read: KeywordReader = probeKeywords,
): () => void {
  if (match === null) return () => undefined
  const colours = watchSystemColours(() => matches(match, FORCED_COLOURS_QUERY), read, onChange)
  const handler = () => {
    colours.rebase()
    onChange()
  }
  const lists: ContrastMediaList[] = []
  for (const q of WATCHED_QUERIES) {
    try {
      lists.push(match(q))
    } catch {
      // A query this engine cannot parse is simply not watched.
    }
  }
  for (const l of lists) {
    if (typeof l.addEventListener === 'function') l.addEventListener('change', handler)
    else l.addListener?.(handler)
  }
  return () => {
    colours.stop()
    for (const l of lists) {
      if (typeof l.removeEventListener === 'function') l.removeEventListener('change', handler)
      else l.removeListener?.(handler)
    }
  }
}

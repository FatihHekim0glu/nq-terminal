// The pure parts of REG 94) Effect map (roadmap #5, slice 3): SV3a's served annual Sharpe against each trial's
// track length in years (n / periods), one GlyphScatter point per trial of the Deflated Sharpe view. Only served
// values are plotted; the only arithmetic is n / periods. Nothing here is a score, a rank or a total: a point's
// mark is its REGISTRY ROW NUMBER, 1 + its index in the rows 91) Board shows (the served registry order the
// board and 92) Evidence number by default), so Number <GO> n on the map opens the DES of the board's row n.
// The verdict glyphs are the files' badges (PASS up, FAIL down, anything else a ring); the terminal adds none.
import { offScaleLines, placedPoints } from '../../charts/echarts/glyphScatterModel'
import type { GlyphPoint, GlyphRefLine, GlyphScatterInput, PointGlyph } from '../../charts/echarts/glyphScatterModel'
import { niceAxis } from '../../charts/echarts/shared'
import { EVIDENCE_MAP as M } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { trackYears } from '../../quant/power'
import { formatNumber } from '../tear/tearFormat'
import { formatDsr, type DeflatedView } from './deflatedModel'
import type { Badge, RegRow } from './regModel'

/** Annual Sharpe beyond plus or minus this is drawn pinned at the axis edge, labelled with its true value. */
export const MAP_Y_LIMIT = 3
/** The years axis is logarithmic when the longest track is at least this many times the shortest. */
const LOG_RATIO = 10
/** The mark of a trial that is not a row of the board: it has no number, so Number <GO> cannot open it. */
const NO_MARK = '-'
const SHOWN_DECIMALS = 2

export interface EvidenceMapView {
  readonly input: GlyphScatterInput
  /** The axis rule, what is pinned or off the axes, and the trials with no row number; null with no points. */
  readonly note: string | null
  /** The numbered points, ascending: Number <GO> n opens the DES of `name`. */
  readonly points: readonly { readonly n: number; readonly name: string }[]
}

type Trial = DeflatedView['rows'][number]
type Scale = 'log' | 'linear'

const glyphOf = (badge: Badge): PointGlyph => (badge === 'PASS' ? 'up' : badge === 'FAIL' ? 'down' : 'ring')
const isUsable = (v: number): boolean => Number.isFinite(v)
const withinLimit = (v: number): number => Math.min(Math.max(v, -MAP_Y_LIMIT), MAP_Y_LIMIT)

/** Each registry row with its board number, first occurrence of a name winning. */
function numberRows(rows: readonly RegRow[]): Map<string, { readonly row: RegRow; readonly n: number }> {
  const byName = new Map<string, { readonly row: RegRow; readonly n: number }>()
  rows.forEach((row, i) => {
    if (!byName.has(row.name)) byName.set(row.name, { row, n: i + 1 })
  })
  return byName
}

/** Log only when the longest positive track is at least LOG_RATIO times the shortest; else linear. */
function scaleOf(years: readonly number[]): Scale {
  const shown = years.filter((v) => isUsable(v) && v > 0)
  if (shown.length < 2) return 'linear'
  return Math.max(...shown) / Math.min(...shown) >= LOG_RATIO ? 'log' : 'linear'
}

/** A linear years axis is fitted to the tracks (the ten year cluster would otherwise sit in a tenth of a 0 to 12 axis). */
function xAxisOf(scale: Scale, years: readonly number[]): GlyphScatterInput['x'] {
  const base = { label: M.xAxis, scale, format: 'number', signed: false } as const
  const shown = years.filter(isUsable)
  if (scale === 'log' || shown.length === 0) return base
  const nice = niceAxis(Math.min(...shown), Math.max(...shown))
  return { ...base, min: nice.min, max: nice.max }
}

/**
 * The Sharpe axis: rounded out over the points (each clamped to the limit), zero and the reference lines
 * inside the limit, then cut at plus or minus MAP_Y_LIMIT. A point beyond the cut is pinned by the chart.
 */
function yAxisOf(sharpes: readonly number[], lines: readonly GlyphRefLine[]): GlyphScatterInput['y'] {
  const values = [
    0,
    ...sharpes.filter(isUsable).map(withinLimit),
    ...lines.map((l) => l.value).filter((v) => isUsable(v) && Math.abs(v) <= MAP_Y_LIMIT),
  ]
  const nice = niceAxis(Math.min(...values), Math.max(...values))
  return {
    label: M.yAxis,
    scale: 'linear',
    format: 'number',
    min: Math.max(nice.min, -MAP_Y_LIMIT),
    max: Math.min(nice.max, MAP_Y_LIMIT),
  }
}

function referenceLines(view: DeflatedView): GlyphRefLine[] {
  return [
    {
      axis: 'y',
      value: view.sr0_null_annual ?? Number.NaN,
      label: fillCopy(M.v0Line, { sr: formatNumber(view.sr0_null_annual, SHOWN_DECIMALS), n: view.n_trials }),
      tone: 'data',
    },
    { axis: 'y', value: view.sr0_annual ?? Number.NaN, label: fillCopy(M.vLine, { sr: formatNumber(view.sr0_annual, SHOWN_DECIMALS) }), tone: 'accent' },
    { axis: 'y', value: 0, label: M.zeroLine, tone: 'muted' },
  ]
}

function pointOf(trial: Trial, numbered: { readonly row: RegRow; readonly n: number } | undefined): GlyphPoint {
  return {
    label: trial.name,
    tag: numbered ? String(numbered.n) : NO_MARK,
    x: trackYears(trial.n, trial.periods),
    y: trial.annual_sharpe ?? Number.NaN,
    glyph: numbered ? glyphOf(numbered.row.badge) : 'ring',
    ...(numbered?.row.tag === 'overlay' ? { hollow: true } : {}),
    kind: numbered ? numbered.row.badge : M.kindNone,
    extra: { dsr: formatDsr(trial.dsr_null) },
  }
}

function noteOf(input: GlyphScatterInput, scale: Scale, unnumbered: readonly string[]): string | null {
  if (input.points.length === 0) return null
  const pinned = placedPoints(input).drawn.filter((p) => p.off).map((p) => p.label)
  const off = offScaleLines(input)
  return [
    fillCopy(M.scaleRule, { scale: scale === 'log' ? M.scaleLog : M.scaleLinear }),
    pinned.length > 0 ? fillCopy(M.pinned, { limit: MAP_Y_LIMIT, names: pinned.join(', ') }) : '',
    off.length > 0 ? fillCopy(M.offLines, { lines: off.map((l) => l.label).join(', ') }) : '',
    unnumbered.length > 0 ? fillCopy(M.unnumbered, { names: unnumbered.join(', ') }) : '',
  ]
    .filter((sentence) => sentence !== '')
    .join(' ')
}

/**
 * The effect map: every trial of the served Deflated Sharpe view as a point at (years, annual Sharpe), marked with
 * its number among `rows` (the rows 91) Board shows, in served order). A trial with no such row is marked "-", has no
 * number and is listed in the note. SR0 under V0, under V and zero are labelled lines; one outside the axes is not
 * drawn and is named in the note instead.
 */
export function buildEvidenceMap(view: DeflatedView, rows: readonly RegRow[]): EvidenceMapView {
  const numbered = numberRows(rows)
  const trials = view.rows.map((trial) => ({ trial, numbered: numbered.get(trial.name) }))
  const points = trials.map((t) => pointOf(t.trial, t.numbered))
  const years = points.map((p) => p.x)
  const lines = referenceLines(view)
  const scale = scaleOf(years)
  const input: GlyphScatterInput = {
    name: M.name,
    x: xAxisOf(scale, years),
    y: yAxisOf(points.map((p) => p.y), lines),
    points,
    lines,
    extraColumns: [{ key: 'dsr', label: M.dsrCol, numeric: true }],
  }
  const unnumbered = trials.filter((t) => t.numbered === undefined).map((t) => t.trial.name)
  return {
    input,
    note: noteOf(input, scale, unnumbered),
    points: trials
      .flatMap((t) => (t.numbered ? [{ n: t.numbered.n, name: t.trial.name }] : []))
      .sort((a, b) => a.n - b.n),
  }
}

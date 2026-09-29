// GlyphScatter (roadmap R8 and R5): one value against another where each point carries a verdict in
// its shape AND its colour, so neither has to be told apart alone (colour-vision safe): an up triangle
// in cUp, a down triangle (the same triangle turned 180 degrees) in cDown, and a ring for neither.
// A hollow point keeps its glyph and colour on a black fill. Labelled reference lines and a dashed
// y = x diagonal sit under the points. A point outside a fixed axis range is pinned to the edge in its
// own glyph and colour, labelled with its true value; a point a log axis cannot show is left out of the
// chart and counted, but the table view keeps it.
// The types below are shared by the chart kits built on this one: change them only additively.
import { GLYPH_SCATTER as G } from '../../copy/glyphScatter'
import { fillCopy } from '../../copy/workspace'
import type { ChartColumn, ChartTable } from '../ChartA11y'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartColors, type ChartTokens } from '../theme'
import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from './core'
import { fixed, formatP, signed, withUnit } from './format'
import { baseOption, isFiniteNumber, markLine, niceAxis, refLine, textFont, themeXAxis, themeYAxis, type LineLabelPosition } from './shared'

export type PointGlyph = 'up' | 'down' | 'ring'
export type LineTone = 'data' | 'accent' | 'muted'

export interface GlyphPoint {
  /** Names the point in the table view. */
  readonly label: string
  /** The short mark drawn beside the glyph. */
  readonly tag: string
  readonly x: number
  readonly y: number
  readonly glyph: PointGlyph
  /** Drawn on a black fill, keeping the glyph and its colour on the border. */
  readonly hollow?: boolean
  /** What the glyph means, in words (the table's Kind column and the summary). */
  readonly kind: string
  /** Formatted extra cells for the table view, by GlyphScatterInput.extraColumns key. */
  readonly extra?: Readonly<Record<string, string>>
}

export interface GlyphAxis {
  readonly label: string
  readonly scale: 'log' | 'linear'
  readonly inverse?: boolean
  /** 'p' writes p-values with formatP; 'number' writes fixed decimals and the unit. */
  readonly format: 'p' | 'number'
  readonly decimals?: number
  readonly unit?: string
  /** False writes a linear value with no explicit plus, for a duration or a count. Default true. */
  readonly signed?: boolean
  /** A fixed end of the axis; it wins over the data. Points beyond it are pinned to the edge. */
  readonly min?: number
  readonly max?: number
}

export interface GlyphRefLine {
  readonly axis: 'x' | 'y'
  readonly value: number
  readonly label: string
  readonly tone: LineTone
}

export interface GlyphExtraColumn {
  readonly key: string
  readonly label: string
  readonly numeric?: boolean
}

export interface GlyphScatterInput {
  readonly name: string
  readonly x: GlyphAxis
  readonly y: GlyphAxis
  readonly points: readonly GlyphPoint[]
  readonly lines?: readonly GlyphRefLine[]
  /** The label of a dashed y = x line across both axes; both axes must share scale and format. */
  readonly diagonal?: string
  readonly extraColumns?: readonly GlyphExtraColumn[]
}

export interface GlyphDomain {
  readonly min: number
  readonly max: number
  /** Tick step on a linear axis. */
  readonly interval?: number
}

export type PlacedPoint = GlyphPoint & {
  /** Where it is drawn: the value, or the axis edge when the value is outside a fixed range. */
  readonly px: number
  readonly py: number
  /** True when it is drawn at an edge, not at its own value. */
  readonly off: boolean
}

const POINT_SIZE = 9
const GLYPH_BORDER = 1.5
const DEFAULT_DECIMALS = 2
/** Keeps a value that sits exactly on a decade from being rounded to the wrong side by log10 noise. */
const LOG_EPS = 1e-9
/** formatP prints anything below this as `<0.0001`; below it the true value is written as an exponent. */
const P_FLOOR = 0.0001
const P_TOP = 1
const EMPTY_LOG = { p: { min: 1e-3, max: P_TOP }, number: { min: 1, max: 10 } } as const
const BASE_KEYS: readonly string[] = ['tag', 'point', 'x', 'y', 'kind']

const SYMBOL = { up: 'triangle', down: 'triangle', ring: 'circle' } as const
const ROTATE = { up: 0, down: 180, ring: 0 } as const

const decade = (k: number) => Number(`1e${k}`)
const dec = (axis: GlyphAxis) => axis.decimals ?? DEFAULT_DECIMALS
const isLog = (axis: GlyphAxis) => axis.scale === 'log'
/** A value the axis can show: finite, and positive on a log axis. */
const usable = (v: number, axis: GlyphAxis) => isFiniteNumber(v) && (!isLog(axis) || v > 0)

function extent(values: readonly number[]): readonly [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/**
 * The axis range. A fixed min or max wins (a log axis takes only a positive one). A log axis runs from
 * a decade below the lowest positive value (a value on a decade gets room) to 1 for p-values, or to the
 * next decade above the highest for other numbers. A linear axis is rounded out over the values and 0.
 */
export function glyphDomain(axis: GlyphAxis, values: readonly number[]): GlyphDomain {
  const log = isLog(axis)
  const seen = values.filter((v) => usable(v, axis))
  const bound = (v: number | undefined) => (v !== undefined && usable(v, axis) ? v : undefined)
  const fixedMin = bound(axis.min)
  const fixedMax = bound(axis.max)
  if (log) {
    const empty = EMPTY_LOG[axis.format]
    const [lo, hi] = seen.length > 0 ? extent(seen) : [Infinity, -Infinity]
    const min = fixedMin ?? (seen.length > 0 ? decade(Math.floor(Math.log10(lo) - LOG_EPS)) : empty.min)
    const top = axis.format === 'p' ? P_TOP : seen.length > 0 ? decade(Math.ceil(Math.log10(hi) - LOG_EPS)) : empty.max
    const max = fixedMax ?? top
    return { min, max: max > min ? max : min * 10 }
  }
  const [lo, hi] = extent([0, ...seen])
  const nice = niceAxis(lo, hi)
  const min = fixedMin ?? nice.min
  const max = fixedMax ?? nice.max
  const interval = fixedMin === undefined && fixedMax === undefined ? nice.interval : niceAxis(min, max).interval
  return max > min ? { min, max, interval } : { min, max: min + 1, interval: 1 }
}

interface Placement {
  readonly drawn: PlacedPoint[]
  readonly dropped: number
  readonly xDomain: GlyphDomain
  readonly yDomain: GlyphDomain
}

const clamp = (v: number, d: GlyphDomain) => Math.min(Math.max(v, d.min), d.max)

function place(input: GlyphScatterInput): Placement {
  const shown = input.points.filter((p) => usable(p.x, input.x) && usable(p.y, input.y))
  const xDomain = glyphDomain(input.x, shown.map((p) => p.x))
  const yDomain = glyphDomain(input.y, shown.map((p) => p.y))
  const drawn = shown.map((p) => {
    const px = clamp(p.x, xDomain)
    const py = clamp(p.y, yDomain)
    return { ...p, px, py, off: px !== p.x || py !== p.y }
  })
  return { drawn, dropped: input.points.length - shown.length, xDomain, yDomain }
}

/**
 * The points to draw, each with the place it is drawn. A value that is not finite, or not positive on a
 * log axis, drops the point (counted); one outside a fixed axis range is pinned to the edge with off set.
 */
export function placedPoints(input: GlyphScatterInput): { drawn: PlacedPoint[]; dropped: number } {
  const { drawn, dropped } = place(input)
  return { drawn, dropped }
}

function linesOutside(input: GlyphScatterInput, placement: Placement): GlyphRefLine[] {
  return (input.lines ?? []).filter((l) => {
    const axis = l.axis === 'x' ? input.x : input.y
    const domain = l.axis === 'x' ? placement.xDomain : placement.yDomain
    return !usable(l.value, axis) || l.value < domain.min || l.value > domain.max
  })
}

/** The reference lines outside their axis range. They are not drawn; the caller says so. */
export function offScaleLines(input: GlyphScatterInput): GlyphRefLine[] {
  return linesOutside(input, place(input))
}

/** A value as the summary and table write it: p-values with formatP (an exponent below its floor). */
function valueText(v: number, axis: GlyphAxis): string {
  if (axis.format === 'p') return v > 0 && v < P_FLOOR ? v.toExponential(1) : formatP(v)
  return withUnit(isLog(axis) || axis.signed === false ? fixed(v, dec(axis)) : signed(v, dec(axis)), axis.unit)
}

/**
 * A table cell: a usable value as the summary writes it; a finite value the axis cannot show (zero or
 * negative on a log axis) as served, with no exponent form; a value that is not finite as the missing mark.
 */
function cellText(v: number, axis: GlyphAxis): string {
  if (usable(v, axis)) return valueText(v, axis)
  if (!isFiniteNumber(v)) return G.missing
  return axis.format === 'p' ? fixed(v, 4) : withUnit(fixed(v, dec(axis)), axis.unit)
}

/** An axis tick: formatP, with an exponent where formatP would print `<0.0001` for several ticks. */
function tickText(v: number, axis: GlyphAxis): string {
  if (axis.format === 'p') return v > 0 && v < P_FLOOR * (1 - LOG_EPS) ? v.toExponential(0) : formatP(v)
  return withUnit(fixed(v, dec(axis)), axis.unit)
}

function glyphColour(glyph: PointGlyph, c: ChartColors): string {
  return glyph === 'up' ? c.cUp : glyph === 'down' ? c.cDown : c.chartS1
}

function itemStyle(p: GlyphPoint, c: ChartColors) {
  const colour = glyphColour(p.glyph, c)
  if (p.glyph === 'ring' || p.hollow) return { color: c.bg, borderColor: colour, borderWidth: GLYPH_BORDER }
  return { color: colour }
}

function offValue(p: PlacedPoint, input: GlyphScatterInput): string {
  const parts: string[] = []
  if (p.px !== p.x) parts.push(valueText(p.x, input.x))
  if (p.py !== p.y) parts.push(valueText(p.y, input.y))
  return parts.join(', ')
}

/** A point on the right-hand edge puts its label inside the plot, not over the value axis labels. */
function labelSide(p: PlacedPoint, input: GlyphScatterInput, placement: Placement): 'left' | 'right' {
  const rightEdge = input.x.inverse ? placement.xDomain.min : placement.xDomain.max
  return p.px === rightEdge ? 'left' : 'right'
}

function pointItem(p: PlacedPoint, input: GlyphScatterInput, placement: Placement, tokens: ChartTokens) {
  const c = tokens.color
  return {
    value: [p.px, p.py],
    symbol: SYMBOL[p.glyph],
    symbolRotate: ROTATE[p.glyph],
    itemStyle: itemStyle(p, c),
    label: {
      show: true,
      formatter: p.off ? fillCopy(G.offScaleLabel, { tag: p.tag, value: offValue(p, input) }) : p.tag,
      position: labelSide(p, input, placement),
      color: c.text,
      ...textFont(tokens),
    },
  }
}

function toneColour(tone: LineTone, c: ChartColors): string {
  return tone === 'data' ? c.data : tone === 'accent' ? c.accent2 : c.zeroLine
}

/** A vertical line's label sits at its top; when the y axis is reversed the line runs top down, so at its start. */
function linePosition(line: GlyphRefLine, input: GlyphScatterInput): LineLabelPosition {
  if (line.axis === 'y') return 'insideEndTop'
  return input.y.inverse ? 'start' : 'end'
}

function refsSeries(lines: readonly GlyphRefLine[], input: GlyphScatterInput, tokens: ChartTokens): LineSeriesOption {
  const c = tokens.color
  const items = lines.map((l) =>
    refLine(l.axis === 'x' ? { xAxis: l.value } : { yAxis: l.value }, toneColour(l.tone, c), {
      label: l.label,
      dashed: false,
      position: linePosition(l, input),
    }),
  )
  return { id: 'refs', type: 'line', silent: true, data: [], markLine: markLine(items, tokens) }
}

function assertDiagonalAxes(input: GlyphScatterInput): void {
  if (input.x.scale !== input.y.scale || input.x.format !== input.y.format) {
    throw new Error('A y = x diagonal needs the same scale and format on both axes')
  }
}

/** The diagonal's label sits above its right-hand end (the low end when the x axis is reversed). */
const DIAGONAL_LABEL_SHIFT = [-2, -9] as const

function diagonalSeries(text: string, input: GlyphScatterInput, placement: Placement, tokens: ChartTokens): LineSeriesOption {
  const c = tokens.color
  const lo = Math.min(placement.xDomain.min, placement.yDomain.min)
  const hi = Math.max(placement.xDomain.max, placement.yDomain.max)
  // ECharts' endLabel follows the base axis: with x reversed it sits at the plot's left edge, off the canvas.
  // A label on the visually right-hand end (data index 0 when x is reversed) is placed where we say.
  const anchor = input.x.inverse ? 0 : 1
  return {
    id: 'diagonal',
    type: 'line',
    silent: true,
    showSymbol: true,
    symbolSize: 0,
    z: 3,
    data: [[lo, lo], [hi, hi]],
    lineStyle: { color: c.zeroLine, width: CHART_GEOMETRY.lineWidth, type: [...CHART_GEOMETRY.fenceDash] },
    label: {
      show: true,
      position: 'left',
      offset: [...DIAGONAL_LABEL_SHIFT],
      ...textFont(tokens),
      color: c.zeroLine,
      formatter: (params) => (params.dataIndex === anchor ? text : ''),
    },
  }
}

function axisOption(base: ReturnType<typeof themeXAxis> | ReturnType<typeof themeYAxis>, axis: GlyphAxis, domain: GlyphDomain, tokens: ChartTokens) {
  const shared = {
    ...base,
    name: axis.label,
    nameTextStyle: textFont(tokens),
    min: domain.min,
    max: domain.max,
    inverse: axis.inverse === true,
    axisLabel: { ...base.axisLabel, ...textFont(tokens), formatter: (v: number) => tickText(v, axis) },
  }
  return isLog(axis)
    ? { ...shared, type: 'log' as const, logBase: 10 }
    : { ...shared, type: 'value' as const, ...(domain.interval === undefined ? {} : { interval: domain.interval }) }
}

export function glyphScatterOption(input: GlyphScatterInput, tokens: ChartTokens = DEFAULT_CHART_TOKENS): EChartsOption {
  if (input.diagonal !== undefined) assertDiagonalAxes(input)
  const placement = place(input)
  const points: ScatterSeriesOption = {
    id: 'points',
    type: 'scatter',
    silent: true,
    z: 4,
    symbolSize: POINT_SIZE,
    data: placement.drawn.map((p) => pointItem(p, input, placement, tokens)),
  }
  const outside = new Set(linesOutside(input, placement))
  const lines = (input.lines ?? []).filter((l) => !outside.has(l))
  const series: Array<ScatterSeriesOption | LineSeriesOption> = []
  if (input.diagonal !== undefined) series.push(diagonalSeries(input.diagonal, input, placement, tokens))
  if (lines.length > 0) series.push(refsSeries(lines, input, tokens))
  series.push(points)
  return {
    ...baseOption(tokens),
    grid: { left: 12, right: CHART_GEOMETRY.axisGutter, top: 24, bottom: 40 },
    xAxis: { ...axisOption(themeXAxis(tokens), input.x, placement.xDomain, tokens), nameLocation: 'middle', nameGap: 24 },
    // The name sits at the top of the axis; a reversed axis has its top at the low end.
    yAxis: { ...axisOption(themeYAxis(tokens), input.y, placement.yDomain, tokens), nameLocation: input.y.inverse ? 'start' : 'end' },
    series,
  }
}

function kindsText(drawn: readonly PlacedPoint[]): string {
  const counts = new Map<string, { kind: string; glyph: PointGlyph; count: number }>()
  for (const p of drawn) {
    const key = `${p.glyph}\u0000${p.kind}`
    const seen = counts.get(key)
    if (seen) seen.count += 1
    else counts.set(key, { kind: p.kind, glyph: p.glyph, count: 1 })
  }
  return [...counts.values()].map((k) => fillCopy(G.kind, { count: k.count, kind: k.kind, glyph: G.glyphs[k.glyph] })).join(', ')
}

export function describeGlyphScatter(input: GlyphScatterInput): string {
  const placement = place(input)
  const { drawn, dropped } = placement
  const off = drawn.filter((p) => p.off).length
  const outside = linesOutside(input, placement)
  const tail = [
    off > 0 ? fillCopy(G.off, { n: off }) : '',
    dropped > 0 ? fillCopy(G.dropped, { n: dropped }) : '',
    outside.length > 0 ? fillCopy(G.linesOff, { names: outside.map((l) => l.label).join(', ') }) : '',
  ].join('')
  if (drawn.length === 0) return fillCopy(G.summaryEmpty, { name: input.name }) + tail
  const [xmin, xmax] = extent(drawn.map((p) => p.x))
  const [ymin, ymax] = extent(drawn.map((p) => p.y))
  const hollow = drawn.filter((p) => p.hollow).length
  return fillCopy(G.summary, {
    name: input.name,
    n: drawn.length,
    points: drawn.length === 1 ? G.point : G.points,
    x: input.x.label,
    xmin: valueText(xmin, input.x),
    xmax: valueText(xmax, input.x),
    y: input.y.label,
    ymin: valueText(ymin, input.y),
    ymax: valueText(ymax, input.y),
    kinds: kindsText(drawn) + (hollow > 0 ? fillCopy(G.hollow, { n: hollow }) : ''),
  }) + tail
}

export function glyphScatterTable(input: GlyphScatterInput): ChartTable {
  const extras = input.extraColumns ?? []
  const clash = extras.find((e) => BASE_KEYS.includes(e.key))
  if (clash) throw new Error(`The extra column key "${clash.key}" is already a table column`)
  const columns: ChartColumn[] = [
    { key: 'tag', label: G.colTag },
    { key: 'point', label: G.colPoint, rowHeader: true },
    { key: 'x', label: input.x.label, numeric: true },
    { key: 'y', label: input.y.label, numeric: true },
    { key: 'kind', label: G.colKind },
    ...extras.map((e) => ({ key: e.key, label: e.label, ...(e.numeric ? { numeric: true } : {}) })),
  ]
  // Every point is a row, in input order, so a value the chart cannot draw (a p of exactly 0, a negative
  // value on a log axis, a NaN) is still in the accessible table. Its Kind says it was not drawn.
  const rows = input.points.map((p) => ({
    tag: p.tag,
    point: p.label,
    x: cellText(p.x, input.x),
    y: cellText(p.y, input.y),
    kind: usable(p.x, input.x) && usable(p.y, input.y) ? p.kind : fillCopy(G.kindNotDrawn, { kind: p.kind }),
    ...Object.fromEntries(extras.map((e) => [e.key, p.extra?.[e.key] ?? ''])),
  }))
  return { caption: fillCopy(G.caption, { name: input.name }), columns, rows }
}

// HTML overlays over CandleChart's canvas (look spec 6.1): the legend at the top left of each pane,
// the second time-axis row (years, months or dates, split by 1px dividers), the event data tip, and
// the crosshair readout under the chart. Colours come from tokens through chart.css and
// CandleChart.css; inline styles here only place things.
import { CANDLE } from '../copy/candleChart'
import { fillCopy } from '../copy/workspace'
import { formatPrice, formatVolume, formatTime, type CandleBars, type CandleIndicator, type LegendStats, type ReadoutPart, type TimeStrip } from './CandleChart.model'
import { CHART_GEOMETRY as G } from './theme'

interface LegendRow {
  readonly swatch?: string
  readonly name: string
  readonly value: string
}

/**
 * A price pane shorter than this keeps only its Last price row: the High on, Average and Low on rows
 * would run over the volume pane and under the attribution logo (the HOME GP panel at 1366x768).
 */
export const LEGEND_STATS_MIN_PANE = 120

function Legend({ rows, top, clearLogo = false }: { readonly rows: readonly LegendRow[]; readonly top: number; readonly clearLogo?: boolean }) {
  return (
    <div className={clearLogo ? 'chart-legend candle-legend-clear-logo' : 'chart-legend'} style={{ top: top + G.legendInset }}>
      {rows.map((r) => (
        <div key={r.name} className="candle-legend-row">
          <span className="chart-legend-swatch" style={r.swatch ? { background: `var(${r.swatch})` } : undefined} />
          <span className="chart-legend-name candle-legend-name">{r.name}</span>
          <span className="chart-legend-value">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface LegendsProps {
  readonly name: string
  readonly bars: CandleBars
  readonly index: number
  readonly stats: LegendStats | null
  readonly precision: number
  readonly intraday: boolean
  readonly timeZone: string
  readonly indicator?: CandleIndicator
  readonly paneTops: readonly number[]
}

/** Price legend (Last price tracks the cursor; high, average and low of the loaded bars), then volume and indicator. */
export function Legends(p: LegendsProps) {
  const when = (i: number) => formatTime(p.bars.t[i] ?? 0, p.intraday, p.timeZone)
  const px = (v: number | null | undefined) => formatPrice(v, p.precision)
  const price: LegendRow[] = [{ swatch: '--candle-up', name: fillCopy(CANDLE.legendName, { name: p.name, field: CANDLE.lastPrice }), value: px(p.bars.c[p.index]) }]
  const priceHeight = (p.paneTops[1] ?? Infinity) - (p.paneTops[0] ?? 0)
  if (p.stats && priceHeight >= LEGEND_STATS_MIN_PANE) {
    price.push(
      { name: fillCopy(CANDLE.highOn, { date: when(p.stats.highIndex) }), value: px(p.stats.high) },
      { name: CANDLE.average, value: px(p.stats.average) },
      { name: fillCopy(CANDLE.lowOn, { date: when(p.stats.lowIndex) }), value: px(p.stats.low) },
    )
  }
  const ind = p.indicator
  const indValue = ind?.values[p.index]
  return (
    <>
      <Legend rows={price} top={0} />
      {p.paneTops[1] !== undefined ? (
        <Legend top={p.paneTops[1]} clearLogo rows={[{ swatch: '--chart-vol', name: fillCopy(CANDLE.legendName, { name: p.name, field: CANDLE.volume }), value: formatVolume(p.bars.v[p.index]) }]} />
      ) : null}
      {ind && p.paneTops[2] !== undefined ? (
        <Legend top={p.paneTops[2]} rows={[{
          swatch: '--chart-s1', name: ind.name,
          value: typeof indValue === 'number' ? `${indValue.toFixed(ind.digits ?? 1)}${ind.unit ?? ''}` : '',
        }]} />
      ) : null}
    </>
  )
}

/** The second axis row under the chart's own time axis, with the square yellow roll date tags. */
export function TimeStripView({ strip }: { readonly strip: TimeStrip }) {
  return (
    <div className="chart-years candle-strip" aria-hidden="true">
      {strip.segments.map((s) => (
        <span key={s.key} className="candle-strip-label" style={{ left: s.left, width: s.width }}>{s.label}</span>
      ))}
      {strip.dividers.map((x) => <span key={x} className="chart-years-div" style={{ left: x }} />)}
      {(strip.rolls ?? []).map((r) => (
        <span key={`roll-${r.key}`} className="candle-roll-tag" style={{ left: r.left, width: r.width }}>{r.label}</span>
      ))}
    </div>
  )
}

/**
 * The 5px 1-3-1 pane splitter (look spec 6.1) over each of the library's 1px pane separators, which
 * sit 1px above each lower pane's top: the splitter covers that row and 2px either side.
 */
export function PaneSplitters({ paneTops }: { readonly paneTops: readonly number[] }) {
  const half = (G.splitter.total - 1) / 2
  return (
    <>
      {paneTops.slice(1).map((top) => (
        <div key={top} className="chart-splitter candle-splitter" aria-hidden="true" style={{ top: top - 1 - half }} />
      ))}
    </>
  )
}

export interface TipState {
  readonly x: number
  readonly y: number
  readonly lines: readonly string[]
}

/** Event-marker data tip: about 15px right of the pointer. */
export function DataTip({ tip }: { readonly tip: TipState }) {
  return (
    <div className="chart-datatip" style={{ left: tip.x + G.datatipOffset, top: tip.y }}>
      {tip.lines.join('\n')}
    </div>
  )
}

export function Readout({ parts, shown, count }: { readonly parts: readonly ReadoutPart[]; readonly shown: number | null; readonly count: number }) {
  return (
    <span className="candle-readout">
      {parts.map((p, i) => (
        <span key={i} className="candle-readout-item">
          {p.label ? <span className="candle-readout-key">{p.label}</span> : null}
          {p.label ? ' ' : null}{p.value}
        </span>
      ))}
      {shown !== null ? <span className="candle-readout-item">{fillCopy(CANDLE.shown, { shown, count })}</span> : null}
    </span>
  )
}

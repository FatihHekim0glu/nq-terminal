// CandleChart (TASKS 5.2; UI_SPEC sections 7 and 8; look spec 6 and 7.6): OHLC candles with a
// volume pane and an optional indicator pane (RV22 on GP), fill and roll markers, the 2022 fence,
// the TradingView attribution kept on screen, and the link group's crosshair.
//
// Accessibility (UI_SPEC section 9): ChartA11y gives the chart role="img" named by a data summary,
// a table view (T) and the readout under the chart. With the chart focused, Left and Right step the
// crosshair one bar, Home and End jump to the data ends, + and - zoom; the readout then shows
// T O H L C V, the indicator, the bar's fills and rolls, and how many bars the zoom shows.
//
// The library loads lazily (loadLwc). Pass stable arrays (from the query cache or useMemo): a new
// `bars`, `fills`, `rolls` or `indicator` object rebuilds the chart.
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { CANDLE } from '../copy/candleChart'
import { fillCopy } from '../copy/workspace'
import type { PanelLink } from '../state/linkGroups'
import ChartA11y, { type ChartTable } from './ChartA11y'
import type { CandleEngine } from './CandleChart.engine'
import { useCandleCursor, useCandleEngine, useSettledShown } from './CandleChart.hooks'
import {
  barEvents, barStep, candleSummary, candleTable, isIntraday, legendStats, readoutParts, stepIndex,
  type BarEvents, type CandleBars, type CandleFill, type CandleIndicator, type CandleRoll,
} from './CandleChart.model'
import { DataTip, Legends, PaneSplitters, Readout, TimeStripView } from './CandleChart.overlays'
import { loadLwc, useChartLibrary, type ChartLibraryState } from './lazy'
import './CandleChart.css'

export interface CandleChartProps {
  /** The instrument as shown in the legend and summary, e.g. "NQ1 Index". */
  readonly name: string
  /** Column arrays as the API's /api/bars sends them (epoch seconds, bar open). */
  readonly bars: CandleBars
  readonly fills?: readonly CandleFill[]
  readonly rolls?: readonly CandleRoll[]
  /** A line in its own pane under volume, one value per bar (RV22 on GP). */
  readonly indicator?: CandleIndicator
  readonly link?: PanelLink
  /** Zone for intraday times (daily bars are always UTC dates). */
  readonly timeZone?: string
  readonly precision?: number
  /** Price grid (NQ ticks are 0.25). */
  readonly minMove?: number
  /** The dashed grid; off by default (look spec 6.1). */
  readonly grid?: boolean
  /** Called once the chart has drawn, with the time from mount in milliseconds. */
  readonly onRendered?: (ms: number) => void
}

/** + and - zoom by these factors. */
export const ZOOM_IN = 0.8
export const ZOOM_OUT = 1.25
const NO_FILLS: readonly CandleFill[] = []
const NO_ROLLS: readonly CandleRoll[] = []

function LibraryStatus({ state }: { readonly state: ChartLibraryState<unknown> }) {
  if (state.status === 'loading') return <p className="candle-status">{CANDLE.loading}</p>
  if (state.status === 'error') return <p className="candle-status candle-error" role="alert">{fillCopy(CANDLE.failed, { error: state.error.message })}</p>
  return null
}

const KEYS: Readonly<Record<string, (e: CandleEngine) => void>> = {
  ArrowLeft: (e) => e.step(-1),
  ArrowRight: (e) => e.step(1),
  Home: (e) => e.home(),
  End: (e) => e.end(),
  '+': (e) => e.zoom(ZOOM_IN),
  '=': (e) => e.zoom(ZOOM_IN),
  '-': (e) => e.zoom(ZOOM_OUT),
}

interface A11yInput {
  readonly name: string
  readonly bars: CandleBars
  readonly step: number
  readonly precision: number
  readonly timeZone: string
  readonly events: BarEvents
  readonly fills: number
  readonly rolls: number
  readonly indicator?: CandleIndicator
}

/** The accessible name (data summary) and the table view. */
function useCandleA11y(a: A11yInput): { readonly summary: string; readonly table: ChartTable } {
  const { name, bars, step, precision, timeZone, events, fills, rolls, indicator } = a
  const summary = useMemo(
    () => candleSummary({ name, bars, step, precision, timeZone, fills, rolls }),
    [name, bars, step, precision, timeZone, fills, rolls],
  )
  const table = useMemo(
    () => candleTable({ name, bars, precision, intraday: isIntraday(step), timeZone, events, ...(indicator ? { indicator } : {}) }),
    [name, bars, precision, step, timeZone, events, indicator],
  )
  return { summary, table }
}

export default function CandleChart(props: CandleChartProps) {
  const { name, bars, indicator, link = '-', timeZone = 'America/New_York', precision = 2, minMove = 0.01, grid = false } = props
  const fills = props.fills ?? NO_FILLS
  const rolls = props.rolls ?? NO_ROLLS
  const lib = useChartLibrary(loadLwc)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const chartId = `candle-${useId()}`
  const step = useMemo(() => barStep(bars.t), [bars.t])
  const intraday = isIntraday(step)
  const events = useMemo(() => barEvents(bars, fills, rolls, step), [bars, fills, rolls, step])
  const stats = useMemo(() => legendStats(bars), [bars])
  const ind = indicator ? { indicator } : {}
  const cursor = useCandleCursor(events, precision)
  const { engine, drawn, view } = useCandleEngine(lib, host, {
    bars, step, intraday, timeZone, fills, rolls, ...(indicator ? { indicator } : {}), precision, minMove, grid, link, chartId,
    onCursor: cursor.onCursor, ...(props.onRendered ? { onRendered: props.onRendered } : {}),
  })
  const shown = useSettledShown(view)
  const n = bars.t.length
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const act = KEYS[e.key]
    if (!act || !engine.current || e.altKey || e.ctrlKey || e.metaKey) return
    // D35: Left and Right must not be consumed once the crosshair is already at that edge, or GP and
    // GIP's range buttons, fields and toggles become unreachable by keyboard (the chart would keep the
    // panel's one Tab stop forever). stepIndex returns null exactly when the step would not move.
    // D36: only a fresh press gives the key back; an auto-repeat at the edge (still held from before
    // the edge was reached) is swallowed instead, or holding the key walks focus on through every
    // other roving control in the panel once dockview hands focus off the chart.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowLeft' ? -1 : 1
      if (stepIndex(engine.current.cursor(), delta, n, null) === null) {
        if (e.repeat) e.preventDefault()
        return
      }
    }
    e.preventDefault()
    const eng = engine.current
    cursor.onKey(e.repeat, () => act(eng))
  }
  const { summary, table } = useCandleA11y({ name, bars, step, precision, timeZone, events, fills: fills.length, rolls: rolls.length, ...ind })
  const parts = readoutParts(bars, cursor.readout ?? n - 1, { precision, intraday, timeZone, events, ...ind })
  return (
    <>
      <LibraryStatus state={lib} />
      <ChartA11y label={summary} table={table} onKeyDown={onKeyDown} readout={n > 0 ? <Readout parts={parts} shown={shown} count={n} /> : undefined}>
        <div className="candle-chart" aria-busy={!drawn} data-chart-lib="lightweight-charts">
          <div className="candle-plot">
            <div ref={setHost} className="candle-host" />
            {view ? <PaneSplitters paneTops={view.paneTops} /> : null}
            {n > 0 && view ? (
              <Legends name={name} bars={bars} index={cursor.legend ?? n - 1} stats={stats} precision={precision}
                intraday={intraday} timeZone={timeZone} paneTops={view.paneTops} {...ind} />
            ) : null}
            {cursor.tip ? <DataTip tip={cursor.tip} /> : null}
          </div>
          {view ? <TimeStripView strip={view.strip} /> : null}
        </div>
      </ChartA11y>
    </>
  )
}

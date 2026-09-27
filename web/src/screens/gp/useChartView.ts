// What the quote header and the candle chart of an instrument show, derived from the served bars and
// kept stable across renders (GP, GIP and the instrument DES). RV22 and the day return come from the
// universe endpoint when the daily chart ends at the fence; nothing here computes a statistic.
import { useMemo } from 'react'
import type { CandleIndicator, CandleRoll } from '../../charts/CandleChart.model'
import { dayReturnPercent, isoDate, priceDecimals, quoteFromBars, rollsFrom, rv22Percent, rvIndicator, type GpTimeframe } from './model'
import type { GpData } from './useGpData'

const NO_ROLLS: readonly CandleRoll[] = []

interface ChartView {
  readonly quote: ReturnType<typeof quoteFromBars>
  readonly rolls: readonly CandleRoll[]
  readonly precision: number
  /** The universe date when the header shows its RV22 and 1D return, else null. */
  readonly rvDate: string | null
  /** The RV22 pane under the volume (look spec 7.6), or null when there is no line to draw. */
  readonly indicator: CandleIndicator | null
}

const NO_BARS = { t: [], o: [], h: [], l: [], c: [], v: [] }

/** What the header and chart show, derived from the served bars and kept stable across renders. */
export function useChartView(data: GpData, root: string, ticker: string, tf: GpTimeframe, showRolls: boolean): ChartView {
  const bars = data.bars
  const lastDate = bars && bars.t.length > 0 ? isoDate((bars.t[bars.t.length - 1] ?? 0) * 1000) : null
  const rv22 = data.universeRows ? rv22Percent(data.universeRows, root, lastDate) : null
  const dayReturnPct = data.universeRows ? dayReturnPercent(data.universeRows, root, lastDate) : null
  const quote = useMemo(
    () => quoteFromBars({ root, ticker, bars: bars ?? NO_BARS, intraday: tf !== '1d', rv22, dayReturnPct }),
    [root, ticker, bars, tf, rv22, dayReturnPct],
  )
  const rolls = useMemo(() => (bars && showRolls ? rollsFrom(bars.rolls) : NO_ROLLS), [bars, showRolls])
  const precision = useMemo(() => (bars ? priceDecimals(bars) : 2), [bars])
  const rv = data.rv
  const indicator = useMemo(() => (bars && rv && tf === '1d' ? rvIndicator(bars, rv) : null), [bars, rv, tf])
  return { quote, rolls, precision, rvDate: rv22 !== null || dayReturnPct !== null ? lastDate : null, indicator }
}


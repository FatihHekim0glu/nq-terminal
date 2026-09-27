// Gallery entry /__gallery/ChartLibraries (Phase 5 stage A): each chart library loads as its own
// lazy chunk under the production CSP, themed from src/charts/theme, and a uPlot chart and a
// lightweight-charts chart in link group A share one crosshair through src/charts/sync.ts. The
// readout shows the group's crosshair time, so the E2E run can check the sync in a real browser.
import { useEffect, useMemo, useState } from 'react'
import ChartA11y, { type ChartTable } from '../charts/ChartA11y'
import { describeSeries } from '../charts/ChartA11ySummary'
import { crosshairBus } from '../charts/sync'
import { GALLERY_PROBE as P } from '../copy/gallery'
import { fillCopy } from '../copy/workspace'
import { equityFixture, mulberry32, ohlcvFixture, type OhlcvBar, type SeriesFixture } from './fixtures'
import { EchartsProbe, LwcProbe, UplotProbe } from './probes'

const isoDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
const TABLE_ROWS = 10

function equityTable(series: SeriesFixture): ChartTable {
  const rows = series.t.slice(-TABLE_ROWS).map((t, i) => {
    const v = series.v[series.v.length - TABLE_ROWS + i]
    return { date: isoDate(t), value: v == null ? '' : v.toFixed(4) }
  })
  return { caption: P.equityName, columns: [{ key: 'date', label: P.colDate }, { key: 'value', label: P.colValue, numeric: true }], rows }
}

function barsTable(bars: readonly OhlcvBar[]): ChartTable {
  const rows = bars.slice(-TABLE_ROWS).map((b) => ({
    date: isoDate(b.time), open: b.open.toFixed(2), high: b.high.toFixed(2), low: b.low.toFixed(2), close: b.close.toFixed(2), volume: b.volume,
  }))
  const num = (key: string, label: string) => ({ key, label, numeric: true })
  return {
    caption: P.candlesName,
    columns: [{ key: 'date', label: P.colDate }, num('open', P.colOpen), num('high', P.colHigh), num('low', P.colLow), num('close', P.colClose), num('volume', P.colVolume)],
    rows,
  }
}

function monthlyFixture(): { months: string[]; values: number[] } {
  const rand = mulberry32(11)
  const months = Array.from({ length: 24 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
  return { months, values: months.map(() => Math.round((rand() - 0.45) * 1600) / 100) }
}

/** The group A crosshair time, from the bus (not React state per move in the charts themselves). */
function SyncReadout() {
  const [time, setTime] = useState<number | null>(null)
  useEffect(() => crosshairBus.subscribe('A', 'gallery-readout', (move) => setTime(move.time)), [])
  return <p data-testid="sync-readout">{fillCopy(P.readout, { time: time === null ? P.none : isoDate(time) })}</p>
}

export default function ChartLibrariesGallery() {
  const equity = useMemo(() => equityFixture({ count: 260, seed: 5, start: '2021-06-01' }), [])
  const bars = useMemo(() => ohlcvFixture({ count: 260, seed: 5, start: '2021-06-01' }), [])
  const monthly = useMemo(monthlyFixture, [])
  const equityLabel = describeSeries({ name: P.equityName, t: equity.t.map(isoDate), v: equity.v })
  const last = bars[bars.length - 1]
  const barsLabel = fillCopy(P.candlesSummary, {
    count: bars.length, start: isoDate(bars[0]?.time ?? 0), end: isoDate(last?.time ?? 0), last: last?.close.toFixed(2) ?? '',
  })
  const monthLabel = fillCopy(P.barsSummary, {
    count: monthly.values.length, min: Math.min(...monthly.values).toFixed(2), max: Math.max(...monthly.values).toFixed(2),
  })
  const monthTable: ChartTable = {
    caption: P.barsName,
    columns: [{ key: 'month', label: P.colMonth }, { key: 'ret', label: P.colReturn, numeric: true }],
    rows: monthly.months.map((m, i) => ({ month: m, ret: (monthly.values[i] ?? 0).toFixed(2) })),
  }
  return (
    <div className="gallery-grid">
      <section aria-labelledby="g-uplot">
        <h2 id="g-uplot">{P.uplotTitle}</h2>
        <ChartA11y label={equityLabel} table={equityTable(equity)}><UplotProbe series={equity} /></ChartA11y>
      </section>
      <section aria-labelledby="g-lwc">
        <h2 id="g-lwc">{P.lwcTitle}</h2>
        <ChartA11y label={barsLabel} table={barsTable(bars)}><LwcProbe bars={bars} /></ChartA11y>
      </section>
      <section aria-labelledby="g-echarts">
        <h2 id="g-echarts">{P.echartsTitle}</h2>
        <ChartA11y label={monthLabel} table={monthTable}><EchartsProbe months={monthly.months} values={monthly.values} /></ChartA11y>
      </section>
      <section aria-labelledby="g-sync">
        <h2 id="g-sync">{P.syncTitle}</h2>
        <p>{P.note}</p>
        <SyncReadout />
      </section>
    </div>
  )
}

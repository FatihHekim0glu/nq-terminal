// Gallery entry /__gallery/CandleChart.perf: 4,000 one-minute bars (the API's default max_points,
// about ten RTH sessions from late February 2021, fixture data). The time from mount to the chart's second
// painted frame is written out for the Playwright performance check (e2e/gallery-candles.spec.ts).
import { useCallback, useMemo, useState } from 'react'
import { CANDLE_GALLERY as G } from '../copy/candleChart'
import { fillCopy } from '../copy/workspace'
import CandleChart from './CandleChart'
import { rthBars } from './CandleChart.galleryData'
import './CandleChart.gallery.css'

export const PERF_BARS = 4000
const DAYS = ['2021-02-25', '2021-02-26', '2021-03-01', '2021-03-02', '2021-03-03', '2021-03-04', '2021-03-05', '2021-03-08', '2021-03-09', '2021-03-10', '2021-03-11']

function perfBars() {
  const all = rthBars(DAYS, 60, 3)
  const cut = <T,>(a: readonly T[]) => a.slice(0, PERF_BARS)
  return { t: cut(all.t), o: cut(all.o), h: cut(all.h), l: cut(all.l), c: cut(all.c), v: cut(all.v) }
}

export default function CandleChartPerfGallery() {
  const bars = useMemo(perfBars, [])
  const [ms, setMs] = useState<number | null>(null)
  const onRendered = useCallback((value: number) => setMs(value), [])
  return (
    <div className="candle-gallery">
      <h2>{G.perfTitle}</h2>
      <output data-testid="render-ms" data-ms={ms ?? ''}>
        {ms === null ? G.perfPending : fillCopy(G.perfResult, { count: bars.t.length, ms: ms.toFixed(1) })}
      </output>
      <CandleChart name={G.perfName} bars={bars} link="B" minMove={0.25} onRendered={onRendered} />
    </div>
  )
}

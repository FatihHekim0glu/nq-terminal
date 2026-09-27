// Gallery entry /__gallery/CandleChart.intraday: five RTH sessions (2021-03-08 to 03-12, fixture
// data) as 5-minute and 1-hour candles side by side, both in link group A, times in New York. The
// GIP layout, and the check that a keyboard crosshair on one chart moves the other.
import { useMemo } from 'react'
import { CANDLE_GALLERY as G } from '../copy/candleChart'
import CandleChart from './CandleChart'
import { RTH_DAYS, rthBars, toHourly } from './CandleChart.galleryData'
import './CandleChart.gallery.css'

export default function CandleChartIntradayGallery() {
  const five = useMemo(() => rthBars(RTH_DAYS, 300, 7), [])
  const hour = useMemo(() => toHourly(five), [five])
  return (
    <div className="candle-gallery">
      <h2>{G.intradayTitle}</h2>
      <div className="candle-gallery-row">
        <section className="candle-gallery-cell" aria-label={G.fiveMinuteName} data-testid="five">
          <CandleChart name={G.fiveMinuteName} bars={five} link="A" minMove={0.25} />
        </section>
        <section className="candle-gallery-cell" aria-label={G.hourName} data-testid="hour">
          <CandleChart name={G.hourName} bars={hour} link="A" minMove={0.25} />
        </section>
      </div>
    </div>
  )
}

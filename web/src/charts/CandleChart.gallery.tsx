// Gallery entry /__gallery/CandleChart: NQ1 Index daily candles for 2021 (fixture data) with volume
// and RV22 panes, quarterly roll markers, fills from a linked run, and the 2022 fence just after the
// last bar, in link group A. The GP screen's chart at full panel size.
import { useMemo } from 'react'
import { CANDLE_GALLERY as G } from '../copy/candleChart'
import CandleChart from './CandleChart'
import { DAILY_ROLLS, dailyFills, dailyNq, rv22 } from './CandleChart.galleryData'
import './CandleChart.gallery.css'

export default function CandleChartGallery() {
  const bars = useMemo(dailyNq, [])
  const fills = useMemo(() => dailyFills(bars), [bars])
  const indicator = useMemo(() => rv22(bars, G.rv22), [bars])
  return (
    <div className="candle-gallery">
      <h2>{G.dailyTitle}</h2>
      <CandleChart name={G.dailyName} bars={bars} fills={fills} rolls={DAILY_ROLLS} indicator={indicator} link="A" minMove={0.25} />
    </div>
  )
}

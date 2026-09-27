// One small chart per library for the ChartLibraries gallery entry (gallery builds only). Each takes
// its library from the lazy loaders and its options from the charts theme, the way the Phase 5
// components do; the uPlot and lightweight-charts probes join link group A through the sync bus.
// These are probes of the plumbing, not the Phase 5 components.
import type { UTCTimestamp } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import type uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { GALLERY_PROBE as P } from '../copy/gallery'
import { fillCopy } from '../copy/workspace'
import { loadEcharts, loadLwc, loadUplot, useChartLibrary, type ChartLibraryState } from '../charts/lazy'
import { quietAttributionLogo } from '../charts/lwcAttribution'
import { lwcCrosshairSync, uplotCrosshairSync } from '../charts/sync'
import { echartsPresets, lineStackSeries, makeEchartsTheme, makeLwcTheme, makeUplotTheme, readChartTokens } from '../charts/theme'
import type { OhlcvBar, SeriesFixture } from './fixtures'

function LibraryStatus<T>({ state }: { readonly state: ChartLibraryState<T> }) {
  if (state.status === 'loading') return <p className="gallery-loading">{P.loading}</p>
  if (state.status === 'error') return <p className="gallery-error" role="alert">{fillCopy(P.failed, { error: state.error.message })}</p>
  return null
}

/** A copy of a readonly theme value that the library may write into (uPlot mutates its options). */
function writable<T>(value: T): T {
  return structuredClone(value)
}

export function UplotProbe({ series }: { readonly series: SeriesFixture }) {
  const lib = useChartLibrary(loadUplot)
  const host = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = host.current
    if (lib.status !== 'ready' || el === null) return
    const theme = makeUplotTheme(readChartTokens())
    const styles = lineStackSeries(readChartTokens())
    const sync = uplotCrosshairSync('A', 'gallery-uplot')
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: el.clientHeight,
      padding: writable([...theme.padding]),
      axes: writable(theme.axes) as uPlot.Axis[],
      legend: { show: false },
      cursor: { points: { show: false }, ...(sync.cursorSync ? { sync: sync.cursorSync } : {}) },
      scales: { x: { time: true } },
      series: [{}, { label: P.equityName, ...styles.primary }],
      plugins: [sync.plugin],
    }
    const plot = new lib.lib(opts, [series.t, series.v], el)
    setDrawn(true)
    return () => plot.destroy()
  }, [lib, series])
  return (
    <>
      <LibraryStatus state={lib} />
      <div ref={host} className="gallery-chart" aria-busy={!drawn} data-chart-lib="uplot" />
    </>
  )
}

export function LwcProbe({ bars }: { readonly bars: readonly OhlcvBar[] }) {
  const lib = useChartLibrary(loadLwc)
  const host = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = host.current
    if (lib.status !== 'ready' || el === null) return
    const { createChart, CandlestickSeries } = lib.lib
    const theme = makeLwcTheme(readChartTokens())
    const chart = createChart(el, { ...theme.chart, autoSize: true })
    const stopLogo = quietAttributionLogo(el)
    const candles = chart.addSeries(CandlestickSeries, theme.candle)
    candles.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })))
    chart.timeScale().fitContent()
    const closes = new Map(bars.map((b) => [b.time, b.close]))
    const sync = lwcCrosshairSync({ chart, series: candles, link: 'A', sourceId: 'gallery-lwc', priceAt: (t) => closes.get(t) ?? null })
    setDrawn(true)
    return () => {
      stopLogo()
      sync.dispose()
      chart.remove()
    }
  }, [lib, bars])
  return (
    <>
      <LibraryStatus state={lib} />
      <div ref={host} className="gallery-chart" aria-busy={!drawn} data-chart-lib="lightweight-charts" />
    </>
  )
}

export function EchartsProbe({ months, values }: { readonly months: readonly string[]; readonly values: readonly number[] }) {
  const lib = useChartLibrary(loadEcharts)
  const host = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = host.current
    if (lib.status !== 'ready' || el === null) return
    const tokens = readChartTokens()
    const theme = makeEchartsTheme(tokens)
    const colours = echartsPresets(tokens).barLadder
    const chart = lib.lib.init(el, null, { renderer: 'canvas' })
    chart.setOption({
      backgroundColor: theme.backgroundColor,
      animation: theme.animation,
      textStyle: theme.textStyle,
      grid: { left: 8, right: 57, top: 8, bottom: 24 },
      xAxis: { ...writable(theme.xAxis), type: 'category', data: [...months] },
      yAxis: { ...writable(theme.yAxis), type: 'value' },
      series: [{
        type: 'bar',
        data: values.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? colours.pos : colours.neg } })),
      }],
    })
    setDrawn(true)
    return () => chart.dispose()
  }, [lib, months, values])
  return (
    <>
      <LibraryStatus state={lib} />
      <div ref={host} className="gallery-chart" aria-busy={!drawn} data-chart-lib="echarts" />
    </>
  )
}

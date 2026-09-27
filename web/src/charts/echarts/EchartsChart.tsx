// The shared host for the ECharts set: loads ECharts lazily (its own chunk, src/charts/lazy.ts),
// draws the option on a canvas that fills its box, redraws when the option changes, follows resizes
// and disposes of the chart on unmount. It stays aria-busy until the first draw, so the gallery helper
// and screen readers wait for it. Each draw is timed as a performance measure named
// `nqt-echarts-draw:<chartId>` (the 5.3 performance check reads it).
//
// EchartsFigure wraps the host in ChartA11y: role="img" named by the data summary, plus the table
// view, which is the chart's keyboard and screen reader path (UI_SPEC section 9).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ECHARTS } from '../../copy/echarts'
import { fillCopy } from '../../copy/workspace'
import ChartA11y, { type ChartTable } from '../ChartA11y'
import { loadEcharts, useChartLibrary } from '../lazy'
import { readChartTokens, type ChartTokens } from '../theme'
import type { EChartsOption, EChartsType } from './core'
import './echarts.css'

export const DRAW_MEASURE_PREFIX = 'nqt-echarts-draw:'

/** The chart tokens as the page resolves them, read once per mount (CVD themes included). */
export function useChartTokens(): ChartTokens {
  return useMemo(() => readChartTokens(), [])
}

function recordDraw(chartId: string, start: number, end: number): void {
  const name = `${DRAW_MEASURE_PREFIX}${chartId}`
  try {
    performance.clearMeasures(name)
    performance.measure(name, { start, end })
  } catch {
    // A browser without User Timing Level 3 simply keeps no measure; the chart is drawn either way.
  }
}

export interface EchartsChartProps {
  readonly option: EChartsOption
  /** Names the draw measure; unique on the page. */
  readonly chartId: string
}

export function EchartsChart({ option, chartId }: EchartsChartProps) {
  const lib = useChartLibrary(loadEcharts)
  const host = useRef<HTMLDivElement>(null)
  const [chart, setChart] = useState<EChartsType | null>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const el = host.current
    if (lib.status !== 'ready' || el === null) return
    const instance = lib.lib.init(el, null, { renderer: 'canvas' })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => instance.resize())
    observer?.observe(el)
    setChart(instance)
    return () => {
      observer?.disconnect()
      instance.dispose()
      setChart(null)
    }
  }, [lib])

  useEffect(() => {
    if (chart === null) return
    const start = performance.now()
    chart.setOption(option, { notMerge: true })
    recordDraw(chartId, start, performance.now())
    setDrawn(true)
  }, [chart, option, chartId])

  return (
    <div className="echarts-host">
      {lib.status === 'error' ? (
        <p className="echarts-status echarts-error" role="alert">{fillCopy(ECHARTS.failed, { error: lib.error.message })}</p>
      ) : lib.status === 'loading' ? (
        <p className="echarts-status">{ECHARTS.loading}</p>
      ) : null}
      <div ref={host} className="echarts-canvas" data-chart-lib="echarts" data-chart-id={chartId} aria-busy={!drawn} />
    </div>
  )
}

export interface EchartsFigureProps extends EchartsChartProps {
  /** The data summary; the chart's accessible name. */
  readonly label: string
  readonly table: ChartTable
  /** Drawn under the chart inside the figure (a heat-scale legend). */
  readonly footer?: ReactNode
}

export function EchartsFigure({ label, table, option, chartId, footer }: EchartsFigureProps) {
  return (
    <ChartA11y label={label} table={table}>
      <div className="echarts-frame">
        <EchartsChart option={option} chartId={chartId} />
        {footer}
      </div>
    </ChartA11y>
  )
}

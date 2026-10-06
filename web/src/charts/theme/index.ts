// Charts theme (look spec 6 and build plan task 4). Plain option objects for uPlot,
// lightweight-charts and ECharts with no library import; Phase 5 components consume them.
import './chart.css'
import { echartsWithGrid, type EchartsTheme } from './echartsTheme'
import { lwcWithGrid, type LwcTheme } from './lwcTheme'
import { uplotWithGrid, type UplotTheme } from './uplotTheme'

export * from './chartContrast'
export * from './chartTokens'
export * from './echartsTheme'
export * from './geometry'
export * from './lwcTheme'
export * from './scales'
export * from './uplotTheme'

/** The grid is off by default on every chart (6.1); this is the per-chart switch. */
export function withGrid(theme: UplotTheme, on?: boolean): UplotTheme
export function withGrid(theme: LwcTheme, on?: boolean): LwcTheme
export function withGrid(theme: EchartsTheme, on?: boolean): EchartsTheme
export function withGrid(theme: UplotTheme | LwcTheme | EchartsTheme, on = true): UplotTheme | LwcTheme | EchartsTheme {
  if ('axes' in theme) return uplotWithGrid(theme, on)
  if ('chart' in theme) return lwcWithGrid(theme, on)
  return echartsWithGrid(theme, on)
}

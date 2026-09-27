// The ECharts build for the 5.3 set (Heatmap, Distribution, BarLadder, PScatter, Swimlane), from
// tree-shaken entry points only: `echarts/core` plus the charts, components and renderer registered
// below. Never import the bare 'echarts' package (it pulls in every chart type); a test enforces it.
// This module is loaded through loadEcharts() in ../lazy.ts, so ECharts is its own lazy chunk.
// Components read their options from ../theme (echartsTheme) and write no colour of their own.
//
// Registered: Bar (BarLadder), Line (normal overlay, boundary lines), Scatter (PScatter), Custom
// (Heatmap cells on whole pixels, Distribution bins, CI whiskers, Swimlane); grid, both visualMap kinds
// (piecewise CORR scale, continuous MRET ramp), markLine (VaR, fence), markArea (sealed spans),
// dataset and tooltip; the canvas renderer. Task 5.3 owns this file and adds what it needs.
// The per-series option types are re-exported (types only, erased) so the option builders in this
// folder can type their series without importing ECharts at run time.
import { BarChart, CustomChart, LineChart, ScatterChart } from 'echarts/charts'
import type {
  BarSeriesOption,
  CustomSeriesOption,
  LineSeriesOption,
  ScatterSeriesOption,
} from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
  VisualMapPiecewiseComponent,
} from 'echarts/components'
import type {
  DatasetComponentOption,
  GridComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from 'echarts/components'
import { graphic, init, use } from 'echarts/core'
import type { ComposeOption, EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  CustomChart,
  LineChart,
  ScatterChart,
  DatasetComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
  VisualMapPiecewiseComponent,
  CanvasRenderer,
])

/** The option type for every chart in the set: only the registered series and components. */
export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | CustomSeriesOption
  | LineSeriesOption
  | ScatterSeriesOption
  | DatasetComponentOption
  | GridComponentOption
  | MarkAreaComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>

export type { EChartsType }
export type {
  BarSeriesOption,
  CustomSeriesOption,
  LineSeriesOption,
  ScatterSeriesOption,
}
export { graphic, init }

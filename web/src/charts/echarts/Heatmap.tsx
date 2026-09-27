// Heatmap (TASKS 5.3; look spec 6.3, 7.5, 7.7, 7.8): monthly returns (MRET), correlation (CORR) and
// 27F returns (MON), each on its own heat scale, with the scale legend under the grid.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { HeatScaleBar } from './HeatScale'
import { describeHeatmap, heatmapOption, heatmapTable, heatScale, type HeatmapInput } from './heatmapModel'

export interface HeatmapProps {
  readonly data: HeatmapInput
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

export function Heatmap({ data, chartId = 'heatmap' }: HeatmapProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => heatmapOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeHeatmap(data), [data])
  const table = useMemo(() => heatmapTable(data), [data])
  const scale = useMemo(() => heatScale(data, tokens), [data, tokens])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} footer={<HeatScaleBar scale={scale} />} />
}

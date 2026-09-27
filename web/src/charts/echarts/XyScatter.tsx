// XyScatter (TASKS Phase 10 on screen): one value against another with the API's fitted line (BR4, RD3, TA2).
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describeXyScatter, xyScatterOption, xyScatterTable, type XyScatterInput } from './xyScatterModel'

export interface XyScatterProps {
  readonly data: XyScatterInput
  /** Names the draw measure; unique on the page. */
  readonly chartId: string
}

export function XyScatter({ data, chartId }: XyScatterProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => xyScatterOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeXyScatter(data), [data])
  const table = useMemo(() => xyScatterTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

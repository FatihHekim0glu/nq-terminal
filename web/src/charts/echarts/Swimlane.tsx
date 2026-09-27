// Swimlane (TASKS 5.3; look spec 6.3 and 7.10, UI_SPEC 7 OOS): the gate access log by caller, each read window
// against the fence, sealed reads highlighted.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describeSwimlane, swimlaneOption, swimlaneTable, type SwimlaneInput } from './swimlaneModel'

export interface SwimlaneProps {
  readonly data: SwimlaneInput
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

export function Swimlane({ data, chartId = 'swimlane' }: SwimlaneProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => swimlaneOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeSwimlane(data), [data])
  const table = useMemo(() => swimlaneTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

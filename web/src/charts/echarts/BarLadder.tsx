// BarLadder (TASKS 5.3; look spec 6.3): signed bars with confidence whiskers, for blocks, the cost ladder and
// P&L by hour or weekday.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describeBarLadder, barLadderOption, barLadderTable, type BarLadderInput } from './barLadderModel'

export interface BarLadderProps {
  readonly data: BarLadderInput
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

export function BarLadder({ data, chartId = 'bar-ladder' }: BarLadderProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => barLadderOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeBarLadder(data), [data])
  const table = useMemo(() => barLadderTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

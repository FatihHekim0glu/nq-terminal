// The EVT chart: the mean path with its band, drawn by the shared ECharts host. Accessible through
// EchartsFigure: role="img" named by the data summary, and a table view (the keyboard and screen reader path).
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from '../../charts/echarts/EchartsChart'
import { describeEventPath, eventPathKey, eventPathOption, eventPathTable, type EventPathInput } from './chartModel'

export interface EventPathChartProps {
  readonly data: EventPathInput
  /** Names the draw measure; unique on the page. */
  readonly chartId: string
}

export function EventPathChart({ data, chartId }: EventPathChartProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => eventPathOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeEventPath(data), [data])
  const table = useMemo(() => eventPathTable(data), [data])
  const key = useMemo(() => eventPathKey(data, tokens), [data, tokens])
  const footer = (
    <div className="echarts-scale">
      {key.map((k) => (
        <span key={k.label} className="echarts-scale-named">
          <span className="echarts-scale-step" style={{ background: k.fill }} />
          {k.label}
        </span>
      ))}
    </div>
  )
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} footer={footer} />
}

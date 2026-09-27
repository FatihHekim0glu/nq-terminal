// Distribution (TASKS 5.3; look spec 7.5 RET): the return histogram with the fitted normal, the mean and
// one-sigma lines and the VaR and CVaR lines, beside the daily-return series when one is given.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describeDistribution, distributionOption, distributionTable, type DistributionInput } from './distributionModel'

export interface DistributionProps {
  readonly data: DistributionInput
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

export function Distribution({ data, chartId = 'distribution' }: DistributionProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => distributionOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeDistribution(data), [data])
  const table = useMemo(() => distributionTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

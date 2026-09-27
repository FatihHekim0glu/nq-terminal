// PScatter (TASKS 5.3; look spec 6.3, UI_SPEC 7 MT): sorted p-values against rank with the Bonferroni, Holm and
// BH boundaries.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describePScatter, pScatterOption, pScatterTable, type PScatterInput } from './pScatterModel'

export interface PScatterProps {
  readonly data: PScatterInput
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

export function PScatter({ data, chartId = 'p-scatter' }: PScatterProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => pScatterOption(data, tokens), [data, tokens])
  const label = useMemo(() => describePScatter(data), [data])
  const table = useMemo(() => pScatterTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

// Cone (ANALYTICS_CATALOG SV6 on screen): pointwise percentiles of the resampled paths at each step (not a band
// that whole paths stay inside), with the realised last year, and optional overlays (a path placed on the cone,
// LV6). The key names every line that is drawn.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { coneHasRealised, coneKey, coneOption, coneTable, describeCone, type ConeInput } from './coneModel'
import { EchartsFigure, useChartTokens } from './EchartsChart'

export interface ConeProps {
  readonly data: ConeInput
  /** Names the draw measure; unique on the page. */
  readonly chartId: string
}

export function Cone({ data, chartId }: ConeProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => coneOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeCone(data), [data])
  const table = useMemo(() => coneTable(data), [data])
  const key = useMemo(() => coneKey(tokens, data.overlays, coneHasRealised(data)), [data, tokens])
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

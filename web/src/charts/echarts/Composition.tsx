// Composition (roadmap #13, EX1 by instrument): the book's exposure by instrument as a heat grid or as
// areas stacked by sector, over the same session columns. Under the chart a key names each sector in
// its colour (and Gross and Net in the stack view), and the heat view adds what brightness means.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import {
  compositionHeatOption,
  compositionKey,
  compositionScaleNote,
  compositionStackOption,
  compositionTable,
  describeComposition,
  type CompositionInput,
  type CompositionMode,
} from './compositionModel'
import { EchartsFigure, useChartTokens } from './EchartsChart'

export interface CompositionProps {
  readonly data: CompositionInput
  readonly mode: CompositionMode
  /** Names the draw measure; unique on the page. */
  readonly chartId?: string
}

// The key can hold up to ten entries (seven sectors, the "not in the index" band, Gross and Net), so it
// wraps; the 22px minimum keeps a single-line row as tall as the house scale row.
const FOOTER_ROW = { flexWrap: 'wrap', height: 'auto', minHeight: 22 } as const

export function Composition({ data, mode, chartId = 'composition' }: CompositionProps) {
  const tokens = useChartTokens()
  const option = useMemo(
    () => (mode === 'heat' ? compositionHeatOption(data, tokens) : compositionStackOption(data, tokens)),
    [data, mode, tokens],
  )
  const label = useMemo(() => describeComposition(data, mode), [data, mode])
  const table = useMemo(() => compositionTable(data), [data])
  const key = useMemo(() => compositionKey(data, mode, tokens), [data, mode, tokens])
  const scale = useMemo(() => (mode === 'heat' ? compositionScaleNote(data) : null), [data, mode])
  const footer = (
    <>
      <div className="echarts-scale" style={FOOTER_ROW}>
        {key.map((k) => (
          <span key={k.label} className="echarts-scale-named">
            <span className="echarts-scale-step" style={{ background: k.fill }} />
            {k.label}
          </span>
        ))}
      </div>
      {scale === null ? null : (
        <div className="echarts-scale" style={FOOTER_ROW}>
          <span>{scale}</span>
        </div>
      )}
    </>
  )
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} footer={footer} />
}

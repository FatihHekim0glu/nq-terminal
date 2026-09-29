// GlyphScatter (roadmap R8 and R5): one value against another, each point a triangle up, a triangle down
// or a ring, in shape and colour together, with labelled reference lines and an optional y = x diagonal.
// Accessible through EchartsFigure: role="img" named by the data summary, and a table view.
import { useMemo } from 'react'
import { EchartsFigure, useChartTokens } from './EchartsChart'
import { describeGlyphScatter, glyphScatterOption, glyphScatterTable, type GlyphScatterInput } from './glyphScatterModel'

export interface GlyphScatterProps {
  readonly data: GlyphScatterInput
  /** Names the draw measure; unique on the page. */
  readonly chartId: string
}

export function GlyphScatter({ data, chartId }: GlyphScatterProps) {
  const tokens = useChartTokens()
  const option = useMemo(() => glyphScatterOption(data, tokens), [data, tokens])
  const label = useMemo(() => describeGlyphScatter(data), [data])
  const table = useMemo(() => glyphScatterTable(data), [data])
  return <EchartsFigure label={label} table={table} option={option} chartId={chartId} />
}

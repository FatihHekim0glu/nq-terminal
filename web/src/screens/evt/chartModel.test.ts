// EVT chart model: the band's honesty wording reaches the chart key and the accessible table caption
// (U04: align MV8's band label with SEAS's "a spread, not a confidence interval" convention). The rest
// of chartModel (the option series, the table rows, the summary text) is covered by model.test.ts.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS, SYSTEM_COLOUR_FALLBACK, forcedChartTokens } from '../../charts/theme'
import { eventPathKey, eventPathOption, eventPathTable } from './chartModel'
import { makeStudy } from './fixtures'
import { chartInput } from './model'

const FORCED = forcedChartTokens(SYSTEM_COLOUR_FALLBACK, DEFAULT_CHART_TOKENS)

type SeriesLike = { id?: string; lineStyle?: { width?: number; color?: string; type?: unknown }; areaStyle?: { color?: string } }
const seriesOf = (option: ReturnType<typeof eventPathOption>, id: string): SeriesLike =>
  (option.series as SeriesLike[]).find((s) => s.id === id)!

describe('EVT chart model under forced colours', () => {
  it('draws the band edges in a visible system colour, not the Canvas colour', () => {
    const input = chartInput(makeStudy(), null)
    const option = eventPathOption(input, FORCED)
    for (const id of ['band-base', 'band']) {
      const style = seriesOf(option, id).lineStyle
      expect(style?.width).toBeGreaterThan(0)
      expect(style?.color).toBe(FORCED.color.chartGrid)
      expect(style?.color).not.toBe(FORCED.color.bg)
    }
  })

  it('shows the band key swatch in a visible colour', () => {
    const band = eventPathKey(chartInput(makeStudy(), null), FORCED).find((k) => k.label.startsWith('Band'))
    expect(band?.fill).not.toBe(FORCED.color.bg)
  })

  it('dashes the selected path against the solid mean', () => {
    const option = eventPathOption(chartInput(makeStudy(), makeStudy().events[0]!), FORCED)
    expect(seriesOf(option, 'selected').lineStyle?.type).toEqual([10, 4])
    expect(seriesOf(option, 'mean').lineStyle?.type).toBeUndefined()
  })

  it('leaves the default band edgeless and the selected path solid', () => {
    const option = eventPathOption(chartInput(makeStudy(), makeStudy().events[0]!), DEFAULT_CHART_TOKENS)
    expect(seriesOf(option, 'band').lineStyle?.width).toBe(0)
    expect(seriesOf(option, 'selected').lineStyle?.type).toBeUndefined()
  })
})

describe('EVT chart model: band honesty wording (U04)', () => {
  it('labels the band a spread, not a confidence interval, in the chart key', () => {
    const input = chartInput(makeStudy(), null)
    const key = eventPathKey(input, DEFAULT_CHART_TOKENS)
    const band = key.find((k) => k.label.startsWith('Band'))
    expect(band?.label).toContain('not a confidence interval')
  })

  it('says the same in the accessible table caption', () => {
    const input = chartInput(makeStudy(), null)
    const table = eventPathTable(input)
    expect(table.caption).toContain('not a confidence interval')
  })
})

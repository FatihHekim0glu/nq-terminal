// EVT chart model: the band's honesty wording reaches the chart key and the accessible table caption
// (U04: align MV8's band label with SEAS's "a spread, not a confidence interval" convention). The rest
// of chartModel (the option series, the table rows, the summary text) is covered by model.test.ts.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from '../../charts/theme'
import { eventPathKey, eventPathTable } from './chartModel'
import { makeStudy } from './fixtures'
import { chartInput } from './model'

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

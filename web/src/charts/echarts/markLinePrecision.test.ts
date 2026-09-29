import { describe, expect, it } from 'vitest'
import { MULTIPLE_TESTING, REGISTRY } from '../../screens/reg/regFixtures'
import { buildReplication, replicationScatter } from '../../screens/reg/replicationModel'
import { seriesOf, uniqueTokens } from './echartsTestUtil'
import { glyphScatterOption } from './glyphScatterModel'
import { markLine, refLine } from './shared'

// ECharts rounds every markLine xAxis/yAxis value to `precision` decimals (default 2, MarkLineView
// applies value.toFixed(precision)). A reference line at alpha/k = 0.05 / 21 would round to 0 and vanish
// on a log axis, so the shared markLine settings raise the precision to the ECharts maximum.
const T = uniqueTokens()

describe('markLine: reference values are not rounded by ECharts', () => {
  it('sets a precision of at least 10 decimals', () => {
    const opt = markLine([refLine({ xAxis: 0.05 / 21 }, '#000000')], T)
    expect(typeof opt.precision).toBe('number')
    expect(opt.precision).toBeGreaterThanOrEqual(10)
  })

  it('round-trips every reference value the charts draw, as ECharts rounds them', () => {
    const opt = markLine([refLine({ xAxis: 0.05 / 21 }, '#000000')], T)
    // ECharts clamps the setting at 20 before it calls toFixed.
    const digits = Math.min(opt.precision, 20)
    for (const v of [0.05 / 21, 0.05 / 7, -0.0147, 1640995200000]) {
      expect(+v.toFixed(digits), String(v)).toBe(v)
    }
  })
})

describe('the replication scatter (MT 86): its alpha / k line keeps its exact place', () => {
  const option = glyphScatterOption(replicationScatter(buildReplication(MULTIPLE_TESTING, REGISTRY)), T)
  const refs = seriesOf(option).find((s) => s.id === 'refs') as { markLine: { precision: number; data: { xAxis?: number; yAxis?: number }[] } } | undefined

  it('draws the reference lines through a high precision markLine', () => {
    expect(refs).toBeDefined()
    expect(refs?.markLine.precision).toBeGreaterThanOrEqual(10)
  })

  it('holds a line at alpha / k on the x axis', () => {
    expect(refs?.markLine.data.some((d) => d.xAxis === MULTIPLE_TESTING.alpha / MULTIPLE_TESTING.k)).toBe(true)
  })
})

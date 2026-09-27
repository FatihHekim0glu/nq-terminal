// The full look spec 7.5 templates that Phase 8's API fields allow: the EQ performance-difference pane
// (equity.perf_diff), the RET per-period series beside the histogram (distribution.series), the RR
// volatility Hi and Low callouts (rolling.vol_extremes), and each tab's 98) Export. Every value drawn or
// saved is the API's; fractions are shown times 100.
import { describe, expect, it } from 'vitest'
import { TEAR_EQ, TEAR_RR } from '../../copy/tear'
import { HYP_ANALYTICS, RUN_ANALYTICS, SMOKE_ANALYTICS } from './tear.fixtures'
import { distributionInput, eqStack, rrExtremes, rrStack } from './tearCharts'
import { tearExport } from './tearExport'
import type { Analytics } from './tearKpis'

describe('EQ: the performance-difference pane', () => {
  it('draws strategy minus benchmark from 0 under the equity, in percent, signed, with a white zero line', () => {
    const stack = eqStack(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(stack.panes.map((p) => p.id)).toEqual(['equity', 'perfDiff'])
    const diff = stack.panes[1]!
    expect(diff.series).toHaveLength(1)
    expect(diff.series[0]!.style).toBe('perfDiff')
    expect(diff.series[0]!.name).toBe(TEAR_EQ.perfDiff)
    expect(diff.zero).toBe('white')
    expect(diff.unit).toBe('%')
    expect(diff.signed).toBe(true)
    const api = SMOKE_ANALYTICS.equity.perf_diff!
    diff.series[0]!.values.forEach((v, i) => expect(v).toBeCloseTo(api[i]! * 100, 12))
    expect(stack.panes[0]!.weight).toBeGreaterThan(diff.weight ?? 1)
  })

  it('has no difference pane without a benchmark (born failing: never a difference against nothing)', () => {
    expect(RUN_ANALYTICS.equity.perf_diff).toBeNull()
    expect(eqStack(RUN_ANALYTICS, 'nt_volmanaged_v0_fixture_m1').panes.map((p) => p.id)).toEqual(['equity'])
  })
})

describe('RET: the per-period series beside the histogram', () => {
  it('passes the API series on the shared return axis, scaled like the histogram', () => {
    const input = distributionInput(HYP_ANALYTICS, 'volmanaged_v0')!
    const s = HYP_ANALYTICS.distribution.series
    expect(input.series?.t).toBe(s.t)
    input.series!.v.forEach((v, i) => expect(v).toBeCloseTo(s.r[i]! * 100, 12))
  })
})

function withExtremes(data: Analytics): Analytics {
  const [short, long] = data.rolling.vol_extremes
  return {
    ...data,
    rolling: {
      ...data.rolling,
      vol_extremes: [
        { ...short!, hi: 0.32, hi_t: data.rolling.t[5]!, hi_date: data.rolling.date[5]!, lo: 0.1491, lo_t: data.rolling.t[9]!, lo_date: data.rolling.date[9]! },
        { ...long!, hi: null, hi_t: null, hi_date: null, lo: null, lo_t: null, lo_date: null },
      ],
    },
  }
}

describe('RR: the volatility Hi and Low callouts', () => {
  it('marks the short window line at its highest and lowest value, GV style, in percent', () => {
    const data = withExtremes(SMOKE_ANALYTICS)
    const vol = rrStack(data, 'smoke_2015_01').panes[1]!
    expect(vol.callouts).toEqual([
      { t: data.rolling.t[5], value: 32, label: 'Hi: 32.00' },
      { t: data.rolling.t[9], value: 14.91, label: 'Low: 14.91' },
    ])
  })

  it('states every window extreme with its date in words, and says when a window has none', () => {
    const lines = rrExtremes(withExtremes(SMOKE_ANALYTICS))
    expect(lines).toEqual([
      `63 sessions: Hi 32.00% on ${SMOKE_ANALYTICS.rolling.date[5]}, Low 14.91% on ${SMOKE_ANALYTICS.rolling.date[9]}.`,
      '252 sessions: no rolling value.',
    ])
    expect(TEAR_RR.extremes).toContain('{hi}')
  })

  it('draws no callout when the API has no extreme (a series shorter than the window)', () => {
    expect(rrStack(SMOKE_ANALYTICS, 'smoke_2015_01').panes[1]!.callouts).toEqual([])
  })
})

describe('98) Export of each tab', () => {
  const lines = (csv: string) => csv.split('\r\n')

  it('EQ: date, equity, benchmark and the difference at full precision', () => {
    const out = tearExport('EQ', SMOKE_ANALYTICS, 'smoke_2015_01')
    const rows = lines(out.csv)
    expect(out.fileName).toBe('smoke_2015_01_EQ.csv')
    expect(rows[0]).toBe('date,equity,bench,perf_diff')
    expect(rows[1]).toBe([SMOKE_ANALYTICS.equity.date[0], SMOKE_ANALYTICS.equity.equity[0], SMOKE_ANALYTICS.equity.bench![0], SMOKE_ANALYTICS.equity.perf_diff![0]].join(','))
    expect(out.rows).toBe(SMOKE_ANALYTICS.equity.t.length)
  })

  it('DD: the underwater curves, then RET the per-period returns', () => {
    expect(lines(tearExport('DD', SMOKE_ANALYTICS, 'x').csv)[0]).toBe('date,dd,bench_dd')
    const ret = tearExport('RET', HYP_ANALYTICS, 'volmanaged_v0')
    expect(lines(ret.csv)[0]).toBe('date,r')
    expect(ret.rows).toBe(HYP_ANALYTICS.distribution.series.r.length)
  })

  it('RR: both windows of rolling Sharpe and volatility; MRET: the year by month grid and the yearly total', () => {
    expect(lines(tearExport('RR', SMOKE_ANALYTICS, 'x').csv)[0]).toBe('date,sharpe_63,sharpe_252,vol_63,vol_252')
    const mret = tearExport('MRET', HYP_ANALYTICS, 'volmanaged_v0')
    const rows = lines(mret.csv)
    expect(rows[0]).toBe('year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,year_total')
    expect(rows[1]!.startsWith('2011,,,,0.0129969,')).toBe(true)
    expect(mret.rows).toBe(HYP_ANALYTICS.monthly.years.length)
  })
})

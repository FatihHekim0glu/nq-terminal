import { describe, expect, it } from 'vitest'
import { HYP_ANALYTICS, RUN_ANALYTICS, SMOKE_ANALYTICS } from './tear.fixtures'
import { displayUnit, formatValue } from './tearFormat'
import {
  basisLine,
  ddStack,
  distributionInput,
  drawdownRows,
  eqStack,
  mretHeatmap,
  rrEmpty,
  rrStack,
  statsNotes,
  statsSections,
  yearlyLadder,
} from './tearCharts'

describe('basis line (UI_SPEC section 6: every panel names its basis and unit)', () => {
  it('names the displayed unit when a fraction is printed times 100 (MRET cells carry no % sign)', () => {
    const unit = SMOKE_ANALYTICS.monthly.unit
    const line = basisLine(SMOKE_ANALYTICS, displayUnit(unit))
    expect(line).toContain(`Unit: percent (${unit}, times 100)`)
    expect(displayUnit('USD per session')).toBe('USD per session')
  })

  it('names the basis letter, the basis label and the section unit verbatim', () => {
    const line = basisLine(SMOKE_ANALYTICS, SMOKE_ANALYTICS.equity.unit)
    expect(line).toContain('Basis B')
    expect(line).toContain(SMOKE_ANALYTICS.basis_label)
    expect(line).toContain(SMOKE_ANALYTICS.equity.unit)
  })
})

describe('EQ (look spec 7.5)', () => {
  it('draws the API equity array itself, with the benchmark when there is one', () => {
    const stack = eqStack(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(stack.t).toBe(SMOKE_ANALYTICS.equity.t)
    const [pane] = stack.panes
    expect(pane!.series.map((s) => s.style)).toEqual(['primary', 'benchmark'])
    expect(pane!.series[0]!.values).toBe(SMOKE_ANALYTICS.equity.equity)
    expect(pane!.series[1]!.values).toBe(SMOKE_ANALYTICS.equity.bench)
    expect(pane!.logAllowed).toBe(true)
  })

  it('leaves the benchmark out when the API has none', () => {
    const stack = eqStack(RUN_ANALYTICS, 'nt_volmanaged_v0_fixture_m1')
    expect(stack.panes[0]!.series.map((s) => s.style)).toEqual(['primary'])
  })

  it("names the API's max drawdown and basis in the equity pane's summary, never a ratio of the curve", () => {
    const pane = eqStack(HYP_ANALYTICS, 'volmanaged_v0').panes[0]!
    const dd = HYP_ANALYTICS.drawdown
    expect(pane.summaryDrawdown).toEqual({ value: formatValue(dd.max_drawdown, dd.unit, 2), basis: `Basis ${HYP_ANALYTICS.basis}` })
    expect(ddStack(HYP_ANALYTICS, 'volmanaged_v0').panes[0]!.summaryDrawdown).toEqual(pane.summaryDrawdown)
    expect(ddStack(HYP_ANALYTICS, 'volmanaged_v0').panes[1]!.summaryDrawdown).toBeUndefined()
  })

  it('uses 4 decimals for a multiple of K and 2 for USD', () => {
    expect(eqStack(HYP_ANALYTICS, 'volmanaged_v0').panes[0]!.decimals).toBe(4)
    expect(eqStack(SMOKE_ANALYTICS, 'smoke_2015_01').panes[0]!.decimals).toBe(2)
  })
})

describe('DD (look spec 7.5)', () => {
  it('stacks equity over the underwater curve in percent with a white zero line', () => {
    const stack = ddStack(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(stack.panes.map((p) => p.id)).toEqual(['equity', 'underwater'])
    const under = stack.panes[1]!
    expect(under.zero).toBe('white')
    expect(under.unit).toBe('%')
    expect(under.series.map((s) => s.style)).toEqual(['underwater', 'benchmark'])
    const api = SMOKE_ANALYTICS.drawdown.dd
    under.series[0]!.values.forEach((v, i) => {
      const x = api[i]
      if (x === null || x === undefined) expect(v).toBeNull()
      else expect(v).toBeCloseTo(x * 100, 12)
    })
  })

  it('lists the drawdown table with the API depths at the displayed precision', () => {
    const rows = drawdownRows(SMOKE_ANALYTICS)
    expect(rows).toHaveLength(SMOKE_ANALYTICS.drawdown_table.length)
    const first = SMOKE_ANALYTICS.drawdown_table[0]!
    expect(rows[0]!.depth).toBe(`${(first.depth * 100).toFixed(2)}%`)
    expect(rows[0]!.recovery).toBe('open')
    expect(rows[0]!.rank).toBe(1)
  })

  it('writes "start" for a peak at the starting value (null peak)', () => {
    const data = { ...SMOKE_ANALYTICS, drawdown_table: [{ ...SMOKE_ANALYTICS.drawdown_table[0]!, peak: null }] }
    expect(drawdownRows(data)[0]!.peak).toBe('start')
  })
})

describe('RR (look spec 7.5)', () => {
  it('draws rolling Sharpe over rolling volatility with the API windows', () => {
    const stack = rrStack(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(stack.t).toBe(SMOKE_ANALYTICS.rolling.t)
    expect(stack.panes.map((p) => p.id)).toEqual(['sharpe', 'vol'])
    expect(stack.panes[0]!.zero).toBe('grey')
    expect(stack.panes[0]!.series.map((s) => s.name)).toEqual(['Sharpe 63 sessions', 'Sharpe 252 sessions'])
    expect(stack.panes[0]!.series[0]!.values).toBe(SMOKE_ANALYTICS.rolling.sharpe_short)
    expect(stack.panes[1]!.unit).toBe('%')
  })
})

describe('MRET (look spec 7.5)', () => {
  it('builds the year by month heat map in percent, average first then years descending', () => {
    const heat = mretHeatmap(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(heat.kind).toBe('mret')
    expect(heat.columns).toHaveLength(12)
    expect(heat.rows[0]).toMatch(/yr avg/)
    expect(heat.rows.slice(1)).toEqual([...SMOKE_ANALYTICS.monthly.years].sort((a, b) => b - a).map(String))
    expect(heat.unit).toBe('%')
    // The average row is the terminal's own: drawn, but never named as a monthly extreme.
    expect(heat.derivedRows).toBe(1)
    const jan = SMOKE_ANALYTICS.monthly.grid[0]![0]!
    expect(heat.values[1]![0]).toBeCloseTo(jan * 100, 12)
  })

  it('labels the yearly bars as a house addition', () => {
    const bars = yearlyLadder(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(bars.name).toMatch(/house addition/)
    expect(bars.bars.map((b) => b.label)).toEqual(SMOKE_ANALYTICS.monthly.yearly.map((y) => String(y.year)))
  })
})

describe('RET (look spec 7.5)', () => {
  it('feeds the histogram, the normal fit and VaR and CVaR in percent', () => {
    const input = distributionInput(RUN_ANALYTICS, 'nt_volmanaged_v0_fixture_m1')!
    const h = RUN_ANALYTICS.distribution.histogram
    expect(input.counts).toBe(h.counts)
    expect(input.edges[0]).toBeCloseTo(h.edges[0]! * 100, 12)
    expect(input.mean).toBeCloseTo(h.mean! * 100, 12)
    expect(input.risk.var95).toBeCloseTo(RUN_ANALYTICS.risk.var_95! * 100, 12)
    expect(input.risk.cvar99).toBeCloseTo(RUN_ANALYTICS.risk.cvar_99! * 100, 12)
    expect(input.unit).toBe('%')
  })

  it('gives no histogram when an edge or the moments are missing', () => {
    const h = RUN_ANALYTICS.distribution.histogram
    const broken = { ...RUN_ANALYTICS, distribution: { ...RUN_ANALYTICS.distribution, histogram: { ...h, sd: null } } }
    expect(distributionInput(broken, 'x')).toBeNull()
  })

  it('lists summary, risk and validity rows with API values at the displayed precision', () => {
    const sections = statsSections(RUN_ANALYTICS)
    expect(sections.map((s) => s.id)).toEqual(['summary', 'risk', 'validity'])
    const rows = Object.fromEntries(sections.flatMap((s) => s.rows.map((r) => [r.id, r.value])))
    const st = RUN_ANALYTICS.distribution.stats
    expect(rows.n).toBe(String(st.n))
    expect(rows.hitRate).toBe(`${(st.hit_rate! * 100).toFixed(2)}%`)
    expect(rows.skew).toBe(st.skew!.toFixed(2))
    expect(rows.var95).toBe(`${(RUN_ANALYTICS.risk.var_95! * 100).toFixed(2)}%`)
    expect(rows.psrZero).toBe(RUN_ANALYTICS.validity.psr.at_zero!.toFixed(3))
    expect(rows.minTrlZero).toMatch(/not reachable/)
  })

  it('keeps a MinTRL value short enough for its cell and states the reason once in a note below', () => {
    const rows = Object.fromEntries(statsSections(HYP_ANALYTICS).flatMap((s) => s.rows.map((r) => [r.id, r.value])))
    expect(rows.minTrlZero).toBe('not reachable')
    expect(rows.minTrlBench).toBe('not reachable')
    const notes = statsNotes(HYP_ANALYTICS)
    expect(notes).toEqual(['Not reachable: the Sharpe is at or below the threshold (MinTRL (0), MinTRL (benchmark Sharpe)).'])
    expect(statsNotes({ ...HYP_ANALYTICS, validity: { ...HYP_ANALYTICS.validity, min_trl: { ...HYP_ANALYTICS.validity.min_trl, at_zero: { ...HYP_ANALYTICS.validity.min_trl.at_zero, reason: 'reachable', reachable: true, sessions: 400 }, at_benchmark: null } } })).toEqual([])
  })
})

describe('RR when the series is shorter than the rolling windows', () => {
  it('replaces the empty panes with a note that states the window and the series length', () => {
    const empty = rrEmpty(HYP_ANALYTICS)
    expect(empty).toEqual({
      panes: [
        { id: 'sharpe', title: 'Rolling Sharpe', text: 'Needs 63 sessions; this series has 39.' },
        { id: 'vol', title: 'Rolling volatility', text: 'Needs 63 sessions; this series has 39.' },
      ],
      longNote: null,
    })
  })

  it('draws the chart when the short window has values, with a note for an unmet long window', () => {
    const r = HYP_ANALYTICS.rolling
    const some = { ...HYP_ANALYTICS, rolling: { ...r, sharpe_short: r.sharpe_short.map((_, i) => (i > 30 ? 0.5 : null)) } }
    expect(rrEmpty(some)).toEqual({ panes: [], longNote: 'The 252-session lines need 252 sessions; this series has 39.' })
    const full = { ...some, rolling: { ...some.rolling, sharpe_long: some.rolling.sharpe_short } }
    expect(rrEmpty(full)).toEqual({ panes: [], longNote: null })
  })
})

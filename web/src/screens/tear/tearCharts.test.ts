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
  rrBandNote,
  rrStack,
  statsNotes,
  statsSections,
  tailsNote,
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

  it('draws each window its own range if the full-sample Sharpe held (born failing: one full-sample pair)', () => {
    // statistics review: SV5's full-sample interval on the 63-session pane left most values outside it at a
    // constant true Sharpe; each window now gets SR_full +/- 1.96 x its own Mertens error (RL1 band)
    const r = HYP_ANALYTICS.rolling
    const lines = { ...HYP_ANALYTICS, rolling: { ...r, sharpe_short: r.t.map(() => 0.5), sharpe_long: r.t.map(() => 0.5) } }
    const stack = rrStack(lines, 'volmanaged_v0')
    const n = r.t.length
    const [short, long] = HYP_ANALYTICS.rolling.sharpe_bands
    const bounds = stack.panes[0]!.series.slice(2)
    expect(bounds.map((s) => [s.name, s.style])).toEqual([
      ['Range low, Sharpe 63 sessions', 'ciBound'], ['Range high, Sharpe 63 sessions', 'ciBound'],
      ['Range low, Sharpe 252 sessions', 'ciBound'], ['Range high, Sharpe 252 sessions', 'ciBound'],
    ])
    expect(bounds[0]!.values).toEqual(Array(n).fill(short!.lo))
    expect(bounds[3]!.values).toEqual(Array(n).fill(long!.hi))
    expect(short!.hi! - short!.lo!).toBeGreaterThan(1.9 * (long!.hi! - long!.lo!))
    expect(rrBandNote(lines)).toBe(
      'Dashed amber lines: the range (95%) of a 63-session Sharpe, -7.53 to 0.09, and of a 252-session Sharpe, -5.61 to -1.82, if the full-sample Sharpe -3.72 held throughout (Mertens standard error). A line outside its range is not by itself a regime change.',
    )
  })

  it('draws no range for a window without a rolling value', () => {
    const stack = rrStack(SMOKE_ANALYTICS, 'smoke_2015_01')
    expect(stack.panes[0]!.series).toHaveLength(2)
    expect(rrBandNote(SMOKE_ANALYTICS)).toBeNull()
    const r = HYP_ANALYTICS.rolling
    const shortOnly = { ...HYP_ANALYTICS, rolling: { ...r, sharpe_short: r.t.map(() => 0.5) } }
    expect(rrStack(shortOnly, 'x').panes[0]!.series.slice(2).map((s) => s.name)).toEqual(['Range low, Sharpe 63 sessions', 'Range high, Sharpe 63 sessions'])
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

describe('G16: the 21-session tail rows get their own section, separate from the 1-session risk rows', () => {
  it('keeps Risk to VaR and CVaR only, and gives the tails their own titled section naming the window and the sign convention', () => {
    const sections = statsSections(HYP_ANALYTICS)
    expect(sections.map((s) => s.id)).toEqual(['summary', 'risk', 'tails', 'validity'])
    const risk = sections.find((s) => s.id === 'risk')!
    expect(risk.rows.map((r) => r.id)).toEqual(['var95', 'cvar95', 'var99', 'cvar99'])
    const tails = sections.find((s) => s.id === 'tails')!
    expect(tails.rows.map((r) => r.id)).toEqual(['tails5', 'tails1', 'tailsN'])
    expect(tails.title).toBe('21-session loss (overlapping sums, negative = loss)')
  })

  it('shows no tails section for a series with no 21-session windows (RUN_ANALYTICS: n = 0)', () => {
    expect(RUN_ANALYTICS.risk.tails21?.n).toBe(0)
    expect(statsSections(RUN_ANALYTICS).map((s) => s.id)).toEqual(['summary', 'risk', 'validity'])
  })
})

describe('tailsNote (G16): says when too few windows separate the 5% and 1% tails', () => {
  it('notes it when 19 windows round both quantiles to the same worst window', () => {
    expect(HYP_ANALYTICS.risk.tails21).toMatchObject({ n: 19, shortfall_1pct: -0.0789560099999999, shortfall_5pct: -0.0789560099999999 })
    expect(tailsNote(HYP_ANALYTICS)).toBe('With only 19 windows, the 5% and 1% tails fall on the same window and cannot be told apart.')
  })

  it('says nothing for a series with no 21-session windows', () => {
    expect(tailsNote(RUN_ANALYTICS)).toBeNull()
  })

  it('says nothing once the two tails separate', () => {
    const wide = { ...HYP_ANALYTICS, risk: { ...HYP_ANALYTICS.risk, tails21: { ...HYP_ANALYTICS.risk.tails21!, shortfall_1pct: -0.12, shortfall_5pct: -0.08 } } }
    expect(tailsNote(wide)).toBeNull()
  })
})

describe('U24: RET names the benchmark Sharpe the PSR (benchmark Sharpe) row tests against', () => {
  it('adds an annualised Benchmark Sharpe row before PSR (benchmark Sharpe), matching HOME (-3.67)', () => {
    const validity = statsSections(HYP_ANALYTICS).find((s) => s.id === 'validity')!
    const ids = validity.rows.map((r) => r.id)
    expect(ids.indexOf('benchSharpe')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('benchSharpe')).toBeLessThan(ids.indexOf('psrBench'))
    const row = validity.rows.find((r) => r.id === 'benchSharpe')!
    expect(row.label).toBe('Benchmark Sharpe')
    expect(row.value).toBe('-3.67')
  })

  it('has no Benchmark Sharpe row when the series has no benchmark', () => {
    expect(RUN_ANALYTICS.validity.psr.benchmark_sr_per_period).toBeNull()
    const ids = statsSections(RUN_ANALYTICS).find((s) => s.id === 'validity')!.rows.map((r) => r.id)
    expect(ids).not.toContain('benchSharpe')
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

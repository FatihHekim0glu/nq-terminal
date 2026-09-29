import { describe, expect, it } from 'vitest'
import { contextTables } from '../../charts/LineStack.context'
import type { Schemas } from '../../api/types'
import { TEAR_DD } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { HYP_ANALYTICS, RUN_ANALYTICS, SMOKE_ANALYTICS } from './tear.fixtures'
import { HYP_EXTENDED } from './tearP1.fixtures'
import type { Analytics } from './tearKpis'
import { displayUnit, formatValue } from './tearFormat'
import {
  basisLine,
  contextLines,
  ddStack,
  distributionInput,
  drawdownLanes,
  drawdownRows,
  epochOfDate,
  eqStack,
  laneNotes,
  laneNumber,
  lanesDropped,
  laneWeight,
  mretHeatmap,
  regimeRibbon,
  rrEmpty,
  rrBandNote,
  rrStack,
  statsNotes,
  statsSections,
  stressSpans,
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
    expect(stack.panes.map((p) => p.id)).toEqual(['equity', 'underwater', 'lanes'])
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

// ---------------------------------------------------------------------------------------------
// Roadmap 12, part B: market context on EQ and DD (RK5 stress spans, RG1 regime ribbon)

type Extended = Schemas['ExtendedAnalytics']
type StressRow = Extended['stress']['rows'][number]
type RegimeState = 'low' | 'mid' | 'high'

/** HYP_EXTENDED with its stress rows and regimes replaced, so a test states exactly what it feeds in. */
function extendedWith(over: { readonly rows?: readonly Partial<StressRow>[]; readonly regimes?: Extended['regimes'] }): Extended {
  const base = HYP_EXTENDED.stress.rows[0]!
  const rows = over.rows ? over.rows.map((r) => ({ ...base, ...r })) : HYP_EXTENDED.stress.rows
  return { ...HYP_EXTENDED, stress: { ...HYP_EXTENDED.stress, rows }, regimes: over.regimes === undefined ? HYP_EXTENDED.regimes : over.regimes }
}

/** A served RG1 block over the given sessions, with the given labels in the given order. */
function regimesOf(t: readonly number[], regime: ReadonlyArray<RegimeState | null>): NonNullable<Extended['regimes']> {
  return { ...HYP_EXTENDED.regimes!, t: [...t], date: t.map((x) => new Date(x * 1000).toISOString().slice(0, 10)), regime: [...regime] }
}

const SERIES_T = HYP_ANALYTICS.equity.t
const DAY = 86400

describe('epochOfDate: a session date as the UTC epoch second of its 00:00 (the tear sheet t)', () => {
  it('reads YYYY-MM-DD as UTC midnight', () => {
    expect(epochOfDate('1970-01-01')).toBe(0)
    expect(epochOfDate('1970-01-02')).toBe(DAY)
    expect(epochOfDate('2011-04-25')).toBe(SERIES_T[0])
    expect(epochOfDate(HYP_ANALYTICS.last)).toBe(SERIES_T[SERIES_T.length - 1])
    expect(epochOfDate('2020-02-29')).toBe(1582934400)
  })

  it('is NaN for anything that is not a real calendar date, so a bad date can never be drawn', () => {
    for (const bad of ['', 'x', '2011-4-25', '2011-04-25T00:00:00Z', '2011-02-30', '2011-13-01', '20110425']) {
      expect(Number.isNaN(epochOfDate(bad)), bad).toBe(true)
    }
  })
})

describe('stressSpans (RK5): peak to recovery, or to the trough while unrecovered', () => {
  it('gives one span per frozen window, in served order, with epoch second bounds', () => {
    const spans = stressSpans(HYP_EXTENDED)
    expect(spans).toHaveLength(5)
    expect(spans.map((s) => s.label)).toEqual(HYP_EXTENDED.stress.rows.map((r) => r.label))
    expect(spans.map((s) => [s.from, s.to])).toEqual(
      HYP_EXTENDED.stress.rows.map((r) => [epochOfDate(r.peak), epochOfDate(r.recovery!)]),
    )
    expect(spans[0]).toEqual({ from: epochOfDate('2020-02-19'), to: epochOfDate('2020-06-05'), label: '2020 COVID crash' })
  })

  it('ends an unrecovered window at its trough, not at the end of the data', () => {
    const [span] = stressSpans(extendedWith({ rows: [{ label: 'Open fall', peak: '2011-05-02', trough: '2011-05-20', recovery: null }] }))
    expect(span).toEqual({ from: epochOfDate('2011-05-02'), to: epochOfDate('2011-05-20'), label: 'Open fall' })
  })

  it('carries the [SPENT] tag on the chip label of a spent window only', () => {
    const spans = stressSpans(extendedWith({
      rows: [{ label: 'Frozen one', spent: false }, { label: '2022 bear market', spent: true, peak: '2022-01-03', trough: '2022-10-12', recovery: null }],
    }))
    expect(spans.map((s) => s.label)).toEqual(['Frozen one', '2022 bear market [SPENT]'])
  })

  it('is empty without the extended body, and leaves out a window whose dates are not real', () => {
    expect(stressSpans(null)).toEqual([])
    const spans = stressSpans(extendedWith({ rows: [{ label: 'Bad', peak: 'soon', trough: '2011-05-20', recovery: null }, { label: 'Good', peak: '2011-05-02', trough: '2011-05-20', recovery: null }] }))
    expect(spans.map((s) => s.label)).toEqual(['Good'])
  })
})

describe('regimeRibbon (RG1): the served labels, aligned to the series by exact time', () => {
  it('is null without the extended body or without a served regime block', () => {
    expect(regimeRibbon(null, SERIES_T)).toBeNull()
    expect(regimeRibbon({ ...HYP_EXTENDED, regimes: null }, SERIES_T)).toBeNull()
  })

  it('gives 39 nulls for the captured series, which sits before the 252 sessions RG1 needs', () => {
    expect(HYP_EXTENDED.regimes!.t).toEqual(SERIES_T)
    const ribbon = regimeRibbon(HYP_EXTENDED, SERIES_T)!
    expect(ribbon.values).toHaveLength(39)
    expect(ribbon.values.every((v) => v === null)).toBe(true)
  })

  it('names the strip and gives every state its words and its one letter glyph, plus the missing text', () => {
    const ribbon = regimeRibbon(HYP_EXTENDED, SERIES_T)!
    expect(ribbon.name).toBe('Regime')
    expect(ribbon.missing).toBe('unlabelled')
    expect(ribbon.states).toEqual({
      low: { label: 'low volatility', glyph: 'L' },
      mid: { label: 'mid volatility', glyph: 'M' },
      high: { label: 'high volatility', glyph: 'H' },
    })
  })

  it('aligns by time, not by position: shuffled regime rows land on their own sessions', () => {
    const t = [0, 1, 2, 3, 4, 5].map((i) => SERIES_T[i]!)
    const labels: RegimeState[] = ['low', 'mid', 'high', 'high', 'mid', 'low']
    const order = [3, 0, 5, 2, 4, 1]
    const shuffled = regimesOf(order.map((i) => t[i]!), order.map((i) => labels[i]!))
    expect(regimeRibbon(extendedWith({ regimes: shuffled }), t)!.values).toEqual(labels)
  })

  it('leaves a session the served block does not hold as null, and ignores a served time the series lacks', () => {
    const t = [0, 1, 2, 3].map((i) => SERIES_T[i]!)
    const served = regimesOf([t[1]!, t[3]!, t[3]! + DAY / 2], ['high', 'low', 'mid'])
    expect(regimeRibbon(extendedWith({ regimes: served }), t)!.values).toEqual([null, 'high', null, 'low'])
  })

  it('treats a served label that is not low, mid or high as no state', () => {
    const t = [0, 1].map((i) => SERIES_T[i]!)
    const served = { ...regimesOf(t, ['low', 'mid']), regime: ['low', 'extreme'] as unknown as NonNullable<Extended['regimes']>['regime'] }
    expect(regimeRibbon(extendedWith({ regimes: served }), t)!.values).toEqual(['low', null])
  })

  it('handles a long series (10,000 sessions) in one pass', () => {
    const t = Array.from({ length: 10_000 }, (_, i) => i * DAY)
    const labels = t.map((_, i) => (['low', 'mid', 'high'] as const)[i % 3]!)
    const values = regimeRibbon(extendedWith({ regimes: regimesOf(t, labels) }), t)!.values
    expect(values[9_999]).toBe(labels[9_999])
    expect(values.filter((v) => v !== null)).toHaveLength(10_000)
  })
})

describe('contextLines: the layers in words, with counts, basis and tag', () => {
  it('says 0 of 5 windows and 0 of 39 sessions for the captured series', () => {
    const [spans, ribbon] = contextLines(HYP_EXTENDED, SERIES_T)
    expect(spans).toBe(
      `0 of 5 frozen stress windows (RK5, ${HYP_EXTENDED.stress.frozen}) fall in this series; bands run from peak to recovery, or to the trough while unrecovered. [POST HOC]`,
    )
    expect(ribbon).toBe(`Strip under the time axis: RG1 volatility regime of each session; 0 of 39 sessions labelled. ${HYP_EXTENDED.regimes!.label} [POST HOC]`)
    expect(contextLines(HYP_EXTENDED, SERIES_T)).toHaveLength(2)
  })

  it('counts the windows that touch the series, ends included, and the sessions that carry a label', () => {
    const t = SERIES_T
    const ext = extendedWith({
      rows: [
        { label: 'inside', peak: '2011-05-02', trough: '2011-05-20', recovery: '2011-06-01' },
        { label: 'touches the last session', peak: '2011-06-17', trough: '2011-06-20', recovery: '2011-07-01' },
        { label: 'ends the day before', peak: '2011-03-01', trough: '2011-04-01', recovery: '2011-04-24' },
        { label: 'far away', peak: '2020-02-19', trough: '2020-03-20', recovery: null },
      ],
      regimes: regimesOf(t, t.map((_, i) => (i < 10 ? null : i < 25 ? 'mid' : 'high'))),
    })
    const [spans, ribbon] = contextLines(ext, t)
    expect(spans).toMatch(/^2 of 4 frozen stress windows \(RK5, /)
    expect(ribbon).toMatch(/; 29 of 39 sessions labelled\. /)
  })

  it('formats large counts with a thousands separator', () => {
    const t = Array.from({ length: 2686 }, (_, i) => i * DAY)
    const [, ribbon] = contextLines(extendedWith({ regimes: regimesOf(t, t.map(() => 'low')) }), t)
    expect(ribbon).toContain('2,686 of 2,686 sessions labelled')
  })

  it('says no window falls in the series when RK5 serves none, naming the series range', () => {
    const [spans] = contextLines(extendedWith({ rows: [] }), SERIES_T)
    expect(spans).toBe('No frozen stress window falls in this series (2011-04-25 to 2011-06-17).')
  })

  it('names the served reason when there is no regime block, or says none was given', () => {
    const none = { ...HYP_EXTENDED, regimes: null, regimes_note: 'needs 252 earlier sessions' }
    expect(contextLines(none, SERIES_T)[1]).toBe('No volatility regime is served for this series: needs 252 earlier sessions')
    expect(contextLines({ ...none, regimes_note: null }, SERIES_T)[1]).toBe('No volatility regime is served for this series: the API gives no reason')
  })

  it('is empty without the extended body, and copes with an empty series', () => {
    expect(contextLines(null, SERIES_T)).toEqual([])
    const [spans, ribbon] = contextLines(HYP_EXTENDED, [])
    expect(spans).toMatch(/^0 of 5 frozen stress windows/)
    expect(ribbon).toContain('0 of 0 sessions labelled')
  })
})

describe('EQ and DD stacks with the market context', () => {
  const NAME = 'volmanaged_v0'

  it('are unchanged without the extended body: no spans and no ribbon, not even as undefined keys', () => {
    for (const build of [eqStack, ddStack]) {
      const plain = build(HYP_ANALYTICS, NAME)
      expect(build(HYP_ANALYTICS, NAME, null)).toStrictEqual(plain)
      expect(Object.keys(plain).sort()).toEqual(['panes', 't', 'title'])
    }
  })

  it('attach the five spans and the ribbon for their own t, leaving the panes exactly as they were', () => {
    const eq = eqStack(HYP_ANALYTICS, NAME, HYP_EXTENDED)
    expect(eq.spans).toEqual(stressSpans(HYP_EXTENDED))
    expect(eq.ribbon!.values).toHaveLength(HYP_ANALYTICS.equity.t.length)
    expect(eq.panes).toEqual(eqStack(HYP_ANALYTICS, NAME).panes)
    expect(eq.t).toBe(HYP_ANALYTICS.equity.t)
    const dd = ddStack(HYP_ANALYTICS, NAME, HYP_EXTENDED)
    expect(dd.spans).toHaveLength(5)
    expect(dd.ribbon!.values).toHaveLength(HYP_ANALYTICS.drawdown.t.length)
    expect(dd.panes).toEqual(ddStack(HYP_ANALYTICS, NAME).panes)
  })

  it('attach only the layer the body holds', () => {
    const noRegimes = eqStack(HYP_ANALYTICS, NAME, { ...HYP_EXTENDED, regimes: null })
    expect(noRegimes.spans).toHaveLength(5)
    expect('ribbon' in noRegimes).toBe(false)
    const noWindows = ddStack(HYP_ANALYTICS, NAME, extendedWith({ rows: [] }))
    expect('spans' in noWindows).toBe(false)
    expect(noWindows.ribbon).toBeDefined()
  })

  it("list the five windows as not in view in the chart's T table when the series lies outside them", () => {
    const eq = eqStack(HYP_ANALYTICS, NAME, HYP_EXTENDED)
    const [windows] = contextTables(eq.title, eq.t, eq.spans, eq.ribbon)
    expect(windows!.rows).toHaveLength(5)
    expect(windows!.rows.map((r) => r.inView)).toEqual(['no', 'no', 'no', 'no', 'no'])
    expect(windows!.rows.map((r) => r.window)).toEqual(HYP_EXTENDED.stress.rows.map((r) => r.label))
  })

  it('tables a labelled strip by runs and the windows in view as yes', () => {
    const t = SERIES_T
    const ext = extendedWith({
      rows: [{ label: 'inside', peak: '2011-05-02', trough: '2011-05-20', recovery: '2011-06-01' }],
      regimes: regimesOf(t, t.map((_, i) => (i < 10 ? null : i < 25 ? 'mid' : 'high'))),
    })
    const eq = eqStack(HYP_ANALYTICS, NAME, ext)
    const [windows, runs] = contextTables(eq.title, eq.t, eq.spans, eq.ribbon)
    expect(windows!.rows.map((r) => r.inView)).toEqual(['yes'])
    expect(runs!.rows.map((r) => [r.state, r.sessions])).toEqual([['mid volatility', 15], ['high volatility', 14]])
  })
})

// ---------------------------------------------------------------------------------------------
// Roadmap 10, phase 1: drawdown episode lanes over the served DD2 rows

type Row = Analytics['drawdown_table'][number]
const iso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)
const DD_T = HYP_ANALYTICS.drawdown.t

function withRows(rows: readonly Partial<Row>[], base: Analytics = HYP_ANALYTICS): Analytics {
  const first = base.drawdown_table[0]!
  return { ...base, drawdown_table: rows.map((r) => ({ ...first, ...r })) }
}

/** Ten recovered-or-open rows, deepest first, all inside the fixture's 39 sessions. */
function tenRows(): Row[] {
  return Array.from({ length: 10 }, (_, i): Row => {
    const open = i === 9
    return {
      peak: iso(DD_T[i]!),
      trough: iso(DD_T[i + 2]!),
      recovery: open ? null : iso(DD_T[i + 5]!),
      depth: -0.1 + i * 0.005,
      peak_to_trough: 2,
      trough_to_recovery: open ? null : 3,
      length: open ? 30 : 5,
      open,
    }
  })
}

describe('drawdownLanes (DD2): one lane per served row, in served order', () => {
  it('maps the fixture\'s one open row to a lane with epoch second bounds and the depth text', () => {
    const lanes = drawdownLanes(HYP_ANALYTICS)!
    expect(lanes.name).toBe(TEAR_DD.lanesName)
    expect(lanes.name).toBe('Episodes')
    expect(lanes.episodes).toEqual([
      {
        rank: 1,
        peak: epochOfDate('2011-04-27'),
        trough: epochOfDate('2011-06-17'),
        // open: the lane runs to the last session the data reaches
        end: DD_T[DD_T.length - 1],
        open: true,
        depth: formatValue(HYP_ANALYTICS.drawdown_table[0]!.depth, HYP_ANALYTICS.drawdown.unit, 2),
      },
    ])
    expect(lanes.episodes[0]!.depth).toBe('-9.49%')
    expect(lanes.episodes[0]!.peak).toBe(1303862400)
  })

  it('keeps ten rows in the order served with ranks 1 to 10, a recovered row ending at its recovery', () => {
    const data = withRows(tenRows())
    const { episodes } = drawdownLanes(data)!
    expect(episodes.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(episodes.map((e) => e.peak)).toEqual(DD_T.slice(0, 10))
    expect(episodes.map((e) => e.trough)).toEqual(DD_T.slice(2, 12))
    expect(episodes.slice(0, 9).map((e) => e.end)).toEqual(DD_T.slice(5, 14))
    expect(episodes.slice(0, 9).every((e) => !e.open)).toBe(true)
    expect(episodes[9]).toMatchObject({ open: true, end: DD_T[DD_T.length - 1] })
    // the depths are the served ones, unsorted and unchanged
    expect(episodes.map((e) => e.depth)).toEqual(data.drawdown_table.map((r) => formatValue(r.depth, data.drawdown.unit, 2)))
  })

  it('starts a lane at the first session of the series when the served peak is null (the starting value)', () => {
    const [episode] = drawdownLanes(withRows([{ peak: null }]))!.episodes
    expect(episode!.peak).toBe(DD_T[0])
  })

  it('leaves out a row with a date that is not real, counts it, and keeps the others\' served ranks', () => {
    const rows = tenRows()
    rows[1] = { ...rows[1]!, peak: '2011-02-30' }
    rows[4] = { ...rows[4]!, trough: 'later' }
    rows[6] = { ...rows[6]!, recovery: '2011-13-01' }
    const data = withRows(rows)
    const lanes = drawdownLanes(data)!
    expect(lanes.episodes.map((e) => e.rank)).toEqual([1, 3, 4, 6, 8, 9, 10])
    expect(lanesDropped(data)).toBe(3)
    expect(lanes.episodes.every((e) => [e.peak, e.trough, e.end].every(Number.isFinite))).toBe(true)
  })

  it('is null with no rows, and when no row has a readable date', () => {
    expect(drawdownLanes(withRows([]))).toBeNull()
    expect(lanesDropped(withRows([]))).toBe(0)
    const bad = withRows([{ trough: 'x' }, { peak: 'y' }])
    expect(drawdownLanes(bad)).toBeNull()
    expect(lanesDropped(bad)).toBe(2)
  })

  it('cannot place a row on an empty axis when it starts or runs open: dropped and counted', () => {
    const empty = { ...withRows([{ peak: null }]), drawdown: { ...HYP_ANALYTICS.drawdown, t: [] } }
    expect(drawdownLanes(empty)).toBeNull()
    expect(lanesDropped(empty)).toBe(1)
    const recovered = { ...withRows([{ peak: '2011-04-27', recovery: '2011-06-01', open: false }]), drawdown: { ...HYP_ANALYTICS.drawdown, t: [] } }
    expect(drawdownLanes(recovered)!.episodes).toHaveLength(1)
  })

  it('places a monthly series\' month-end rows exactly on its t, so no lane shifts', () => {
    const ends = ['2020-01-31', '2020-02-29', '2020-03-31', '2020-04-30', '2020-05-29', '2020-06-30']
    const t = ends.map(epochOfDate)
    const data: Analytics = {
      ...withRows([{ peak: '2020-01-31', trough: '2020-03-31', recovery: '2020-05-29', open: false }, { peak: '2020-05-29', trough: '2020-06-30', recovery: null, open: true }]),
      drawdown: { ...HYP_ANALYTICS.drawdown, t, date: ends },
    }
    const [closed, open] = drawdownLanes(data)!.episodes
    expect([closed!.peak, closed!.trough, closed!.end]).toEqual([t[0], t[2], t[4]])
    expect([open!.peak, open!.trough, open!.end]).toEqual([t[4], t[5], t[5]])
    for (const e of [closed!, open!]) for (const at of [e.peak, e.trough, e.end]) expect(t).toContain(at)
  })

  it('summarises nothing: a lane holds the served facts only (DD3 is not served)', () => {
    const lanes = drawdownLanes(withRows(tenRows()))!
    expect(Object.keys(lanes).sort()).toEqual(['episodes', 'name'])
    for (const e of lanes.episodes) expect(Object.keys(e).sort()).toEqual(['depth', 'end', 'open', 'peak', 'rank', 'trough'])
  })
})

describe('laneWeight: the lanes pane grows with its rows, never under 0.8', () => {
  it('is 0.8 up to five rows and 1.6 at ten', () => {
    expect(laneWeight(0)).toBe(0.8)
    expect(laneWeight(1)).toBe(0.8)
    expect(laneWeight(5)).toBeCloseTo(0.8, 12)
    expect(laneWeight(10)).toBeCloseTo(1.6, 12)
    expect(laneWeight(7)).toBeCloseTo(1.12, 12)
  })
})

describe('laneNumber: Number <GO> 11 to 20 pins an episode', () => {
  it('is ten more than the rank', () => {
    expect([1, 2, 10].map(laneNumber)).toEqual([11, 12, 20])
  })
})

describe('ddStack with the lanes pane', () => {
  const NAME = 'volmanaged_v0'

  it('stacks equity, underwater and the lanes, the lanes last so they carry the time axis and the regime strip', () => {
    const stack = ddStack(HYP_ANALYTICS, NAME)
    expect(stack.panes.map((p) => p.id)).toEqual(['equity', 'underwater', 'lanes'])
    const lanes = stack.panes[2]!
    expect(lanes.series).toEqual([])
    expect(lanes.lanes).toEqual(drawdownLanes(HYP_ANALYTICS))
    expect(lanes.weight).toBe(laneWeight(1))
    expect(lanes.summaryDrawdown).toBeUndefined()
    expect(lanes.zero).toBeUndefined()
  })

  it('weights the pane by the rows drawn', () => {
    const stack = ddStack(withRows(tenRows()), NAME)
    expect(stack.panes[2]!.weight).toBeCloseTo(1.6, 12)
    expect(stack.panes[2]!.lanes!.episodes).toHaveLength(10)
  })

  it('keeps the equity and underwater panes exactly as they were', () => {
    const [equity, underwater] = ddStack(HYP_ANALYTICS, NAME).panes
    const without = ddStack(withRows([]), NAME).panes
    expect(without.map((p) => p.id)).toEqual(['equity', 'underwater'])
    expect(equity).toEqual(without[0])
    expect(underwater).toEqual(without[1])
  })

  it('has no lanes pane for an empty table, or when no row can be drawn', () => {
    expect(ddStack(withRows([]), NAME).panes.map((p) => p.id)).toEqual(['equity', 'underwater'])
    expect(ddStack(withRows([{ trough: 'x' }]), NAME).panes.map((p) => p.id)).toEqual(['equity', 'underwater'])
  })

  it('carries the market context over all three panes without touching them', () => {
    const plain = ddStack(HYP_ANALYTICS, NAME)
    const withContext = ddStack(HYP_ANALYTICS, NAME, HYP_EXTENDED)
    expect(withContext.panes).toEqual(plain.panes)
    expect(withContext.ribbon).toBeDefined()
  })
})

describe('laneNotes: what the lanes are, in words, and what they are not', () => {
  it('names the rows as the deepest the API lists and says DD3 is not served', () => {
    const data = withRows(tenRows())
    const [note, ...rest] = laneNotes(data)
    expect(rest).toEqual([])
    expect(note).toBe(fillCopy(TEAR_DD.lanesNote, { n: 10 }))
    expect(note).toContain('the 10 deepest drawdowns the API lists (DD2), deepest first')
    expect(note).toContain('an open episode ends in a hatch')
    expect(note).not.toContain('is hatched')
    expect(note).toContain('DD3 (all episodes and time to recovery) is not served')
  })

  it('says it in the singular for one row', () => {
    const [note] = laneNotes(HYP_ANALYTICS)
    expect(note).toBe(TEAR_DD.lanesNoteOne)
    expect(note).toContain('the deepest drawdown the API lists (DD2)')
    expect(note).toContain('an open episode ends in a hatch')
    expect(note).toContain('DD3')
  })

  it('adds the count of rows left out for an unreadable date', () => {
    const rows = tenRows()
    rows[2] = { ...rows[2]!, peak: 'x' }
    expect(laneNotes(withRows(rows))).toEqual([fillCopy(TEAR_DD.lanesNote, { n: 10 }), TEAR_DD.laneDroppedOne])
    expect(laneNotes(withRows(rows))[1]).toBe('1 row with an unreadable date is not drawn.')
    const two = tenRows().map((r, i) => (i < 2 ? { ...r, peak: 'x' } : r))
    expect(laneNotes(withRows(two))[1]).toBe('2 rows with an unreadable date are not drawn.')
  })

  it('only counts the rows left out when none can be drawn, and prints nothing for an empty table', () => {
    expect(laneNotes(withRows([{ peak: 'x' }, { peak: 'y' }]))).toEqual([fillCopy(TEAR_DD.laneDropped, { n: 2 })])
    expect(laneNotes(withRows([]))).toEqual([])
  })

  it('derives no statistic from the rows: no longest, median or total in the copy', () => {
    for (const text of [TEAR_DD.lanesNote, TEAR_DD.lanesNoteOne, TEAR_DD.laneDropped, TEAR_DD.laneItem, TEAR_DD.lanesName]) {
      expect(text).not.toMatch(/longest|median|total|average|mean|recovery time/i)
    }
  })
})

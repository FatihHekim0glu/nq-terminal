// The P2 panel models (RG2, EX5, MV6): what each panel prints, from the captured API responses. Nothing is
// recomputed: every number is the API's, formatted at a fixed precision.
import { describe, expect, it } from 'vitest'
import { contextReadout, contextTables } from '../../charts/LineStack.context'
import { RCT } from '../../copy/regimesCapacityTerm'
import {
  capacityRows,
  curveRows,
  formatCarry,
  formatParticipation,
  gateLine,
  instrumentRows,
  maxLine,
  termStack,
  termSummaryLine,
  trendRibbon,
  trendRows,
  trendStripLine,
  trendStack,
  unlabelledLine,
  voidLine,
  welchLine,
  worstRows,
} from './model'
import { RUN_CAPACITY, TERM_CL, TREND_MONTHLY, TREND_VIEW } from './p2rct.fixtures'
import type { TermStructure, TrendRegimeView } from './types'

describe('trend regime (RG2)', () => {
  it('prints one row per regime in the API order with the API values', () => {
    const rows = trendRows(TREND_VIEW)
    expect(rows.map((r) => r.regime)).toEqual(['above', 'below'])
    expect(rows[0]).toMatchObject({ name: RCT.trend.names.above, n: '2,478', sharpe: '1.26', hit: '56.86%' })
    expect(rows[1]!.sharpe).toBe('-1.87')
  })

  it('states Welch t with its degrees of freedom and never a p-value', () => {
    const line = welchLine(TREND_VIEW)
    expect(line).toContain('2.63')
    expect(line).not.toMatch(/\bp\b|p-value|p =/)
    expect(welchLine({ ...TREND_VIEW, welch_t: null, welch_df: null })).toBe(RCT.trend.welchNone)
  })

  it('counts the unlabelled sessions against the window', () => {
    expect(unlabelledLine(TREND_VIEW)).toBe('Sessions without a regime (fewer than 200 earlier closes): 0.')
  })

  it('a monthly book has no rows', () => {
    expect(TREND_MONTHLY.available).toBe(false)
    expect(trendRows(TREND_MONTHLY)).toEqual([])
  })
})

const DAY = 86_400
const FENCE_SECONDS = Date.UTC(2022, 0, 1) / 1000

/** A view over `n` sessions from 2021-12-20, so the last ones fall on and after the 2022 fence. */
function viewOver(regimes: ReadonlyArray<'above' | 'below' | null>): TrendRegimeView {
  const start = Date.UTC(2021, 11, 20) / 1000
  const t = regimes.map((_, i) => start + i * DAY)
  return {
    ...TREND_VIEW,
    t,
    date: t.map((x) => new Date(x * 1000).toISOString().slice(0, 10)),
    regime: [...regimes],
    close: regimes.map((_, i) => 15_000 + i),
    mean_close: regimes.map((_, i) => 14_000 + i),
  }
}

describe('trend regime chart (RG2 through LineStack)', () => {
  it('draws NQ against its mean in one pane with the regime as the strip, from the served arrays', () => {
    const stack = trendStack(TREND_VIEW)!
    expect(stack.t).toEqual(TREND_VIEW.t)
    expect(stack.panes).toHaveLength(1)
    const [pane] = stack.panes
    expect(pane!.series.map((s) => s.values)).toEqual([TREND_VIEW.close, TREND_VIEW.mean_close])
    expect(pane!.series.map((s) => s.name)).toEqual([RCT.trend.chart.closeName, RCT.trend.chart.meanName])
    expect(stack.ribbon.name).toBe(RCT.trend.chart.ribbonName)
    expect(stack.ribbon.values).toHaveLength(TREND_VIEW.t.length)
    expect(stack.title).toBe(RCT.trend.chart.title)
  })

  it('maps above to the high state and below to the low state, a missing regime to nothing, never to mid', () => {
    const stack = trendStack(viewOver(['above', 'below', null, 'below']))!
    expect(stack.ribbon.values).toEqual(['high', 'low', null, 'low'])
    expect(stack.ribbon.states.high).toEqual({ label: RCT.trend.names.above, glyph: 'A' })
    expect(stack.ribbon.states.low).toEqual({ label: RCT.trend.names.below, glyph: 'B' })
    expect(stack.ribbon.values).not.toContain('mid')
    expect(stack.ribbon.missing).toBe(RCT.trend.chart.noRegime)
  })

  it('gives each state its own glyph so no state is told apart by colour alone', () => {
    const glyphs = Object.values(trendStack(TREND_VIEW)!.ribbon.states).map((s) => s.glyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it('born failing: a session dated on or after the fence never reaches the chart', () => {
    const view = viewOver(Array.from({ length: 20 }, () => 'above' as const))
    const stack = trendStack(view)!
    expect(stack.t.every((x) => x < FENCE_SECONDS)).toBe(true)
    expect(stack.t.length).toBeLessThan(view.t.length)
    const lengths = new Set([stack.t.length, stack.ribbon.values.length, ...stack.panes.flatMap((p) => p.series.map((s) => s.values.length))])
    expect(lengths.size).toBe(1)
  })

  it('has no chart for a monthly book or a view with no session', () => {
    expect(trendStack(TREND_MONTHLY)).toBeNull()
    expect(trendStack(viewOver([]))).toBeNull()
  })

  it('keeps a missing close as a gap, not a zero', () => {
    const view = { ...viewOver(['above', 'above', 'above']), close: [15_000, null, 15_002] }
    expect(trendStack(view)!.panes[0]!.series[0]!.values).toEqual([15_000, null, 15_002])
  })

  it('speaks in the regime words at the crosshair and in the table view, never as a volatility regime', () => {
    const stack = trendStack(viewOver(['above', 'above', 'below', 'below', null]))!
    expect(contextReadout(stack.t, 0, undefined, stack.ribbon)).toBe('Trend regime: Above the mean (A)')
    expect(contextReadout(stack.t, 2, undefined, stack.ribbon)).toBe('Trend regime: Below the mean (B)')
    expect(contextReadout(stack.t, 4, undefined, stack.ribbon)).toBe(`Trend regime ${RCT.trend.chart.noRegime}`)
    const [runs] = contextTables(stack.title, stack.t, undefined, stack.ribbon)
    expect(runs!.rows.map((r) => [r.state, r.sessions])).toEqual([[RCT.trend.names.above, 2], [RCT.trend.names.below, 2]])
    expect(JSON.stringify(runs)).not.toMatch(/volatility/i)
  })

  it('offers the regime as a strip over another series own sessions (the market context of EQ and DD)', () => {
    const view = viewOver(['above', 'below', 'above'])
    const t = [view.t[0]!, view.t[1]! + 3600, view.t[2]!]
    const ribbon = trendRibbon(view, t)!
    expect(ribbon.values).toEqual(['high', null, 'high'])
    expect(trendRibbon(TREND_MONTHLY, t)).toBeNull()
    expect(trendRibbon(viewOver([null, null]), t)).toBeNull()
  })

  it('says in words how many sessions of the other series carry a trend label, or why none does', () => {
    const view = viewOver(['above', 'below', 'above'])
    const t = [view.t[0]!, view.t[1]! + 3600, view.t[2]!, view.t[2]! + DAY]
    expect(trendStripLine(view, t)).toBe(`Strip under the time axis: RG2 trend regime of each session; 2 of 4 sessions labelled. ${view.label} [POST HOC]`)
    expect(trendStripLine(TREND_MONTHLY, t)).toBe(`No trend regime is served for this series: ${TREND_MONTHLY.note}`)
    expect(trendStripLine({ ...TREND_MONTHLY, note: null }, t)).toBe(`No trend regime is served for this series: ${RCT.trend.chart.noReason}`)
  })
})

describe('capacity (EX5)', () => {
  it('prints participation as a percentage of the session volume', () => {
    expect(formatParticipation(6.68511859045879e-5)).toBe('0.0067%')
    expect(formatParticipation(null)).toBe(RCT.missing)
    const [row] = capacityRows(RUN_CAPACITY)
    expect(row).toMatchObject({ symbol: 'CL.V.0', sessions: '3', void: '0', maxDate: '2012-01-23' })
    expect(row!.max).toBe(formatParticipation(RUN_CAPACITY.rows[0]!.ratio_max))
  })

  it('lists every instrument with its volume series or none', () => {
    const rows = instrumentRows({ ...RUN_CAPACITY, instruments: [...RUN_CAPACITY.instruments, { instrument: 'RTY.XCME', symbol: null, factor: 1, note: 'not in the futures universe: no volume series' }] })
    expect(rows.at(-1)).toMatchObject({ instrument: 'RTY.XCME', symbol: RCT.capacity.outside })
    expect(rows.length).toBe(RUN_CAPACITY.instruments.length + 1)
  })

  it('keeps the API order of the largest sessions', () => {
    const rows = worstRows(RUN_CAPACITY)
    expect(rows.map((r) => r.date)).toEqual(RUN_CAPACITY.worst.map((w) => w.date))
  })

  it('names the largest participation, or says there is none', () => {
    expect(maxLine(RUN_CAPACITY)).toContain(RUN_CAPACITY.max_symbol ?? '')
    expect(maxLine({ ...RUN_CAPACITY, max_ratio: null, max_symbol: null })).toBe(RCT.capacity.none)
  })
})

describe('term structure (MV6)', () => {
  it('formats the carry as signed percent a year', () => {
    expect(formatCarry(0.0200495)).toBe('+2.00%')
    expect(formatCarry(-0.0312)).toBe('-3.12%')
    expect(formatCarry(null)).toBe(RCT.missing)
  })

  it('draws the carry in percent a year over the front to next spread, on one time axis', () => {
    const stack = termStack(TERM_CL)!
    expect(stack.t).toEqual(TERM_CL.t)
    expect(stack.panes.map((p) => p.id)).toEqual(['carry', 'spread'])
    const [carry, spread] = stack.panes
    expect(carry!.unit).toBe('%')
    expect(carry!.series[0]!.values).toEqual(TERM_CL.carry.map((c) => c * 100))
    expect(spread!.series[0]!.values).toEqual(TERM_CL.spread)
    expect(carry!.zero).toBe('white')
    expect(stack.title).toBe('CL calendar-chain carry and spread')
  })

  it('names the spread pane with the market units', () => {
    expect(termStack(TERM_CL)!.panes[1]!.series[0]!.name).toContain(TERM_CL.units)
  })

  it('born failing: a point dated past the fence never reaches the chart', () => {
    const leaked: TermStructure = {
      ...TERM_CL,
      t: [...TERM_CL.t, Date.UTC(2022, 0, 3) / 1000],
      date: [...TERM_CL.date, '2022-01-03'],
      front: [...TERM_CL.front, 'CLH2022'],
      next: [...TERM_CL.next, 'CLJ2022'],
      spread: [...TERM_CL.spread, 1],
      carry: [...TERM_CL.carry, 0.5],
    }
    const stack = termStack(leaked)!
    expect(stack.t).toEqual(TERM_CL.t)
    expect(stack.panes.every((p) => p.series.every((s) => s.values.length === TERM_CL.t.length))).toBe(true)
    expect(Math.max(...stack.panes[0]!.series[0]!.values.map(Number))).toBeLessThan(50)
  })

  it('born failing: a carry that is not a number is a gap, never a zero', () => {
    const holey = { ...TERM_CL, carry: TERM_CL.carry.map((c, i) => (i === 3 ? Number.NaN : c)) }
    expect(termStack(holey)!.panes[0]!.series[0]!.values[3]).toBeNull()
  })

  it('an empty series has no chart', () => {
    const empty = { ...TERM_CL, t: [], date: [], front: [], next: [], spread: [], carry: [], f1: [], f2: [], expiry_front: [], expiry_next: [] }
    expect(termStack(empty)).toBeNull()
  })

  it('summarises the series and the void sessions in words', () => {
    expect(termSummaryLine(TERM_CL)).toContain('2956 sessions')
    expect(termSummaryLine(TERM_CL)).toContain('+2.00%')
    expect(voidLine(TERM_CL)).toContain(`${TERM_CL.void.thin} thin`)
    expect(termSummaryLine({ ...TERM_CL, summary: { ...TERM_CL.summary, n: 0 } })).toBe(RCT.term.summaryNone)
  })

  it('lists the latest curve rank by rank', () => {
    const rows = curveRows(TERM_CL)
    expect(rows.map((r) => r.rank)).toEqual(['0', '1', '2', '3'])
    expect(rows[0]).toMatchObject({ contract: 'CLG2022', expiry: '2022-01-20', days: '20' })
  })

  it('states how the prices were served', () => {
    expect(gateLine(TERM_CL.gate)).toContain('caller terminal')
    expect(gateLine(null)).toBeNull()
  })
})

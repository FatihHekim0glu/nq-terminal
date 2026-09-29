// REG 95) Compare, the union of times (roadmap #9 phase B). Basis A series that share a unit rarely share
// their times (tom_v0 exits, prefomc_v0 dates, overnight_v0 exit_date and rebal_v0 exit_ts are all USD per
// trade), and a daily book and a monthly one share a unit too. On the union of times each line is mostly
// null, so every series joins its own served points across those nulls (spanGaps), as its EQ line does. The
// values stay the served ones, null where the hypothesis has no row: nothing is carried forward.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { regCompareModel, type RegSeriesInput } from './regCompareModel'

type Body = Schemas['HypothesisSeries']

const U = 'USD per trade, one NQ contract'
const POINTS = 'points per trade (NQ)'

function body(name: string, unit: string, t: number[], equity: number[]): Body {
  return { basis: 'A', bench_label: null, cost: 1, equity, kind: 'trades', name, r: equity.map(() => 0), r_bench: null, source: 'fixture', t, unit }
}

const ok = (name: string, unit: string, t: number[], equity: number[]): RegSeriesInput => ({ name, body: body(name, unit, t, equity), error: null })

describe('regCompareModel: series that share a unit but not their times', () => {
  it('keeps one pane, the union of times and the served values, and joins each line across its nulls', () => {
    const m = regCompareModel([ok('a_v0', U, [100, 300], [1, 3]), ok('b_v0', U, [200, 400], [2, 4])], 1)
    expect(m.panes).toHaveLength(1)
    expect(m.t).toEqual([100, 200, 300, 400])
    expect(m.panes[0]!.series[0]!.values).toEqual([1, null, 3, null])
    expect(m.panes[0]!.series[1]!.values).toEqual([null, 2, null, 4])
    expect(m.panes.flatMap((p) => p.series).map((s) => s.spanGaps)).toEqual([true, true])
  })

  it('shows a monthly hypothesis against a daily one: its own points, joined', () => {
    const day = Array.from({ length: 60 }, (_, i) => 86_400 * i)
    const monthly = [day[0]!, day[30]!, day[59]!]
    const m = regCompareModel([ok('daily_v0', U, day, day.map((_, i) => i)), ok('monthly_v0', U, monthly, [10, 20, 30])], 1)
    expect(m.t).toHaveLength(60)
    const [daily, month] = m.panes[0]!.series
    expect(daily!.values.filter((v) => v !== null)).toHaveLength(60)
    expect(month!.values.filter((v) => v !== null)).toHaveLength(3)
    expect(month!.values.filter((v) => v !== null)).toEqual([10, 20, 30])
    expect(month!.spanGaps).toBe(true)
    expect(daily!.spanGaps).toBe(true)
  })

  it('sets spanGaps on every series of every pane, whatever the unit', () => {
    const m = regCompareModel([ok('a_v0', U, [1, 3], [1, 3]), ok('b_v0', POINTS, [2], [0.5]), ok('c_v0', U, [2], [7])], 1)
    expect(m.panes).toHaveLength(2)
    for (const s of m.panes.flatMap((p) => p.series)) expect(s.spanGaps).toBe(true)
  })
})

describe('regCompareModel: served values only, no statistic in the legend', () => {
  it('turns the single-series legend statistics off on every pane it builds', () => {
    const one = regCompareModel([ok('a_v0', U, [1, 2], [1, 2])], 1)
    expect(one.panes).toHaveLength(1)
    expect(one.panes[0]!.legendStats).toBe(false)
    const many = regCompareModel([ok('a_v0', U, [1, 2], [1, 2]), ok('b_v0', POINTS, [1], [1]), ok('c_v0', U, [3], [3])], 1)
    expect(many.panes).toHaveLength(2)
    for (const p of many.panes) expect(p.legendStats).toBe(false)
  })
})

// REG 95) Compare, the pure model (roadmap #9 phase B, W6-R9b): the served Basis A screen series of the
// marked hypotheses grouped into one pane per unit (C1: two units never share an axis), on the union of
// their times, styled by basket position, with the failed ones listed. Served values only: nothing here
// rescales, cumulates or tests anything.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { COMPARE_STYLES } from '../../charts/LineStack.types'
import { regCompareModel, type RegSeriesInput } from './regCompareModel'

type Body = Schemas['HypothesisSeries']

const POINTS = 'points per trade (NQ)'
const USD = 'USD'

function body(name: string, unit: string, t: number[], equity: number[]): Body {
  return { basis: 'A', bench_label: null, cost: 1, equity, kind: 'trades', name, r: equity.map(() => 0), r_bench: null, source: 'fixture', t, unit }
}

const ok = (name: string, unit: string, t: number[], equity: number[]): RegSeriesInput => ({ name, body: body(name, unit, t, equity), error: null })
const failed = (name: string, error: string): RegSeriesInput => ({ name, body: null, error })
const pending = (name: string): RegSeriesInput => ({ name, body: null, error: null })

describe('regCompareModel: one pane per unit (C1)', () => {
  it('puts two hypotheses of the same unit on one pane, in basket order', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1, 2], [0.5, 1]), ok('b_v0', POINTS, [1, 2], [2, 3])], 1)
    expect(m.panes).toHaveLength(1)
    expect(m.panes[0]!.id).toBe('unit-0')
    expect(m.panes[0]!.series.map((s) => s.name)).toEqual(['a_v0 (1 tick)', 'b_v0 (1 tick)'])
    expect(m.paneUnits).toEqual([POINTS])
    expect(m.paneNames).toEqual([['a_v0', 'b_v0']])
  })

  it('gives two units two panes and never lets a series onto the other unit axis', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1, 2], [0.5, 1]), ok('b_v0', USD, [1, 2], [100, 200]), ok('c_v0', POINTS, [1, 2], [3, 4])], 1)
    expect(m.panes.map((p) => p.id)).toEqual(['unit-0', 'unit-1'])
    expect(m.paneUnits).toEqual([POINTS, USD])
    expect(m.paneNames).toEqual([['a_v0', 'c_v0'], ['b_v0']])
    expect(m.panes[0]!.series.map((s) => s.name)).toEqual(['a_v0 (1 tick)', 'c_v0 (1 tick)'])
    expect(m.panes[1]!.series.map((s) => s.name)).toEqual(['b_v0 (1 tick)'])
  })

  it('orders panes by the first hypothesis of each unit in the basket', () => {
    const m = regCompareModel([ok('b_v0', USD, [1], [1]), ok('a_v0', POINTS, [1], [1])], 1)
    expect(m.paneUnits).toEqual([USD, POINTS])
  })

  it('draws every pane with three decimals and no zero line, and adds no drawdown, log or unit of its own', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1, 2], [0.5, 1])], 1)
    const pane = m.panes[0]!
    expect(pane.decimals).toBe(3)
    expect(pane.zero).toBe('none')
    expect(pane.summaryDrawdown).toBeUndefined()
    expect(pane.logAllowed).toBeUndefined()
    expect(pane.unit).toBeUndefined()
    expect(pane.signed).toBeUndefined()
  })
})

describe('regCompareModel: the union of times', () => {
  it('sorts the union of every time and pads a missing time with null, never with a value', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [10, 30], [1, 3]), ok('b_v0', POINTS, [20, 30, 40], [2, 3.5, 4])], 1)
    expect(m.t).toEqual([10, 20, 30, 40])
    expect(m.panes[0]!.series[0]!.values).toEqual([1, null, 3, null])
    expect(m.panes[0]!.series[1]!.values).toEqual([null, 2, 3.5, 4])
  })

  it('shares the one union across panes of different units', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1, 3], [1, 3]), ok('b_v0', USD, [2], [200])], 1)
    expect(m.t).toEqual([1, 2, 3])
    expect(m.panes[0]!.series[0]!.values).toEqual([1, null, 3])
    expect(m.panes[1]!.series[0]!.values).toEqual([null, 200, null])
  })

  it('keeps a true zero as zero (a gap is null, a zero is a value)', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1, 2, 3], [0, 0, 1]), ok('b_v0', POINTS, [2], [0])], 1)
    expect(m.panes[0]!.series[0]!.values).toEqual([0, 0, 1])
    expect(m.panes[0]!.series[1]!.values).toEqual([null, 0, null])
  })

  it('handles a large basket without changing a value (8 series of 10,000 points)', () => {
    const t = Array.from({ length: 10_000 }, (_, i) => 1_262_304_000 + i * 86_400)
    const inputs = Array.from({ length: 8 }, (_, k) => ok(`h${k}_v0`, POINTS, t, t.map((_, i) => (i + k) * 0.001)))
    const m = regCompareModel(inputs, 1)
    expect(m.t).toHaveLength(10_000)
    expect(m.panes).toHaveLength(1)
    expect(m.panes[0]!.series).toHaveLength(8)
    expect(m.panes[0]!.series[7]!.values[9_999]).toBe(10_006 * 0.001)
  })
})

describe('regCompareModel: styles follow the basket sequence', () => {
  it('gives series i the compare style i', () => {
    const inputs = ['a', 'b', 'c'].map((n) => ok(`${n}_v0`, POINTS, [1], [1]))
    const styles = regCompareModel(inputs, 1).panes[0]!.series.map((s) => s.style)
    expect(styles).toEqual([COMPARE_STYLES[0], COMPARE_STYLES[1], COMPARE_STYLES[2]])
  })

  it('keeps a hypothesis on its own style when another one fails or is still loading', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1], [1]), failed('b_v0', 'not found'), pending('c_v0'), ok('d_v0', POINTS, [1], [2])], 1)
    expect(m.panes[0]!.series.map((s) => s.style)).toEqual([COMPARE_STYLES[0], COMPARE_STYLES[3]])
  })

  it('keeps the style of a hypothesis that sits on a later pane at its basket position', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1], [1]), ok('b_v0', USD, [1], [1])], 1)
    expect(m.panes[1]!.series[0]!.style).toBe(COMPARE_STYLES[1])
  })

  it('cycles the eight styles rather than failing on a longer list', () => {
    const inputs = Array.from({ length: 9 }, (_, k) => ok(`h${k}_v0`, POINTS, [1], [k]))
    const styles = regCompareModel(inputs, 1).panes[0]!.series.map((s) => s.style)
    expect(styles).toHaveLength(9)
    expect(styles[8]).toBe(COMPARE_STYLES[0])
  })
})

describe('regCompareModel: series names', () => {
  it('names each series with the hypothesis and the cost asked for', () => {
    const at = (cost: number) => regCompareModel([ok('volmanaged_v0', POINTS, [1], [1])], cost).panes[0]!.series[0]!.name
    expect(at(1)).toBe('volmanaged_v0 (1 tick)')
    expect(at(0)).toBe('volmanaged_v0 (0 ticks)')
    expect(at(2)).toBe('volmanaged_v0 (2 ticks)')
  })
})

describe('regCompareModel: errors go to the failed list', () => {
  it('lists a hypothesis whose series could not be read, with the API detail, and draws none of it', () => {
    const m = regCompareModel([ok('a_v0', POINTS, [1], [1]), failed('gone_v0', 'unknown name')], 1)
    expect(m.failed).toEqual([{ name: 'gone_v0', detail: 'unknown name' }])
    expect(m.panes[0]!.series.map((s) => s.name)).toEqual(['a_v0 (1 tick)'])
  })

  it('keeps the failed list in basket order', () => {
    const m = regCompareModel([failed('z_v0', 'x'), ok('a_v0', POINTS, [1], [1]), failed('b_v0', 'y')], 1)
    expect(m.failed.map((f) => f.name)).toEqual(['z_v0', 'b_v0'])
  })

  it('draws nothing when every hypothesis failed', () => {
    const m = regCompareModel([failed('a_v0', 'x'), failed('b_v0', 'y')], 1)
    expect(m.t).toEqual([])
    expect(m.panes).toEqual([])
    expect(m.paneUnits).toEqual([])
    expect(m.paneNames).toEqual([])
    expect(m.failed).toHaveLength(2)
  })

  it('does not list a hypothesis that is still loading as failed, and does not draw it', () => {
    const m = regCompareModel([pending('a_v0'), ok('b_v0', POINTS, [1], [1])], 1)
    expect(m.failed).toEqual([])
    expect(m.panes[0]!.series.map((s) => s.name)).toEqual(['b_v0 (1 tick)'])
  })

  it('lets a served body win over an error left from an earlier refetch', () => {
    const both: RegSeriesInput = { name: 'a_v0', body: body('a_v0', POINTS, [1], [1]), error: 'stale failure' }
    const m = regCompareModel([both], 1)
    expect(m.failed).toEqual([])
    expect(m.panes).toHaveLength(1)
  })

  it('returns an empty model for an empty basket', () => {
    expect(regCompareModel([], 1)).toEqual({ t: [], panes: [], failed: [], paneUnits: [], paneNames: [] })
  })
})

describe('regCompareModel: served values unchanged', () => {
  it('passes the served equity through exactly: no rescale, no rounding, no sign change', () => {
    const equity = [0, -1.25, 0.1 + 0.2, 1e-9, -1234.56789012345]
    const m = regCompareModel([ok('a_v0', POINTS, [1, 2, 3, 4, 5], equity)], 1)
    expect(m.panes[0]!.series[0]!.values).toEqual(equity)
    expect(m.panes[0]!.series[0]!.values[2]).toBe(0.30000000000000004)
  })

  it('does not read the per trade r column: the plotted line is the served running sum', () => {
    const b = body('a_v0', POINTS, [1, 2], [1, 3])
    const withR: RegSeriesInput = { name: 'a_v0', body: { ...b, r: [1, 2] }, error: null }
    expect(regCompareModel([withR], 1).panes[0]!.series[0]!.values).toEqual([1, 3])
  })

  it('does not change its inputs', () => {
    const t = Object.freeze([2, 1]) as unknown as number[]
    const equity = Object.freeze([5, 4]) as unknown as number[]
    const input = ok('a_v0', POINTS, t, equity)
    const m = regCompareModel([input], 1)
    expect(m.t).toEqual([1, 2])
    expect(m.panes[0]!.series[0]!.values).toEqual([4, 5])
    expect(t).toEqual([2, 1])
    expect(equity).toEqual([5, 4])
  })
})

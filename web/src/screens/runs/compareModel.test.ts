// The compare view's model (roadmap 9, phase A): the served RunComparison as one LineStack pane. Nothing
// is computed from the curves: the rebased values, the time axis and the stats are the API's own.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { COMPARE_STYLES } from '../../charts/LineStack.types'
import { compareModel, maxDdFall, statsRows } from './compareModel'

type Body = Schemas['RunComparison']
type Series = Schemas['CompareSeries']

function series(runId: string, rebased: Array<number | null>, patch: Partial<Series> = {}): Series {
  return { run_id: runId, is_probe: false, usable: true, source: 'mtm_snapshots', rebased, ...patch }
}

function stats(runId: string, patch: Partial<Schemas['CompareStats']> = {}): Schemas['CompareStats'] {
  return {
    run_id: runId, basis: 'B', n_trades: 4, pnl_total: 100, fees_total: 10, total_return: 0.001, sharpe: 1.5,
    max_drawdown: 0.002, stats_note: null, ...patch,
  }
}

function body(list: Series[], patch: Partial<Body> = {}): Body {
  return {
    t: [100, 200, 300],
    date: ['2020-01-01', '2020-01-02', '2020-01-03'],
    series: list,
    stats: list.map((s) => stats(s.run_id)),
    ...patch,
  }
}

const A = series('run_a', [1, 1.01, 1.02])
const B = series('run_b', [1, null, 0.99], { source: 'realised_trades' })

describe('compareModel: one pane of rebased curves', () => {
  it('draws one pane with the served rebased values, in body order', () => {
    const view = compareModel(body([A, B]))
    expect(view.panes).toHaveLength(1)
    const pane = view.panes[0]!
    expect(pane.id).toBe('rebased')
    expect(pane.series.map((s) => s.values)).toEqual([A.rebased, B.rebased])
    expect(pane.zero).toBe('none')
    expect(pane.decimals).toBe(3)
    expect(pane.unit).toBe('')
  })

  it('has the accessible name describe every run, not only the first (a pane of peers)', () => {
    expect(compareModel(body([A, B])).panes[0]?.summaryAll).toBe(true)
  })

  it('gives the lines COMPARE_STYLES in sequence', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const view = compareModel(body(ids.map((id) => series(id, [1, 1, 1]))))
    expect(view.panes[0]?.series.map((s) => s.style)).toEqual([...COMPARE_STYLES])
  })

  it('names each line with its run and where its curve comes from', () => {
    const names = compareModel(body([A, B])).panes[0]?.series.map((s) => s.name)
    expect(names).toEqual(['run_a (marked to market)', 'run_b (realised trades)'])
  })

  it('passes the served time axis through unchanged', () => {
    const b = body([A, B])
    expect(compareModel(b).t).toBe(b.t)
  })
})

describe('compareModel: runs that cannot be drawn', () => {
  it('leaves an unusable series out of the pane, lists it as undrawn, and keeps the styles contiguous', () => {
    const bad = series('run_bad', [null, null, null], { usable: false })
    const view = compareModel(body([A, bad, B]))
    expect(view.undrawn).toEqual(['run_bad'])
    expect(view.panes[0]?.series.map((s) => [s.name, s.style])).toEqual([
      ['run_a (marked to market)', 'compare1'],
      ['run_b (realised trades)', 'compare2'],
    ])
  })

  it('has no undrawn ids when every series is usable', () => {
    expect(compareModel(body([A, B])).undrawn).toEqual([])
  })

  it('has no pane at all when no series is usable', () => {
    const view = compareModel(body([series('x', [null, null, null], { usable: false }), series('y', [null, null, null], { usable: false })]))
    expect(view.panes).toEqual([])
    expect(view.undrawn).toEqual(['x', 'y'])
  })

  it('reads an empty body without failing', () => {
    const view = compareModel({ t: [], date: [], series: [], stats: [] })
    expect(view).toEqual({ t: [], panes: [], stats: [], undrawn: [] })
  })
})

describe('compareModel: the log toggle', () => {
  it('allows log when every finite value is above zero, gaps ignored', () => {
    expect(compareModel(body([A, B])).panes[0]?.logAllowed).toBe(true)
  })

  it('refuses log when any finite value is zero or below', () => {
    expect(compareModel(body([A, series('z', [1, 0, 0.5])])).panes[0]?.logAllowed).toBe(false)
    expect(compareModel(body([A, series('n', [1, -0.2, 0.5])])).panes[0]?.logAllowed).toBe(false)
  })

  it('treats NaN and infinities as gaps, as the chart does', () => {
    expect(compareModel(body([A, series('g', [1, Number.NaN, Number.POSITIVE_INFINITY])])).panes[0]?.logAllowed).toBe(true)
  })
})

describe('compareModel: the stats are the served ones', () => {
  it('hands the served stats through verbatim (the same array, no recomputation)', () => {
    const odd = [stats('run_a', { total_return: 0.123456789, sharpe: null }), stats('run_b', { stats_note: 'a note' })]
    const b = body([A, B], { stats: odd })
    expect(compareModel(b).stats).toBe(b.stats)
    expect(compareModel(b).stats).toEqual(odd)
  })
})

describe('maxDdFall', () => {
  it('shows the API depth as a fall, the sign RUNS and the tear sheet use', () => {
    expect(maxDdFall(stats('a', { max_drawdown: 0.25 }))).toBe(-0.25)
    expect(maxDdFall(stats('a', { max_drawdown: -0.25 }))).toBe(-0.25)
  })

  it('keeps a missing depth missing', () => {
    expect(maxDdFall(stats('a', { max_drawdown: null }))).toBeNull()
  })
})

describe('statsRows', () => {
  it('pairs each served stats entry with the words for its curve source, in body order', () => {
    const b = body([A, B])
    const rows = statsRows(b)
    expect(rows.map((r) => [r.stats.run_id, r.source])).toEqual([['run_a', 'marked to market'], ['run_b', 'realised trades']])
    expect(rows[0]?.stats).toBe(b.stats[0])
    expect(rows[1]?.stats).toBe(b.stats[1])
  })

  it('leaves the source empty for stats without a series, and keeps unusable runs listed', () => {
    const b = body([A], { stats: [stats('run_a'), stats('run_x', { stats_note: 'why' })] })
    expect(statsRows(b).map((r) => r.source)).toEqual(['marked to market', ''])
  })
})

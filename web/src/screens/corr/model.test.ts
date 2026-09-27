// CORR model (TASKS 7.2, look spec 7.8, ANALYTICS MV5): the matrix in the API's clustered order (or by
// sector), values untouched, the pair defaults and the rolling pair series kept inside the fence.
import { describe, expect, it } from 'vitest'
import { makeUniverse } from '../mon/testUniverse'
import {
  FENCE_T,
  corrHeatmapInput,
  defaultPair,
  matrixEntry,
  pairSeries,
  rootOf,
  matrixCsv,
  sectorOrder,
} from './model'

describe('corrHeatmapInput', () => {
  const u = makeUniverse()
  const roots = u.correlation_window.symbols.map(rootOf)

  it('draws the window matrix in the API cluster order, values as served', () => {
    const input = corrHeatmapInput(u, 'window', 'clustered')
    const order = u.correlation_window.order
    expect(input.kind).toBe('corr')
    expect(input.rows).toEqual(order.map((i) => roots[i]))
    expect(input.columns).toEqual(input.rows)
    for (let r = 0; r < order.length; r++) {
      for (let c = 0; c < order.length; c++) {
        expect(input.values[r]![c]).toBe(u.correlation_window.matrix[order[r]!]![order[c]!])
      }
    }
    expect(input.decimals).toBe(2)
    expect(input.name).toBe('27F correlation, last 252 sessions, clustered order')
  })

  it('draws the full-sample matrix in its own cluster order', () => {
    const input = corrHeatmapInput(u, 'full', 'clustered')
    const order = u.correlation_full.order
    expect(input.rows).toEqual(order.map((i) => roots[i]))
    expect(input.values[2]![5]).toBe(u.correlation_full.matrix[order[2]!]![order[5]!])
    expect(input.name).toBe('27F correlation, full sample to 2021-12-31, clustered order')
  })

  it('draws the matrix by sector when asked, equity first', () => {
    const input = corrHeatmapInput(u, 'window', 'sector')
    expect(input.rows.slice(0, 4)).toEqual(['ES', 'NQ', 'YM', 'ZT'])
    expect(input.rows.at(-1)).toBe('HE')
    expect(input.values[0]![1]).toBe(0.17036571349116403)
  })

  it('heads each sector run of columns in sector order (look spec 7.8), and none in the clustered order', () => {
    const input = corrHeatmapInput(u, 'window', 'sector')
    expect(input.columnGroups?.slice(0, 2)).toEqual([{ label: 'Equity', from: 0, to: 2 }, { label: 'Rates', from: 3, to: 6 }])
    expect(input.columnGroups?.at(-1)).toEqual({ label: 'Livestock', from: 25, to: 26 })
    expect(corrHeatmapInput(u, 'window', 'clustered').columnGroups).toBeUndefined()
  })

  it('saves the shown matrix as CSV in its order, every value as the API sent it', () => {
    const input = corrHeatmapInput(u, 'window', 'sector')
    const lines = matrixCsv(input).split('\r\n')
    expect(lines[0]).toBe(['symbol', ...input.columns].join(','))
    expect(lines).toHaveLength(28)
    expect(lines[1]!.split(',')[2]).toBe(String(input.values[0]![1]))
  })

  it('refuses an order that is not a permutation of the symbols', () => {
    const bad = { ...u, correlation_window: { ...u.correlation_window, order: [0, 0, 1] } }
    expect(() => corrHeatmapInput(bad, 'window', 'clustered')).toThrow(/order/)
  })
})

describe('sectorOrder', () => {
  it('keeps the API order inside each sector', () => {
    const u = makeUniverse()
    const order = sectorOrder(u.correlation_window.symbols, u.rows)
    expect(order.slice(0, 3)).toEqual([0, 1, 2])
    expect(new Set(order).size).toBe(27)
  })
})

describe('pairs', () => {
  const u = makeUniverse()

  it('defaults to NQ against ZN', () => {
    expect(defaultPair(u.correlation_window.symbols)).toEqual(['NQ.V.0', 'ZN.V.0'])
    expect(defaultPair(['A.V.0', 'B.V.0'])).toEqual(['A.V.0', 'B.V.0'])
  })

  it('reads a matrix entry by symbol', () => {
    expect(matrixEntry(u.correlation_window, 'ES.V.0', 'NQ.V.0')).toBe(0.17036571349116403)
    expect(matrixEntry(u.correlation_window, 'ES.V.0', 'XX.V.0')).toBeNull()
  })

  it('keeps the served points before the fence and counts any past it', () => {
    const t = [FENCE_T - 2 * 86_400, FENCE_T - 86_400, FENCE_T]
    const s = pairSeries({ t, corr: [0.1, null, 0.3], date: ['2021-12-30', '2021-12-31', '2022-01-01'] })
    expect(s.t).toEqual(t.slice(0, 2))
    expect(s.values).toEqual([0.1, null])
    expect(s.fenced).toBe(1)
    expect(s.last).toEqual({ value: 0.1, date: '2021-12-30' })
  })

  it('has no last value when every point is empty', () => {
    expect(pairSeries({ t: [1, 2], corr: [null, null], date: ['a', 'b'] }).last).toBeNull()
  })
})

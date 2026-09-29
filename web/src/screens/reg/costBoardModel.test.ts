// costBoardModel (93) Cost survival, look spec 7.2, roadmap #5), pinned on the real research fixtures
// (regFixtures.ts, des/desTestData.ts): one tile per served cost ladder (EX4), each on its own stated
// scale including 0, sorted by served break-even (furthest first, nulls last), with a missing list for
// rows without a ladder. Every printed number is the screen JSON's own; only the sort order, the
// scale and the marker position are computed here.
import { describe, expect, it } from 'vitest'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import { buildRegRows } from './regModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import { buildCostBoard, type CostBoardView, type CostTile } from './costBoardModel'
import type { HypothesisDetails } from './useHypothesisDetails'

const REG_ROWS = buildRegRows(REGISTRY, HYPOTHESES)

const DETAILS: HypothesisDetails = {
  byName: new Map([
    ['overnight_v0', OVERNIGHT],
    ['volmanaged_v0', VOLMANAGED],
    ['rebal_v0', REBAL],
    ['za_v0', ZA],
    ['za_v0_C3_gao_momentum', ZA_C3],
  ]),
  failed: new Map([['tom_v0', 'not found']]),
  pending: 0,
}

function build(details: HypothesisDetails = DETAILS): CostBoardView {
  return buildCostBoard(REG_ROWS, details)
}

function tileOf(view: CostBoardView, name: string): CostTile {
  const tile = view.tiles.find((t) => t.name === name)
  if (!tile) throw new Error(`no tile ${name}`)
  return tile
}

describe('buildCostBoard', () => {
  it('sorts tiles by served break-even descending, nulls last, then name: volmanaged_v0 first, za_v0 last', () => {
    const view = build()
    expect(view.tiles.map((t) => t.name)).toEqual(['volmanaged_v0', 'overnight_v0', 'rebal_v0', 'za_v0'])
  })

  it('numbers tiles 1..N in the sorted (served) order, from 1', () => {
    const view = build()
    expect(view.tiles.map((t) => t.n)).toEqual([1, 2, 3, 4])
  })

  it("volmanaged_v0's scale includes 0, and each rung prints its signed value", () => {
    const tile = tileOf(build(), 'volmanaged_v0')
    expect(tile.scale.min).toBe(0)
    expect(tile.scale.max).toBeCloseTo(3.5251418696179626, 9)
    expect(tile.rungs.map((r) => r.text)).toEqual(['+3.53', '+3.47', '+3.42'])
    expect(tile.rungs.map((r) => r.ticks)).toEqual([0, 1, 2])
  })

  it("volmanaged_v0's break-even is recorded (66.11) but sits beyond the drawn ladder, so the marker is not drawn", () => {
    const tile = tileOf(build(), 'volmanaged_v0')
    expect(tile.breakEven).toBe(66.10675789415836)
    expect(tile.breakEvenAt).toBeNull()
    expect(tile.breakEvenText).toContain('beyond the ladder')
  })

  it('za_v0 has a scale that spans a negative and a positive rung, and no recorded break-even', () => {
    const tile = tileOf(build(), 'za_v0')
    expect(tile.scale.min).toBeLessThan(0)
    expect(tile.scale.max).toBeGreaterThan(0)
    expect(tile.breakEven).toBeNull()
    expect(tile.breakEvenAt).toBeNull()
  })

  it('overnight_v0 and rebal_v0 both carry no recorded break-even', () => {
    const view = build()
    expect(tileOf(view, 'overnight_v0').breakEven).toBeNull()
    expect(tileOf(view, 'rebal_v0').breakEven).toBeNull()
  })

  it('falls back to a -1 to 1 scale when every rung (and 0) is the same value', () => {
    const flatDetails: HypothesisDetails = {
      byName: new Map([
        ['flat_v0', {
          card: HYPOTHESES[0]!,
          des: { basis: 'A', blocks: [], blocks_unit: null, cost_ladder: [{ ticks_per_side: 0, value: 0 }], cost_ladder_unit: 'pts', break_even_ticks_per_side: null },
          screen: { name: 'flat_v0' },
          spec: null,
          auxiliaries: {},
          history: [],
          summary_name: null,
          summary_md: null,
        }],
      ]),
      failed: new Map(),
      pending: 0,
    }
    const flatRow = { ...REG_ROWS[0]!, name: 'flat_v0' }
    const view = buildCostBoard([flatRow], flatDetails)
    expect(view.tiles).toHaveLength(1)
    expect(view.tiles[0]!.scale).toEqual({ min: -1, max: 1 })
  })

  it('lists a row whose detail loaded but recorded no cost ladder as missing, reason none', () => {
    const view = build()
    expect(view.missing).toContainEqual({ name: 'za_v0_C3_gao_momentum', reason: 'none', detail: null })
  })

  it('lists a row whose detail failed as missing, reason failed, with the failure text', () => {
    const view = build()
    expect(view.missing).toContainEqual({ name: 'tom_v0', reason: 'failed', detail: 'not found' })
  })

  it('lists every other row as missing, reason pending, while nothing has been read yet', () => {
    const details: HypothesisDetails = { byName: new Map(), failed: new Map(), pending: REG_ROWS.length }
    const view = buildCostBoard(REG_ROWS, details)
    expect(view.tiles).toEqual([])
    expect(view.missing).toHaveLength(REG_ROWS.length)
    expect(view.missing.every((m) => m.reason === 'pending' && m.detail === null)).toBe(true)
  })

  it('states its own summary label, naming the tile count and the count without a ladder (reason none only)', () => {
    const view = build()
    const none = view.missing.filter((m) => m.reason === 'none').length
    expect(none).toBeLessThan(view.missing.length)
    expect(view.label).toContain(`${view.tiles.length}`)
    expect(view.label).toContain(`${none}`)
  })

  it('builds one table row per tile per rung, at the printed precision, with the row-owning name repeated', () => {
    const view = build()
    const rows = view.table.rows.filter((r) => r.name === 'volmanaged_v0')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: 'volmanaged_v0', ticks: 0, value: '+3.53' })
    expect(view.table.columns.map((c) => c.key)).toEqual(['name', 'ticks', 'value', 'unit', 'breakEven'])
  })

  it('born failing: every tile carries a unit and a scale that includes both bounds finite', () => {
    for (const tile of build().tiles) {
      expect(Number.isFinite(tile.scale.min)).toBe(true)
      expect(Number.isFinite(tile.scale.max)).toBe(true)
      expect(tile.scale.min).toBeLessThanOrEqual(0)
      expect(tile.scale.max).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('buildCostBoard: view.status (mirrors evidenceModel.detailStatus)', () => {
  it('is null once nothing is pending or failed', () => {
    const details: HypothesisDetails = { ...DETAILS, failed: new Map() }
    const rows = REG_ROWS.filter((r) => details.byName.has(r.name))
    expect(buildCostBoard(rows, details).status).toBeNull()
  })

  it('is reading while anything is pending, even alongside a failure', () => {
    const details: HypothesisDetails = { byName: new Map(), failed: new Map([['tom_v0', 'not found']]), pending: 2 }
    const view = buildCostBoard(REG_ROWS, details)
    expect(view.status).toEqual({ kind: 'reading', n: REG_ROWS.length - 1 })
  })

  it('is the first failure once nothing is pending', () => {
    const rows = [...REG_ROWS.filter((r) => DETAILS.byName.has(r.name)), { ...REG_ROWS[0]!, name: 'tom_v0' }]
    const view = buildCostBoard(rows, DETAILS)
    expect(view.status).toEqual({ kind: 'failed', n: 1, name: 'tom_v0', detail: 'not found' })
  })
})

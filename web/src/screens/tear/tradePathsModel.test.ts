import { describe, expect, it } from 'vitest'
import { TRADE_PATHS } from '../../copy/tradePaths'
import { excursionInputs, holdingLadder, holdingRows, offBasisNote, streakRows } from './tradePathsModel'
import { EXCURSIONS, EXCURSIONS_DAILY, EXCURSIONS_ON_BASIS as ON_BASIS, TRADE_PATHS as PATHS } from './tearP1.fixtures'

describe('TA2 MAE and MFE', () => {
  it('scatters MAE and MFE against the final result, in R when every trade has one, a loss hollow', () => {
    const view = excursionInputs(ON_BASIS, 'nt_za_v0_fixture_a')
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.unit).toBe('R')
    const [mae, mfe] = view.charts
    expect(mae!.points).toHaveLength(ON_BASIS.n)
    const first = ON_BASIS.rows[0]!
    expect(mae!.points[0]).toEqual({ x: first.final_r, y: first.mae_r, hollow: !first.win, label: first.entry_ts })
    expect(mfe!.points[0]!.y).toBe(first.mfe_r)
    expect(mae!.kinds).toEqual({ solid: TRADE_PATHS.win, hollow: TRADE_PATHS.loss })
    expect(mae!.x.unit).toBe('R')
  })

  it('falls back to points from the entry fill when some trade has no R', () => {
    const rows = ON_BASIS.rows.map((r, i) => (i === 0 ? { ...r, mae_r: null, mfe_r: null, final_r: null } : r))
    const view = excursionInputs({ ...ON_BASIS, rows, in_r: ON_BASIS.n - 1 }, 'x')
    if (view.kind !== 'ok') throw new Error(view.kind)
    expect(view.unit).toBe('pts')
    expect(view.charts[0]!.points[0]).toMatchObject({ x: rows[0]!.final_pts, y: rows[0]!.mae_pts })
  })

  it('says why bars on another price basis are refused, with the counts (the fixture serve, born failing)', () => {
    // the fixture serve's synthetic bars sit near 2480 and the fills near 5790: MAE of thousands of points once
    expect(EXCURSIONS.available).toBe(false)
    expect(EXCURSIONS.off_basis).toBe(EXCURSIONS.basis_checked)
    const view = excursionInputs(EXCURSIONS, 'nt_za_v0_fixture_a')
    expect(view).toEqual({ kind: 'none', text: EXCURSIONS.note })
    expect(EXCURSIONS.note).toContain('another price basis')
  })

  it('counts the few trades whose fills lie off their bars when the view is shown', () => {
    expect(offBasisNote(ON_BASIS)).toBeNull()
    expect(offBasisNote({ ...ON_BASIS, off_basis: 1 })).toBe(
      '1 of 6 trades has a fill outside the 1-minute bars it could have happened in (more than one tick away); its MAE and MFE may be on another price basis.',
    )
    expect(offBasisNote({ ...ON_BASIS, off_basis: 2 })).toBe(
      '2 of 6 trades have a fill outside the 1-minute bars they could have happened in (more than one tick away); their MAE and MFE may be on another price basis.',
    )
  })

  it('says why a daily run has none', () => {
    expect(excursionInputs(EXCURSIONS_DAILY, 'nt_dtsmom_v0_fixture_ts1')).toEqual({ kind: 'none', text: EXCURSIONS_DAILY.note })
  })
})

describe('TA4 holding times', () => {
  it('draws the Sturges bins on log minutes as labelled bars with their counts', () => {
    const ladder = holdingLadder(PATHS, 'nt_za_v0_fixture_a')
    expect(ladder.bars.map((b) => [b.label, b.value])).toEqual([
      ['3 to 10 min', 2], ['10 to 34 min', 0], ['34 to 114 min', 2], ['114 to 385 min', 2],
    ])
  })

  it('groups thousands in the range row as in the other holding rows (born failing: 1050.0 to 1050.0)', () => {
    const long = { ...PATHS, holding: { ...PATHS.holding, min: 1050, max: 30240, median: 1050 } }
    const rows = Object.fromEntries(holdingRows(long).map((r) => [r.id, r.value]))
    expect(rows.median).toBe('1,050.0 min')
    expect(rows.range).toBe('1,050.0 to 30,240.0 min')
  })

  it('lists the median, mean and range, and counts zero durations apart', () => {
    expect(holdingRows(PATHS).map((r) => [r.id, r.value])).toEqual([
      ['n', '6'], ['zero', '0'], ['median', '44.5 min'], ['mean', '144.3 min'], ['p5', '3.3 min'], ['p95', '385.0 min'], ['range', '3.0 to 385.0 min'],
    ])
  })
})

describe('TA5 streaks', () => {
  it('gives the longest runs and the runs test on the whole list, with its p-value', () => {
    expect(streakRows(PATHS).map((r) => [r.id, r.value])).toEqual([
      ['longestWin', '1'], ['longestLoss', '1'], ['wins', '3'], ['losses', '3'], ['runs', '6'], ['expected', '4.00'], ['z', '1.83'], ['p', '0.0679'],
    ])
  })
})

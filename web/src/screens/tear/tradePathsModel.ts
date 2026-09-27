// A run's trade paths on its tear sheet (ANALYTICS_CATALOG TA2, TA4, TA5). Pure functions over
// GET /api/analytics/run/{id}/excursions and /trade-paths: MAE and MFE against the final result (in R when every
// trade has one, else points from the entry fill; a losing trade hollow), the holding-time bins as labelled
// bars, and the streaks with the runs test on the whole trade list (never a slice the user picked).
import type { Schemas } from '../../api/types'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { formatP } from '../../charts/echarts/format'
import type { XyScatterInput } from '../../charts/echarts/xyScatterModel'
import { TRADE_PATHS as T } from '../../copy/tradePaths'
import { fillCopy } from '../../copy/workspace'
import type { KeyValueRow } from './tearP1Model'
import { formatNumber } from './tearFormat'

export type RunExcursions = Schemas['RunExcursions']
export type RunTradePaths = Schemas['RunTradePaths']

export type ExcursionView =
  | { readonly kind: 'none'; readonly text: string }
  | { readonly kind: 'ok'; readonly unit: string; readonly charts: readonly [XyScatterInput, XyScatterInput] }

export function excursionInputs(exc: RunExcursions, name: string): ExcursionView {
  if (!exc.available || exc.rows.length === 0) return { kind: 'none', text: exc.note ?? T.failed }
  const inR = exc.in_r === exc.n && exc.rows.every((r) => r.final_r !== null && r.mae_r !== null && r.mfe_r !== null)
  const unit = inR ? T.unitR : T.unitPts
  const pick = (r: RunExcursions['rows'][number], which: 'mae' | 'mfe') => ({
    x: (inR ? r.final_r : r.final_pts) as number,
    y: (inR ? r[`${which}_r`] : r[`${which}_pts`]) as number,
    hollow: !r.win,
    label: r.entry_ts,
  })
  const chart = (which: 'mae' | 'mfe'): XyScatterInput => ({
    name: fillCopy(which === 'mae' ? T.maeName : T.mfeName, { name }),
    x: { label: T.final, unit, decimals: 2 },
    y: { label: which === 'mae' ? T.mae : T.mfe, unit, decimals: 2 },
    points: exc.rows.map((r) => pick(r, which)),
    kinds: { solid: T.win, hollow: T.loss },
  })
  return { kind: 'ok', unit, charts: [chart('mae'), chart('mfe')] }
}

/** The count of shown trades whose fills lie off their bars (the API refuses the view above 5%); null when none. */
export function offBasisNote(exc: RunExcursions): string | null {
  if (!exc.available || exc.off_basis === 0) return null
  const words = { n: formatNumber(exc.off_basis, 0, { thousands: true }), checked: formatNumber(exc.basis_checked, 0, { thousands: true }) }
  return fillCopy(exc.off_basis === 1 ? T.offBasisOne : T.offBasisMany, words)
}

export function holdingLadder(paths: RunTradePaths, name: string): BarLadderInput {
  const h = paths.holding
  return {
    name: fillCopy(T.holdingName, { name }),
    decimals: 0,
    bars: h.counts.map((count, i) => ({
      label: fillCopy(T.holdingBin, { lo: formatNumber(h.edges[i], 0, { thousands: true }), hi: formatNumber(h.edges[i + 1], 0, { thousands: true }) }),
      value: count,
    })),
  }
}

const minutes = (v: number | null) => (v === null ? '--' : fillCopy(T.minutes, { value: formatNumber(v, 1, { thousands: true }) }))

export function holdingRows(paths: RunTradePaths): KeyValueRow[] {
  const h = paths.holding
  const R = T.rows
  return [
    { id: 'n', label: R.n, value: formatNumber(h.n, 0, { thousands: true }) },
    { id: 'zero', label: R.zero, value: formatNumber(h.zero, 0, { thousands: true }) },
    { id: 'median', label: R.median, value: minutes(h.median) },
    { id: 'mean', label: R.mean, value: minutes(h.mean) },
    { id: 'p5', label: R.p5, value: minutes(h.p5) },
    { id: 'p95', label: R.p95, value: minutes(h.p95) },
    { id: 'range', label: R.range, value: h.min === null || h.max === null ? '--' : fillCopy(T.range, { lo: formatNumber(h.min, 1, { thousands: true }), hi: formatNumber(h.max, 1, { thousands: true }) }) },
  ]
}

export function streakRows(paths: RunTradePaths): KeyValueRow[] {
  const s = paths.streaks
  const t = s.runs_test
  const R = T.rows
  return [
    { id: 'longestWin', label: R.longestWin, value: formatNumber(s.longest_win, 0) },
    { id: 'longestLoss', label: R.longestLoss, value: formatNumber(s.longest_loss, 0) },
    { id: 'wins', label: R.wins, value: formatNumber(t.wins, 0, { thousands: true }) },
    { id: 'losses', label: R.losses, value: formatNumber(t.losses, 0, { thousands: true }) },
    { id: 'runs', label: R.runs, value: formatNumber(t.runs, 0, { thousands: true }) },
    { id: 'expected', label: R.expected, value: formatNumber(t.expected, 2) },
    { id: 'z', label: R.z, value: formatNumber(t.z, 2) },
    { id: 'p', label: R.p, value: typeof t.p === 'number' && Number.isFinite(t.p) ? formatP(t.p) : '--' },
  ]
}

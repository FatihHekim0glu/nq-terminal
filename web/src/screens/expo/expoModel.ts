// EXPO (TASKS 9.4; ANALYTICS_CATALOG EX1 and EX2): a run's exposure and turnover as the API sends them.
// The summary rows are the API's own means (the same figures as the run books' exposure card); the
// per-session rows pair each session's gross and net exposure with that session's turnover by date.
// Nothing is summed or averaged here. Pure.
import type { Schemas } from '../../api/types'
import { toCsv } from '../../chrome/exportCsv'
import { EXPO } from '../../copy/books'
import { decimalsFor } from '../des/desModel'
import { formatNumber } from '../tear/tearFormat'

export type RunExposure = Schemas['RunExposure']

export interface SummaryRow {
  readonly id: string
  readonly label: string
  readonly value: string
}

export interface SessionRow {
  readonly date: string
  readonly gross: number | null
  readonly net: number | null
  readonly turnover: number | null
}

/** Two significant figures below 1 (0.0152 prints 0.015), two decimals from 1 up: the DES number rule. */
const sig = (v: number | null | undefined) => formatNumber(v, decimalsFor([v ?? null]))

export function summaryRows(view: RunExposure): SummaryRow[] {
  const e = view.exposure
  const t = view.turnover
  if (!e) return []
  const R = EXPO.rows
  const rows: SummaryRow[] = [
    { id: 'meanGross', label: R.meanGross, value: sig(e.mean_gross) },
    { id: 'meanNet', label: R.meanNet, value: sig(e.mean_net) },
    { id: 'sessions', label: R.sessions, value: formatNumber(e.date.length, 0, { thousands: true }) },
  ]
  if (!t) return rows
  return [
    ...rows,
    { id: 'meanTurnover', label: R.meanTurnover, value: sig(t.mean_daily) },
    { id: 'annualTurnover', label: R.annualTurnover, value: sig(t.annualised) },
    { id: 'periods', label: R.periods, value: formatNumber(t.periods, 0) },
  ]
}

/** One row per exposure session, newest first, with the turnover of the same date (null where none). */
export function sessionRows(view: RunExposure): SessionRow[] {
  const e = view.exposure
  if (!e) return []
  const turnover = new Map<string, number | null>()
  view.turnover?.date.forEach((d, i) => turnover.set(d, view.turnover?.daily[i] ?? null))
  const rows = e.date.map((date, i) => ({ date, gross: e.gross[i] ?? null, net: e.net[i] ?? null, turnover: turnover.get(date) ?? null }))
  return rows.reverse()
}

export function exposureCsv(view: RunExposure): { readonly csv: string; readonly rows: number } {
  const rows = sessionRows(view)
  const C = EXPO.cols
  return { csv: toCsv([C.date, C.gross, C.net, C.turnover], rows.map((r) => [r.date, r.gross, r.net, r.turnover])), rows: rows.length }
}

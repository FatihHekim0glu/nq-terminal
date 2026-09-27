// LEDG columns (look spec 7.9: `Date  Run id  Strategy  Trades  Net P&L  Sharpe  Balance  Anchor pair`,
// plus exp id, variant, window, fees, hit rate, t and the result.json match). Dates carry a weekday in
// muted grey; the balance shows colour and text; the anchor pair shows its verdict.
import type { MonitorColumn } from '../../grids/MonitorGrid'
import { fillCopy } from '../../copy/workspace'
import { balanceBadge, formatCount, formatFraction, formatRatio, formatUsd, signTone } from '../runs/model'
import { LEDG } from '../../copy/ledg'
import { weekdayDate, type AnchorPair, type LedgerRow } from './model'

const C = LEDG.cols

function DateCell({ ts }: { readonly ts: string | null }) {
  const text = weekdayDate(ts)
  const [day, date] = text.includes(' ') ? text.split(' ') : ['', text]
  return day ? (
    <>
      <span className="ledg-weekday">{day}</span> {date}
    </>
  ) : (
    <>{text}</>
  )
}

function balanceOk(r: LedgerRow): boolean | null {
  if (r.balance_check === 'OK') return true
  if (r.balance_check === null || r.balance_check === '') return null
  return false
}

function matchText(r: LedgerRow): string {
  if (!r.run_found) return LEDG.runMissing
  if (r.matches_result === true) return LEDG.yes
  if (r.matches_result === false) return LEDG.no
  return '--'
}

function rowColumns(): MonitorColumn<LedgerRow>[] {
  return [
    { id: 'date', header: C.date, width: 124, kind: 'text', value: (r) => r.ts_utc, format: (r) => weekdayDate(r.ts_utc), render: (r) => <DateCell ts={r.ts_utc} /> },
    { id: 'run', header: C.runId, width: 250, kind: 'name', value: (r) => r.run_id },
    { id: 'exp', header: C.expId, width: 190, kind: 'text', value: (r) => r.exp_id },
    { id: 'strategy', header: C.strategy, width: 100, kind: 'text', value: (r) => r.strategy },
    { id: 'variant', header: C.variant, width: 78, kind: 'text', value: (r) => r.variant },
    {
      id: 'window', header: C.window, width: 190, kind: 'text', value: (r) => r.start,
      format: (r) => (r.start && r.end ? fillCopy(LEDG.window, { start: r.start, end: r.end }) : '--'),
    },
    { id: 'trades', header: C.trades, width: 64, kind: 'num', value: (r) => r.n_trades, format: (r) => formatCount(r.n_trades) },
    { id: 'pnl', header: C.pnl, width: 116, kind: 'num', value: (r) => r.pnl_total, format: (r) => formatUsd(r.pnl_total, true), tone: (r) => signTone(r.pnl_total) },
    { id: 'fees', header: C.fees, width: 92, kind: 'num', value: (r) => r.fees_total, format: (r) => formatUsd(r.fees_total) },
    { id: 'hit', header: C.hitRate, width: 70, kind: 'num', value: (r) => r.hit_rate, format: (r) => formatFraction(r.hit_rate, 1) },
    { id: 't', header: C.tNetR, width: 76, kind: 'num', value: (r) => r.t_net_r, format: (r) => formatRatio(r.t_net_r) },
  ]
}

function checkColumns(anchors: ReadonlyMap<string, AnchorPair>): MonitorColumn<LedgerRow>[] {
  const verdict = (r: LedgerRow) => anchors.get(r.run_id)?.verdict ?? null
  return [
    { id: 'balance', header: C.balance, width: 116, kind: 'text', value: (r) => balanceBadge(balanceOk(r)).text, tone: (r) => balanceBadge(balanceOk(r)).tone },
    { id: 'matches', header: C.matches, width: 150, kind: 'text', value: matchText, tone: (r) => (r.matches_result === false || !r.run_found ? 'down' : undefined) },
    { id: 'anchor', header: C.anchor, width: 140, kind: 'text', value: verdict, tone: (r) => (verdict(r) === 'IDENTICAL' ? 'up' : verdict(r) === 'DIFFERENT' ? 'down' : undefined) },
  ]
}

/** The columns a panel narrower than the full ledger drops (look spec 7.9 keeps the rest). */
const WIDE_ONLY: ReadonlySet<string> = new Set(['exp', 'variant', 'window', 'fees'])

/**
 * Keep the result stable per anchor map: MonitorGrid rebuilds its model when the array changes.
 * `compact` drops the exp id, variant, window and fees columns, so a 1366px panel has no sideways scroll.
 */
export function ledgerColumns(anchors: ReadonlyMap<string, AnchorPair>, compact = false): MonitorColumn<LedgerRow>[] {
  const all = [...rowColumns(), ...checkColumns(anchors)]
  return compact ? all.filter((c) => !WIDE_ONLY.has(c.id)) : all
}

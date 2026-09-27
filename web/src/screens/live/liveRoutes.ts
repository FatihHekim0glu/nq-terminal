// LIVE's Routes and Fills sections and footer strip (look spec 7.11, EMSX blotter layout; ANALYTICS_CATALOG
// LV1). Pure functions over GET /api/live/routes: one route per journal close row (its status, side and
// quantities), the fills the book counted, and the API's totals over performance rows only. A plumbing
// row keeps the API's banner text; the footer names the plumbing rows apart and never adds them in.
// Read only: the terminal has no order path; these are the journal's own records.
import type { Schemas } from '../../api/types'
import { LIVE } from '../../copy/live'
import { fillCopy } from '../../copy/workspace'
import type { StateItem } from './liveModel'

export type LiveRoutes = Schemas['LiveRoutes']
type Route = Schemas['LiveRouteRow']
type Fill = Schemas['LiveFillRow']
type Side = 'BUY' | 'SELL'

const PX_DECIMALS = 2
const SLIP_DECIMALS = 1
const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const fixed = (v: number | null | undefined, d: number) => (finite(v) ? v.toFixed(d) : LIVE.none)
const whole = (v: number | null | undefined) => (finite(v) ? String(Math.round(v * 1e6) / 1e6) : LIVE.none)
const usd = (v: number | null | undefined) => (finite(v) ? USD.format(v) : LIVE.none)

export interface RouteRowView {
  readonly key: string
  readonly date: string
  readonly status: Route['status']
  readonly side: Side | typeof LIVE.none
  readonly filled: string
  readonly contract: string
  readonly target: string
  readonly sent: string
  readonly avgPx: string
  readonly closePx: string
  readonly decisionPx: string
  readonly slip: string
  readonly reason: string
  readonly reconciled: boolean | null
  readonly plumbing: boolean
  readonly banner: string | null
}

export interface FillRowView {
  readonly key: string
  readonly date: string
  readonly contract: string
  readonly side: Side
  readonly qty: string
  readonly price: string
  readonly notional: string
  readonly plumbing: boolean
  readonly banner: string | null
}

const newestFirst = <T extends { readonly line_no: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => b.line_no - a.line_no)

function routeView(r: Route, i: number): RouteRowView {
  return {
    key: `${r.file}:${r.line_no}:${i}`,
    date: r.date ?? LIVE.none,
    status: r.status,
    side: r.side ?? LIVE.none,
    filled: whole(r.filled_qty),
    contract: r.contract ?? LIVE.none,
    target: whole(r.target),
    sent: whole(r.sent_target),
    avgPx: fixed(r.avg_fill_px, PX_DECIMALS),
    closePx: fixed(r.close_px, PX_DECIMALS),
    decisionPx: fixed(r.decision_px, PX_DECIMALS),
    slip: fixed(r.slippage_ticks, SLIP_DECIMALS),
    reason: r.reason ?? LIVE.none,
    reconciled: r.reconciled_ok,
    plumbing: r.plumbing,
    banner: r.banner,
  }
}

/** One row per journal close row, newest first. */
export function routeRows(body: LiveRoutes): RouteRowView[] {
  return newestFirst(body.routes).map(routeView)
}

/** The fills the book counted, newest first; notional at the API's point value. */
export function fillRows(body: LiveRoutes): FillRowView[] {
  return newestFirst(body.fills).map((f: Fill, i) => ({
    key: `${f.file}:${f.line_no}:${i}`,
    date: f.date ?? LIVE.none,
    contract: f.contract,
    side: f.side,
    qty: whole(f.qty),
    price: fixed(f.price, PX_DECIMALS),
    notional: usd(f.notional_usd),
    plumbing: f.plumbing,
    banner: f.banner,
  }))
}

/** B/S as coloured text: BUY up, SELL down (the word is always there, so colour is never the only cue). */
export function sideTone(side: string | null): 'up' | 'down' | undefined {
  if (side === 'BUY') return 'up'
  return side === 'SELL' ? 'down' : undefined
}

/** The footer strip (look spec 7.11 `%Filled | Filled | Notional | # orders`): the API's totals. */
export function routeFooter(body: LiveRoutes): StateItem[] {
  const s = body.summary
  const n = (v: number) => String(v)
  return [
    { key: 'routes', label: LIVE.footRoutes, value: n(s.routes) },
    { key: 'sent', label: LIVE.footSent, value: n(s.sent) },
    { key: 'blocked', label: LIVE.footBlocked, value: n(s.blocked), ...(s.blocked > 0 ? { tone: 'warn' as const } : {}) },
    { key: 'refused', label: LIVE.footRefused, value: n(s.refused), ...(s.refused > 0 ? { tone: 'warn' as const } : {}) },
    { key: 'errors', label: LIVE.footErrors, value: n(s.errors), ...(s.errors > 0 ? { tone: 'down' as const } : {}) },
    { key: 'fills', label: LIVE.footFills, value: n(s.fills) },
    { key: 'filled', label: LIVE.footFilled, value: fillCopy(LIVE.contracts, { n: s.filled_contracts }) },
    { key: 'notional', label: LIVE.footNotional, value: finite(s.notional_usd) ? fillCopy(LIVE.usd, { value: usd(s.notional_usd) }) : LIVE.none },
    {
      key: 'plumbing', label: LIVE.footPlumbing,
      value: fillCopy(LIVE.footPlumbingValue, { routes: s.plumbing_routes, fills: s.plumbing_fills }),
      ...(s.plumbing_routes + s.plumbing_fills > 0 ? { tone: 'warn' as const } : {}),
    },
    ...(s.bad_fills > 0 ? [{ key: 'bad', label: LIVE.footBadFills, value: n(s.bad_fills), tone: 'down' as const }] : []),
  ]
}

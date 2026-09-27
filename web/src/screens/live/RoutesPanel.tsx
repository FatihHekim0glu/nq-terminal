// LIVE's Routes and Fills sections and the footer strip (look spec 7.11, laid out like a blotter; read
// only). GET /api/live/routes, polled with the rest of LIVE: one route per book journal close row with
// its status, B/S in up or down text, the quantities and prices as the journal recorded them, then the
// fills the book counted, then the API's totals over performance rows. Plumbing rows are hatched and carry
// the API's banner text; the footer counts them apart. The journal records no send time: the section
// line states the book's rule instead.
import { useMemo } from 'react'
import { useLiveRoutes } from '../../api/queries'
import { LIVE } from '../../copy/live'
import { fillCopy } from '../../copy/workspace'
import { fillRows, routeFooter, routeRows, sideTone, type FillRowView, type RouteRowView } from './liveRoutes'
import PlainTable, { type PlainColumn } from './PlainTable'
import StateStrip from './StateStrip'

function WithBanner({ banner, text }: { readonly banner: string | null; readonly text: string }) {
  if (!banner) return <>{text}</>
  return (
    <>
      <span className="plumbing-banner">{banner}</span> {text}
    </>
  )
}

const statusTone = (r: RouteRowView) => (r.status === 'error' ? 'down' : r.status === 'sent' ? undefined : 'muted')

const ROUTE_COLUMNS: PlainColumn<RouteRowView>[] = [
  { id: 'date', header: LIVE.colDate, width: 96, kind: 'name', text: (r) => r.date },
  { id: 'status', header: LIVE.colStatus, width: 70, kind: 'text', text: (r) => r.status, tone: statusTone },
  { id: 'side', header: LIVE.colSide, width: 44, kind: 'text', text: (r) => r.side, tone: (r) => sideTone(r.side) },
  { id: 'filled', header: LIVE.colFilled, width: 52, kind: 'num', text: (r) => r.filled },
  { id: 'contract', header: LIVE.colContract, width: 96, kind: 'text', text: (r) => r.contract },
  { id: 'target', header: LIVE.colTarget, width: 56, kind: 'num', text: (r) => r.target },
  { id: 'sent', header: LIVE.colSentTarget, width: 48, kind: 'num', text: (r) => r.sent },
  { id: 'avg', header: LIVE.colAvgPx, width: 84, kind: 'num', text: (r) => r.avgPx },
  { id: 'close', header: LIVE.colClose, width: 84, kind: 'num', text: (r) => r.closePx },
  { id: 'decision', header: LIVE.colDecisionPx, width: 90, kind: 'num', text: (r) => r.decisionPx },
  { id: 'slip', header: LIVE.colSlippage, width: 76, kind: 'num', text: (r) => r.slip },
  {
    id: 'recon', header: LIVE.colReconciled, width: 52, kind: 'text',
    text: (r) => (r.reconciled === true ? LIVE.ok : r.reconciled === false ? LIVE.fail : LIVE.none), tone: (r) => (r.reconciled === false ? 'down' : undefined),
  },
  { id: 'reason', header: LIVE.colReason, width: 440, kind: 'text', text: (r) => <WithBanner banner={r.banner} text={r.reason} /> },
]

const FILL_COLUMNS: PlainColumn<FillRowView>[] = [
  { id: 'date', header: LIVE.colDate, width: 96, kind: 'name', text: (r) => r.date },
  { id: 'contract', header: LIVE.colContract, width: 96, kind: 'text', text: (r) => r.contract },
  { id: 'side', header: LIVE.colSide, width: 44, kind: 'text', text: (r) => r.side, tone: (r) => sideTone(r.side) },
  { id: 'qty', header: LIVE.colQty, width: 48, kind: 'num', text: (r) => r.qty },
  { id: 'price', header: LIVE.colPrice, width: 84, kind: 'num', text: (r) => r.price },
  { id: 'notional', header: LIVE.colNotional, width: 110, kind: 'num', text: (r) => r.notional },
  { id: 'banner', header: LIVE.colNote, width: 360, kind: 'text', text: (r) => (r.banner ? <span className="plumbing-banner">{r.banner}</span> : '') },
]

const rowKey = (r: { readonly key: string }) => r.key
const plumbingClass = (r: { readonly plumbing: boolean }) => (r.plumbing ? 'plumbing-row' : undefined)

export default function RoutesPanel() {
  const query = useLiveRoutes()
  const body = query.data
  const routes = useMemo(() => (body ? routeRows(body) : []), [body])
  const fills = useMemo(() => (body ? fillRows(body) : []), [body])
  const footer = useMemo(() => (body ? routeFooter(body) : []), [body])
  if (query.isError) return <p className="live-message" role="alert">{fillCopy(LIVE.routesError, { detail: query.error.detail })}</p>
  if (!body) return <p className="live-message">{LIVE.routesLoading}</p>
  if (!body.present) return <p className="live-message">{body.empty_state ?? LIVE.routesEmpty}</p>
  return (
    <section className="live-routes" aria-label={LIVE.routesTitle}>
      <h3 className="live-section">
        <span className="live-readonly">{LIVE.readOnlyTag}</span> {LIVE.routesTitle}
      </h3>
      <p className="live-message">{fillCopy(LIVE.routesBasis, { basis: body.basis, rule: body.order_time_rule })}</p>
      <PlainTable label={LIVE.routesLabel} rows={routes} columns={ROUTE_COLUMNS} rowId={rowKey} rowClassName={plumbingClass} emptyText={LIVE.routesEmpty} />
      <h3 className="live-section">{LIVE.fillsTitle}</h3>
      <PlainTable label={LIVE.fillsLabel} rows={fills} columns={FILL_COLUMNS} rowId={rowKey} rowClassName={plumbingClass} emptyText={LIVE.fillsEmpty} />
      <div className="live-foot">
        <StateStrip label={LIVE.footerLabel} items={footer} />
      </div>
    </section>
  )
}

// A run's trades, costs and exposure panels (UI_SPEC section 7, the tear sheet's last row; ANALYTICS
// TA1, TA3, TA6, EX1 to EX4). Three DES-style cards under the tab view. The trade card appears only
// when the run has closed trades; the exposure card says why when a run has no snapshots. Each card
// is [POST HOC] and names its unit; the slippage table holds real fills only, as the API sends them.
import { useId, useMemo, useState, type ReactNode } from 'react'
import type { ApiError } from '../../api/client'
import { useRun } from '../../api/queries'
import { BarLadder } from '../../charts/echarts/BarLadder'
import LineStack from '../../charts/LineStack'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { TEAR, TEAR_BOOKS as B } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import {
  exposureStack, groupLadder, hasTrades, sensitivityLadder, slippageView, tradeStatRows, waterfallRows,
  type Grouping, type RunCosts, type RunExposure, type RunTrades,
} from './tearBooks'
import { formatNumber } from './tearFormat'
import { useRunBooks } from './tearQueries'
import '../../grids/grid.css'
import '../../tiles/tiles.css'

function chartId(prefix: string, uid: string): string {
  return `${prefix}-${uid.replace(/[^A-Za-z0-9_-]/g, '')}`
}

function Card({ title, tag, children }: { readonly title: string; readonly tag?: string; readonly children: ReactNode }) {
  return (
    <div className="nqt-card tear-card">
      <h3 className="nqt-card-title tear-card-title">
        {title}
        {tag ? <span className="tear-card-tag">{tag}</span> : null}
      </h3>
      <div className="tear-card-body">{children}</div>
    </div>
  )
}

function Pending({ error }: { readonly error: ApiError | null }) {
  if (error) return <p className="tear-note" role="alert">{fillCopy(B.failed, { detail: error.detail })}</p>
  return <p className="tear-note" role="status" aria-busy="true">{TEAR.loadingBooks}</p>
}

function Rows({ caption, rows }: { readonly caption: string; readonly rows: ReadonlyArray<{ id: string; label: string; value: string }> }) {
  return (
    <table className="nqt-grid tear-kv">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" className="name tear-rowhead">{r.label}</th>
            <td className="num tear-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** TA6 (ARCHITECTURE s4): the real-fill rows of this run's own strategy only, the sample named. */
function SlippageTable({ trades, strategy }: { readonly trades: RunTrades; readonly strategy: string | null }) {
  const view = useMemo(() => slippageView(trades, strategy), [trades, strategy])
  const C = B.slippageCols
  if (view.kind === 'none') return <p className="tear-note">{view.caption}</p>
  const rows = view.rows
  return (
    <div className="nqt-grid-scroll tear-table">
      <table className="nqt-grid">
        <caption className="tear-caption">{view.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{C.name}</th>
            {[C.n, C.mean, C.p5, C.p50, C.p95].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
            <th scope="col">{C.source}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="name">{r.name}</td>
              <td className="num">{r.n}</td>
              <td className="num">{r.mean}</td>
              <td className="num">{r.p5}</td>
              <td className="num">{r.p50}</td>
              <td className="num">{r.p95}</td>
              <td className="muted" title={r.source}>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TradesCard({ trades, runId }: { readonly trades: RunTrades; readonly runId: string }) {
  const run = useRun(runId)
  const strategy = run.data?.summary.strategy ?? null
  const [grouping, setGrouping] = useState<Grouping>(trades.by_hour ? 'hour' : 'weekday')
  const ladder = useMemo(() => groupLadder(trades, grouping, runId), [trades, grouping, runId])
  const rows = useMemo(() => tradeStatRows(trades), [trades])
  const uid = useId()
  const options = (['hour', 'weekday', 'month'] as const)
    .filter((g) => g !== 'hour' || trades.by_hour)
    .map((g) => ({ value: g, label: B.groups[g] }))
  const s = trades.slippage
  return (
    <Card title={B.tradesTitle} tag={trades.tag}>
      <p className="tear-basis">{fillCopy(B.groupUnit, { unit: trades.unit, timezone: trades.by_weekday.timezone })}</p>
      <Rows caption={B.tradeStatsLabel} rows={rows} />
      {trades.hit_rate_matches !== null ? <p className="tear-note">{trades.hit_rate_matches ? B.hitMatch : B.hitMismatch}</p> : null}
      {trades.hour_note ? <p className="tear-note">{trades.hour_note}</p> : null}
      <ToggleGroup label={B.groupLabel} options={options} value={grouping} onChange={(v) => setGrouping(v as Grouping)} />
      {ladder ? <div className="tear-chart tear-chart-short"><BarLadder data={ladder} chartId={chartId('tear-group', uid)} /></div> : null}
      {run.data || run.isError ? <SlippageTable trades={trades} strategy={strategy} /> : null}
      <p className="tear-note">{s.label}</p>
      {strategy === 'volmanaged' && s.live_plumbing_rows_skipped > 0 ? <p className="tear-note">{fillCopy(B.slippagePlumbing, { n: s.live_plumbing_rows_skipped })}</p> : null}
    </Card>
  )
}

function CostsCard({ costs, runId }: { readonly costs: RunCosts; readonly runId: string }) {
  const rows = useMemo(() => waterfallRows(costs), [costs])
  const ladder = useMemo(() => sensitivityLadder(costs, runId), [costs, runId])
  const uid = useId()
  const w = costs.waterfall
  const be = costs.sensitivity.break_even_ticks_per_side
  return (
    <Card title={B.costsTitle} tag={costs.tag}>
      <table className="nqt-grid tear-kv">
        <caption className="tear-caption">{fillCopy(B.waterfallCaption, { unit: w.unit })}</caption>
        <thead><tr><th scope="col">{B.waterfallCols.step}</th><th scope="col" className="num">{B.waterfallCols.value}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.step} className={r.total ? 'total-row' : undefined}>
              <th scope="row" className="name tear-rowhead">{r.step}</th>
              <td className="num tear-value">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tear-note">{fillCopy(w.ticks === 1 ? B.sidesLineOne : B.sidesLine, { sides: formatNumber(w.sides, 0, { thousands: true }), ticks: formatNumber(w.ticks, 0) })}</p>
      <p className="tear-note">{w.label}</p>
      <div className="tear-chart tear-chart-short"><BarLadder data={ladder} chartId={chartId('tear-sens', uid)} /></div>
      <p className="tear-note">{costs.sensitivity.label}</p>
      <p className="tear-note">{fillCopy(B.runTicks, { ticks: formatNumber(costs.sensitivity.run_ticks, 0) })}</p>
      {ladder.marker === undefined && be !== null ? <p className="tear-note">{fillCopy(B.breakEvenNone, { ticks: formatNumber(be, 2) })}</p> : null}
    </Card>
  )
}

function ExposureCard({ exposure, runId, link }: { readonly exposure: RunExposure; readonly runId: string; readonly link: PanelLink }) {
  const spec = useMemo(() => exposureStack(exposure, runId), [exposure, runId])
  const e = exposure.exposure
  const t = exposure.turnover
  if (!spec || !e) {
    return <Card title={B.exposureTitle} tag={exposure.tag}><p className="tear-note">{fillCopy(B.unavailable, { note: exposure.note ?? '' })}</p></Card>
  }
  const means = fillCopy(B.exposureMeans, {
    gross: formatNumber(e.mean_gross, 2), net: formatNumber(e.mean_net, 2),
    daily: formatNumber(t?.mean_daily, 2), annual: formatNumber(t?.annualised, 2),
  })
  return (
    <Card title={B.exposureTitle} tag={exposure.tag}>
      <p className="tear-basis">{t ? fillCopy(B.exposureUnitTurnover, { label: e.label, unit: e.unit, turnover: t.unit }) : fillCopy(B.exposureUnit, { label: e.label, unit: e.unit })}</p>
      <div className="tear-chart tear-chart-short"><LineStack title={spec.title} t={spec.t} panes={spec.panes} link={link} /></div>
      <p className="tear-note">{means}</p>
      <p className="tear-note">{fillCopy(B.priceBasis, { text: e.price_basis })}</p>
      <p className="tear-note">{e.positions_reconcile ? B.reconcile : B.noReconcile}</p>
    </Card>
  )
}

export default function RunBooks({ runId, link = '-' }: { readonly runId: string; readonly link?: PanelLink }) {
  const books = useRunBooks(runId, true)
  const trades = books.trades.data
  return (
    <section className="tear-books" aria-label={fillCopy(B.headingLabel, { run: runId })}>
      <h3 className="tear-books-heading">{B.heading}</h3>
      <div className="tear-books-grid">
        {trades ? (
          hasTrades(trades) ? <TradesCard trades={trades} runId={runId} /> : <Card title={B.tradesTitle}><p className="tear-note">{B.noTrades}</p></Card>
        ) : <Card title={B.tradesTitle}><Pending error={books.trades.error} /></Card>}
        {books.costs.data ? <CostsCard costs={books.costs.data} runId={runId} /> : <Card title={B.costsTitle}><Pending error={books.costs.error} /></Card>}
        {books.exposure.data ? <ExposureCard exposure={books.exposure.data} runId={runId} link={link} /> : <Card title={B.exposureTitle}><Pending error={books.exposure.error} /></Card>}
      </div>
    </section>
  )
}

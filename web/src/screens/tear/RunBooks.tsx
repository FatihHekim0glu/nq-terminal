// A run's trades, costs and exposure panels (UI_SPEC section 7, the tear sheet's last row; ANALYTICS
// TA1, TA3, TA6, EX1 to EX4, and in P1 TA2, TA4, TA5 as the trade paths card). DES-style cards under the tab view. The trade card appears only
// when the run has closed trades; the exposure card says why when a run has no snapshots. Each card
// is [POST HOC] and names its unit; the slippage table holds real fills only, as the API sends them.
import { useId, useMemo, useState, type CSSProperties } from 'react'
import { useCommands, useRun } from '../../api/queries'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { Composition } from '../../charts/echarts/Composition'
import LineStack from '../../charts/LineStack'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { COMPOSITION } from '../../copy/composition'
import { TEAR, TEAR_BOOKS as B } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { sig } from '../expo/expoModel'
import type { PanelLink } from '../../state/linkGroups'
import type { CompositionMode } from '../../charts/echarts/compositionModel'
import { compositionInput, compositionView, type RootIndex } from './bookComposition'
import {
  exposureStack, groupLadder, hasTrades, sensitivityLadder, slippageView, tradeStatRows, waterfallRows,
  type Grouping, type RunCosts, type RunExposure, type RunTrades,
} from './tearBooks'
import RunTradePaths from './RunTradePaths'
import { Card, Pending as CardPending, Rows, chartId } from './TearCard'
import { formatNumber } from './tearFormat'
import { useRunBooks } from './tearQueries'
import '../../grids/grid.css'
import '../../tiles/tiles.css'
import './tearComposition.css'

function Pending({ error }: { readonly error: Parameters<typeof CardPending>[0]['error'] }) {
  return <CardPending error={error} failed={B.failed} loading={TEAR.loadingBooks} />
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

export function CostsCard({ costs, runId }: { readonly costs: RunCosts; readonly runId: string }) {
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

/** Totals is the gross, net and turnover stack; the other two draw the per-instrument series. */
export type ExposureViewName = 'totals' | 'heat' | 'stack'

const VIEW_OPTIONS = (['totals', 'heat', 'stack'] as const).map((view) => ({ value: view, label: COMPOSITION.views[view] }))

export interface ExposureCardProps {
  readonly exposure: RunExposure
  readonly runId: string
  readonly link: PanelLink
  /** The instrument index (root and sector of each instrument) that groups the per-instrument series.
   *  Left out, the card reads it from GET /api/commands; null says there is none (every instrument then
   *  sits under "not in the instrument index"). The gallery passes one, so it makes no request. */
  readonly index?: RootIndex | null
  /** The view shown first: Totals, unless a gallery entry asks for another. */
  readonly initialView?: ExposureViewName
}

function ExposureBody({ exposure, runId, link, index, initialView = 'totals' }: ExposureCardProps & { readonly index: RootIndex | null }) {
  // Every hook comes before the early return below: a new read may flip the card between the two shapes.
  const spec = useMemo(() => exposureStack(exposure, runId), [exposure, runId])
  const composition = useMemo(() => compositionView(exposure.exposure, index), [exposure.exposure, index])
  const [chosen, setChosen] = useState<ExposureViewName>(initialView)
  // Without a per-instrument series there is nothing to compose, whatever was chosen before.
  const mode: CompositionMode | null = composition === null || chosen === 'totals' ? null : chosen
  const input = useMemo(() => (composition === null || mode === null ? null : compositionInput(composition, runId, mode)), [composition, runId, mode])
  const uid = useId()
  const e = exposure.exposure
  const t = exposure.turnover
  if (!spec || !e) {
    return <Card title={B.exposureTitle} tag={exposure.tag}><p className="tear-note">{fillCopy(B.unavailable, { note: exposure.note ?? '' })}</p></Card>
  }
  // Shares expoModel's sig() with the EXPO summary table beside this card, so the same API mean never
  // prints at two different precisions on the same screen (D23).
  const means = fillCopy(B.exposureMeans, {
    gross: sig(e.mean_gross), net: sig(e.mean_net),
    daily: sig(t?.mean_daily), annual: sig(t?.annualised),
  })
  // The turnover unit belongs to the Totals stack's second pane; the composition views have no such pane.
  const unit = t && mode === null
    ? fillCopy(B.exposureUnitTurnover, { label: e.label, unit: e.unit, turnover: t.unit })
    : fillCopy(B.exposureUnit, { label: e.label, unit: e.unit })
  const rows = { '--composition-rows': composition?.rows.length ?? 0 } as CSSProperties
  return (
    <Card title={B.exposureTitle} tag={exposure.tag}>
      <p className="tear-basis">{unit}</p>
      {composition ? <ToggleGroup label={COMPOSITION.toggle} options={VIEW_OPTIONS} value={mode ?? 'totals'} onChange={(v) => setChosen(v as ExposureViewName)} /> : null}
      {input && composition && mode ? (
        <>
          <div className={`tear-chart-composition tear-chart-composition-${mode}`} style={mode === 'heat' ? rows : undefined}>
            <Composition data={input} mode={mode} chartId={chartId('tear-composition', uid)} />
          </div>
          <p className="tear-note">{COMPOSITION.absolute}</p>
          <p className="tear-note">{COMPOSITION.sampling[composition.sampling]}</p>
        </>
      ) : (
        <div className="tear-chart tear-chart-short"><LineStack title={spec.title} t={spec.t} panes={spec.panes} link={link} /></div>
      )}
      <p className="tear-note">{means}</p>
      <p className="tear-note">{fillCopy(B.priceBasis, { text: e.price_basis })}</p>
      <p className="tear-note">{e.positions_reconcile ? B.reconcile : B.noReconcile}</p>
    </Card>
  )
}

/** The instrument index from GET /api/commands (shared with the command line's own read). */
function ServedIndexExposure(props: ExposureCardProps) {
  const commands = useCommands()
  return <ExposureBody {...props} index={commands.data ?? null} />
}

export function ExposureCard(props: ExposureCardProps) {
  return props.index === undefined ? <ServedIndexExposure {...props} /> : <ExposureBody {...props} index={props.index} />
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
        {trades && hasTrades(trades) ? <RunTradePaths runId={runId} /> : null}
        {books.costs.data ? <CostsCard costs={books.costs.data} runId={runId} /> : <Card title={B.costsTitle}><Pending error={books.costs.error} /></Card>}
        {books.exposure.data ? <ExposureCard exposure={books.exposure.data} runId={runId} link={link} /> : <Card title={B.exposureTitle}><Pending error={books.exposure.error} /></Card>}
      </div>
    </section>
  )
}

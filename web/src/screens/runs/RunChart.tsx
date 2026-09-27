// RUN tab 1) Chart (look spec 7.4): equity on Basis B in white with the benchmark in orange (in a pane of
// its own when a shared axis would flatten the strategy), a 5px splitter, then the underwater curve, from GET /api/analytics/run/{id}/panel (the tear sheet's own
// series, one row per gated session, [POST HOC]); the statistics side panel at about a third of the
// width; and the BalanceCheck card. An unusable run (rule 4) gets no LineStack and no series request.
import { useMemo } from 'react'
import { useApiQuery } from '../../api/queries'
import type { Schemas } from '../../api/types'
import LineStack from '../../charts/LineStack'
import type { LineStackPane } from '../../charts/LineStack.types'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import BalanceCheck from '../../tiles/BalanceCheck'
import { panelDrawdown } from '../home/homeEquity.model'
import { RUN, RUN_TAGS } from './copy'
import { benchOwnPane, formatCount, formatFraction, formatRatio, formatUsd, signTone, type Tone } from './model'
import type { RunDetail } from './runModel'

type Panel = Schemas['HomePanel']
const C = RUN.chart
// The side panel scrolls on its own at small sizes, so it is a named roving item the keyboard can reach.
const roving = { [ROVING_ATTR]: '' }

function percent(values: ReadonlyArray<number | null>): Array<number | null> {
  return values.map((v) => (v === null ? null : v * 100))
}

function usePanes(panel: Panel, run: string): LineStackPane[] {
  return useMemo(() => {
    const bench = panel.bench_equity
    const benchDd = panel.bench_underwater
    const dd = panelDrawdown(panel)
    // A benchmark that would squash the strategy's line flat on a shared axis gets a pane of its own.
    const split = benchOwnPane(panel.equity, bench)
    const benchSeries = bench ? [{ name: C.bench, style: 'benchmark' as const, values: bench }] : []
    return [
      {
        id: 'equity', weight: 2, decimals: 2, zero: 'none', logAllowed: true,
        ...(dd ? { summaryDrawdown: dd } : {}),
        series: [
          { name: fillCopy(C.equity, { run }), style: 'primary', values: panel.equity },
          ...(split ? [] : benchSeries),
        ],
      },
      ...(split ? [{ id: 'bench', weight: 1, decimals: 2, zero: 'none' as const, logAllowed: true, series: benchSeries }] : []),
      {
        id: 'underwater', weight: 1, decimals: 2, unit: '%', zero: 'white',
        series: [
          { name: fillCopy(C.underwater, { run }), style: 'underwater', values: percent(panel.underwater) },
          ...(benchDd ? [{ name: C.benchUnderwater, style: 'benchmark' as const, values: percent(benchDd) }] : []),
        ],
      },
    ]
  }, [panel, run])
}

function ChartNotes({ panel }: { readonly panel: Panel }) {
  return (
    <p className="run-note">
      <span className="run-tag">{panel.tag}</span>
      {fillCopy(C.basis, { basis: panel.basis, label: panel.basis_label, unit: panel.equity_unit, source: panel.label })}{' '}
      {panel.bench_label ? fillCopy(C.bench_label, { label: panel.bench_label }) : C.noBench}{' '}
      {panel.dropped.length > 0 ? fillCopy(C.dropped, { n: panel.dropped.length }) : null}
    </p>
  )
}

function Chart({ panel, run, link }: { readonly panel: Panel; readonly run: string; readonly link: LinkGroup }) {
  const panes = usePanes(panel, run)
  return (
    <>
      <ChartNotes panel={panel} />
      <div className="run-chart-body">
        <LineStack title={fillCopy(C.title, { run })} t={panel.t} panes={panes} link={link} />
      </div>
    </>
  )
}

interface StatRow {
  readonly label: string
  readonly value: string
  readonly tone?: Tone
}

function statRows(detail: RunDetail, panel: Panel | undefined): StatRow[] {
  const s = detail.summary
  const S = RUN.stats
  return [
    { label: S.trades, value: formatCount(s.n_trades) },
    { label: S.pnl, value: formatUsd(s.pnl_total, true), tone: signTone(s.pnl_total) },
    { label: S.fees, value: formatUsd(s.fees_total) },
    { label: S.hitRate, value: formatFraction(s.hit_rate, 1) },
    { label: S.meanNetR, value: formatRatio(s.mean_net_r, 3), tone: signTone(s.mean_net_r) },
    { label: S.tNetR, value: formatRatio(s.t_net_r) },
    { label: S.tPnl, value: formatRatio(s.t_pnl_usd) },
    { label: S.sharpe, value: formatRatio(panel?.sharpe), tone: signTone(panel?.sharpe) },
    { label: S.maxDd, value: formatFraction(panel?.max_drawdown, 2) },
    { label: S.sessions, value: formatCount(panel?.n) },
  ]
}

function Stats({ detail, panel }: { readonly detail: RunDetail; readonly panel: Panel | undefined }) {
  const run = detail.summary.run_id
  return (
    <table className="run-stats">
      <caption>{fillCopy(RUN.stats.caption, { run })}</caption>
      <thead>
        <tr>
          <th scope="col">{RUN.stats.metric}</th>
          <th scope="col">{RUN.stats.total}</th>
        </tr>
      </thead>
      <tbody>
        {statRows(detail, panel).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td className={row.tone}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function UsableChart({ detail, link }: { readonly detail: RunDetail; readonly link: LinkGroup }) {
  const run = detail.summary.run_id
  const query = useApiQuery('/api/analytics/run/{run_id}/panel', { path: { run_id: run }, query: { freq: 'D' } })
  return (
    <>
      <section className="run-chart" aria-label={C.label}>
        {query.error ? <p className="run-msg" role="status">{fillCopy(C.failed, { detail: query.error.detail })}</p> : null}
        {query.data ? <Chart panel={query.data} run={run} link={link} /> : null}
        {query.isPending ? <p className="run-msg" role="status">{C.loading}</p> : null}
      </section>
      <Side detail={detail} panel={query.data} />
    </>
  )
}

function Side({ detail, panel }: { readonly detail: RunDetail; readonly panel: Panel | undefined }) {
  return (
    <div className="run-side" role="region" aria-label={RUN.stats.label} tabIndex={0} {...roving}>
      <Stats detail={detail} panel={panel} />
      <p className="run-note">{RUN.stats.note}</p>
      <BalanceCheck check={detail.balance_check} coverage={detail.coverage_check} anchor={detail.anchor?.verdict ?? null} runId={detail.summary.run_id} />
    </div>
  )
}

export default function RunChart({ detail, link }: { readonly detail: RunDetail; readonly link: LinkGroup }) {
  if (detail.summary.usable) {
    return (
      <div className="run-chart-tab">
        <UsableChart detail={detail} link={link} />
      </div>
    )
  }
  const tag = detail.summary.balance_ok === false ? RUN_TAGS.unusableBalance : RUN_TAGS.unusable
  return (
    <div className="run-chart-tab">
      <section className="run-chart" aria-label={C.label}>
        <p className="run-unusable" role="note">
          <span className="run-tag run-tag-down">{tag}</span> {C.unusable}
        </p>
      </section>
      <Side detail={detail} panel={undefined} />
    </div>
  )
}

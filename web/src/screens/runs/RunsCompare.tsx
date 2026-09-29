// The RUNS compare view (roadmap 9, phase A; tab `90) Compare n`): the runs marked with Space drawn as
// rebased equity on one axis (Basis B: account equity over the starting balance K, 1.0 on the day before
// each run's first session), from GET /api/runs/compare, with the served stats in a grid under the chart.
// Probes are left out unless 97) Settings includes them; unbalanced, unusable and unknown runs are always
// left out and listed under Not drawn. Every number is the API's, formatted; the terminal adds no test,
// no p value and no pass or fail on runs the reader picked. [POST HOC]
import { useId, useMemo } from 'react'
import { useRunsCompare } from '../../api/queries.screens'
import LineStack from '../../charts/LineStack'
import PanelFault, { PanelLoading } from '../../chrome/PanelFault'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import { RUNS } from '../../copy/runs'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn } from '../../grids/MonitorGrid'
import { compareSelection } from './basket'
import { compareModel, maxDdFall, statsRows, type CompareRow } from './compareModel'
import { formatCount, formatFraction, formatRatio, formatUsd, signTone, type RunSummary } from './model'

const C = RUNS.compare
const COLS = C.cols
const NONE: readonly string[] = []

const COLUMNS: readonly MonitorColumn<CompareRow>[] = [
  { id: 'run', header: COLS.run, width: 250, kind: 'name', value: (r) => r.stats.run_id },
  { id: 'source', header: COLS.source, width: 140, kind: 'text', value: (r) => r.source },
  {
    id: 'totalReturn', header: COLS.totalReturn, width: 110, kind: 'num', value: (r) => r.stats.total_return,
    format: (r) => formatFraction(r.stats.total_return, 2),
  },
  {
    id: 'sharpe', header: COLS.sharpe, width: 76, kind: 'num', value: (r) => r.stats.sharpe,
    format: (r) => formatRatio(r.stats.sharpe), tone: (r) => signTone(r.stats.sharpe),
  },
  { id: 'maxDd', header: COLS.maxDd, width: 84, kind: 'num', value: (r) => maxDdFall(r.stats), format: (r) => formatFraction(maxDdFall(r.stats), 2) },
  { id: 'trades', header: COLS.trades, width: 64, kind: 'num', value: (r) => r.stats.n_trades, format: (r) => formatCount(r.stats.n_trades) },
  { id: 'fees', header: COLS.fees, width: 92, kind: 'num', value: (r) => r.stats.fees_total, format: (r) => formatUsd(r.stats.fees_total) },
  { id: 'note', header: COLS.note, width: 360, kind: 'text', value: (r) => r.stats.stats_note },
]

const rowId = (r: CompareRow) => r.stats.run_id

interface Left {
  readonly id: string
  readonly reason: string
}

function NotDrawn({ items }: { readonly items: readonly Left[] }) {
  const titleId = useId()
  return (
    <div className="runs-excluded">
      <span id={titleId} className="runs-excluded-title">{C.excludedTitle}</span>
      <ul aria-labelledby={titleId}>
        {items.map((item) => (
          <li key={item.id}>{fillCopy(C.notDrawn, { run: item.id, reason: item.reason })}</li>
        ))}
      </ul>
    </div>
  )
}

/** The chart title: one drawable line reads "1 run", not "1 runs" (the API may leave a single usable series). */
function chartTitle(n: number): string {
  return n === 1 ? C.chartTitleOne : fillCopy(C.chartTitle, { n })
}

export interface RunsCompareProps {
  /** The basket, in marking order. */
  readonly ids: readonly string[]
  readonly runs: readonly RunSummary[]
  readonly includeProbes: boolean
  /** The panel's link group, for the chart's crosshair. */
  readonly link: LinkGroup
}

export default function RunsCompare({ ids, runs, includeProbes, link }: RunsCompareProps) {
  const selection = useMemo(() => compareSelection(ids, runs, includeProbes), [ids, runs, includeProbes])
  const drawable = selection.drawn.length >= 2
  const query = useRunsCompare(drawable ? selection.drawn : NONE)
  const body = drawable ? query.data : undefined
  const view = useMemo(() => (body ? compareModel(body) : null), [body])
  const rows = useMemo(() => (body ? statsRows(body) : []), [body])
  const left: Left[] = [
    ...selection.excluded.map((e) => ({ id: e.id, reason: C.reasons[e.reason] })),
    ...(view?.undrawn ?? []).map((id) => ({ id, reason: C.reasons.unusable })),
  ]
  const pane = view?.panes[0]
  return (
    <div className="runs-compare">
      <p className="runs-note">{C.note}</p>
      {left.length > 0 ? <NotDrawn items={left} /> : null}
      {!drawable || (view && !pane) ? (
        <p className="runs-msg" role="status">{C.needTwo}</p>
      ) : query.error ? (
        <PanelFault error={query.error} failedText={C.failed} onRetry={() => void query.refetch()} className="runs-msg" />
      ) : view && pane ? (
        <>
          <section className="runs-compare-chart" aria-label={C.chartLabel}>
            <LineStack title={chartTitle(pane.series.length)} t={view.t} panes={view.panes} link={link} />
          </section>
          <div className="runs-compare-stats">
            <MonitorGrid label={C.statsLabel} rows={rows} columns={COLUMNS} rowId={rowId} numbered={false} scroll="panel" />
          </div>
        </>
      ) : (
        <PanelLoading text={C.loading} className="runs-msg" />
      )}
    </div>
  )
}

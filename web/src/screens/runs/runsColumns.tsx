// The RUNS table columns (look spec 7.4: `Run id  Strategy  Trades  Net P&L  Sharpe  MaxDD  Balance  MTM
// Anchor`, plus kind, window, fees, hit rate, coverage and the tags). Names amber, numbers right-aligned
// with fixed decimals, badges in colour and text. Sharpe and max drawdown are the compare stats.
import type { MonitorColumn } from '../../grids/MonitorGrid'
import { fillCopy } from '../../copy/workspace'
import { RUNS } from './copy'
import {
  balanceBadge,
  checkText,
  checkTone,
  formatCount,
  formatFraction,
  formatRatio,
  formatUsd,
  runTags,
  signTone,
  type CompareStats,
  type RunSummary,
} from './model'

const C = RUNS.cols

function TagList({ tags }: { readonly tags: readonly string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="runs-tag">{tag}</span>
      ))}
    </>
  )
}

function baseColumns(): MonitorColumn<RunSummary>[] {
  return [
    { id: 'run', header: C.runId, width: 250, kind: 'name', value: (r) => r.run_id },
    { id: 'strategy', header: C.strategy, width: 100, kind: 'text', value: (r) => r.strategy },
    { id: 'kind', header: C.kind, width: 72, kind: 'text', value: (r) => r.kind },
    { id: 'variant', header: C.variant, width: 78, kind: 'text', value: (r) => r.variant },
    {
      id: 'window', header: C.window, width: 190, kind: 'text', value: (r) => r.start,
      format: (r) => (r.start && r.end ? fillCopy(RUNS.window, { start: r.start, end: r.end }) : '--'),
    },
    { id: 'trades', header: C.trades, width: 64, kind: 'num', value: (r) => r.n_trades, format: (r) => formatCount(r.n_trades) },
    {
      id: 'pnl', header: C.pnl, width: 116, kind: 'num', value: (r) => r.pnl_total,
      format: (r) => formatUsd(r.pnl_total, true), tone: (r) => signTone(r.pnl_total),
    },
    { id: 'fees', header: C.fees, width: 92, kind: 'num', value: (r) => r.fees_total, format: (r) => formatUsd(r.fees_total) },
    { id: 'hit', header: C.hitRate, width: 70, kind: 'num', value: (r) => r.hit_rate, format: (r) => formatFraction(r.hit_rate, 1) },
  ]
}

function statColumns(stats: ReadonlyMap<string, CompareStats>): MonitorColumn<RunSummary>[] {
  const sharpe = (r: RunSummary) => stats.get(r.run_id)?.sharpe ?? null
  // CompareStats sends the drawdown as a positive depth; the tear sheet, RUN and HOME show a fall as a
  // negative number, so the column shows the same sign for the same quantity.
  const maxDd = (r: RunSummary) => {
    const depth = stats.get(r.run_id)?.max_drawdown ?? null
    return depth === null ? null : -Math.abs(depth)
  }
  return [
    { id: 'sharpe', header: C.sharpe, width: 76, kind: 'num', value: sharpe, format: (r) => formatRatio(sharpe(r)), tone: (r) => signTone(sharpe(r)) },
    { id: 'maxdd', header: C.maxDd, width: 84, kind: 'num', value: maxDd, format: (r) => formatFraction(maxDd(r), 2) },
  ]
}

function checkColumns(): MonitorColumn<RunSummary>[] {
  return [
    {
      id: 'balance', header: C.balance, width: 116, kind: 'text', value: (r) => balanceBadge(r.balance_ok).text,
      tone: (r) => balanceBadge(r.balance_ok).tone,
    },
    { id: 'mtm', header: C.mtm, width: 56, kind: 'text', value: (r) => checkText(r.mtm_ok), tone: (r) => checkTone(r.mtm_ok) },
    { id: 'coverage', header: C.coverage, width: 76, kind: 'text', value: (r) => checkText(r.coverage_ok), tone: (r) => checkTone(r.coverage_ok) },
    { id: 'anchor', header: C.anchor, width: 170, kind: 'text', value: (r) => r.anchor_of },
    {
      id: 'tags', header: C.tags, width: 190, kind: 'text', sortable: false, value: (r) => runTags(r).join(' '),
      render: (r) => <TagList tags={runTags(r)} />,
    },
  ]
}

/** Keep the result stable per stats map: MonitorGrid rebuilds its table model when the array changes. */
export function runsColumns(stats: ReadonlyMap<string, CompareStats>): MonitorColumn<RunSummary>[] {
  return [...baseColumns(), ...statColumns(stats), ...checkColumns()]
}

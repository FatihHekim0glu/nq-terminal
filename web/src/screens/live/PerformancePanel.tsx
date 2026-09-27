// Target against actual and the reconciliation table (LV1, LV2; UI_SPEC section 7 LIVE). The series
// come from /api/live/performance (performance rows only) and are drawn only after they match, date for
// date, the journal's own non-plumbing close rows (/api/live/journal?type=close), so a plumbing row can
// never reach the chart even if the server let one through.
import { useMemo } from 'react'
import { LIVE_POLL_MS, useApiQuery, useLivePerformance } from '../../api/queries'
import LineStack from '../../charts/LineStack'
import type { LineStackPane } from '../../charts/LineStack.types'
import { LIVE } from '../../copy/live'
import { fillCopy } from '../../copy/workspace'
import { performanceChart, reconRows, type Performance, type ReconRow } from './liveModel'
import PlainTable, { type PlainColumn } from './PlainTable'

/** The API's largest page: a paper book writes about 250 close rows a year. */
const CLOSE_PAGE = 5000

const yesNo = (b: boolean | null) => (b === true ? LIVE.yes : b === false ? LIVE.no : LIVE.none)
const fixed = (n: number | null, d: number) => (n === null ? LIVE.none : n.toFixed(d))
const whole = (n: number | null) => (n === null ? LIVE.none : String(n))
const textOr = (s: string | null) => s ?? LIVE.none

const RECON_COLUMNS: PlainColumn<ReconRow>[] = [
  { id: 'date', header: LIVE.colDate, width: 96, kind: 'name', text: (r) => textOr(r.date) },
  { id: 'contract', header: LIVE.colContract, width: 96, kind: 'text', text: (r) => textOr(r.contract) },
  { id: 'target', header: LIVE.colTarget, width: 56, kind: 'num', text: (r) => whole(r.target) },
  { id: 'expected', header: LIVE.colExpected, width: 68, kind: 'num', text: (r) => whole(r.expected) },
  { id: 'actual', header: LIVE.colActual, width: 48, kind: 'num', text: (r) => whole(r.actual) },
  {
    id: 'recon', header: LIVE.colReconciled, width: 52, kind: 'text',
    text: (r) => (r.reconciled === true ? LIVE.ok : r.reconciled === false ? LIVE.fail : LIVE.none), tone: (r) => (r.reconciled === false ? 'down' : undefined),
  },
  { id: 'exposure', header: LIVE.colExposure, width: 72, kind: 'num', text: (r) => fixed(r.exposure, 4) },
  { id: 'slip', header: LIVE.colSlippage, width: 76, kind: 'num', text: (r) => fixed(r.slippage, 1) },
  { id: 'sent', header: LIVE.colSent, width: 44, kind: 'text', text: (r) => yesNo(r.sent) },
  { id: 'refused', header: LIVE.colRefused, width: 130, kind: 'text', text: (r) => textOr(r.refused) },
  { id: 'error', header: LIVE.colError, width: 300, kind: 'text', text: (r) => textOr(r.error), tone: (r) => (r.error ? 'down' : undefined) },
  { id: 'halted', header: LIVE.colHalted, width: 56, kind: 'text', text: (r) => yesNo(r.halted), tone: (r) => (r.halted ? 'down' : undefined) },
]

const reconId = (r: ReconRow) => r.key

function Chart({ perf }: { readonly perf: Performance }) {
  const closes = useApiQuery(
    '/api/live/journal',
    { query: { file: perf.journal, type: 'close', limit: CLOSE_PAGE } },
    { refetchInterval: LIVE_POLL_MS, staleTime: 0, enabled: perf.present },
  )
  const result = useMemo(
    () => (closes.data ? performanceChart(perf, closes.data.items, closes.data.total) : null),
    [perf, closes.data],
  )
  const panes = useMemo<LineStackPane[] | null>(() => {
    if (result?.kind !== 'ok') return null
    return [
      { id: 'contracts', weight: 2, decimals: 0, series: [
        { name: LIVE.chartTargetSeries, style: 'primary', values: result.target },
        { name: LIVE.chartActualSeries, style: 'benchmark', values: result.actual },
      ] },
      { id: 'exposure', weight: 1.5, decimals: 4, series: [{ name: LIVE.chartExposureSeries, style: 'rollShort', values: result.exposure }] },
    ]
  }, [result])
  if (closes.isError) return <p className="live-message" role="alert">{closes.error.detail}</p>
  if (!result) return <p className="live-message">{LIVE.chartLoading}</p>
  if (result.kind === 'error') return <p className="live-message live-guard" role="alert">{result.message}</p>
  if (result.kind === 'empty' || !panes) return <p className="live-message">{LIVE.chartEmpty}</p>
  return (
    <div className="live-chart">
      {result.skippedNoDate > 0 ? <p className="live-message">{fillCopy(LIVE.chartNoDates, { n: result.skippedNoDate })}</p> : null}
      <LineStack title={fillCopy(LIVE.chartTitle, { journal: perf.journal })} t={result.t} panes={panes} link="-" fence={null} initialRange="Max" />
    </div>
  )
}

export default function PerformancePanel() {
  const query = useLivePerformance()
  const perf = query.data
  const rows = useMemo(() => (perf ? reconRows(perf) : []), [perf])
  if (query.isError) return <p className="live-message" role="alert">{query.error.detail}</p>
  if (!perf) return <p className="live-message">{LIVE.loading}</p>
  if (!perf.present) return <p className="live-message">{perf.empty_state ?? LIVE.chartEmpty}</p>
  return (
    <div className="live-perf">
      <p className="live-message">
        <span className="live-basis">{perf.basis}</span>{' '}
        {perf.plumbing_rows_skipped > 0 ? fillCopy(LIVE.plumbingSkipped, { n: perf.plumbing_rows_skipped }) : null}
      </p>
      <div className="live-perf-row">
        <Chart perf={perf} />
        <div className="live-recon">
          <PlainTable label={LIVE.reconLabel} rows={rows} columns={RECON_COLUMNS} rowId={reconId} emptyText={LIVE.chartEmpty} />
        </div>
      </div>
    </div>
  )
}

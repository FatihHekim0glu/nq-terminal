// The trade paths card of a run's tear sheet (ANALYTICS_CATALOG TA2, TA4, TA5), beside its trades card.
// TA2: MAE and MFE against the final result over the run's own gated 1-minute bars (intraday runs only; the
// card says why otherwise). TA4: holding times on log minutes. TA5: streaks and the runs test on the whole
// trade list. Every chart has its summary and table view; the card is [POST HOC].
import { useId, useMemo } from 'react'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { XyScatter } from '../../charts/echarts/XyScatter'
import { TRADE_PATHS as T } from '../../copy/tradePaths'
import { fillCopy } from '../../copy/workspace'
import { Card, Pending, Rows, chartId } from './TearCard'
import { useRunPaths } from './tearQueries'
import { excursionInputs, holdingLadder, holdingRows, offBasisNote, streakRows, type RunExcursions, type RunTradePaths as Paths } from './tradePathsModel'

function Excursions({ exc, runId }: { readonly exc: RunExcursions; readonly runId: string }) {
  const view = useMemo(() => excursionInputs(exc, runId), [exc, runId])
  const offBasis = useMemo(() => offBasisNote(exc), [exc])
  const uid = useId()
  if (view.kind === 'none') return <p className="tear-note">{view.text}</p>
  const [mae, mfe] = view.charts
  return (
    <>
      <p className="tear-basis">{fillCopy(T.basis, { unit: view.unit, label: exc.label, symbol: exc.symbol ?? '--', variant: exc.variant ?? '--' })}</p>
      {exc.no_bars > 0 ? <p className="tear-note">{fillCopy(T.noBars, { n: exc.no_bars })}</p> : null}
      {offBasis ? <p className="tear-note">{offBasis}</p> : null}
      <div className="tear-chart tear-chart-short"><XyScatter data={mae} chartId={chartId('tear-mae', uid)} /></div>
      <div className="tear-chart tear-chart-short"><XyScatter data={mfe} chartId={chartId('tear-mfe', uid)} /></div>
    </>
  )
}

function Holding({ paths, runId }: { readonly paths: Paths; readonly runId: string }) {
  const ladder = useMemo(() => holdingLadder(paths, runId), [paths, runId])
  const uid = useId()
  return (
    <>
      <p className="tear-basis">{fillCopy(T.holdingBasis, { rule: paths.holding.bin_rule })}</p>
      {ladder.bars.length > 0 ? <div className="tear-chart tear-chart-short"><BarLadder data={ladder} chartId={chartId('tear-hold', uid)} /></div> : null}
      <Rows caption={T.holdingCaption} rows={holdingRows(paths)} />
      <Rows caption={T.streakCaption} rows={streakRows(paths)} visibleCaption />
      <p className="tear-note">{paths.streaks.note}</p>
    </>
  )
}

export default function RunTradePaths({ runId }: { readonly runId: string }) {
  const q = useRunPaths(runId, true)
  const tag = q.paths.data?.tag ?? q.excursions.data?.tag
  return (
    <Card title={T.title} tag={tag} className="tear-card-paths">
      {q.excursions.data ? <Excursions exc={q.excursions.data} runId={runId} /> : <Pending error={q.excursions.error} failed={T.failed} loading={T.loading} />}
      {q.paths.data ? <Holding paths={q.paths.data} runId={runId} /> : <Pending error={q.paths.error} failed={T.failed} loading={T.loading} />}
    </Card>
  )
}

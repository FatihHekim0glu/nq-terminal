// MT 87) Effective trials (ANALYTICS_CATALOG SV3b, roadmap #19 slice 2): the effective number of trials from the
// registered daily trials' own return correlations, then the SR0 and DSR each N would set. [POST HOC], computed in
// the browser, an extra view only (no verdict). GETs: /api/analytics/deflated (SV3, shared with 85) Family) and, once
// the SV3 view has named its daily trials, /api/analytics/hypothesis/{name}?cost=1 for each of them (useTrialSeries).
// computeEffectiveN refuses unless the browser formula reproduces what SV3 served; a refusal is a status line, never an
// alert, and draws no matrix. A failure of the SV3 view itself is the one alert (PanelFault, as on 85). Plain tables
// and one heatmap: no MonitorGrid and no numbered item.
import { useMemo, type ReactNode } from 'react'
import { useDeflated } from '../../api/queries'
import { Heatmap } from '../../charts/echarts/Heatmap'
import PanelFault, { PanelLoading } from '../../chrome/PanelFault'
import { DEFLATED } from '../../copy/deflated'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import type { DeflatedView } from './deflatedModel'
import {
  basisText,
  clustersText,
  computeEffectiveN,
  dailyTrialNames,
  dsrHeaders,
  dsrRows,
  effectiveNHeatmap,
  estimateRows,
  refusalText,
  windowText,
  type EffectiveNOk,
  type EffectiveNResult,
} from './effectiveNModel'
import { useTrialSeries } from './useTrialSeries'
import './reg.css'

const CHART_ID = 'mt-neff-heatmap'
const NO_NAMES: readonly string[] = []
const ESTIMATE_COLS = ['nDaily', 'nTotal', 'sr0Session', 'sr0Annual'] as const

function Section({ view, children }: { readonly view: DeflatedView | undefined; readonly children: ReactNode }) {
  return (
    <section className="reg-confirm mt-neff" aria-label={EFFECTIVE_N.label}>
      <p className="reg-band">
        <span className="reg-band-title">{EFFECTIVE_N.title}</span>{' '}
        <span className="reg-warn">{SPEC.postHoc}</span>{' '}
        <span className="reg-muted">{view === undefined ? '' : basisText(view)}</span>
      </p>
      <p className="reg-msg reg-muted">{EFFECTIVE_N.computed}</p>
      {children}
    </section>
  )
}

function EstimatesTable({ result }: { readonly result: EffectiveNOk }) {
  const rows = useMemo(() => estimateRows(result), [result])
  const cols = EFFECTIVE_N.estimates.cols
  return (
    <table className="nqt-grid mt-deflated-table">
      <caption className="reg-caption">{EFFECTIVE_N.estimates.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{cols.estimator}</th>
          {ESTIMATE_COLS.map((key) => <th key={key} scope="col" className="num">{cols[key]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-served={row.served ? 'true' : undefined}>
            <th scope="row" className="name">
              {row.label}
              {row.served ? <>{' '}<span className="reg-muted">({EFFECTIVE_N.served})</span></> : null}
            </th>
            {row.cells.map((cell, i) => <td key={ESTIMATE_COLS[i]} className="num">{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DsrTable({ result, view }: { readonly result: EffectiveNOk; readonly view: DeflatedView }) {
  const rows = useMemo(() => dsrRows(result), [result])
  const headers = dsrHeaders(view)
  return (
    <table className="nqt-grid mt-deflated-table">
      <caption className="reg-caption">{EFFECTIVE_N.dsrCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{headers.name}</th>
          <th scope="col" className="num">{headers.periods}</th>
          <th scope="col" className="num">{headers.served}</th>
          <th scope="col" className="num">{headers.participation}</th>
          <th scope="col" className="num">{headers.liJi}</th>
          <th scope="col" className="num">{headers.clusters}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th scope="row" className="name">{row.name}</th>
            <td className="num">{row.periods}</td>
            {row.cells.map((cell, i) => <td key={i} className="num">{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OkView({ result, view }: { readonly result: EffectiveNOk; readonly view: DeflatedView }) {
  const heatmap = useMemo(() => effectiveNHeatmap(result), [result])
  return (
    <>
      <p className="reg-msg">{windowText(result)}</p>
      <EstimatesTable result={result} />
      <p className="reg-msg">{clustersText(result)}</p>
      <div className="mt-neff-chart"><Heatmap data={heatmap} chartId={CHART_ID} /></div>
      <p className="reg-msg reg-muted">{EFFECTIVE_N.diagonalNote}</p>
      <DsrTable result={result} view={view} />
    </>
  )
}

/** A computed result as content: the refusal as a status line, or the estimates, the heatmap and the DSR table. */
function Content({ result, view }: { readonly result: EffectiveNResult; readonly view: DeflatedView }) {
  return result.ok ? <OkView result={result} view={view} /> : <p role="status" className="reg-msg">{refusalText(result.refusal)}</p>
}

/** The whole view over a computed result: the band, the note, then the refusal or the view. */
export function EffectiveNBody({ result, view }: { readonly result: EffectiveNResult; readonly view: DeflatedView }) {
  return (
    <Section view={view}>
      <Content result={result} view={view} />
    </Section>
  )
}

export default function EffectiveNPanel() {
  const query = useDeflated()
  const view = query.data
  const names = useMemo(() => (view === undefined ? NO_NAMES : dailyTrialNames(view)), [view])
  const read = useTrialSeries(names, names.length > 0)
  const finished = view !== undefined && read.done === read.total
  const result = useMemo(
    () => (view !== undefined && finished ? computeEffectiveN({ view, series: read.series, failed: read.failed }) : null),
    [view, finished, read.series, read.failed],
  )
  // One Section for every state, so the region is the same element from loading to the finished view, and one
  // status line for reading and for a refusal, so the refusal reaches a screen reader as a change of the live
  // region it is already in (a remounted region can go unannounced).
  let content: ReactNode
  if (query.isError) {
    content = <PanelFault error={query.error} failedText={DEFLATED.failed} className="reg-msg" />
  } else if (view === undefined) {
    content = <PanelLoading text={DEFLATED.loading} className="reg-msg" />
  } else if (result === null || !result.ok) {
    const reading = result === null
    content = (
      <p role="status" aria-busy={reading} className="reg-msg">
        {reading ? fillCopy(EFFECTIVE_N.reading, { done: read.done, total: read.total }) : refusalText(result.refusal)}
      </p>
    )
  } else {
    content = <OkView result={result} view={view} />
  }
  return <Section view={view}>{content}</Section>
}

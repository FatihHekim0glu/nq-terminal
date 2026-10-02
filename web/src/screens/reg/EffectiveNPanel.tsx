// MT 87) Effective trials (ANALYTICS_CATALOG SV3b, roadmap #19 slice 2): the effective number of trials from the
// registered daily trials' own return correlations, then the SR0 and DSR each N would set. [POST HOC], served by the
// backend as `effective_n` on the SV3 view (analytics/neff.py), an extra view only (no verdict). One GET:
// /api/analytics/deflated (SV3, shared with 85) Family); the browser reads no per-trial series and computes nothing.
// A refusal the data gives (no daily trial, too few common sessions, a trial that does not vary) is a status line,
// never an alert, and draws no matrix; so is an answer that carries no effective_n. A failure of the SV3 view itself is
// the one alert (PanelFault, as on 85). Plain tables and one heatmap: no MonitorGrid and no numbered item.
import { useMemo, type ReactNode } from 'react'
import { useDeflated } from '../../api/queries'
import { Heatmap } from '../../charts/echarts/Heatmap'
import PanelFault, { PanelLoading } from '../../chrome/PanelFault'
import { DEFLATED } from '../../copy/deflated'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { SPEC } from '../../copy/tiles'
import {
  basisText,
  clustersText,
  dsrHeaders,
  dsrRows,
  effectiveNHeatmap,
  estimateRows,
  refusalText,
  servedOf,
  windowText,
} from './effectiveNModel'
import type { DeflatedWithEffective, EffectiveNServed } from './effectiveNTypes'
import './reg.css'

const CHART_ID = 'mt-neff-heatmap'
const ESTIMATE_COLS = ['nDaily', 'nTotal', 'sr0Session', 'sr0Annual'] as const

function Section({ served, children }: { readonly served: EffectiveNServed | null; readonly children: ReactNode }) {
  return (
    <section className="reg-confirm mt-neff" aria-label={EFFECTIVE_N.label}>
      <p className="reg-band">
        <span className="reg-band-title">{EFFECTIVE_N.title}</span>{' '}
        <span className="reg-warn">{SPEC.postHoc}</span>{' '}
        <span className="reg-muted">{served === null ? '' : basisText(served)}</span>
      </p>
      <p className="reg-msg reg-muted">{EFFECTIVE_N.source}</p>
      {children}
    </section>
  )
}

function EstimatesTable({ served }: { readonly served: EffectiveNServed }) {
  const rows = useMemo(() => estimateRows(served), [served])
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

function DsrTable({ served, view }: { readonly served: EffectiveNServed; readonly view: DeflatedWithEffective }) {
  const rows = useMemo(() => dsrRows(served), [served])
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

function OkView({ served, view }: { readonly served: EffectiveNServed; readonly view: DeflatedWithEffective }) {
  const heatmap = useMemo(() => effectiveNHeatmap(served), [served])
  return (
    <>
      {served.window === null ? null : <p className="reg-msg">{windowText(served.window)}</p>}
      <EstimatesTable served={served} />
      <p className="reg-msg">{clustersText(served)}</p>
      <div className="mt-neff-chart"><Heatmap data={heatmap} chartId={CHART_ID} /></div>
      <p className="reg-msg reg-muted">{EFFECTIVE_N.diagonalNote}</p>
      <DsrTable served={served} view={view} />
    </>
  )
}

/** The served view as content: a status line for a refusal or an answer without it, else the estimates, heatmap and DSR table. */
function Content({ served, view }: { readonly served: EffectiveNServed | null; readonly view: DeflatedWithEffective }) {
  if (served === null) return <p role="status" className="reg-msg">{EFFECTIVE_N.notServed}</p>
  if (served.refusal !== null) return <p role="status" className="reg-msg">{refusalText(served.refusal)}</p>
  return <OkView served={served} view={view} />
}

/** The whole view over an SV3 answer: the band, the note, then the status line or the view. */
export function EffectiveNBody({ view }: { readonly view: DeflatedWithEffective }) {
  const served = servedOf(view)
  return (
    <Section served={served}>
      <Content served={served} view={view} />
    </Section>
  )
}

export default function EffectiveNPanel() {
  const query = useDeflated()
  // The generated type has `effective_n` only once the contract is regenerated; the answer carries it either way.
  const view = query.data as DeflatedWithEffective | undefined
  // One Section for every state, so the region is the same element from loading to the finished view.
  let content: ReactNode
  if (query.isError) {
    content = <PanelFault error={query.error} failedText={DEFLATED.failed} className="reg-msg" />
  } else if (view === undefined) {
    content = <PanelLoading text={DEFLATED.loading} className="reg-msg" />
  } else {
    content = <Content served={servedOf(view)} view={view} />
  }
  return <Section served={view === undefined ? null : servedOf(view)}>{content}</Section>
}

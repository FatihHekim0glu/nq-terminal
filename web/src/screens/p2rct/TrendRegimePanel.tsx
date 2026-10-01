// RG2 trend regime panel (TASKS Phase 12; ANALYTICS_CATALOG section 10), a DES-style card beside RG1 on the tear
// sheet's RR tab: NQ above or below its 200-session mean at the session before, per-regime sessions, mean, Sharpe and
// hit rate, and Welch's t above against below. The chart is a LineStack stack (the close and its mean in one pane,
// the regime as the strip under the time axis, the primitive EQ and DD use for RG1), with the same table view.
// No p-value anywhere (a fixed split, still [POST HOC]); a monthly book shows the API's reason instead.
// Presentational: the host passes the /trend-regime response.
import { useMemo } from 'react'
import LineStack from '../../charts/LineStack'
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { Card } from '../tear/TearCard'
import '../tear/tear.css'
import { gateLine, trendRows, trendStack, unlabelledLine, welchLine } from './model'
import type { TrendRegimeView } from './types'
import './p2rct.css'

export interface TrendRegimePanelProps {
  readonly view: TrendRegimeView
  /** The chart's link group; '-' (the default) keeps its crosshair to this card. */
  readonly link?: PanelLink
}

const C = RCT.trend.cols

function TrendChart({ view, link }: { readonly view: TrendRegimeView; readonly link: PanelLink }) {
  const stack = useMemo(() => trendStack(view), [view])
  if (stack === null) return <p className="tear-note">{RCT.trend.chart.empty}</p>
  return (
    <>
      <div className="tear-chart tear-chart-p1">
        <LineStack title={stack.title} t={stack.t} panes={stack.panes} ribbon={stack.ribbon} link={link} />
      </div>
      <p className="tear-note">{RCT.trend.chart.note}</p>
    </>
  )
}

export default function TrendRegimePanel({ view, link = '-' }: TrendRegimePanelProps) {
  if (!view.available) {
    return (
      <Card title={RCT.trend.title} tag={view.tag} className="rct-card">
        <p className="tear-note">{fillCopy(RCT.notShown, { note: view.note ?? '' })}</p>
      </Card>
    )
  }
  const rows = trendRows(view)
  const gate = gateLine(view.gate)
  return (
    <Card title={RCT.trend.title} tag={view.tag} className="rct-card">
      <p className="tear-basis">{view.label}</p>
      <TrendChart view={view} link={link} />
      <table className="nqt-grid tear-kv">
        <caption className="sr-only">{RCT.trend.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{C.regime}</th>
            {[C.n, C.mean, C.sharpe, C.hit].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.regime}>
              <th scope="row" className="name tear-rowhead">{r.name}</th>
              <td className="num">{r.n}</td>
              <td className="num">{r.mean}</td>
              <td className="num tear-value">{r.sharpe}</td>
              <td className="num">{r.hit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tear-note">{welchLine(view)}</p>
      <p className="tear-note">{RCT.trend.noP}</p>
      <p className="tear-note">{unlabelledLine(view)}</p>
      <p className="tear-note">{fillCopy(RCT.trend.unit, { unit: view.unit })}</p>
      <p className="tear-note">{fillCopy(RCT.trend.source, { source: view.source })}</p>
      {gate ? <p className="tear-note rct-gate">{gate}</p> : null}
    </Card>
  )
}

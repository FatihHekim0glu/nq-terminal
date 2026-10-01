// The P2 risk extras on the tear sheet (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5), in the DES-style cards
// the P1 views use (look spec 7.3 card bands; tiles as look spec 7.1), each [POST HOC] and descriptive:
//   RET  PF11 ulcer index and recovery factor tiles, then RK4 modified expected shortfall by level (greyed where it
//        is not defined, the historical CVaR shown beside it with the reason);
//   RR   BR5 Treynor ratio tile, with its CAGR, beta and benchmark in the popover and a note on how to read it.
// Presentational: the tear sheet reads GET .../risk-extras and passes the body (or the pending read's error) in.
import { useMemo } from 'react'
import type { ApiError } from '../../api/client'
import { RISK_EXTRAS as R } from '../../copy/riskExtras'
import { fillCopy } from '../../copy/workspace'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import { Card, Pending } from '../tear/TearCard'
import { drawdownTiles, esMoments, esRows, treynorLine, treynorTile } from './riskExtrasModel'
import type { RiskExtrasView } from './types'

export type RiskExtrasTab = 'RET' | 'RR'

export interface RiskExtrasProps {
  readonly tab: RiskExtrasTab
  readonly data: RiskExtrasView | undefined
  readonly error: ApiError | null
}

function DrawdownCard({ view }: { readonly view: RiskExtrasView }) {
  const tiles = useMemo(() => drawdownTiles(view), [view])
  return (
    <Card title={R.drawdown.title} tag={view.tag}>
      <KpiRow label={R.drawdown.label}>
        {tiles.map((t) => <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} description={t.description} unit={t.unit} />)}
      </KpiRow>
    </Card>
  )
}

const C = R.es.cols

function EsCard({ view }: { readonly view: RiskExtrasView }) {
  const rows = useMemo(() => esRows(view), [view])
  const es = view.modified_es
  return (
    <Card title={R.es.title} tag={view.tag} className="tear-card-span2">
      <table className="nqt-grid tear-kv">
        <caption className="tear-caption">{fillCopy(R.es.caption, { horizon: es.horizon })}</caption>
        <thead>
          <tr>
            <th scope="col">{C.level}</th>
            {[C.gaussian, C.historical, C.modified, C.raw, C.value].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
            <th scope="col">{C.used}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.level}>
              <th scope="row" className="name tear-rowhead">{r.level}</th>
              <td className={r.greyed ? ['num', 'muted'].join(' ') : 'num'}>{r.gaussian}</td>
              <td className="num">{r.historical}</td>
              <td className="num">{r.modified}</td>
              <td className="num muted">{r.raw}</td>
              <td className="num tear-value">{r.value}</td>
              <td className={r.greyed ? 'muted' : undefined} title={r.method}>{r.used}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tear-note">{esMoments(view)}</p>
      <p className="tear-note">{es.domain}</p>
      <p className="tear-note">{R.es.source}</p>
    </Card>
  )
}

function TreynorCard({ view }: { readonly view: RiskExtrasView }) {
  const t = useMemo(() => treynorTile(view), [view])
  const line = treynorLine(view)
  return (
    <Card title={R.treynor.title} tag={view.tag}>
      <KpiRow label={R.treynor.label}>
        <KpiTile kpi={t.kpi} decimals={t.decimals} description={t.description} unit={t.unit} />
      </KpiRow>
      {line ? <p className="tear-note">{line}</p> : null}
    </Card>
  )
}

/** The risk extras cards of one tab; a read still on its way, or refused, says so in a card of its own. */
export default function RiskExtras({ tab, data, error }: RiskExtrasProps) {
  if (!data) {
    const title = tab === 'RET' ? R.drawdown.title : R.treynor.title
    return <Card title={title}><Pending error={error} failed={R.failed} loading={R.loading} /></Card>
  }
  if (tab === 'RR') return <TreynorCard view={data} />
  return (
    <>
      <DrawdownCard view={data} />
      <EsCard view={data} />
    </>
  )
}

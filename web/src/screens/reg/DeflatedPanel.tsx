// SV3 on MT (ANALYTICS_CATALOG SV3, SV3a): the Deflated Sharpe over every registered hypothesis on one daily
// basis, [POST HOC] and an extra view only. One GET, /api/analytics/deflated: the family facts (N, V, SR0),
// the trial the API names as dominating V, V0 and its SR0, the leave-one-out line and what N assumes, the DSR
// under V0 by trial as a bar ladder (its own summary and table view) and the full table under V and V0. No pass or fail is drawn from it.
import { useId, useMemo } from 'react'
import { useDeflated } from '../../api/queries'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { DEFLATED } from '../../copy/deflated'
import { fillCopy } from '../../copy/workspace'
import { deflatedFacts, deflatedLadder, deflatedNullFacts, deflatedRows, type DeflatedView } from './deflatedModel'

const C = DEFLATED.cols
const NUMERIC = ['periods', 'n', 'annual', 'srSession', 'skew', 'kurt', 'srOwn', 'sr0', 'dsr', 'sr0Null', 'dsrNull'] as const

function Table({ view }: { readonly view: DeflatedView }) {
  const rows = useMemo(() => deflatedRows(view), [view])
  return (
    <table className="nqt-grid mt-deflated-table">
      <caption className="reg-caption">{DEFLATED.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{C.name}</th>
          <th scope="col">{C.kind}</th>
          {NUMERIC.map((k) => <th key={k} scope="col" className="num">{C[k]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row" className="name">{r.name}</th>
            <td>{r.kind}</td>
            {NUMERIC.map((k) => <td key={k} className="num">{r[k]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DeflatedBody({ view }: { readonly view: DeflatedView }) {
  const ladder = useMemo(() => deflatedLadder(view), [view])
  const chartId = `mt-deflated-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <>
      <p className="reg-msg">{deflatedFacts(view)}</p>
      {deflatedNullFacts(view).map((line) => <p key={line} className="reg-msg">{line}</p>)}
      <p className="reg-msg reg-muted">{`${view.label}. ${view.monthly_note}. ${view.construction}.`}</p>
      <div className="mt-deflated-chart"><BarLadder data={ladder} chartId={chartId} /></div>
      <Table view={view} />
    </>
  )
}

export default function DeflatedPanel() {
  const query = useDeflated()
  return (
    <section className="reg-confirm mt-deflated" aria-label={DEFLATED.label}>
      <p className="reg-band">
        <span className="reg-band-title">{DEFLATED.title}</span>{' '}
        <span className="reg-warn">{query.data?.tag ?? ''}</span>{' '}
        <span className="reg-muted">{DEFLATED.extra}</span>
      </p>
      {query.isError ? (
        <p className="reg-msg down" role="alert">{fillCopy(DEFLATED.failed, { detail: query.error.detail })}</p>
      ) : query.data ? (
        <DeflatedBody view={query.data} />
      ) : (
        <p className="reg-msg" role="status">{DEFLATED.loading}</p>
      )}
    </section>
  )
}

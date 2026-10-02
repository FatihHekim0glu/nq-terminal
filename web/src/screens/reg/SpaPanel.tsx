// SV8 on MT, the view 88) Family test beside 85) Family, 86) Replication and 87) Effective trials (ANALYTICS_CATALOG
// SV8): the family test over the pre-registered NQ hypotheses on one contract against cash, with NQ buy and hold as a
// second, separately labelled row (the same GET nests it). One GET,
// /api/analytics/spa, passed in as `query` (MtScreen's `useSpa(view === 'spa')`, so nothing is read until the view is
// open). It shows the family facts, the SPA p-values (consistent, lower, upper) and White's Reality Check, StepM's
// rejections, the effective number of members (served by the backend from the correlation of their differentials, with
// 87)'s estimators; spaEffectiveModel words it), a member table and the registered hypotheses outside the family with
// their reasons. [POST HOC]: the p-values are
// family-wise over a family fixed by a rule on the registry, never over a slice picked on screen, and no pass or
// fail is drawn for any single hypothesis.
import { useId, useMemo } from 'react'
import { SPA } from '../../copy/spa'
import { fillCopy } from '../../copy/workspace'
import { effectiveLines } from './spaEffectiveModel'
import { spaBootstrapLine, spaCaption, spaExcluded, spaFacts, spaNotes, spaPValues, spaRows, spaStepM } from './spaModel'
import type { SpaQueryState, SpaView } from './spaTypes'
import './spa.css'

const C = SPA.cols
const NUMERIC = ['meanReturn', 'meanDiff', 'block'] as const

function MemberTable({ view }: { readonly view: SpaView }) {
  const rows = useMemo(() => spaRows(view), [view])
  return (
    <table className="nqt-grid mt-spa-table">
      <caption className="reg-caption">{spaCaption(view)}</caption>
      <thead>
        <tr>
          <th scope="col">{C.name}</th>
          {NUMERIC.map((k) => <th key={k} scope="col" className="num">{C[k]}</th>)}
          <th scope="col">{C.consistent}</th>
          <th scope="col">{C.stepm}</th>
          <th scope="col" className="num">{C.leftOut}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row" className="name">{r.name}</th>
            {NUMERIC.map((k) => <td key={k} className="num">{r[k]}</td>)}
            <td>{r.consistent}</td>
            <td className={r.rejected ? 'mt-spa-rejected' : undefined}>{r.stepm}</td>
            <td className="num">{r.leftOut}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Excluded({ view }: { readonly view: SpaView }) {
  const lines = useMemo(() => spaExcluded(view), [view])
  const headingId = `mt-spa-excluded-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  if (lines.length === 0) return <p className="reg-msg reg-muted">{SPA.excludedEmpty}</p>
  return (
    <>
      <p className="reg-msg reg-caption" id={headingId}>{SPA.excludedHeading}</p>
      <ul className="mt-spa-excluded" aria-labelledby={headingId}>
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </>
  )
}

/** The second row: the same family against NQ buy and hold, a harder null, named as such beside the cash row. */
function BuyAndHoldRow({ view }: { readonly view: SpaView }) {
  return (
    <div role="group" aria-label={SPA.heldHeading} className="mt-spa-held">
      <p className="reg-msg reg-caption">{SPA.heldHeading}</p>
      <p className="reg-msg reg-muted">{SPA.heldNote}</p>
      {spaFacts(view).map((line) => <p key={line} className="reg-msg">{line}</p>)}
      <p className="reg-msg mt-spa-result">{spaPValues(view)}</p>
      <p className="reg-msg mt-spa-result">{spaStepM(view)}</p>
      <MemberTable view={view} />
    </div>
  )
}

/** SV8's effective number of members as the backend serves it (SV3b's estimators over the correlation), in the page's words. */
function EffectiveMembers({ view }: { readonly view: SpaView }) {
  const lines = useMemo(() => effectiveLines(view.effective_members), [view])
  return (
    <>
      {lines.map((line, i) => <p key={line} className={i === 0 ? 'reg-msg' : 'reg-msg reg-muted'}>{line}</p>)}
    </>
  )
}

export function SpaBody({ view }: { readonly view: SpaView }) {
  return (
    <>
      {spaFacts(view).map((line) => <p key={line} className="reg-msg">{line}</p>)}
      <p className="reg-msg mt-spa-result">{spaPValues(view)}</p>
      <p className="reg-msg mt-spa-result">{spaStepM(view)}</p>
      <p className="reg-msg reg-muted">{spaBootstrapLine(view)}</p>
      <EffectiveMembers view={view} />
      <MemberTable view={view} />
      {view.buy_and_hold ? <BuyAndHoldRow view={view.buy_and_hold} /> : null}
      <Excluded view={view} />
      {spaNotes(view).map((line) => <p key={line} className="reg-msg reg-muted">{line}</p>)}
    </>
  )
}

export default function SpaPanel({ query }: { readonly query: SpaQueryState }) {
  // The generated type has `effective_members` only once the contract is regenerated; the answer carries it either way.
  const view = query.data as SpaView | undefined
  return (
    <section className="reg-confirm mt-spa" aria-label={SPA.label}>
      <p className="reg-band">
        <span className="reg-band-title">{SPA.title}</span>{' '}
        <span className="reg-warn">{view?.tag ?? ''}</span>{' '}
        <span className="reg-muted">{SPA.extra}</span>
      </p>
      {query.isError ? (
        <p className="reg-msg down" role="alert">{fillCopy(SPA.failed, { detail: query.error?.detail ?? '' })}</p>
      ) : view ? (
        <SpaBody view={view} />
      ) : (
        <p className="reg-msg" role="status">{SPA.loading}</p>
      )}
    </section>
  )
}

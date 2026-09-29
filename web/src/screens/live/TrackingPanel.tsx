// LV5 on LIVE (ANALYTICS_CATALOG section 13): the paper book's P&L against the rule's target on the same
// closes, [POST HOC] and descriptive, performance rows only. One GET, /api/analytics/paper-tracking, refreshed
// by the live stream like the other journal views. The chart is a LineStack (its own summary and table view).
import { useMemo } from 'react'
import { usePaperTracking } from '../../api/queries.screens'
import LineStack from '../../charts/LineStack'
import { TRACKING } from '../../copy/tracking'
import { fillCopy } from '../../copy/workspace'
import { trackingView, type PaperTracking } from './trackingModel'

function Body({ tr }: { readonly tr: PaperTracking }) {
  const view = useMemo(() => trackingView(tr), [tr])
  const basis = fillCopy(TRACKING.unitLine, { basis: tr.basis, unit: tr.unit, multiplier: String(tr.multiplier), label: tr.label })
  return (
    <>
      <p className="live-message">{basis}</p>
      {tr.plumbing_rows_skipped > 0 ? <p className="live-message">{fillCopy(TRACKING.plumbing, { n: tr.plumbing_rows_skipped })}</p> : null}
      {view.kind === 'ok' ? (
        <>
          {view.undated > 0 ? <p className="live-message">{fillCopy(TRACKING.undated, { n: view.undated })}</p> : null}
          <div className="live-tracking-chart">
            <LineStack title={fillCopy(TRACKING.chartTitle, { journal: tr.journal })} t={view.t} panes={view.panes} link="-" fence={null} initialRange="Max" />
          </div>
          <p className="live-message">{view.summary}</p>
        </>
      ) : (
        <p className="live-message">{view.text}</p>
      )}
    </>
  )
}

export default function TrackingPanel() {
  const query = usePaperTracking()
  return (
    <section className="live-tracking" aria-label={TRACKING.label}>
      <h3 className="live-section">
        {TRACKING.title} {query.data ? <span className="live-readonly">{query.data.tag}</span> : null}
      </h3>
      {query.isError ? (
        <p className="live-message" role="alert">{fillCopy(TRACKING.failed, { detail: query.error.detail })}</p>
      ) : query.data ? (
        <Body tr={query.data} />
      ) : (
        <p className="live-message">{TRACKING.loading}</p>
      )}
    </section>
  )
}

// LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13): the paper book against its backtest expectation. The paper and
// model cumulative P&L of LV5, as a fraction of K, placed pointwise on one of two served cones, chosen with a toggle:
// the SV6 cone of the hypothesis that owns the paper journal (backtest start) or a cone resampled from the paper book's
// own sessions (live start). [POST HOC], descriptive and served (GET /api/analytics/paper-expectation): no alarm and
// no verdict, only where the paths sit.
//
// Two GETs: the expectation, and the paper tracking that LV5 already reads (shared cache, no second request). A failed
// tracking read is words here, not an alert: LV5 announces it, so a second alert would say the same failure twice.
// The expectation is re-read once a minute (a paper session adds one row a day, and the backtest cone is cached on the
// server), so the card follows the journal without polling at the live views' 2 s.
import { useMemo, useState, type ReactNode } from 'react'
import type { ApiError } from '../../api/client'
import { useApiQuery } from '../../api/queries'
import { usePaperTracking } from '../../api/queries.screens'
import { Cone } from '../../charts/echarts/Cone'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { CONE_STARTS, EXPECTATION_TAG, expectationView, type ConeStart, type ExpectationView, type PaperExpectation } from './expectationModel'

/** The chart's id: names its draw measure. */
const CHART_ID = 'live-expectation'
/** How often the served expectation is re-read. */
const EXPECTATION_POLL_MS = 60_000
const TOGGLE_OPTIONS = CONE_STARTS.map((value) => ({ value, label: EXPECTATION.start[value] }))

/** What the card shows: a view (the cone or the words for a refusal), or that a read is pending or failed. */
export type ExpectationState =
  | ExpectationView
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly detail: string }

function Body({ state }: { readonly state: ExpectationState }) {
  switch (state.kind) {
    case 'ok':
      return (
        <>
          <div className="live-expectation-chart">
            <Cone data={state.cone} chartId={CHART_ID} />
          </div>
          {state.lines.map((line) => <p key={line} className="live-message">{line}</p>)}
          <p className="live-message live-expectation-computed">{EXPECTATION.computed}</p>
        </>
      )
    case 'refused':
      return <p className="live-message">{state.text}</p>
    case 'failed':
      return <p className="live-message" role="alert">{fillCopy(EXPECTATION.failed, { detail: state.detail })}</p>
    case 'loading':
      return <p className="live-message">{EXPECTATION.loading}</p>
  }
}

/** The card for a state, with the cone toggle when one is given: pure, so the gallery draws it from fixtures. */
export function ExpectationCard({ state, toggle }: { readonly state: ExpectationState; readonly toggle?: ReactNode }) {
  return (
    <section className="live-expectation" aria-label={EXPECTATION.label}>
      <h3 className="live-section">
        {EXPECTATION.title} <span className="live-readonly">{EXPECTATION_TAG}</span>
      </h3>
      {toggle}
      <Body state={state} />
    </section>
  )
}

const asStart = (value: string): ConeStart => (value === 'live' ? 'live' : 'backtest')

/** The view of a served expectation on the chosen cone, and the toggle between the two cones when both are served. */
function useServedView(served: PaperExpectation | undefined, initial: ConeStart): { view: ExpectationView | null; toggle?: ReactNode } {
  const [start, setStart] = useState<ConeStart>(initial)
  const view = useMemo(() => (served ? expectationView(served, start) : null), [served, start])
  if (!view?.switchable) return { view }
  const toggle = (
    <ToggleGroup label={EXPECTATION.start.label} options={TOGGLE_OPTIONS} value={start} onChange={(value) => setStart(asStart(value))} />
  )
  return { view, toggle }
}

/** A served view with its cone toggle (backtest start first unless `initial` says otherwise): the gallery's card. */
export function ServedExpectation({ served, initial = 'backtest' }: { readonly served: PaperExpectation; readonly initial?: ConeStart }) {
  const { view, toggle } = useServedView(served, initial)
  return <ExpectationCard state={view ?? LOADING} toggle={toggle} />
}

interface Read {
  readonly isError: boolean
  readonly error: ApiError | null
}

const LOADING: ExpectationState = { kind: 'loading' }

/** The words for a read that is not in yet or failed, in the order the card needs them; null once the view is in. */
function unsettled(tracking: Read, served: Read & { readonly data: PaperExpectation | undefined }): ExpectationState | null {
  if (tracking.isError) return { kind: 'refused', text: EXPECTATION.noTracking, switchable: false }
  if (served.isError) return { kind: 'failed', detail: served.error?.detail ?? '' }
  return served.data === undefined ? LOADING : null
}

export default function ExpectationPanel() {
  const tracking = usePaperTracking()
  const served = useApiQuery('/api/analytics/paper-expectation', { query: {} }, { refetchInterval: EXPECTATION_POLL_MS })
  const { view, toggle } = useServedView(served.data, 'backtest')
  const pending = unsettled(tracking, served)
  // One card element whatever the state, so the section (and the focus inside it) survives the reads coming in.
  return <ExpectationCard state={pending ?? view ?? LOADING} toggle={pending === null ? toggle : undefined} />
}

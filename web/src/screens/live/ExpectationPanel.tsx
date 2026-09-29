// LV6 on LIVE (ANALYTICS_CATALOG section 13): the paper book against its backtest expectation. The paper and model
// cumulative P&L of LV5, as a fraction of K, placed pointwise on the SV6 cone of the hypothesis that owns the paper
// journal. [POST HOC], descriptive, computed in the browser (C8): no alarm and no verdict, only where the path sits.
//
// GETs only, in the tear sheet's own request shapes (screens/tear/tearQueries.ts): the hypothesis's bootstrap at its
// default cost, and the linked Nautilus run's analytics at D for K (its served capital). Both wait until the paper
// tracking has a finite value. The tracking, hypothesis and run list reads share the app's cache with the other panels.
import { useMemo } from 'react'
import type { ApiError } from '../../api/client'
import { useApiQuery, useRuns } from '../../api/queries'
import { useHypothesis, usePaperTracking } from '../../api/queries.screens'
import { Cone } from '../../charts/echarts/Cone'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { defaultCost } from '../tear/tearQueries'
import {
  EXPECTATION_TAG,
  capitalRun,
  expectationGate,
  expectationView,
  paperBookHypothesis,
  trackingHasValue,
  type ExpectationView,
} from './expectationModel'

/** The chart's id: names its draw measure. */
const CHART_ID = 'live-expectation'
/** The run analytics answers this when the run's balance check failed: a refusal, not a failed read. */
const REFUSED_STATUS = 422

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

/** The card for a state: pure, so the gallery draws it from fixtures without a request. */
export function ExpectationCard({ state }: { readonly state: ExpectationState }) {
  return (
    <section className="live-expectation" aria-label={EXPECTATION.label}>
      <h3 className="live-section">
        {EXPECTATION.title} <span className="live-readonly">{EXPECTATION_TAG}</span>
      </h3>
      <Body state={state} />
    </section>
  )
}

interface Read {
  readonly data: unknown
  readonly isError: boolean
  readonly error: ApiError | null
}

const LOADING: ExpectationState = { kind: 'loading' }
const waiting = (read: Read): boolean => read.data === undefined && !read.isError
const failed = (read: Read): ExpectationState => ({ kind: 'failed', detail: read.error?.detail ?? '' })

interface Reads {
  readonly tracking: Read
  readonly detail: Read
  readonly runs: Read
  readonly run: Read
  readonly boot: Read
}

interface Known {
  readonly valued: boolean
  readonly hypothesis: string | null
  readonly runId: string | null
  /** What expectationGate says of the reads so far: a refusal that needs no cone, or null. */
  readonly gate: string | null
}

/**
 * A read that failed or has not answered, in the order the card needs them, or null when the view can be made:
 * every read it needs is in, or the words of a refusal do not need the rest. A 422 from the run analytics is the
 * API refusing a run (its balance check failed), so it is a refusal, not a failed read. A failed paper tracking
 * read is words, not an alert: LV5 reads the same query and already announces it, so a second alert would say
 * the same failure twice. Only the reads LV6 alone makes (hypothesis, runs, bootstrap, run analytics) alert.
 */
function unsettled({ tracking, detail, runs, run, boot }: Reads, known: Known): ExpectationState | null {
  if (tracking.isError) return { kind: 'refused', text: EXPECTATION.noTracking }
  if (waiting(tracking)) return LOADING
  if (!known.valued || known.hypothesis === null) return null
  for (const read of [detail, runs]) {
    if (read.isError) return failed(read)
    if (waiting(read)) return LOADING
  }
  if (known.runId !== null) {
    if (run.isError && run.error?.status !== REFUSED_STATUS) return failed(run)
    if (waiting(run)) return LOADING
  }
  if (known.gate !== null) return null
  if (boot.isError) return failed(boot)
  return waiting(boot) ? LOADING : null
}

/** The reads the card needs, and the state they are in. */
function useExpectationState(): ExpectationState {
  const tracking = usePaperTracking()
  const hypothesis = paperBookHypothesis(tracking.data?.journal)
  const detail = useHypothesis(hypothesis ?? '')
  const runs = useRuns()
  const card = detail.data?.card
  const cost = card ? defaultCost(card.series_costs) : null
  const runId = card && runs.data ? capitalRun(card, runs.data) : null
  const valued = trackingHasValue(tracking.data)
  const boot = useApiQuery(
    '/api/analytics/hypothesis/{name}/bootstrap',
    { path: { name: hypothesis ?? '' }, query: cost === null ? {} : { cost } },
    { enabled: valued && hypothesis !== null && cost !== null },
  )
  const run = useApiQuery(
    '/api/analytics/run/{run_id}',
    { path: { run_id: runId ?? '' }, query: { freq: 'D' } },
    { enabled: valued && runId !== null },
  )
  const capital = run.data?.capital ?? null
  const gate = expectationGate({ tracking: tracking.data, capital, runId, hypothesis, cost })
  const view = useMemo(
    () => expectationView({ tracking: tracking.data, boot: boot.data, capital, runId, hypothesis, cost }),
    [tracking.data, boot.data, capital, runId, hypothesis, cost],
  )
  return unsettled({ tracking, detail, runs, run, boot }, { valued, hypothesis, runId, gate }) ?? view
}

export default function ExpectationPanel() {
  return <ExpectationCard state={useExpectationState()} />
}

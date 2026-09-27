// LV5 on LIVE (ANALYTICS_CATALOG section 13): paper P&L against the rule's target on the same closes, from
// GET /api/analytics/paper-tracking. Pure: the chart keeps only rows with a time (the axis must ascend), the
// values are the API's, and the summary repeats the API's totals with its unit. Plumbing rows never reach
// this view: the API refuses them and says how many it dropped.
import type { Schemas } from '../../api/types'
import type { LineStackPane } from '../../charts/LineStack.types'
import { TRACKING } from '../../copy/tracking'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'

export type PaperTracking = Schemas['PaperTracking']

export type TrackingView =
  | { readonly kind: 'absent'; readonly text: string; readonly summary: null }
  | { readonly kind: 'empty'; readonly text: string; readonly summary: string }
  | {
      readonly kind: 'ok'
      readonly t: readonly number[]
      readonly panes: readonly LineStackPane[]
      readonly undated: number
      readonly summary: string
    }

const hasNumber = (values: ReadonlyArray<number | null>) => values.some((v) => typeof v === 'number' && Number.isFinite(v))

function summary(tr: PaperTracking): string {
  return fillCopy(TRACKING.summary, {
    n: formatNumber(tr.n, 0, { thousands: true }),
    total: formatNumber(tr.total_difference, 2, { signed: true, thousands: true }),
    sd: formatNumber(tr.tracking_sd, 2, { thousands: true }),
  })
}

export function trackingView(tr: PaperTracking): TrackingView {
  if (!tr.present) return { kind: 'absent', text: tr.empty_state ?? TRACKING.empty, summary: null }
  if (!hasNumber(tr.paper_cumulative) && !hasNumber(tr.model_cumulative)) return { kind: 'empty', text: TRACKING.empty, summary: summary(tr) }
  const keep = tr.t.flatMap((t, i) => (typeof t === 'number' && Number.isFinite(t) ? [i] : []))
  const pick = (values: ReadonlyArray<number | null>) => keep.map((i) => values[i] ?? null)
  const cumulative: LineStackPane = {
    id: 'cumulative', weight: 2, decimals: 2,
    series: [
      { name: TRACKING.paperSeries, style: 'primary', values: pick(tr.paper_cumulative) },
      { name: TRACKING.modelSeries, style: 'benchmark', values: pick(tr.model_cumulative) },
    ],
  }
  const difference: LineStackPane = {
    id: 'difference', weight: 1, decimals: 2, zero: 'white', signed: true,
    series: [{ name: TRACKING.differenceSeries, style: 'perfDiff', values: pick(tr.difference) }],
  }
  return { kind: 'ok', t: keep.map((i) => tr.t[i] as number), panes: [cumulative, difference], undated: tr.t.length - keep.length, summary: summary(tr) }
}

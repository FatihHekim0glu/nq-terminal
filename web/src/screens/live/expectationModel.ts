// The paper path on the SV6 cone (ROADMAP 17 step 1; ANALYTICS_CATALOG SV6 cone, LV6 paper path). [POST HOC]
//
// The paper book's cumulative P&L (USD, from /api/live/tracking) is divided by K, the served capital of the
// Nautilus reproduction behind the hypothesis, and placed step by step on the hypothesis's stationary-bootstrap
// cone (fraction of K, summed, pointwise percentiles p5 to p95). The placement says where the path sits among
// resampled history; it is descriptive, never a verdict, and it is computed in the browser (C8), not served.
//
// pathOnCone is pinned by qa/crosscheck/p12_expectation.py (numpy: usd / K, searchsorted side='right'): the
// golden file qa/golden/p12_expectation.json is read by expectationModel.test.ts, case by case. The view that
// shows it (expectationView, the panel) arrives with the LIVE card; this file holds the pure part.
import type { Schemas } from '../../api/types'

/** The band a value sits in, named by the percentiles around it (p5to25 is at or above p5 and below p25). */
export const CONE_BANDS = ['below5', 'p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'] as const
export type ConeBandName = (typeof CONE_BANDS)[number]

/** The five percentiles of the cone at one step: p5, p25, p50, p75, p95. */
export type ConePercentiles = readonly [number, number, number, number, number]

const PERCENTILE_KEYS = ['5', '25', '50', '75', '95'] as const
type PercentileKey = (typeof PERCENTILE_KEYS)[number]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The band of `value` among five percentiles: the count of percentiles at or below it, named. A value exactly on
 * a percentile is in the band above it (numpy.searchsorted side='right'). Null when the value or a percentile is
 * not a finite number, or the percentiles are not in ascending order (a placement against crossing percentiles
 * would say nothing).
 */
export function coneBand(value: number, q: ConePercentiles): ConeBandName | null {
  if (!finite(value) || q.length !== PERCENTILE_KEYS.length || !q.every(finite)) return null
  if (q.some((p, i) => i > 0 && p < q[i - 1]!)) return null
  return CONE_BANDS[q.filter((p) => p <= value).length]!
}

export interface PathOnConeInput {
  /** Cumulative P&L in USD, one entry per journal row; null before the first performance row and in a gap. */
  readonly usd: ReadonlyArray<number | null>
  /** K in USD: the served capital of the linked Nautilus reproduction. Must be finite and above zero. */
  readonly capital: number
  /** The cone's pointwise percentiles by step, in the cone's own unit (fraction of K). */
  readonly quantiles: Readonly<Record<PercentileKey, ReadonlyArray<number | null>>>
  /** The cone's number of steps. */
  readonly horizon: number
}

export interface PathOnCone {
  /** Index of the first row with a finite value, or null when there is none. Step 1 of the cone is this row. */
  readonly firstIndex: number | null
  /** Length `horizon`: step k is usd[firstIndex + k - 1] / capital, null where the row is absent or has no value. */
  readonly fraction: ReadonlyArray<number | null>
  /** Length `horizon`: the band of each fraction, null where it is null or a percentile is missing at that step. */
  readonly bands: ReadonlyArray<ConeBandName | null>
  /** Rows with a finite value after step `horizon`: counted, never placed. */
  readonly beyond: number
}

function percentilesAt(quantiles: PathOnConeInput['quantiles'], step: number): ConePercentiles | null {
  const cut = PERCENTILE_KEYS.map((key) => (quantiles[key] as ReadonlyArray<number | null> | undefined)?.[step])
  return cut.every(finite) ? (cut as unknown as ConePercentiles) : null
}

/**
 * Places a cumulative USD path on the cone, step by step. [POST HOC] basis: fraction of K = usd / capital; unit:
 * fraction of K, like the cone. Steps count journal rows from the first one with a value, not dates. Pinned by
 * qa/crosscheck/p12_expectation.py. Throws on a capital that is not finite or not above zero, and on a horizon
 * that is not a non-negative whole number.
 */
export function pathOnCone(input: PathOnConeInput): PathOnCone {
  const { usd, capital, quantiles, horizon } = input
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('capital must be a positive finite number')
  if (!Number.isInteger(horizon) || horizon < 0) throw new Error('horizon must be a non-negative whole number')
  const empty = (): null[] => Array.from({ length: horizon }, () => null)
  const first = usd.findIndex(finite)
  if (first < 0) return { firstIndex: null, fraction: empty(), bands: empty(), beyond: 0 }

  const fraction: Array<number | null> = []
  const bands: Array<ConeBandName | null> = []
  for (let step = 0; step < horizon; step += 1) {
    const value = usd[first + step]
    if (!finite(value)) {
      fraction.push(null)
      bands.push(null)
      continue
    }
    const share = value / capital
    const cut = percentilesAt(quantiles, step)
    fraction.push(share)
    bands.push(cut === null ? null : coneBand(share, cut))
  }
  return { firstIndex: first, fraction, bands, beyond: usd.slice(first + horizon).filter(finite).length }
}

/** The paper books that follow a registered hypothesis: the journal file name and the hypothesis behind it. */
export const PAPER_BOOKS: ReadonlyArray<{ readonly journal: RegExp; readonly hypothesis: string }> = [
  { journal: /^volmanaged_paper_journal\b/, hypothesis: 'volmanaged_v0' },
]

/** The hypothesis whose cone a paper journal is placed on, or null for a journal no registered hypothesis owns. */
export function paperBookHypothesis(journal: string | null | undefined): string | null {
  if (!journal) return null
  return PAPER_BOOKS.find((book) => book.journal.test(journal))?.hypothesis ?? null
}

type CardRuns = Pick<Schemas['HypothesisCard'], 'nautilus_runs'>
type RunBadges = Pick<Schemas['RunSummary'], 'run_id' | 'balance_ok' | 'is_probe'> & { readonly readable?: boolean }

/**
 * The run whose served capital is K: the first of the card's Nautilus runs that is not a probe, is readable and
 * has not failed its balance check (an unanswered check is accepted). While the run list loads (`undefined`) the
 * card's first run stands in; once loaded, a run the list does not know is skipped. Null when none qualifies.
 */
export function capitalRun(card: CardRuns, runs: ReadonlyArray<RunBadges> | undefined): string | null {
  if (runs === undefined) return card.nautilus_runs[0] ?? null
  const byId = new Map(runs.map((r) => [r.run_id, r]))
  return card.nautilus_runs.find((id) => {
    const run = byId.get(id)
    return run !== undefined && !run.is_probe && run.balance_ok !== false && run.readable !== false
  }) ?? null
}

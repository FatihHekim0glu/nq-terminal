// Synthetic data for MT 87) Effective trials: NOT RESEARCH DATA. A seeded panel of nine daily trials with planted
// correlation blocks plus two monthly books, and a served-shaped DeflatedView built from that panel with the same
// quant functions the browser formula uses, so every anchor check of effectiveNModel.ts passes on it. The gallery
// (EffectiveN.gallery.tsx) draws the full view from it, and the tests tamper with it one number at a time.
// buildSyntheticView also takes any other panel (the tests give it the golden panel of qa/golden/p12_neff.json).
import type { Schemas } from '../../api/types'
import { mulberry32, tradingDays } from '../../gallery/fixtures'
import { expectedMaxSr0, probabilisticSharpe, sessionSharpe } from '../../quant/trials'
import type { DeflatedView } from './deflatedModel'
import type { TrialSeries } from './effectiveNModel'

export const SYNTHETIC_SEED = 20260929
export const SYNTHETIC_SESSIONS = 600
/** The Euler-Mascheroni constant as the served view sends it (euler_gamma). */
export const EULER_GAMMA = 0.5772156649015329

const DAILY_SD = 0.01
/** Planted blocks: within-block correlation is about loading^2 (0.72, 0.58, and none for the singles). */
const BLOCKS: ReadonlyArray<{ readonly prefix: string; readonly size: number; readonly loading: number }> = [
  { prefix: 'a', size: 4, loading: 0.85 },
  { prefix: 'b', size: 3, loading: 0.76 },
  { prefix: 'c', size: 1, loading: 0 },
  { prefix: 'd', size: 1, loading: 0 },
]
const DRIFTS: readonly number[] = [0.0011, 0.0009, 0.0012, 0.0007, 0.0008, 0.0006, 0.001, 0.0005, 0.0009]

/** A monthly book in the synthetic view: its own-period (monthly) Sharpe and moments. */
export interface MonthlyBook {
  readonly name: string
  readonly n: number
  readonly sr: number
  readonly skew: number
  readonly kurt: number
}

export const SYNTHETIC_MONTHLY: readonly MonthlyBook[] = [
  { name: 'syn_m1', n: 120, sr: 0.31, skew: -0.2, kurt: 3.4 },
  { name: 'syn_m2', n: 96, sr: 0.18, skew: 0.3, kurt: 4.1 },
]

function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), Number.MIN_VALUE)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
}

function isoDates(count: number): string[] {
  return tradingDays(count, '2019-01-02').map((seconds) => new Date(seconds * 1000).toISOString().slice(0, 10))
}

/** Nine daily trials over 600 sessions, in three planted blocks of four, three and one plus one more single. */
export function syntheticPanel(seed = SYNTHETIC_SEED, sessions = SYNTHETIC_SESSIONS): TrialSeries[] {
  const draw = gaussian(mulberry32(seed))
  const date = isoDates(sessions)
  const panel: TrialSeries[] = []
  let index = 0
  for (const block of BLOCKS) {
    const factor = Array.from({ length: sessions }, () => draw())
    for (let k = 1; k <= block.size; k += 1) {
      const drift = DRIFTS[index] ?? 0
      const own = Math.sqrt(1 - block.loading * block.loading)
      const r = factor.map((f) => drift + DAILY_SD * (block.loading * f + own * draw()))
      panel.push({ name: `syn_${block.prefix}${k}`, date, r })
      index += 1
    }
  }
  return panel
}

/** Population skewness and raw kurtosis (normal 3), the SV3a moments (bias=True). */
function moments(values: readonly number[]): { skew: number; kurt: number } {
  const n = values.length
  const mean = values.reduce((sum, x) => sum + x, 0) / n
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const x of values) {
    const d = x - mean
    m2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
  }
  m2 /= n
  m3 /= n
  m4 /= n
  return { skew: m3 / m2 ** 1.5, kurt: m4 / (m2 * m2) }
}

interface Book {
  readonly name: string
  readonly kind: string
  readonly periods: number
  readonly n: number
  readonly sr: number
  readonly skew: number
  readonly kurt: number
}

function sampleVariance(values: readonly number[]): number {
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length
  return values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1)
}

/**
 * A served-shaped SV3 view over the panel and the monthly books: N = all of them, V the sample variance of the
 * per-session Sharpe ratios, V0 the mean of 1/(n - 1) x P/252, SR0 by expectedMaxSr0 and every DSR by
 * probabilisticSharpe in the row's own period (SV3a steps 4 to 6). The numbers come from the same functions the
 * browser formula uses, so a check that recomputes them reproduces them.
 */
export function buildSyntheticView(daily: readonly TrialSeries[], monthly: readonly MonthlyBook[] = SYNTHETIC_MONTHLY): DeflatedView {
  const books: Book[] = [
    ...daily.map((s) => {
      const finite = s.r.filter((x): x is number => x !== null && Number.isFinite(x))
      const { skew, kurt } = moments(finite)
      return { name: s.name, kind: 'daily', periods: 252, n: finite.length, sr: sessionSharpe(finite) as number, skew, kurt }
    }),
    ...monthly.map((b) => ({ name: b.name, kind: 'monthly', periods: 12, n: b.n, sr: b.sr, skew: b.skew, kurt: b.kurt })),
  ]
  const trials = books.length
  const sessionSr = (b: Book): number => (b.periods === 252 ? b.sr : b.sr * Math.sqrt(b.periods / 252))
  const variance = sampleVariance(books.map(sessionSr))
  const varianceNull = books.reduce((sum, b) => sum + (1 / (b.n - 1)) * (b.periods / 252), 0) / trials
  const sr0 = expectedMaxSr0(variance, trials, EULER_GAMMA) as number
  const sr0Null = expectedMaxSr0(varianceNull, trials, EULER_GAMMA) as number
  const rows: DeflatedView['rows'] = books.map((b) => {
    const scale = Math.sqrt(252 / b.periods)
    return {
      name: b.name,
      kind: b.kind,
      periods: b.periods,
      n: b.n,
      sr: b.sr,
      sr_session: sessionSr(b),
      annual_sharpe: b.sr * Math.sqrt(b.periods),
      skew: b.skew,
      kurt: b.kurt,
      sr0_own_period: sr0 * scale,
      dsr: probabilisticSharpe(b.sr, sr0 * scale, b.n, b.skew, b.kurt),
      sr0_null_own_period: sr0Null * scale,
      dsr_null: probabilisticSharpe(b.sr, sr0Null * scale, b.n, b.skew, b.kurt),
    }
  })
  const without = books.map((_, i) => sampleVariance(books.filter((__, j) => j !== i).map(sessionSr)))
  const lowest = without.indexOf(Math.min(...without))
  const looVariance = without[lowest] as number
  const looSr0 = expectedMaxSr0(looVariance, trials, EULER_GAMMA) as number
  return {
    tag: '[POST HOC]',
    label: 'Synthetic view: not research data',
    construction: 'Built from a seeded generator with the browser formulas (effectiveN.fixtures.ts)',
    basis: 'A',
    cost: 1,
    monthly_note: 'monthly books are moved to sessions as SR_m x sqrt(12/252)',
    n_trials: trials,
    variance,
    sr0_session: sr0,
    sr0_annual: sr0 * Math.sqrt(252),
    variance_null: varianceNull,
    sr0_null_session: sr0Null,
    sr0_null_annual: sr0Null * Math.sqrt(252),
    leave_one_out: {
      name: (books[lowest] as Book).name,
      variance: looVariance,
      sr0_session: looSr0,
      sr0_annual: looSr0 * Math.sqrt(252),
      n_trials: trials,
    },
    n_note: 'synthetic rows treated as independent trials',
    euler_gamma: EULER_GAMMA,
    dominant: null,
    rows,
  }
}

/** The synthetic view over the synthetic panel. */
export const SYNTHETIC_VIEW: DeflatedView = buildSyntheticView(syntheticPanel())

/**
 * A GET /api/analytics/hypothesis/{name} body holding only the part the effective-N view reads (distribution.series),
 * typed as the contract's Analytics because the hook reads nothing else from it.
 */
export function seriesBody(series: TrialSeries): Schemas['Analytics'] {
  const body = {
    distribution: {
      series: { date: [...series.date], r: [...series.r], t: series.date.map((_, i) => i), unit: 'fraction of K' },
    },
  }
  return body as unknown as Schemas['Analytics']
}

// [POST HOC] Basis A, annual Sharpe ratio. Computed in the browser (ANALYTICS_CATALOG C8, client phase); the
// backend mirror is pending. Pinned to scipy by the golden vectors of qa/crosscheck/p12_power.py
// (src/quant/power.test.ts). Never shown as a served number.
//
// The set-up is a one-sided test of "annual Sharpe > 0" on normal, serially independent returns. A book of n
// observations at `periods` per year spans n / periods years, and the z-statistic of its annual Sharpe ratio is
// sharpe * sqrt(years). With z the standard normal quantile and Phi its distribution function:
//
//   minimum detectable Sharpe = (z(1 - alpha) + z(power)) / sqrt(years)
//   power at a Sharpe         = Phi(sharpe * sqrt(years) - z(1 - alpha))
//
// The annualisation is the book's own `periods` (252 sessions, 12 months), never 365, and the test is one-sided:
// a two-sided test would use z(1 - alpha / 2) and give a larger number. Serial correlation, fat tails and skew make
// the true detectable Sharpe ratio larger; this is the best case.
import { normalCdf, normalQuantile } from './normal'

/** z(1 - alpha), written -z(alpha) so that a tiny alpha keeps its digits (1 - alpha rounds to 1 below 1e-16). */
function criticalValue(alpha: number): number {
  return -normalQuantile(alpha)
}

/** True for a finite number strictly between 0 and 1. */
function isProbability(value: number): boolean {
  return value > 0 && value < 1
}

/** A book the power maths can use: more than one observation, a positive number of periods per year. */
function isUsableBook(n: number, periods: number): boolean {
  return Number.isFinite(n) && n > 1 && Number.isFinite(periods) && periods > 0
}

/**
 * The years a book spans: n observations at `periods` per year. NaN for a negative or non-finite n, and for a
 * `periods` that is not positive and finite.
 */
export function trackYears(n: number, periods: number): number {
  return Number.isFinite(n) && n >= 0 && Number.isFinite(periods) && periods > 0 ? n / periods : Number.NaN
}

/**
 * The smallest annual Sharpe ratio that a one-sided test at `alpha` detects with probability `power`, on a book of
 * n observations at `periods` per year. NaN when n <= 1, periods <= 0, alpha or power is outside (0, 1), or any
 * input is not a finite number.
 */
export function minimumDetectableSharpe(n: number, periods: number, alpha: number, power: number): number {
  if (!isUsableBook(n, periods) || !isProbability(alpha) || !isProbability(power)) return Number.NaN
  return (criticalValue(alpha) + normalQuantile(power)) / Math.sqrt(trackYears(n, periods))
}

/**
 * The probability that a one-sided test at `alpha` rejects "annual Sharpe <= 0" when the book's true annual Sharpe
 * ratio is `sharpe`, on n observations at `periods` per year. NaN when sharpe is not finite, n <= 1, periods <= 0,
 * alpha is outside (0, 1), or any input is not a finite number.
 */
export function powerAtSharpe(sharpe: number, n: number, periods: number, alpha: number): number {
  if (!Number.isFinite(sharpe) || !isUsableBook(n, periods) || !isProbability(alpha)) return Number.NaN
  return normalCdf(sharpe * Math.sqrt(trackYears(n, periods)) - criticalValue(alpha))
}

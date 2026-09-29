// [POST HOC] Basis A, per session (SV3a), unless a function says otherwise. The effective number of trials and the bar it
// sets, the third piece of ROADMAP 19: two eigenvalue estimators of the effective N, the expected maximum Sharpe ratio
// SR0 of N trials that have no skill, and the Probabilistic Sharpe ratio that turns an SR0 into a DSR. Computed in the
// browser (ANALYTICS_CATALOG C8, client phase); the backend mirror in analytics/deflated.py is pending. Pinned to
// numpy and scipy by the golden vectors of qa/crosscheck/p12_neff.py (src/quant/trials.test.ts): the paper example
// (SR0 0.1132, DSR 0.9004) and the served SV3 view at N = 21 (DEFLATED_REAL: SR0 to 1e-12, every dsr_null to 1e-9).
// Never shown as a served number. Nothing here decides anything: an N or an SR0 is an extra view, and it never
// overrides a frozen pass bar.
//
// - participationRatio(l) = (sum l)^2 / sum l^2: M for M equal eigenvalues, 1 for one non-zero eigenvalue.
// - liJiCount(l): Li and Ji (2005), "Adjusted multiple testing", Heredity 95, 221-227: each |l| adds 1 when it is at
//   least 1, plus its fractional part |l| - floor(|l|). The formula jumps by one at every integer eigenvalue of 2 or
//   more (2 counts 1, just under 2 counts nearly 2). A sampled correlation matrix does not sit on an integer, but
//   two identical trials in an otherwise independent set do, so read it as a count with that edge.
// - expectedMaxSr0(V, N, g) = sqrt(V) x ((1 - g) x Phi^-1(1 - 1/N) + g x Phi^-1(1 - 1/(N e))), the closed form of
//   Bailey and Lopez de Prado (2014), "The Deflated Sharpe Ratio", kept as in SV3a step 5 (1.7% above the exact
//   expected maximum at N = 21, so each DSR errs low). V is the variance of the trials' Sharpe ratios, g the
//   Euler-Mascheroni constant, N the number of trials: fractional for an effective N. V, SR0 and the Sharpe ratios
//   share one period.
// - probabilisticSharpe(SR, SR0, n, skew, kurt) = Phi((SR - SR0) sqrt(n - 1) / sqrt(1 - skew SR + (kurt - 1)/4 SR^2)),
//   with raw kurtosis (a normal has 3), Mertens' variance of the Sharpe estimate; SR and SR0 per period of the n
//   observations. With SR0 from expectedMaxSr0 it is the DSR.
// - sessionSharpe(r) = mean / sd of the returns, the sd with n - 1 in the denominator (SV3a step 4).
import { normalCdf, normalQuantile } from './normal'

/** Refuses a spectrum that cannot be summarised: empty, or holding a value that is not finite. */
function checkSpectrum(eigenvalues: readonly number[]): void {
  if (eigenvalues.length === 0) throw new Error('at least one eigenvalue is needed')
  if (!eigenvalues.every(Number.isFinite)) throw new Error('an eigenvalue is not finite')
}

/**
 * (sum of the eigenvalues)^2 / (sum of their squares): the number of eigenvalues that carry the variance, between 1 and
 * the count. Throws (no null: the eigenvalues of a correlation matrix always have a positive sum) for an empty
 * spectrum, a value that is not finite, or eigenvalues that are all zero.
 */
export function participationRatio(eigenvalues: readonly number[]): number {
  checkSpectrum(eigenvalues)
  let sum = 0
  let squares = 0
  for (const value of eigenvalues) {
    sum += value
    squares += value * value
  }
  if (squares === 0) throw new Error('every eigenvalue is zero')
  return (sum * sum) / squares
}

/**
 * The Li and Ji (2005) effective number of trials: the sum over the eigenvalues of (|l| >= 1 ? 1 : 0) + (|l| -
 * floor(|l|)). A negative eigenvalue counts by its size. Throws for an empty spectrum or a value that is not finite.
 */
export function liJiCount(eigenvalues: readonly number[]): number {
  checkSpectrum(eigenvalues)
  let count = 0
  for (const value of eigenvalues) {
    const size = Math.abs(value)
    count += (size >= 1 ? 1 : 0) + (size - Math.floor(size))
  }
  return count
}

/**
 * SR0, the expected maximum Sharpe ratio of `trials` trials whose Sharpe ratios have variance `variance` and no skill,
 * in the unit of those Sharpe ratios. `gamma` is the Euler-Mascheroni constant (the served view sends euler_gamma).
 * `trials` may be fractional. Null when trials <= 1, when the variance is negative, and when any input is not finite.
 */
export function expectedMaxSr0(variance: number, trials: number, gamma: number): number | null {
  if (!Number.isFinite(variance) || variance < 0 || !Number.isFinite(trials) || trials <= 1 || !Number.isFinite(gamma)) return null
  const mix = (1 - gamma) * normalQuantile(1 - 1 / trials) + gamma * normalQuantile(1 - 1 / (trials * Math.E))
  return Math.sqrt(variance) * mix
}

/**
 * The Probabilistic Sharpe ratio PSR(SR0): the probability that the true Sharpe ratio exceeds `sr0`, given a per-period
 * Sharpe ratio `sr` estimated on `n` observations with skewness `skew` and raw kurtosis `kurt` (a normal has 3).
 * Null when n <= 1, when the variance term 1 - skew SR + (kurt - 1)/4 SR^2 is not positive, and when any input is not
 * finite.
 */
export function probabilisticSharpe(sr: number, sr0: number, n: number, skew: number, kurt: number): number | null {
  if (![sr, sr0, n, skew, kurt].every(Number.isFinite) || n <= 1) return null
  const term = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr
  if (!(term > 0)) return null
  return normalCdf(((sr - sr0) * Math.sqrt(n - 1)) / Math.sqrt(term))
}

/**
 * The per-session Sharpe ratio of a return series: its mean over its sample sd (n - 1 in the denominator), with no
 * annualisation and no risk-free rate. Null for fewer than two values, a value that is not finite, or a series that
 * does not vary.
 */
export function sessionSharpe(returns: readonly number[]): number | null {
  const n = returns.length
  if (n < 2 || !returns.every(Number.isFinite)) return null
  const first = returns[0] as number
  let sum = 0
  let constant = true
  for (const value of returns) {
    sum += value
    if (value !== first) constant = false
  }
  // a constant series can leave a tiny deviation when its mean is not exact (0.01 three times), so test it directly
  if (constant) return null
  let mean = sum / n
  let correction = 0
  for (const value of returns) correction += value - mean
  mean += correction / n
  let squares = 0
  for (const value of returns) squares += (value - mean) * (value - mean)
  const sd = Math.sqrt(squares / (n - 1))
  return sd > 0 ? mean / sd : null
}

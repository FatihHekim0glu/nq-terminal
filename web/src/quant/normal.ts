// The standard normal distribution: normalCdf (Phi) and normalQuantile (its inverse).
//
// Pure functions, no dependency. Both are ports of published, public algorithms, pinned to scipy.stats.norm by the
// golden vectors of qa/crosscheck/p12_power.py (src/quant/normal.test.ts):
//
// - normalCdf: W. J. Cody's rational Chebyshev approximations for the normal distribution function (W. J. Cody,
//   "Rational Chebyshev approximations for the error function", Math. Comp. 23, 1969, pp. 631-637; the coefficients
//   are those of the public-domain netlib SPECFUN package, ACM TOMS Algorithm 715, 1993). Three ranges of |x|:
//   the centre (up to 0.67448975, the 75th percentile), the middle (up to sqrt(32)) and the tail beyond. Outside
//   the centre the value is exp(-x^2 / 2) times a rational function, and x^2 is split in 1/16 steps so that
//   exp(-x^2 / 2) is formed as exp(-s^2 / 2) * exp(-(x^2 - s^2) / 2) with s = trunc(16 |x|) / 16. Then s^2 is exact
//   and the relative error stays near 1e-16 out to the underflow at about x = -38.5.
// - normalQuantile: M. J. Wichura, "Algorithm AS 241: The percentage points of the normal distribution", Applied
//   Statistics 37 (1988) pp. 477-484, routine PPND16 (relative accuracy about 1e-16 for p from about 1e-316 up).
//
// Each rational function is stored as two arrays of coefficients in ascending powers of its variable, named after
// the published tables, and evaluated by Horner's rule in the published order of operations.

const SQRT_32 = Math.sqrt(32)
const CENTRE_LIMIT = 0.67448975
const INVERSE_SQRT_TWO_PI = 0.398942280401432677939946059934
/** Beyond this |x| the tail is below the smallest double (Phi(-38.5) is about 1e-324); it also spares the overflow of 16 |x|. */
const CDF_LIMIT = 39

// Phi, centre: Phi(x) = 1/2 + x * N(x^2) / D(x^2). N: A(4), A(3), A(2), A(1), A(5). D: B(4), B(3), B(2), B(1), 1.
const CENTRE_NUMERATOR = [
  1.8154981253343561249e4, 1.0676894854603709582e3, 1.6102823106855587881e2, 2.2352520354606839287, 6.5682337918207449113e-2,
] as const
const CENTRE_DENOMINATOR = [
  4.5507789335026729956e4, 1.0260932208618978205e4, 9.7609855173777669322e2, 4.720258190468824187e1, 1,
] as const

// Phi, middle: the tail is exp(-x^2 / 2) * N(y) / D(y) with y = |x|. N: C(8), C(7), ... C(1), C(9). D: D(8), ... D(1), 1.
const MIDDLE_NUMERATOR = [
  9.8427148383839780218e3, 1.1602651437647350124e4, 6.8481904505362823326e3, 2.4945375852903726711e3,
  5.9727027639480026226e2, 9.3506656132177855979e1, 8.8831497943883759412, 3.9894151208813466764e-1,
  1.0765576773720192317e-8,
] as const
const MIDDLE_DENOMINATOR = [
  1.9685429676859990727e4, 3.8912003286093271411e4, 3.4900952721145977266e4, 1.8615571640885098091e4,
  6.485558298266760755e3, 1.519377599407554805e3, 2.3538790178262499861e2, 2.2266688044328115691e1, 1,
] as const

// Phi, tail: with u = 1 / x^2 the tail is exp(-x^2 / 2) * (1 / sqrt(2 pi) - u * N(u) / D(u)) / |x|.
// N: P(5), P(4), P(3), P(2), P(1), P(6). D: Q(5), Q(4), Q(3), Q(2), Q(1), 1.
const TAIL_NUMERATOR = [
  2.9112874951168792e-5, 1.421619193227893466e-3, 2.2235277870649807e-2, 1.274011611602473639e-1,
  2.1589853405795699e-1, 2.307344176494017303e-2,
] as const
const TAIL_DENOMINATOR = [
  7.29751555083966205e-5, 3.78239633202758244e-3, 6.59881378689285515e-2, 4.68238212480865118e-1,
  1.28426009614491121, 1,
] as const

// AS241 PPND16, with q = p - 1/2 and r = 0.180625 - q^2 (central), then r = sqrt(-ln min(p, 1 - p)) (tails).
const SPLIT_CENTRE = 0.425
const CONST_CENTRE = 0.180625
const SPLIT_TAIL = 5
const CONST_TAIL = 1.6
// |q| <= 0.425: z = q * A(r) / B(r).
const AS241_A = [
  3.387132872796366608, 1.3314166789178437745e2, 1.9715909503065514427e3, 1.3731693765509461125e4,
  4.5921953931549871457e4, 6.7265770927008700853e4, 3.3430575583588128105e4, 2.5090809287301226727e3,
] as const
const AS241_B = [
  1, 4.2313330701600911252e1, 6.871870074920579083e2, 5.3941960214247511077e3, 2.1213794301586595867e4,
  3.930789580009271061e4, 2.8729085735721942674e4, 5.226495278852854561e3,
] as const
// r <= 5 (after r - 1.6): z = C(r) / D(r).
const AS241_C = [
  1.42343711074968357734, 4.6303378461565452959, 5.7694972214606914055, 3.64784832476320460504,
  1.27045825245236838258, 2.4178072517745061177e-1, 2.27238449892691845833e-2, 7.7454501427834140764e-4,
] as const
const AS241_D = [
  1, 2.05319162663775882187, 1.6763848301838038494, 6.8976733498510000455e-1, 1.4810397642748007459e-1,
  1.51986665636164571966e-2, 5.475938084995344946e-4, 1.05075007164441684324e-9,
] as const
// r > 5 (after r - 5): z = E(r) / F(r).
const AS241_E = [
  6.6579046435011037772, 5.4637849111641143699, 1.7848265399172913358, 2.9656057182850489123e-1,
  2.6532189526576123093e-2, 1.2426609473880784386e-3, 2.71155556874348757815e-5, 2.01033439929228813265e-7,
] as const
const AS241_F = [
  1, 5.9983220655588793769e-1, 1.3692988092273580531e-1, 1.48753612908506148525e-2, 7.868691311456132591e-4,
  1.8463183175100546818e-5, 1.4215117583164458887e-7, 2.04426310338993978564e-15,
] as const

/** Horner's rule for coefficients in ascending powers: c0 + x (c1 + x (c2 + ...)). */
function horner(coefficients: readonly number[], x: number): number {
  return coefficients.reduceRight((sum, coefficient) => sum * x + coefficient, 0)
}

/** The value exp(-y^2 / 2) * rational for y > 0, with the 1/16 split of y^2. */
function scaledByGaussian(y: number, rational: number): number {
  const split = Math.trunc(y * 16) / 16
  const rest = (y - split) * (y + split)
  return Math.exp(-split * split * 0.5) * Math.exp(-rest * 0.5) * rational
}

/**
 * The standard normal cumulative distribution function Phi(x) = P(Z <= x).
 * NaN for NaN; 0 at -Infinity and 1 at +Infinity. Relative error about 1e-16 (Phi(-38) is still resolved).
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  const y = Math.abs(x)
  if (y <= CENTRE_LIMIT) {
    const square = x * x
    return 0.5 + (x * horner(CENTRE_NUMERATOR, square)) / horner(CENTRE_DENOMINATOR, square)
  }
  if (y > CDF_LIMIT) return x < 0 ? 0 : 1
  let tail: number
  if (y <= SQRT_32) {
    tail = scaledByGaussian(y, horner(MIDDLE_NUMERATOR, y) / horner(MIDDLE_DENOMINATOR, y))
  } else {
    const inverseSquare = 1 / (x * x)
    const fit = (inverseSquare * horner(TAIL_NUMERATOR, inverseSquare)) / horner(TAIL_DENOMINATOR, inverseSquare)
    tail = scaledByGaussian(y, (INVERSE_SQRT_TWO_PI - fit) / y)
  }
  return x < 0 ? tail : 1 - tail
}

/**
 * The standard normal quantile (percent point function, the inverse of normalCdf): the z with Phi(z) = p.
 * -Infinity at 0 and +Infinity at 1; NaN for NaN and for p outside [0, 1].
 */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN
  if (p === 0) return -Infinity
  if (p === 1) return Infinity
  const q = p - 0.5
  if (Math.abs(q) <= SPLIT_CENTRE) {
    const r = CONST_CENTRE - q * q
    return (q * horner(AS241_A, r)) / horner(AS241_B, r)
  }
  // the smaller tail: 1 - p is exact for p >= 1/2, so nothing is lost on the upper side
  const tail = q < 0 ? p : 1 - p
  const root = Math.sqrt(-Math.log(tail))
  const z =
    root <= SPLIT_TAIL
      ? horner(AS241_C, root - CONST_TAIL) / horner(AS241_D, root - CONST_TAIL)
      : horner(AS241_E, root - SPLIT_TAIL) / horner(AS241_F, root - SPLIT_TAIL)
  return q < 0 ? -z : z
}

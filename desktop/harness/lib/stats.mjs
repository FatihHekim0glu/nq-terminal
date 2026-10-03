// Small statistics shared by the rows, the records and the report. Pure functions.

export function median(xs) {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return null
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** The nearest-rank quantile (the one trace.ts uses for the frame intervals). */
export function quantile(xs, q) {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (s.length === 0) return null
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]
}

export const p95 = (xs) => quantile(xs, 0.95)

export function range(xs) {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v))
  return { n: s.length, min: s.length ? Math.min(...s) : null, max: s.length ? Math.max(...s) : null, median: median(s) }
}

export const round = (v, digits = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v)

/**
 * "Within noise" as 04 D5.1 words it: a figure is within 10% of the reference median, or inside the reference's min to max range.
 */
export function withinNoise(value, ref, tolerance = 0.1) {
  if (typeof value !== 'number' || !ref || typeof ref.median !== 'number') return false
  if (ref.median !== 0 && Math.abs(value - ref.median) / Math.abs(ref.median) <= tolerance) return true
  return typeof ref.min === 'number' && typeof ref.max === 'number' && value >= ref.min && value <= ref.max
}

/** Two builds agree within noise when their medians are within 10% of each other or their ranges overlap. */
export function agreeWithinNoise(a, b, tolerance = 0.1) {
  if (!a || !b || typeof a.median !== 'number' || typeof b.median !== 'number') return false
  const big = Math.max(Math.abs(a.median), Math.abs(b.median))
  if (big === 0 || Math.abs(a.median - b.median) / big <= tolerance) return true
  return a.min <= b.max && b.min <= a.max
}

// Performance figures of the gallery specs on a shared runner (docs/desktop/v04/ci-hygiene.md). Two pieces, both
// measurement and neither a budget: the budgets stay in the specs, unchanged.
//
// frameStats summarises the frame intervals a page timed with requestAnimationFrame at the clock's own grain. Chromium
// hands out rAF and performance.now() times in steps of 0.1 ms, so a frame that spans two vsyncs reads 33.3 or 33.4 ms,
// but the difference of two such times carries float noise in its last bits (33.400000000000546). A bare `f > 33.4`
// then counted some 33.4 ms frames as over 33.4 ms and not others, which is what failed MonitorGrid's 10,000-row
// scroll on the hosted runner. Each interval is read at the 0.1 ms grain before it is compared or ranked.
//
// measureWithQuietRetry runs a measurement and its perf-only check; on CI alone, a first miss is logged and the
// measurement taken once more, and the second attempt decides. Both attempts are logged either way. A failure inside
// the measurement itself (a functional check, a page that does not load) is never retried.

/** Chromium's timer steps per millisecond (0.1 ms resolution). */
export const CLOCK_STEPS_PER_MS = 10

/** One interval at the clock's grain: 33.400000000000546 reads 33.4, the same number as the literal 33.4. */
export function atClockGrain(ms: number): number {
  return Math.round(ms * CLOCK_STEPS_PER_MS) / CLOCK_STEPS_PER_MS
}

export interface FrameStats {
  readonly frames: number
  readonly p50: number
  readonly p95: number
  readonly max: number
  /** Frames longer than `overMs` at the clock's grain. */
  readonly over33: number
}

/** The 50th and 95th percentile, the longest frame and the count over `overMs`, all at the clock's grain. */
export function frameStats(intervals: readonly number[], overMs = 33.4): FrameStats {
  const sorted = intervals.map(atClockGrain).sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { frames: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1), over33: sorted.filter((f) => f > overMs).length }
}

export interface QuietRetryOptions<T> {
  /** Names the measurement in the log lines. */
  readonly label: string
  /** True on the hosted runner (CI is set by GitHub Actions); off CI a miss fails at once. */
  readonly ci: boolean
  /** Takes one measurement (1 for the first attempt, 2 for the retry); anything it throws fails the test at once. */
  readonly measure: (attempt: number) => Promise<T>
  /** The perf-only assertions: throws on a miss. */
  readonly check: (value: T) => void
  /** Where both attempts are written. */
  readonly log: (line: string) => void
}

function reason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  // Playwright's expect messages carry terminal colour codes.
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim()
}

/** Every attempt's value, in order; the last one passed the check. */
export async function measureWithQuietRetry<T>(options: QuietRetryOptions<T>): Promise<readonly T[]> {
  const { label, ci, measure, check, log } = options
  const first = await measure(1)
  log(`perf ${label}, attempt 1: ${JSON.stringify(first)}`)
  if (!ci) {
    check(first)
    return [first]
  }
  try {
    check(first)
    return [first]
  } catch (e) {
    log(`perf ${label}, attempt 1 missed (${reason(e)}); measuring once more, CI only`)
  }
  const second = await measure(2)
  log(`perf ${label}, attempt 2: ${JSON.stringify(second)}`)
  check(second)
  return [first, second]
}

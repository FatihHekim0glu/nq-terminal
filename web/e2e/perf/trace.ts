// Chromium trace arithmetic for the performance budgets (TASKS 8.3). The specs record a CDP trace with
// browser.startTracing (the Tracing domain), put performance.mark() calls at the points that matter,
// and read everything back from the trace:
// - a mark's `args.data.startTime` is its time in ms since the page's navigation start;
// - the span between two marks uses the trace clock (microseconds);
// - frames are the renderer compositor's DrawFrame events, one per presented frame;
// - long tasks are RunTask slices on the renderer main thread of 50 ms or more.
// Pure functions, checked on hand-built events in trace.spec.ts.

export interface TraceEvent {
  readonly name: string
  readonly cat: string
  readonly ph: string
  readonly ts: number
  readonly dur?: number
  readonly pid: number
  readonly tid: number
  readonly args?: Readonly<Record<string, unknown>>
}

export interface Renderer {
  readonly pid: number
  readonly main: number
  readonly compositor: number
}

export interface FrameStats {
  readonly frames: number
  readonly spanMs: number
  readonly fps: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly maxMs: number
  /** Intervals longer than two 60 Hz frames: at least one frame was missed. */
  readonly missed: number
}

/** The TASKS 8.3 targets. "Near 60 fps" is read as: at least 90% of 60 frames a second on average; a
 * 95th percentile frame interval within 25 ms, so no more than 5% of frames miss their vsync (the
 * compositor's jitter in headless Chromium puts single intervals at 17 to 22 ms with nothing missed); no
 * gap over 50 ms (a visible stall); and no long task on the main thread. */
export const BUDGETS = {
  homeFirstRenderMs: 1500,
  fillsGridMs: 500,
  fillsRows: 8411,
  panZoom: { minFps: 54, maxP95Ms: 25, maxGapMs: 50, minFrames: 30 },
  longTaskMs: 50,
} as const

/** The categories a budget trace records: user timing marks, frames and main-thread tasks. */
export const TRACE_CATEGORIES = [
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'loading',
] as const

const USER_TIMING = 'blink.user_timing'
const MARK_PHASES = new Set(['I', 'R', 'n'])

export function parseTrace(raw: string | Buffer): TraceEvent[] {
  const data: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  const events = Array.isArray(data) ? data : (data as { traceEvents?: unknown }).traceEvents
  if (!Array.isArray(events)) throw new Error('no trace events in the trace file')
  return events as TraceEvent[]
}

function findMark(events: readonly TraceEvent[], name: string): TraceEvent {
  const found = events.find((e) => e.name === name && e.cat.includes(USER_TIMING) && MARK_PHASES.has(e.ph))
  if (!found) throw new Error(`the trace has no performance mark ${name}`)
  return found
}

/** The mark's own performance.now(): ms since the navigation start of its document. */
export function markStartMs(events: readonly TraceEvent[], name: string): number {
  const data = findMark(events, name).args?.data as { startTime?: unknown } | undefined
  if (typeof data?.startTime !== 'number') throw new Error(`the mark ${name} carries no startTime`)
  return data.startTime
}

/** Trace timestamp (microseconds) of a mark. */
export function markTs(events: readonly TraceEvent[], name: string): number {
  return findMark(events, name).ts
}

export function markSpanMs(events: readonly TraceEvent[], from: string, to: string): number {
  const start = markTs(events, from)
  const end = markTs(events, to)
  if (end < start) throw new Error(`the mark ${to} comes before ${from}`)
  return (end - start) / 1000
}

function threadId(events: readonly TraceEvent[], pid: number, name: string): number {
  const meta = events.find((e) => e.name === 'thread_name' && e.pid === pid && (e.args as { name?: unknown } | undefined)?.name === name)
  if (!meta) throw new Error(`the trace names no ${name} thread in process ${pid}`)
  return meta.tid
}

/** The renderer process that emitted a mark, with its main and compositor threads. */
export function rendererOf(events: readonly TraceEvent[], markName: string): Renderer {
  const pid = findMark(events, markName).pid
  return { pid, main: threadId(events, pid, 'CrRendererMain'), compositor: threadId(events, pid, 'Compositor') }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN
}

/** Presented frames of one renderer between two trace timestamps (microseconds, inclusive). */
export function frameStats(events: readonly TraceEvent[], renderer: Renderer, fromUs: number, toUs: number): FrameStats {
  const times = events
    .filter((e) => e.name === 'DrawFrame' && e.ph === 'I' && e.pid === renderer.pid && e.tid === renderer.compositor && e.ts >= fromUs && e.ts <= toUs)
    .map((e) => e.ts)
    .sort((a, b) => a - b)
  const intervals = times.slice(1).map((t, i) => (t - (times[i] ?? t)) / 1000)
  const sorted = [...intervals].sort((a, b) => a - b)
  const spanMs = times.length > 1 ? ((times.at(-1) ?? 0) - (times[0] ?? 0)) / 1000 : 0
  return {
    frames: times.length,
    spanMs,
    fps: spanMs > 0 ? (intervals.length * 1000) / spanMs : 0,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? Number.NaN,
    missed: intervals.filter((ms) => ms > 2 * (1000 / 60)).length,
  }
}

/** Durations (ms) of the renderer main thread's tasks of at least `minMs` that start inside the window. */
export function longTasks(events: readonly TraceEvent[], renderer: Renderer, fromUs: number, toUs: number, minMs: number = BUDGETS.longTaskMs): number[] {
  return events
    .filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.pid === renderer.pid && e.tid === renderer.main && e.ts >= fromUs && e.ts <= toUs)
    .map((e) => (e.dur ?? 0) / 1000)
    .filter((ms) => ms >= minMs)
}

/** Every way a pan or zoom gesture misses "near 60 fps"; empty when it meets the budget. */
export function judgeFrames(stats: FrameStats, long: readonly number[]): string[] {
  const b = BUDGETS.panZoom
  const failures: string[] = []
  if (stats.frames < b.minFrames) failures.push(`only ${stats.frames} frames drawn (at least ${b.minFrames} needed)`)
  if (!(stats.fps >= b.minFps)) failures.push(`${stats.fps.toFixed(1)} fps (at least ${b.minFps})`)
  if (!(stats.p95Ms <= b.maxP95Ms)) failures.push(`p95 frame interval ${stats.p95Ms.toFixed(1)} ms (at most ${b.maxP95Ms})`)
  if (!(stats.maxMs <= b.maxGapMs)) failures.push(`longest frame gap ${stats.maxMs.toFixed(1)} ms (at most ${b.maxGapMs})`)
  if (long.length > 0) failures.push(`${long.length} long task(s) on the main thread: ${long.map((ms) => ms.toFixed(0)).join(', ')} ms`)
  return failures
}

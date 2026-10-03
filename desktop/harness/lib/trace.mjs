// Chromium trace arithmetic for the page-internal rows (a JavaScript port of web/e2e/perf/trace.ts, with the same
// cases in tests/trace.test.mjs) and the CDP recording of a trace from the browser target of the smoke build.
// - a mark's `args.data.startTime` is its time in ms since the page's navigation start;
// - frames are the renderer compositor's DrawFrame events, one per presented frame;
// - long tasks are RunTask slices on the renderer main thread of 50 ms or more.
import { Cdp } from './cdp.mjs'
import { quantile } from './stats.mjs'

export const TRACE_CATEGORIES = ['blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'loading']
const USER_TIMING = 'blink.user_timing'
const MARK_PHASES = new Set(['I', 'R', 'n'])
export const LONG_TASK_MS = 50

export function parseTrace(raw) {
  const data = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
  const events = Array.isArray(data) ? data : data.traceEvents
  if (!Array.isArray(events)) throw new Error('no trace events in the trace file')
  return events
}

function findMark(events, name) {
  const found = events.find((e) => e.name === name && String(e.cat).includes(USER_TIMING) && MARK_PHASES.has(e.ph))
  if (!found) throw new Error(`the trace has no performance mark ${name}`)
  return found
}

export const markTs = (events, name) => findMark(events, name).ts

export function markSpanMs(events, from, to) {
  const a = markTs(events, from)
  const b = markTs(events, to)
  if (b < a) throw new Error(`the mark ${to} comes before ${from}`)
  return (b - a) / 1000
}

function threadId(events, pid, name) {
  const meta = events.find((e) => e.name === 'thread_name' && e.pid === pid && e.args?.name === name)
  if (!meta) throw new Error(`the trace names no ${name} thread in process ${pid}`)
  return meta.tid
}

/** The renderer process that emitted a mark, with its main and compositor threads. */
export function rendererOf(events, markName) {
  const pid = findMark(events, markName).pid
  return { pid, main: threadId(events, pid, 'CrRendererMain'), compositor: threadId(events, pid, 'Compositor') }
}

/** Presented frames of one renderer between two trace timestamps (microseconds, inclusive). */
export function frameStats(events, renderer, fromUs, toUs) {
  const times = events.filter((e) => e.name === 'DrawFrame' && e.ph === 'I' && e.pid === renderer.pid && e.tid === renderer.compositor && e.ts >= fromUs && e.ts <= toUs)
    .map((e) => e.ts).sort((a, b) => a - b)
  const intervals = times.slice(1).map((t, i) => (t - times[i]) / 1000)
  const spanMs = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0
  return { frames: times.length, spanMs, fps: spanMs > 0 ? (intervals.length * 1000) / spanMs : 0, p50Ms: quantile(intervals, 0.5) ?? NaN,
    p95Ms: quantile(intervals, 0.95) ?? NaN, maxMs: intervals.length ? Math.max(...intervals) : NaN, missed: intervals.filter((ms) => ms > 2 * (1000 / 60)).length, intervals }
}

export function longTasks(events, renderer, fromUs, toUs, minMs = LONG_TASK_MS) {
  return events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.pid === renderer.pid && e.tid === renderer.main && e.ts >= fromUs && e.ts <= toUs)
    .map((e) => (e.dur ?? 0) / 1000).filter((ms) => ms >= minMs)
}

/** The stats of a gesture between its two marks (`nqt:<kind>-start` and `nqt:<kind>-end`). */
export function gestureStats(events, kind) {
  const renderer = rendererOf(events, `nqt:${kind}-start`)
  const from = markTs(events, `nqt:${kind}-start`)
  const to = markTs(events, `nqt:${kind}-end`)
  const { intervals, ...stats } = frameStats(events, renderer, from, to)
  return { ...stats, longTasks: longTasks(events, renderer, from, to) }
}

/**
 * Records a CDP trace of the whole browser while `work()` runs. `browserWsUrl` is the browser target of the debugging port
 * (from /json/version). Returns the parsed trace events.
 */
export async function recordTrace(browserWsUrl, work) {
  const browser = new Cdp(browserWsUrl)
  await browser.open()
  try {
    const complete = new Promise((res) => browser.on('Tracing.tracingComplete', res))
    await browser.send('Tracing.start', { traceConfig: { includedCategories: TRACE_CATEGORIES }, transferMode: 'ReturnAsStream' })
    try { await work() } finally { await browser.send('Tracing.end') }
    const done = await complete
    return parseTrace(await readStream(browser, done.stream))
  } finally { browser.close() }
}

async function readStream(browser, handle) {
  const chunks = []
  for (;;) {
    const r = await browser.send('IO.read', { handle, size: 1 << 20 })
    chunks.push(r.base64Encoded ? Buffer.from(r.data, 'base64') : Buffer.from(r.data, 'utf8'))
    if (r.eof) break
  }
  await browser.send('IO.close', { handle }).catch(() => {})
  return Buffer.concat(chunks)
}

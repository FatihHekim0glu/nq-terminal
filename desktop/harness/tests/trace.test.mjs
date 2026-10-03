// The trace arithmetic on hand-built events (the cases of web/e2e/perf/trace.spec.ts, ported). No browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTrace, markTs, markSpanMs, rendererOf, frameStats, longTasks, gestureStats } from '../lib/trace.mjs'

const PID = 7
const MAIN = 11
const COMPOSITOR = 12
const thread = (tid, name, pid = PID) => ({ name: 'thread_name', cat: '__metadata', ph: 'M', ts: 0, pid, tid, args: { name } })
const mark = (name, ts, startTime, pid = PID) => ({ name, cat: 'blink.user_timing', ph: 'I', ts, pid, tid: MAIN, args: { data: { startTime } } })
const draws = (fromUs, stepUs, count, pid = PID) => Array.from({ length: count }, (_, i) => ({ name: 'DrawFrame', cat: 'disabled-by-default-devtools.timeline.frame', ph: 'I', ts: fromUs + i * stepUs, pid, tid: COMPOSITOR }))
const task = (ts, durMs, tid = MAIN) => ({ name: 'RunTask', cat: 'disabled-by-default-devtools.timeline', ph: 'X', ts, dur: durMs * 1000, pid: PID, tid })
const BASE = [thread(MAIN, 'CrRendererMain'), thread(COMPOSITOR, 'Compositor')]
const RENDERER = { pid: PID, main: MAIN, compositor: COMPOSITOR }

test('reads both trace file shapes and rejects anything else', () => {
  assert.equal(parseTrace(JSON.stringify({ traceEvents: [mark('a', 1, 0)] })).length, 1)
  assert.equal(parseTrace(Buffer.from(JSON.stringify([mark('a', 1, 0)]))).length, 1)
  assert.throws(() => parseTrace('{"nothing": 1}'), /no trace events/)
})

test('a span between two marks runs forward on the trace clock', () => {
  const events = [...BASE, mark('a', 1_000_000, 10), mark('b', 1_250_000, 260)]
  assert.equal(markSpanMs(events, 'a', 'b'), 250)
  assert.throws(() => markSpanMs(events, 'b', 'a'), /before/)
  assert.throws(() => markTs(events, 'nqt:missing'), /nqt:missing/)
})

test('the renderer of a mark is its own CrRendererMain and Compositor threads', () => {
  const other = [thread(21, 'CrRendererMain', 9), thread(22, 'Compositor', 9)]
  assert.deepEqual(rendererOf([...other, ...BASE, mark('a', 1, 0)], 'a'), RENDERER)
})

test('frames at 60 Hz give a p95 near 16.7 ms and pass 25 ms', () => {
  const stats = frameStats([...BASE, ...draws(1_000_000, 16_667, 121)], RENDERER, 1_000_000, 3_100_000)
  assert.equal(stats.frames, 121)
  assert.ok(stats.fps > 59)
  assert.ok(Math.abs(stats.p95Ms - 16.667) < 0.01)
})

test('frames at 30 Hz fail the 25 ms budget (born failing)', () => {
  const stats = frameStats([...BASE, ...draws(1_000_000, 33_333, 61)], RENDERER, 1_000_000, 3_000_000)
  assert.ok(stats.p95Ms > 25)
  assert.ok(stats.fps < 31)
})

test('one missed frame in ten raises the p95 while the average still looks near 60', () => {
  const times = []
  let t = 1_000_000
  for (let i = 0; i < 120; i += 1) { times.push(t); t += i % 10 === 9 ? 33_400 : 16_667 }
  const events = [...BASE, ...times.map((ts) => ({ name: 'DrawFrame', cat: 'x', ph: 'I', ts, pid: PID, tid: COMPOSITOR }))]
  const stats = frameStats(events, RENDERER, 0, 9_000_000)
  assert.ok(stats.fps > 54)
  assert.ok(stats.p95Ms > 25)
})

test('frames of another renderer or outside the window are not counted', () => {
  const events = [...BASE, thread(31, 'Compositor', 9), ...draws(1_000_000, 16_667, 10), ...draws(1_000_000, 8_000, 50, 9), ...draws(9_000_000, 16_667, 5)]
  assert.equal(frameStats(events, RENDERER, 1_000_000, 2_000_000).frames, 10)
})

test('main-thread tasks of 50 ms or more inside the window are long tasks', () => {
  const events = [...BASE, task(1_100_000, 12), task(1_200_000, 64), task(1_300_000, 80, COMPOSITOR), task(5_000_000, 200)]
  assert.deepEqual(longTasks(events, RENDERER, 1_000_000, 2_000_000), [64])
})

test('a gesture is read between its two marks', () => {
  const events = [...BASE, mark('nqt:zoom-start', 1_000_000, 100), mark('nqt:zoom-end', 3_000_000, 2100), ...draws(1_000_000, 16_667, 120), task(1_500_000, 70)]
  const g = gestureStats(events, 'zoom')
  assert.equal(g.frames > 100, true)
  assert.ok(g.p95Ms < 17)
  assert.deepEqual(g.longTasks, [70])
})

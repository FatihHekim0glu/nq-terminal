// The trace arithmetic behind the performance budgets (TASKS 8.3), on hand-built Chromium trace events,
// so each budget check is seen to fail on a slow trace before it is trusted on a real one. No browser.
import { expect, test } from '@playwright/test'
import {
  BUDGETS,
  frameStats,
  judgeFrames,
  longTasks,
  markSpanMs,
  markStartMs,
  parseTrace,
  rendererOf,
  type TraceEvent,
} from './trace.ts'

const PID = 7
const MAIN = 11
const COMPOSITOR = 12

function thread(tid: number, name: string, pid = PID): TraceEvent {
  return { name: 'thread_name', cat: '__metadata', ph: 'M', ts: 0, pid, tid, args: { name } }
}

function mark(name: string, ts: number, startTime: number, pid = PID): TraceEvent {
  return { name, cat: 'blink.user_timing', ph: 'I', ts, pid, tid: MAIN, args: { data: { startTime } } }
}

function draws(fromUs: number, stepUs: number, count: number, pid = PID): TraceEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    name: 'DrawFrame', cat: 'disabled-by-default-devtools.timeline.frame', ph: 'I', ts: fromUs + i * stepUs, pid, tid: COMPOSITOR,
  }))
}

function task(ts: number, durMs: number, tid = MAIN): TraceEvent {
  return { name: 'RunTask', cat: 'disabled-by-default-devtools.timeline', ph: 'X', ts, dur: durMs * 1000, pid: PID, tid }
}

const BASE = [thread(MAIN, 'CrRendererMain'), thread(COMPOSITOR, 'Compositor')]

test.describe('trace arithmetic', () => {
  test('reads both trace file shapes and rejects anything else', () => {
    const events = [mark('a', 1, 0)]
    expect(parseTrace(JSON.stringify({ traceEvents: events }))).toHaveLength(1)
    expect(parseTrace(Buffer.from(JSON.stringify(events)))).toHaveLength(1)
    expect(() => parseTrace('{"nothing": 1}')).toThrow(/no trace events/)
  })

  test('a mark time is its own startTime, in ms since navigation start', () => {
    const events = [...BASE, mark('nqt:home-ready', 5_000_000, 812.5)]
    expect(markStartMs(events, 'nqt:home-ready')).toBe(812.5)
    expect(() => markStartMs(events, 'nqt:missing')).toThrow(/nqt:missing/)
  })

  test('a span between two marks is taken from the trace clock and must run forward', () => {
    const events = [...BASE, mark('a', 1_000_000, 10), mark('b', 1_250_000, 260)]
    expect(markSpanMs(events, 'a', 'b')).toBe(250)
    expect(() => markSpanMs(events, 'b', 'a')).toThrow(/before/)
  })

  test('the renderer of a mark is its CrRendererMain and Compositor threads', () => {
    const other = [thread(21, 'CrRendererMain', 9), thread(22, 'Compositor', 9)]
    const events = [...other, ...BASE, mark('a', 1, 0)]
    expect(rendererOf(events, 'a')).toEqual({ pid: PID, main: MAIN, compositor: COMPOSITOR })
  })

  test('frames at 60 Hz pass the pan and zoom budget', () => {
    const events = [...BASE, ...draws(1_000_000, 16_667, 121)]
    const stats = frameStats(events, rendererOf([...events, mark('x', 0, 0)], 'x'), 1_000_000, 3_100_000)
    expect(stats.frames).toBe(121)
    expect(stats.fps).toBeGreaterThan(59)
    expect(stats.p95Ms).toBeCloseTo(16.667, 2)
    expect(judgeFrames(stats, [])).toEqual([])
  })

  test('frames at 30 Hz fail it (born failing)', () => {
    const events = [...BASE, ...draws(1_000_000, 33_333, 61), mark('x', 0, 0)]
    const stats = frameStats(events, rendererOf(events, 'x'), 1_000_000, 3_000_000)
    expect(stats.fps).toBeLessThan(31)
    const failures = judgeFrames(stats, [])
    expect(failures.join(' ')).toMatch(/fps/)
    expect(failures.join(' ')).toMatch(/p95/)
  })

  test('one missed frame in ten fails the p95 frame interval while the average still looks near 60', () => {
    const times: number[] = []
    let t = 1_000_000
    for (let i = 0; i < 120; i += 1) { times.push(t); t += i % 10 === 9 ? 33_400 : 16_667 }
    const events = [...BASE, ...times.map((ts) => ({ name: 'DrawFrame', cat: 'disabled-by-default-devtools.timeline.frame', ph: 'I', ts, pid: PID, tid: COMPOSITOR })), mark('x', 0, 0)]
    const stats = frameStats(events, rendererOf(events, 'x'), 0, 9_000_000)
    expect(stats.fps).toBeGreaterThan(BUDGETS.panZoom.minFps)
    expect(judgeFrames(stats, []).join(' ')).toMatch(/p95/)
  })

  test('one stall of about 100 ms fails the longest frame gap even when the average holds', () => {
    const steady = draws(1_000_000, 16_667, 100)
    const stall = draws(1_000_000 + 100 * 16_667 + 90_000, 16_667, 20)
    const events = [...BASE, ...steady, ...stall, mark('x', 0, 0)]
    const stats = frameStats(events, rendererOf(events, 'x'), 1_000_000, 4_000_000)
    expect(stats.maxMs).toBeGreaterThan(100)
    expect(stats.fps).toBeGreaterThan(BUDGETS.panZoom.minFps)
    expect(judgeFrames(stats, []).join(' ')).toMatch(/longest frame gap/)
  })

  test('frames of another renderer or outside the window are not counted', () => {
    const events = [...BASE, thread(31, 'Compositor', 9), ...draws(1_000_000, 16_667, 10), ...draws(1_000_000, 8_000, 50, 9), ...draws(9_000_000, 16_667, 5)]
    const stats = frameStats(events, { pid: PID, main: MAIN, compositor: COMPOSITOR }, 1_000_000, 2_000_000)
    expect(stats.frames).toBe(10)
  })

  test('too few frames is a failure, never a pass', () => {
    const events = [...BASE, ...draws(1_000_000, 16_667, 3)]
    const stats = frameStats(events, { pid: PID, main: MAIN, compositor: COMPOSITOR }, 1_000_000, 2_000_000)
    expect(judgeFrames(stats, []).join(' ')).toMatch(/frames/)
  })

  test('main-thread tasks over 50 ms inside the window are long tasks and fail the budget', () => {
    const events = [...BASE, task(1_100_000, 12), task(1_200_000, 64), task(1_300_000, 80, COMPOSITOR), task(5_000_000, 200)]
    const renderer = { pid: PID, main: MAIN, compositor: COMPOSITOR }
    const long = longTasks(events, renderer, 1_000_000, 2_000_000)
    expect(long).toEqual([64])
    const smooth = frameStats([...BASE, ...draws(1_000_000, 16_667, 61)], renderer, 1_000_000, 2_000_000)
    expect(judgeFrames(smooth, long).join(' ')).toMatch(/long task/)
  })

  test('the budgets are the task targets', () => {
    expect(BUDGETS.homeFirstRenderMs).toBe(1500)
    expect(BUDGETS.fillsGridMs).toBe(500)
    expect(BUDGETS.fillsRows).toBe(8411)
    expect(BUDGETS.panZoom.minFps).toBeGreaterThanOrEqual(54)
  })
})

// The measurement helpers of the gallery perf specs (perfMeasure.ts; docs/desktop/v04/ci-hygiene.md).
// Born failing: the 10,000-row scroll counted a 33.4 ms frame as over 33.4 ms whenever float noise put it a hair above
// (33.400000000000546 on the hosted runner), and a perf figure missed on a shared runner failed the run with no second
// look and no record of what the first look saw.
import { describe, expect, it } from 'vitest'
import { atClockGrain, frameStats, measureWithQuietRetry } from './perfMeasure.ts'

/** A scroll's intervals: `n` frames of each length, in the order given. */
function frames(...runs: readonly (readonly [number, number])[]): number[] {
  return runs.flatMap(([ms, n]) => Array.from({ length: n }, () => ms))
}

describe('atClockGrain', () => {
  it('reads a float-noisy two-vsync frame as the clock wrote it', () => {
    expect(33.400000000000546 > 33.4).toBe(true)
    expect(atClockGrain(33.400000000000546)).toBe(33.4)
    expect(atClockGrain(33.399999999999636)).toBe(33.4)
    expect(atClockGrain(16.699999999999818)).toBe(16.7)
    expect(atClockGrain(50.099999999999454)).toBe(50.1)
  })
})

describe('frameStats', () => {
  it('does not count 33.4 ms frames over 33.4 ms, whatever their float noise', () => {
    const stats = frameStats(frames([16.699999999999818, 450], [33.400000000000546, 30], [33.399999999999636, 10], [50.099999999999454, 8]))
    expect(stats.frames).toBe(498)
    expect(stats.over33).toBe(8)
    expect(stats.p95).toBe(33.4)
    expect(stats.max).toBe(50.1)
  })

  it('still counts every frame of three vsyncs or more', () => {
    const stats = frameStats(frames([16.7, 400], [50, 60], [66.70000000000073, 38]))
    expect(stats.over33).toBe(98)
    expect(stats.over33 / stats.frames).toBeGreaterThan(0.05)
    expect(stats.p95).toBe(66.7)
  })

  it('ranks as the spec did: index floor(q * n) of the sorted frames', () => {
    const stats = frameStats([5, 1, 4, 2, 3])
    expect(stats).toEqual({ frames: 5, p50: 3, p95: 5, max: 5, over33: 0 })
  })

  it('a run of the hosted runner that failed at 41 frames over 33.4 ms has at most 24 once read at the grain', () => {
    // 38197225288 attempt 1: 498 frames, p95 33.400000000000546, over33 41. Every frame up to the p95 index (473) is
    // at most 33.4 ms, so at most 24 frames can be longer; here the 24 are 50 ms, the worst case.
    const stats = frameStats(frames([16.7, 433], [33.400000000000546, 41], [50, 24]))
    expect(stats.p95).toBe(33.4)
    expect(stats.over33).toBe(24)
    expect(stats.over33 / stats.frames).toBeLessThan(0.05)
  })

  it('gives zeros for no frames', () => {
    expect(frameStats([])).toEqual({ frames: 0, p50: 0, p95: 0, max: 0, over33: 0 })
  })
})

describe('measureWithQuietRetry', () => {
  const budget = (ms: number) => {
    if (!(ms < 100)) throw new Error(`render took ${ms} ms, over 100`)
  }

  function run(values: readonly number[], ci: boolean) {
    const log: string[] = []
    const taken: number[] = []
    const result = measureWithQuietRetry({
      label: 'render',
      ci,
      measure: async (attempt) => {
        taken.push(attempt)
        return values[attempt - 1]!
      },
      check: budget,
      log: (line) => log.push(line),
    })
    return { result, log, taken }
  }

  it('measures once and logs it when the first attempt is within budget', async () => {
    const r = run([30], true)
    await expect(r.result).resolves.toEqual([30])
    expect(r.taken).toEqual([1])
    expect(r.log).toEqual(['perf render, attempt 1: 30'])
  })

  it('on CI, measures once more after a miss, logs both and passes on a second attempt within budget', async () => {
    const r = run([142.8, 31], true)
    await expect(r.result).resolves.toEqual([142.8, 31])
    expect(r.taken).toEqual([1, 2])
    expect(r.log).toEqual([
      'perf render, attempt 1: 142.8',
      'perf render, attempt 1 missed (render took 142.8 ms, over 100); measuring once more, CI only',
      'perf render, attempt 2: 31',
    ])
  })

  it('on CI, fails with the second miss and never takes a third attempt', async () => {
    const r = run([142.8, 134.7, 20], true)
    await expect(r.result).rejects.toThrow('render took 134.7 ms, over 100')
    expect(r.taken).toEqual([1, 2])
    expect(r.log).toHaveLength(3)
  })

  it('off CI, fails at the first miss without a retry', async () => {
    const r = run([142.8, 31], false)
    await expect(r.result).rejects.toThrow('render took 142.8 ms, over 100')
    expect(r.taken).toEqual([1])
    expect(r.log).toEqual(['perf render, attempt 1: 142.8'])
  })

  it('never retries a failure of the measurement itself, such as a functional check', async () => {
    let calls = 0
    const result = measureWithQuietRetry({
      label: 'scroll',
      ci: true,
      measure: async () => {
        calls += 1
        throw new Error('the grid rendered 400 rows: not virtualised')
      },
      check: () => {},
      log: () => {},
    })
    await expect(result).rejects.toThrow('not virtualised')
    expect(calls).toBe(1)
  })

  it('strips terminal colours from a miss before logging it', async () => {
    const log: string[] = []
    await measureWithQuietRetry({
      label: 'x',
      ci: true,
      measure: async (attempt) => attempt,
      check: (v) => {
        if (v === 1) throw new Error('\u001b[2mexpect(\u001b[22mreceived\u001b[2m)\n  Expected: < 1')
      },
      log: (line) => log.push(line),
    })
    expect(log[1]).toBe('perf x, attempt 1 missed (expect(received) Expected: < 1); measuring once more, CI only')
  })

  it('report-only: measures once, logs it and never applies the check, on or off CI', async () => {
    for (const ci of [true, false]) {
      const log: string[] = []
      let calls = 0
      const out = await measureWithQuietRetry({
        label: 'x',
        ci,
        reportOnly: true,
        measure: async () => ++calls,
        check: () => {
          throw new Error('over budget')
        },
        log: (line) => log.push(line),
      })
      expect(out).toEqual([1])
      expect(calls).toBe(1)
      expect(log).toHaveLength(2)
      expect(log[1]).toContain('report-only')
    }
  })
})

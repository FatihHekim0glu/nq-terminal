// The demo's /api/runs/compare body: a port of backend/nq_terminal/services/runs.py compare() and
// _rebased() over the captured Basis B bodies, held to the captured CompareStats. A run is served only
// when its reconstruction ends where the captured stats say it should (1 + total_return, 1e-12); the
// list of such runs is explicit and pinned here.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import source from './compare.ts?raw'
import { ANALYTICS, PANELS, runKey } from './analytics'
import { NOT_IN_DEMO } from './answer'
import { DEMO_COMPARE_RUNS, reconstruct, runComparison, type CapturedCurve } from './compare'
import { COMPARE_STATS, RUNS } from './runs'
import { answerDemo } from '../routes'

type Comparison = Schemas['RunComparison']

const DTS = 'nt_dtsmom_v0_fixture_ts1'
const VOL = 'nt_volmanaged_v0_fixture_m1'
const SMOKE = 'smoke_2015_01'
const OVERNIGHT = 'nt_overnight_v0_fixture_open'
const ZA_A = 'nt_za_v0_fixture_a'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'

/** The captured Basis B curve of a run, read straight from the analytics bodies (not through compare.ts). */
function capturedOf(runId: string): { dates: string[]; equity: Array<number | null>; capital: number } | null {
  const key = runKey(runId, new URLSearchParams())
  const analytics = ANALYTICS.get(key)
  if (analytics) return { dates: analytics.equity.date, equity: analytics.equity.equity, capital: analytics.capital ?? Number.NaN }
  const panel = PANELS.get(key)
  if (panel) return { dates: panel.date, equity: panel.equity, capital: panel.capital ?? Number.NaN }
  return null
}

const totalReturn = (runId: string): number => {
  const stats = COMPARE_STATS.find((s) => s.run_id === runId)
  if (stats?.total_return === null || stats?.total_return === undefined) throw new Error(`no total return for ${runId}`)
  return stats.total_return
}

const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

function ok(ids: string): Comparison {
  const answer = runComparison(ids)
  if (answer.status !== 200) throw new Error(`${ids}: ${answer.status} ${answer.detail}`)
  return answer.body
}

function seriesOf(body: Comparison, runId: string): Schemas['CompareSeries'] {
  const found = body.series.find((s) => s.run_id === runId)
  if (!found) throw new Error(`no series for ${runId}`)
  return found
}

describe('DEMO_COMPARE_RUNS', () => {
  it('is pinned: the three runs whose captured Basis B body reconstructs to the captured stats', () => {
    expect([...DEMO_COMPARE_RUNS]).toEqual([DTS, VOL, SMOKE])
  })

  it('is exactly the runs that have a captured Basis B body and pass the fidelity check', () => {
    const passing = RUNS.filter((run) => {
      const curve = capturedOf(run.run_id)
      const stats = COMPARE_STATS.find((s) => s.run_id === run.run_id)
      if (!curve || !run.usable || stats?.total_return === null || stats?.total_return === undefined) return false
      const last = curve.equity.at(-1)
      return typeof last === 'number' && Math.abs(last / curve.capital - (1 + stats.total_return)) <= 1e-12
    }).map((run) => run.run_id)
    expect([...DEMO_COMPARE_RUNS]).toEqual(passing)
  })

  it('holds only runs the dataset lists and can reconstruct', () => {
    for (const id of DEMO_COMPARE_RUNS) {
      expect(RUNS.some((r) => r.run_id === id)).toBe(true)
      expect(capturedOf(id)).not.toBeNull()
    }
  })
})

describe('runComparison: fidelity to the captured stats', () => {
  for (const id of DEMO_COMPARE_RUNS) {
    const other = DEMO_COMPARE_RUNS.find((x) => x !== id) as string
    const captured = () => capturedOf(id) as NonNullable<ReturnType<typeof capturedOf>>

    it(`${id}: the last rebased value is 1 + total_return within 1e-12`, () => {
      const rebased = seriesOf(ok(`${id},${other}`), id).rebased
      const last = rebased.filter((v): v is number => v !== null).at(-1)
      expect(last).toBeDefined()
      expect(Math.abs((last as number) - (1 + totalReturn(id)))).toBeLessThanOrEqual(1e-12)
    })

    it(`${id}: the day before its first session is exactly 1.0`, () => {
      const body = ok(`${id},${other}`)
      const base = dayBefore(captured().dates[0] as string)
      const at = body.date.indexOf(base)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(seriesOf(body, id).rebased[at]).toBe(1)
    })

    it(`${id}: every session is equity over the captured capital, and null outside the run`, () => {
      const curve = captured()
      const body = ok(`${id},${other}`)
      const rebased = seriesOf(body, id).rebased
      const mine = new Set([dayBefore(curve.dates[0] as string), ...curve.dates])
      body.date.forEach((day, i) => {
        const at = curve.dates.indexOf(day)
        if (at >= 0) expect(rebased[i]).toBe((curve.equity[at] as number) / curve.capital)
        else if (!mine.has(day)) expect(rebased[i]).toBeNull()
      })
    })
  }

  it('pins the base days: the calendar day before each first session', () => {
    const body = ok([DTS, VOL, SMOKE].join(','))
    for (const [id, base] of [[DTS, '2012-01-02'], [VOL, '2011-06-02'], [SMOKE, '2015-01-01']] as const) {
      expect(seriesOf(body, id).rebased[body.date.indexOf(base)]).toBe(1)
    }
  })
})

describe('runComparison: the shared axis', () => {
  it('is the sorted union of every run\'s dates and its base day, with t at midnight UTC of each', () => {
    const ids = [VOL, DTS, SMOKE]
    const body = ok(ids.join(','))
    const expected = new Set<string>()
    for (const id of ids) {
      const dates = (capturedOf(id) as NonNullable<ReturnType<typeof capturedOf>>).dates
      expected.add(dayBefore(dates[0] as string))
      for (const d of dates) expected.add(d)
    }
    expect(body.date).toEqual([...expected].sort())
    expect(body.t).toEqual(body.date.map((d) => Date.parse(`${d}T00:00:00Z`) / 1000))
    expect(body.t).toEqual([...body.t].sort((a, b) => a - b))
    for (const s of body.series) expect(s.rebased).toHaveLength(body.date.length)
  })

  it('gives two runs of different years one axis with a gap between them, as the API would', () => {
    const body = ok(`${DTS},${VOL}`)
    expect(body.date).toHaveLength(15 + 1 + 10 + 1)
    const vol = seriesOf(body, VOL).rebased
    const dts = seriesOf(body, DTS).rebased
    expect(vol.filter((v) => v !== null)).toHaveLength(10 + 1)
    expect(dts.filter((v) => v !== null)).toHaveLength(15 + 1)
    body.date.forEach((_, i) => expect(vol[i] === null || dts[i] === null).toBe(true))
  })

  it('keeps the series in the order the ids were asked, with the flags of the run list and the captured source', () => {
    const body = ok(`${VOL},${SMOKE},${DTS}`)
    expect(body.series.map((s) => s.run_id)).toEqual([VOL, SMOKE, DTS])
    expect(body.series.map((s) => s.source)).toEqual(['mtm_snapshots', 'realised_trades', 'mtm_snapshots'])
    expect(body.series.every((s) => s.usable && !s.is_probe)).toBe(true)
    const listed = (id: string) => RUNS.find((r) => r.run_id === id)
    for (const s of body.series) {
      expect(s.usable).toBe(listed(s.run_id)?.usable)
      expect(s.is_probe).toBe(listed(s.run_id)?.is_probe)
    }
  })

  it('reads ids with blanks around them, as the stats route does', () => {
    expect(ok(` ${DTS} , ${VOL} `).series.map((s) => s.run_id)).toEqual([DTS, VOL])
  })
})

describe('runComparison: the stats are the captured ones', () => {
  it('serves each COMPARE_STATS entry verbatim, in the order asked', () => {
    const body = ok(`${SMOKE},${DTS},${VOL}`)
    expect(body.stats.map((s) => s.run_id)).toEqual([SMOKE, DTS, VOL])
    for (const s of body.stats) {
      const captured = COMPARE_STATS.find((c) => c.run_id === s.run_id)
      expect(s).toBe(captured)
      expect(s).toEqual(captured)
    }
  })
})

describe('runComparison: what the dataset does not hold answers 404', () => {
  const refuse = (ids: string | null) => expect(runComparison(ids)).toBe(NOT_IN_DEMO)

  it('refuses a missing, empty or single id', () => {
    refuse(null)
    refuse('')
    refuse(' , ')
    refuse(DTS)
  })

  it('refuses nine ids, the listed runs among them', () => {
    refuse(Array.from({ length: 9 }, (_, i) => `run_${i}`).join(','))
    refuse([DTS, VOL, SMOKE, ...Array.from({ length: 6 }, (_, i) => `run_${i}`)].join(','))
  })

  it('refuses a repeated id', () => {
    refuse(`${DTS},${DTS}`)
    refuse(`${DTS},${VOL},${DTS}`)
  })

  it('refuses an unknown id', () => {
    refuse(`${DTS},nt_not_in_the_demo`)
  })

  it('refuses a run without a listed reconstruction: no captured body, or unusable', () => {
    refuse(`${DTS},${OVERNIGHT}`)
    refuse(`${VOL},${ZA_A}`)
    refuse(`${DTS},${UNBALANCED}`)
    refuse(`${OVERNIGHT},${ZA_A}`)
  })
})

describe('reconstruct: the port of compare() and _rebased()', () => {
  const curve = (dates: string[], equity: Array<number | null>, capital = 100): CapturedCurve => ({ dates, equity, capital })

  it('puts 1.0 on the day before the first session and equity over K after it', () => {
    const out = reconstruct([curve(['2020-01-06', '2020-01-07'], [101, 99])])
    expect(out.date).toEqual(['2020-01-05', '2020-01-06', '2020-01-07'])
    expect(out.rebased).toEqual([[1, 1.01, 0.99]])
    expect(out.t).toEqual([1578182400, 1578268800, 1578355200])
  })

  it('crosses a month and a year end for the base day', () => {
    expect(reconstruct([curve(['2021-03-01'], [100])]).date[0]).toBe('2021-02-28')
    expect(reconstruct([curve(['2020-03-01'], [100])]).date[0]).toBe('2020-02-29')
    expect(reconstruct([curve(['2022-01-01'], [100])]).date[0]).toBe('2021-12-31')
  })

  it('leaves a gap (null) where a run has no value, and merges overlapping runs on shared days', () => {
    const out = reconstruct([
      curve(['2020-01-06', '2020-01-08'], [110, 120], 100),
      curve(['2020-01-07', '2020-01-08'], [50, 60], 50),
    ])
    expect(out.date).toEqual(['2020-01-05', '2020-01-06', '2020-01-07', '2020-01-08'])
    expect(out.rebased[0]).toEqual([1, 1.1, null, 1.2])
    expect(out.rebased[1]).toEqual([null, 1, 1, 1.2])
  })

  it('treats a missing captured value as no value, not as zero', () => {
    const out = reconstruct([curve(['2020-01-06', '2020-01-07'], [null, 101])])
    expect(out.rebased[0]).toEqual([1, null, 1.01])
  })

  it('lets the last of two rows on one day win, as the backend\'s dict does', () => {
    const out = reconstruct([curve(['2020-01-06', '2020-01-06'], [101, 102])])
    expect(out.date).toEqual(['2020-01-05', '2020-01-06'])
    expect(out.rebased[0]).toEqual([1, 1.02])
  })

  it('divides each run by its own capital', () => {
    const out = reconstruct([curve(['2020-01-06'], [1_000_500], 1_000_000)])
    expect(out.rebased[0]?.[1]).toBe(1_000_500 / 1_000_000)
  })
})

describe('the header', () => {
  it('says the body is a reconstruction checked against the captured stats', () => {
    const header = source.split('\n').filter((line) => line.startsWith('//')).map((line) => line.replace(/^\/\/\s?/, '')).join(' ')
    expect(header).toMatch(/reconstruction/i)
    expect(header).toMatch(/checked against the captured/i)
  })
})

describe('the /api/runs/compare route', () => {
  const get = (query: Record<string, string>) => answerDemo('/api/runs/compare', new URLSearchParams(query))

  it('answers a listed pair with the reconstructed body', () => {
    expect(get({ ids: `${DTS},${VOL}` })).toEqual({ status: 200, body: ok(`${DTS},${VOL}`) })
  })

  it('answers the honest 404 for an unlisted run or a missing ids parameter', () => {
    expect(get({ ids: `${DTS},${OVERNIGHT}` }).status).toBe(404)
    expect(get({}).status).toBe(404)
  })
})

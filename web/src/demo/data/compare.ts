// The demo's GET /api/runs/compare body: a reconstruction from the captured Basis B bodies, checked against
// the captured CompareStats. It ports backend/nq_terminal/services/runs.py compare() and _rebased():
//   days     = the sorted union of every drawn run's session dates and its base day, the calendar day before
//              its first session, where the rebased value is exactly K / K = 1.0;
//   t        = each day at midnight UTC in epoch seconds (_date_epoch);
//   rebased  = equity / K per day, null where the run has no value.
// The captured Basis B body (screens/runs/runs.fixtures.ts, one row per gated session) stands in for the
// backend's EquitySeries.equity and starting_usd: its equity and capital, and it inherits the body's dates (one
// row per gated session). Nothing else is computed; the stats are the captured COMPARE_STATS entries verbatim.
//
// The check that a reconstruction is honest: its last rebased value must equal 1 + the captured
// total_return (within 1e-12, compare.test.ts). Only the runs listed in DEMO_COMPARE_RUNS are served, every
// one of them passing that check; any other id answers 404 'not in the demo dataset', never a body borrowed
// from another run.
import type { Schemas } from '../../api/types'
import { ANALYTICS, PANELS, runKey } from './analytics'
import { NOT_IN_DEMO, served, utcMs, type DemoBody, type DemoRefusal } from './answer'
import { COMPARE_STATS, RUNS } from './runs'

type Comparison = Schemas['RunComparison']
type Source = Schemas['CompareSeries']['source']

/** The runs the demo can compare, in run list order, each with a captured Basis B body that ends at 1 + total_return.
 * Left out, and answered 404: nt_overnight_v0_fixture_open and nt_za_v0_fixture_a (usable runs, but no Basis B body
 * was captured for them, so nothing honest can be rebased) and nt_za_v0_fixture_unbalanced (unusable, rule 4: the
 * compare view lists it as not drawn and never asks for it). */
export const DEMO_COMPARE_RUNS: readonly string[] = [
  'nt_dtsmom_v0_fixture_ts1',
  'nt_volmanaged_v0_fixture_m1',
  'smoke_2015_01',
]

/** The API accepts 2 to 8 distinct runs (MAX_COMPARE). */
const COMPARE_MIN = 2
const COMPARE_MAX = 8
const DAY_MS = 86_400_000
const SOURCES: readonly string[] = ['mtm_snapshots', 'realised_trades']

/** What the reconstruction needs of a run: its session dates, equity per session and starting balance K. */
export interface CapturedCurve {
  readonly dates: readonly string[]
  readonly equity: ReadonlyArray<number | null>
  readonly capital: number
}

interface Captured extends CapturedCurve {
  readonly source: Source
}

const isSource = (v: string): v is Source => SOURCES.includes(v)

/** A captured Basis B body as a curve: USD equity, a positive K, and a source the API names. */
function curveOf(
  dates: readonly string[], equity: ReadonlyArray<number | null>, unit: string, capital: number | null, ...origin: string[]
): Captured | null {
  const source = origin.find(isSource)
  if (source === undefined || capital === null || !(capital > 0) || !unit.startsWith('USD')) return null
  return dates.length > 0 && dates.length === equity.length ? { dates, equity, capital, source } : null
}

/** The run's captured Basis B body, from its tear sheet analytics or its HOME panel (both carry K and the session equity). */
function captured(runId: string): Captured | null {
  const key = runKey(runId, new URLSearchParams())
  const analytics = ANALYTICS.get(key)
  if (analytics) return curveOf(analytics.equity.date, analytics.equity.equity, analytics.equity.unit, analytics.capital, analytics.source, analytics.kind)
  const panel = PANELS.get(key)
  if (panel) return curveOf(panel.date, panel.equity, panel.equity_unit, panel.capital, panel.source, panel.kind)
  return null
}

/** _date_epoch: midnight UTC of an ISO day, in epoch seconds. */
const epoch = (day: string): number => utcMs(day) / 1000

/** _base_day: the calendar day before a curve's first session (none for a curve without sessions). */
function baseDay(curve: CapturedCurve): string[] {
  const first = curve.dates[0]
  return first === undefined ? [] : [new Date(utcMs(first.slice(0, 10)) - DAY_MS).toISOString().slice(0, 10)]
}

/** compare() over curves already read: the shared days, their epoch stamps, and one rebased line per curve. */
export function reconstruct(curves: readonly CapturedCurve[]): { t: number[]; date: string[]; rebased: Array<Array<number | null>> } {
  const date = [...new Set(curves.flatMap((c) => [...c.dates, ...baseDay(c)]))].sort()
  const rebased = curves.map((c) => {
    // _rebased: {base day: K} overlaid by {date: equity}; a later row on the same day wins.
    const byDay = new Map<string, number | null>(baseDay(c).map((d) => [d, c.capital]))
    c.dates.forEach((d, i) => byDay.set(d, c.equity[i] ?? null))
    return date.map((d) => {
      const value = byDay.get(d)
      return value === undefined || value === null ? null : value / c.capital
    })
  })
  return { t: date.map(epoch), date, rebased }
}

/** The asked ids: split on commas, blanks around them dropped, empty entries skipped (as /api/runs/stats reads them). */
function idsOf(ids: string | null): string[] {
  return (ids ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')
}

/** GET /api/runs/compare?ids=a,b: 2 to 8 distinct listed runs; anything else the dataset does not hold is a 404. */
export function runComparison(ids: string | null): DemoBody<Comparison> | DemoRefusal {
  const wanted = idsOf(ids)
  if (wanted.length < COMPARE_MIN || wanted.length > COMPARE_MAX || new Set(wanted).size !== wanted.length) return NOT_IN_DEMO
  const found = wanted.map((id) => ({
    curve: DEMO_COMPARE_RUNS.includes(id) ? captured(id) : null,
    run: RUNS.find((r) => r.run_id === id),
    stats: COMPARE_STATS.find((s) => s.run_id === id),
  }))
  const complete = found.flatMap((f) => (f.curve && f.run && f.stats ? [{ curve: f.curve, run: f.run, stats: f.stats }] : []))
  if (complete.length !== wanted.length) return NOT_IN_DEMO
  const { t, date, rebased } = reconstruct(complete.map((f) => f.curve))
  return served({
    t,
    date,
    series: complete.map((f, i) => ({
      run_id: f.run.run_id,
      is_probe: f.run.is_probe,
      usable: f.run.usable,
      source: f.curve.source,
      rebased: rebased[i] as Array<number | null>,
    })),
    stats: complete.map((f) => f.stats),
  })
}

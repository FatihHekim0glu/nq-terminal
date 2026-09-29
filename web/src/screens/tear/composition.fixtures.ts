// Gallery fixture for the exposure composition card (roadmap #13): a SEEDED 27-instrument book over
// 1,300 weekday sessions, so the by-instrument grid and the by-sector stack can be seen at the scale of
// the whole universe. It is NOT a run and NOT a result: every number below comes from a fixed random seed
// (mulberry32), never from a backtest, and the fixture says so in its own labels. Values are absolute
// notional over equity in [0, 0.4] with runs of exactly zero (a flat book); gross is their sum, net a
// seeded signed series no larger than gross. The instrument index is the MON test universe's roots.
// Imported by the gallery entry and by tests only; never by the app.
import type { Schemas } from '../../api/types'
import { mulberry32, tradingDays } from '../../gallery/fixtures'
import { ROOTS } from '../mon/testUniverse'
import type { RootIndex } from './bookComposition'

export const COMPOSITION_RUN = 'gallery_fixture_seeded_book'
/** Weekday sessions from 2016-01-04: 260 whole ISO weeks, so the card samples them weekly. */
export const COMPOSITION_SESSIONS = 1300
export const COMPOSITION_START = '2016-01-04'
export const COMPOSITION_MAX = 0.4

const SEED = 20160104
const PERIODS = 252
const RUN_MIN = 5
const RUN_SPAN = 55
const FLAT_SHARE = 0.35
const JITTER = 0.2
const STEP = 0.2
const PLACES = 1_000_000

const round = (v: number) => Math.round(v * PLACES) / PLACES
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length

/** Runs of 5 to 59 sessions, each either flat (exactly 0) or held near one level in [0, 0.4]. */
function heldSeries(rand: () => number, n: number): number[] {
  const out: number[] = []
  while (out.length < n) {
    const length = RUN_MIN + Math.floor(rand() * RUN_SPAN)
    const level = rand() < FLAT_SHARE ? 0 : rand() * COMPOSITION_MAX
    for (let k = 0; k < length && out.length < n; k += 1) {
      out.push(level === 0 ? 0 : round(Math.min(COMPOSITION_MAX, level * (1 - JITTER / 2 + JITTER * rand()))))
    }
  }
  return out
}

function build(): Schemas['RunExposure'] {
  const rand = mulberry32(SEED)
  const t = tradingDays(COMPOSITION_SESSIONS, COMPOSITION_START)
  const date = t.map((s) => new Date(s * 1000).toISOString().slice(0, 10))
  const by_instrument: Record<string, number[]> = {}
  for (const [root] of ROOTS) by_instrument[`${root}.XCME`] = heldSeries(rand, date.length)
  const series = Object.values(by_instrument)
  const gross = date.map((_, i) => round(series.reduce((sum, s) => sum + (s[i] ?? 0), 0)))
  let direction = 0.5
  const net = gross.map((g) => {
    direction = Math.max(-1, Math.min(1, direction + (rand() - 0.5) * STEP))
    return round(g * direction)
  })
  const daily = date.map((_, i) => (i === 0 ? 0 : round(series.reduce((sum, s) => sum + Math.abs((s[i] ?? 0) - (s[i - 1] ?? 0)), 0))))
  const meanDaily = mean(daily)
  return {
    run_id: COMPOSITION_RUN,
    tag: '[POST HOC]',
    available: true,
    note: null,
    exposure: {
      run_id: COMPOSITION_RUN,
      basis: 'B',
      unit: 'notional over equity',
      label: 'Seeded gallery fixture, not a run: absolute notional over equity per instrument and session',
      price_basis: 'none: a seeded gallery fixture, no prices',
      positions_reconcile: true,
      t,
      date,
      gross,
      net,
      mean_gross: mean(gross),
      mean_net: mean(net),
      by_instrument,
    },
    turnover: {
      run_id: COMPOSITION_RUN,
      basis: 'B',
      unit: 'notional traded over equity',
      label: 'Seeded gallery fixture, not a run: one-way notional change over equity per session',
      price_basis: 'none: a seeded gallery fixture, no prices',
      source: 'seeded gallery fixture',
      periods: PERIODS,
      t,
      date,
      daily,
      mean_daily: meanDaily,
      annualised: meanDaily * PERIODS,
    },
  }
}

/** The 27 seeded instruments as GET /api/analytics/run/{id}/exposure would carry them. */
export const COMPOSITION_EXPOSURE: Schemas['RunExposure'] = build()

/** The instrument index (root and sector) of the MON test universe, as GET /api/commands lists it. */
export const COMPOSITION_INDEX: RootIndex = {
  instruments: ROOTS.map(([root, sector]) => ({ root, sector })),
}

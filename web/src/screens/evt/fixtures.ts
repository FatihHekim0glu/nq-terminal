// Hand-built EVT API bodies for the tests and the gallery: a calendar with the real counts, and a small daily
// study (two complete events, one void) whose values are easy to check by hand.
import type { EventCalendar, EventStudy } from './types'

const GATE = { caller: 'terminal', served_years: [2010, 2021], cached: false, reads_this_process: 1 }
const LABEL = '[POST HOC] descriptive event study, in-sample to 2021-12-31, not a registered test'

export function makeCalendar(): EventCalendar {
  return {
    label: LABEL,
    source: 'experiments/macroday_v0.json event_dates (sha256 0123456789ab)',
    spec_sha256: '0123456789ab'.padEnd(64, '0'),
    fomc_check: 'agrees with the 89 statements in data/text/fomc/manifest.json',
    types: ['CPI', 'PPI', 'NFP', 'FOMC', 'ALL'],
    counts: { CPI: 133, PPI: 135, NFP: 132, FOMC: 89, ALL: 475 },
    excluded: ['2012-04-06'],
    events: [{ date: '2015-01-28', types: ['FOMC'], times_et: ['14:00'] }],
    daily_symbols: ['NQ.V.0', 'ES.V.0', 'ZN.V.0'],
    intraday_symbols: ['NQ.V.0', 'ZN.V.0'],
    daily_default: [5, 5],
    intraday_default: [60, 120],
  }
}

export function makeStudy(overrides: Partial<EventStudy> = {}): EventStudy {
  return {
    symbol: 'NQ.V.0',
    event_type: 'FOMC',
    mode: 'daily',
    variant: 'vendor',
    timeframe: '1d',
    label: LABEL,
    basis: 'cumulative sum of daily r from the close before the event session',
    band_note: 'band: mean -/+ 1.96 x the cross-event standard error; no p-value is shown on a slice picked on screen',
    source: 'experiments/macroday_v0.json event_dates (sha256 0123456789ab)',
    unit: 'cumulative sum of daily returns from the close before the event (0.01 is 1%); a sum, so it is not exactly the price change over several sessions',
    offset_unit: 'session',
    pre: 2,
    post: 2,
    offsets: [-2, -1, 0, 1, 2],
    mean: [-0.001, 0, 0.002, 0.003, 0.005],
    se: [0.001, 0, 0.001, 0.001, 0.002],
    lower: [-0.003, 0, 0, 0.001, 0.001],
    upper: [0.001, 0, 0.004, 0.005, 0.009],
    band_z: 1.96,
    band_level: 0.95,
    n_listed: 3,
    n_used: 2,
    n_void: 1,
    end: { n: 2, mean: 0.005, median: 0.005, sd: 0.001, se: 0.0007, share_positive: 1 },
    events: [
      { n: 1, date: '2015-01-28', types: ['FOMC'], time_et: '14:00', t0_utc: null, used: true, reason: null, first: -0.002, end: 0.004, path: [-0.002, 0, 0.001, 0.002, 0.004] },
      { n: 2, date: '2015-03-18', types: ['FOMC', 'PPI'], time_et: '14:00', t0_utc: null, used: true, reason: null, first: 0, end: 0.006, path: [0, 0, 0.003, 0.004, 0.006] },
      { n: 3, date: '2016-06-15', types: ['FOMC'], time_et: '14:00', t0_utc: null, used: false, reason: 'stale close on 2016-06-14 (no bar dated that session)', first: null, end: null, path: [] },
    ],
    gate: GATE,
    ...overrides,
  }
}

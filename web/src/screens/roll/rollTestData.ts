// Test data for the ROLL tests (imported by *.test.* files only, never by the app). The NQ and CL rows and
// the paper schedule repeat what the fixture-mode backend returned (backend/tests/fixture_app.py, synthetic
// bars; today 2026-09-27); ES is hand-built to reach the edge cases: two rolls in one month, a QA count that
// differs, a missing percent gap, and one roll dated after the fence that the screen must never show.
import type { MarketRolls, PaperRollSchedule, RollCalendar, RollEvent } from './types'

export const LABEL = '[POST HOC] descriptive, in-sample, not a registered test'
export const BASIS =
  "a roll is a change of instrument_id between consecutive served 1d bars (vendor, volume-rolled); gap_pts = offset_t - offset_(t-1) in the root's served units; gap_pct = 100 x gap_pts / c_none of the bar before the roll; 1d files through the OOS gate, sessions to 2021-12-31"
export const UNIT_NOTE =
  "gap in the root's served units (points) and in percent of the unadjusted close before the roll; the sign is the offset change, old contract less new, so it is negative when the new contract trades above the old"

const ev = (date: string, lastDate: string, from: number, closeBefore: number | null, gapPts: number | null, gapPct: number | null): RollEvent => ({
  date,
  t: Date.parse(`${date}T00:00:00Z`) / 1000,
  last_date: lastDate,
  from,
  to: from + 1,
  close_before: closeBefore,
  gap_pts: gapPts,
  gap_pct: gapPct,
})

export const NQ: MarketRolls = {
  symbol: 'NQ.V.0', root: 'NQ', sector: 'equity', units: 'index points', tick: 0.25, first_date: '2010-01-01', last_date: '2021-12-31',
  rolls: [
    ev('2021-06-11', '2021-06-10', 208085, 15260.75, -0.25, -0.0016381894729944465),
    ev('2021-09-13', '2021-09-10', 208086, 14028.75, -4.25, -0.03029493005435267),
    ev('2021-12-13', '2021-12-10', 208087, 14920.25, 3.75, 0.025133627117508085),
  ],
  per_year: { '2021': 3 }, count: 3, mean_abs_gap_pct: 0.019022, max_abs_gap_pct: 0.03029493005435267, qa_rolls_total: 3, qa_match: true,
}

export const CL: MarketRolls = {
  symbol: 'CL.V.0', root: 'CL', sector: 'energy', units: 'USD per barrel', tick: 0.01, first_date: '2010-01-01', last_date: '2021-12-31',
  rolls: [
    ev('2021-06-11', '2021-06-10', 1408085, 71.4, -0.07, -0.09803921568627451),
    ev('2021-09-13', '2021-09-10', 1408086, 70.98, 0.010000000000000009, 0.014088475626937177),
    ev('2021-12-13', '2021-12-10', 1408087, 70.23, 0.19, 0.2705396554179126),
  ],
  per_year: { '2021': 3 }, count: 3, mean_abs_gap_pct: 0.1275, max_abs_gap_pct: 0.2705396554179126, qa_rolls_total: null, qa_match: null,
}

export const ES: MarketRolls = {
  symbol: 'ES.V.0', root: 'ES', sector: 'equity', units: 'index points', tick: 0.25, first_date: '2010-01-01', last_date: '2021-12-31',
  rolls: [
    ev('2020-03-12', '2020-03-11', 736, 2480.5, 1.5, 0.060471),
    ev('2021-03-01', '2021-02-26', 737, 3811.0, -2.0, -0.052480),
    ev('2021-03-19', '2021-03-18', 738, 3913.25, 0.5, 0.012777),
    ev('2021-09-17', '2021-09-16', 739, null, 1.0, null),
    ev('2022-03-11', '2022-03-10', 740, 4200.0, 1.25, 0.029762),
  ],
  per_year: { '2020': 1, '2021': 3, '2022': 1 }, count: 5, mean_abs_gap_pct: 0.0414, max_abs_gap_pct: 0.060471, qa_rolls_total: 46, qa_match: false,
}

export function makeCalendar(markets: readonly MarketRolls[] = [ES, NQ, CL]): RollCalendar {
  const months: string[] = []
  for (let y = 2010; y <= 2021; y += 1) for (let m = 1; m <= 12; m += 1) months.push(`${y}-${String(m).padStart(2, '0')}`)
  return {
    as_of: '2021-12-31', label: LABEL, basis: BASIS, unit_note: UNIT_NOTE, months, markets: [...markets], missing: ['ZW.V.0'],
    qa_source: 'results/qa_report_universe.json (candidates.<root>.qa.rolls_total)',
    gate: { caller: 'terminal', served_years: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021], cached: false, reads_this_process: 27 },
  }
}

export const PAPER: PaperRollSchedule = {
  label: 'paper book roll schedule: calendar rule only, no price is read',
  rule: 'expiry on the third Friday of March, June, September and December (the business day before when that Friday is not one); the book rolls at the close 8 business days before expiry, so on a roll day it already holds the new contract',
  source: 'nq_lab.mnq_roll', today_et: '2026-09-27', held: 'MNQZ6', next_roll: '2026-12-08', roll_today: false,
  rows: [
    { contract: 'MNQM6', expiry: '2026-06-18', roll_date: '2026-06-08', into: 'MNQU6', status: 'past' },
    { contract: 'MNQU6', expiry: '2026-09-18', roll_date: '2026-09-08', into: 'MNQZ6', status: 'past' },
    { contract: 'MNQZ6', expiry: '2026-12-18', roll_date: '2026-12-08', into: 'MNQH7', status: 'held' },
    { contract: 'MNQH7', expiry: '2027-03-19', roll_date: '2027-03-09', into: 'MNQM7', status: 'upcoming' },
  ],
}

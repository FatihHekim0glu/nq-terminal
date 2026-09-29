// Test data for the VCONE tests (imported by *.test.* files only, never by the app). The shapes are the local
// VolCone and VolConeUniverse types; values are deterministic fillers on the backend's scale (fractions per year).
import { LABEL, ROOTS } from '../mon/testUniverse'
import type { VolCone, VolConeRow, VolConeUniverse } from './types'

export const HORIZON_LIST = [5, 10, 21, 63, 126, 252] as const
export const BASIS = 'sd of log(1 + r) over each window of h sessions (ddof 1, every return defined) x sqrt(252)'
export const UNIT = 'fraction per year, annualised (0.18 is 18%)'
// As the real backend's gate would report it for these fixtures (see model.test.ts and VconeScreen.test.tsx).
// The demo dataset does not read through a real gate, so it overrides this field itself (demo/data/p1.ts).
export const GATE = { caller: 'terminal', served_years: [2010, 2021], cached: false, reads_this_process: 27 }
export { LABEL }

export function coneRow(sessions: number, scale = 1, latest: number | null = 0.21): VolConeRow {
  const wide = 1 + 20 / sessions
  return {
    sessions,
    n: 2800 - sessions,
    first_date: '2010-01-11',
    last_date: '2021-12-31',
    min: 0.08 * scale,
    p10: 0.12 * scale,
    p25: 0.15 * scale,
    p50: 0.19 * scale * wide * 0.8,
    p75: 0.24 * scale * wide * 0.8,
    p90: 0.3 * scale * wide * 0.8,
    max: 0.6 * scale * wide,
    latest,
    latest_rank: latest === null ? null : 61.2,
  }
}

export function makeCone(root = 'NQ', undefinedReturns = 0): VolCone {
  const sector = ROOTS.find(([r]) => r === root)?.[1] ?? 'equity'
  return {
    symbol: `${root}.V.0`,
    root,
    sector,
    as_of: '2021-12-31',
    label: LABEL,
    basis: BASIS,
    unit: UNIT,
    percentiles: [10, 25, 50, 75, 90],
    min_windows: 20,
    undefined_returns: undefinedReturns,
    horizons: HORIZON_LIST.map((h) => coneRow(h)),
    gate: GATE,
  }
}

export function makeSmall(sessions = 21): VolConeUniverse {
  return {
    sessions,
    horizons: [...HORIZON_LIST],
    as_of: '2021-12-31',
    label: LABEL,
    basis: BASIS,
    unit: UNIT,
    percentiles: [10, 25, 50, 75, 90],
    rows: ROOTS.map(([root, sector], i) => ({
      symbol: `${root}.V.0`,
      root,
      sector,
      stats: coneRow(sessions, 0.5 + i / 20, i === 3 ? null : 0.1 + i / 100),
    })),
    missing: [],
    gate: GATE,
  }
}

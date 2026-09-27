// Test data for the MON and CORR tests (imported by *.test.* files only, never by the app). The shape is
// the contract's Universe; the NQ, ES and ZT rows and the first matrix entries repeat values the
// fixture-mode backend returned (backend/tests/fixture_app.py), the rest are deterministic fillers.
import type { Schemas } from '../../api/types'

type Universe = Schemas['Universe']
type UniverseRow = Schemas['UniverseRow']

export const ROOTS: ReadonlyArray<readonly [string, string, string]> = [
  ['ES', 'equity', 'index points'], ['NQ', 'equity', 'index points'], ['YM', 'equity', 'index points'],
  ['ZT', 'rates', 'points of par, decimal'], ['ZF', 'rates', 'points of par, decimal'],
  ['ZN', 'rates', 'points of par, decimal'], ['ZB', 'rates', 'points of par, decimal'],
  ['6E', 'fx', 'USD per EUR'], ['6J', 'fx', 'USD per JPY'], ['6B', 'fx', 'USD per GBP'],
  ['6A', 'fx', 'USD per AUD'], ['6C', 'fx', 'USD per CAD'], ['6S', 'fx', 'USD per CHF'],
  ['CL', 'energy', 'USD per barrel'], ['NG', 'energy', 'USD per MMBtu'], ['HO', 'energy', 'USD per gallon'],
  ['RB', 'energy', 'USD per gallon'], ['GC', 'metals', 'USD per troy ounce'], ['SI', 'metals', 'USD per troy ounce'],
  ['HG', 'metals', 'USD per pound'], ['ZC', 'grains', 'US cents per bushel'], ['ZS', 'grains', 'US cents per bushel'],
  ['ZW', 'grains', 'US cents per bushel'], ['ZL', 'grains', 'US cents per pound'], ['ZM', 'grains', 'USD per short ton'],
  ['LE', 'livestock', 'US cents per pound'], ['HE', 'livestock', 'US cents per pound'],
]

export const HORIZONS = ['1D', '1W', '1M', '3M', 'YTD', '12M'] as const
export const RETURNS_UNIT = 'fraction of the implied previous price, compounded over the horizon (0.01 is 1%)'
export const LABEL = '[POST HOC] descriptive, in-sample, not a registered test'
export const BASIS =
  'daily r = dB / (N - dB) with B = c_back and N = c_none (the dtsmom_panel convention), compounded over each horizon; NYSE sessions to 2021-12-31'

const NQ_ROW: UniverseRow = {
  symbol: 'NQ.V.0', root: 'NQ', sector: 'equity', units: 'index points', tick: 0.25, tick_usd: 5.0, last_date: '2021-12-31',
  last_close: 15959.0, last_close_back: 15959.0, stale_last: false,
  returns: { '1D': 0.005196359399112005, '1W': 0.0649627973707918, '1M': 0.02430415861744395, '3M': 0.06695711146688277, YTD: 0.23654186182164305, '12M': 0.23654186182164305 },
  vol_normalised: { '1D': 0.3021090280013028, '1W': 1.6890567380664319, '1M': 0.3083439746481087, '3M': 0.49044573021680204, YTD: 0.866307876836481, '12M': 0.866307876836481 },
  realised_vol: 0.27304595530797793, corr_to_nq: 1.0, returns_unit: RETURNS_UNIT,
}

const ES_ROW: UniverseRow = {
  symbol: 'ES.V.0', root: 'ES', sector: 'equity', units: 'index points', tick: 0.25, tick_usd: 12.5, last_date: '2021-12-31',
  last_close: 4782.75, last_close_back: 4782.75, stale_last: false,
  returns: { '1D': -0.006439885743962592, '1W': 0.04873369148119733, '1M': 0.04815946803835813, '3M': -0.001864833717071801, YTD: 0.17585100247912822, '12M': 0.17585100247912822 },
  vol_normalised: { '1D': -0.38769151321525686, '1W': 1.3120562047282094, '1M': 0.6326742599004984, '3M': -0.014144186366814852, YTD: 0.6668877040044005, '12M': 0.6668877040044005 },
  realised_vol: 0.26368907602166236, corr_to_nq: 0.17036571349116403, returns_unit: RETURNS_UNIT,
}

const ZT_ROW: UniverseRow = {
  symbol: 'ZT.V.0', root: 'ZT', sector: 'rates', units: 'points of par, decimal', tick: 0.00390625, tick_usd: 7.8125, last_date: '2021-12-31',
  last_close: 109.23046875, last_close_back: 109.23046875, stale_last: false,
  returns: { '1D': -0.013929050003526289, '1W': -0.038708790264361026, '1M': -0.0266945432514627, '3M': 0.03752071898828402, YTD: -0.030323672133273027, '12M': -0.030323672133273027 },
  vol_normalised: { '1D': -0.7878208462469806, '1W': -0.9791079290049415, '1M': -0.3294722319170052, '3M': 0.2673664120801983, YTD: -0.10804072573744002, '12M': -0.10804072573744002 },
  realised_vol: 0.2806689044922324, corr_to_nq: 0.038141780653912986, returns_unit: RETURNS_UNIT,
}

/** Tick and tick value per root, as the API serves them (nq_lab.dtsmom_universe TABLE). */
export const TICKS: Readonly<Record<string, readonly [number, number]>> = { "ES": [0.25, 12.5], "NQ": [0.25, 5.0], "YM": [1.0, 5.0], "ZT": [0.00390625, 7.8125], "ZF": [0.0078125, 7.8125], "ZN": [0.015625, 15.625], "ZB": [0.03125, 31.25], "6E": [5e-05, 6.25], "6J": [5e-07, 6.25], "6B": [0.0001, 6.25], "6A": [5e-05, 5.0], "6C": [5e-05, 5.0], "6S": [0.0001, 12.5], "CL": [0.01, 10.0], "NG": [0.001, 10.0], "HO": [0.0001, 4.2], "RB": [0.0001, 4.2], "GC": [0.1, 10.0], "SI": [0.005, 25.0], "HG": [0.0005, 12.5], "ZC": [0.25, 12.5], "ZS": [0.25, 12.5], "ZW": [0.25, 12.5], "ZL": [0.01, 6.0], "ZM": [0.1, 10.0], "LE": [0.025, 10.0], "HE": [0.025, 10.0] }

const KNOWN: Readonly<Record<string, UniverseRow>> = { NQ: NQ_ROW, ES: ES_ROW, ZT: ZT_ROW }

function fillerRow(root: string, sector: string, units: string, i: number): UniverseRow {
  const r = (k: number) => Math.round(((((i * 37 + k * 11) % 23) - 11) / 1000) * 1e6) / 1e6
  const z = (k: number) => Math.round(((((i * 13 + k * 7) % 21) - 10) / 6) * 1e4) / 1e4
  const returns = Object.fromEntries(HORIZONS.map((h, k) => [h, r(k)]))
  const vol = Object.fromEntries(HORIZONS.map((h, k) => [h, z(k)]))
  return {
    symbol: `${root}.V.0`, root, sector, units, tick: TICKS[root]?.[0] ?? 0.01, tick_usd: TICKS[root]?.[1] ?? 1, last_date: '2021-12-31',
    last_close: 100 + i * 3.25, last_close_back: 100 + i * 3.25, stale_last: root === 'HE',
    returns, vol_normalised: vol, realised_vol: 0.1 + i / 200, corr_to_nq: root === 'LE' ? null : Math.round((i / 30 - 0.4) * 1e4) / 1e4,
    returns_unit: RETURNS_UNIT,
  }
}

export function makeRows(): UniverseRow[] {
  return ROOTS.map(([root, sector, units], i) => KNOWN[root] ?? fillerRow(root, sector, units, i))
}

/** A symmetric matrix with ones on the diagonal and the fixture's ES-NQ entry. */
export function makeMatrix(n: number, seed: number): (number | null)[][] {
  const m: (number | null)[][] = Array.from({ length: n }, () => new Array<number | null>(n).fill(1))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = Math.round(((((i * 7 + j * 5 + seed) % 41) - 20) / 21) * 1e6) / 1e6
      m[i]![j] = v
      m[j]![i] = v
    }
  }
  m[0]![1] = 0.17036571349116403
  m[1]![0] = 0.17036571349116403
  return m
}

/** A permutation of 0..n-1 that is not the identity. */
export function makeOrder(n: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => (i * step) % n)
}

export function makeUniverse(window = 252): Universe {
  const symbols = ROOTS.map(([root]) => `${root}.V.0`)
  const n = symbols.length
  return {
    as_of: '2021-12-31', window, label: LABEL, basis: BASIS, horizons: [...HORIZONS],
    horizon_sessions: { '1D': 1, '1W': 5, '1M': 21, '3M': 63, YTD: 252, '12M': 252 },
    rows: makeRows(),
    correlation_window: { sessions: window, symbols, order: makeOrder(n, 5), matrix: makeMatrix(n, 3) },
    correlation_full: { sessions: null, symbols, order: makeOrder(n, 7), matrix: makeMatrix(n, 9) },
    missing: [],
    gate: { caller: 'terminal', served_years: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021], cached: true, reads_this_process: 27 },
  }
}

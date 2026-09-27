// Copy for the market screens MON and CORR (UI_SPEC sections 6, 7 and 10; look spec 7.7 and 7.8).
// UK spelling, no em or en dashes, sentence case. `{name}` slots are filled by fillCopy(). Kept next to
// the screens because this build step owns only src/screens/mon and src/screens/corr; copy.test.ts runs
// the shared copy rules over it, and the merge step may move it to src/copy/market.ts unchanged.

/** Sector titles for the section rows and grouped headers, keyed by the API's `sector`. */
export const SECTOR_TITLES = {
  equity: 'Equity',
  rates: 'Rates',
  fx: 'FX',
  energy: 'Energy',
  metals: 'Metals',
  grains: 'Grains',
  livestock: 'Livestock',
} as const

/**
 * Contract names by root. The universe endpoint carries no name field (listed as an API gap), so the
 * names are written here; they are labels, never values.
 */
export const CONTRACT_NAMES: Readonly<Record<string, string>> = {
  ES: 'E-mini S&P 500',
  NQ: 'E-mini Nasdaq-100',
  YM: 'E-mini Dow',
  ZT: '2-year Note',
  ZF: '5-year Note',
  ZN: '10-year Note',
  ZB: 'Treasury Bond',
  '6E': 'Euro FX',
  '6J': 'Japanese Yen',
  '6B': 'British Pound',
  '6A': 'Australian Dollar',
  '6C': 'Canadian Dollar',
  '6S': 'Swiss Franc',
  CL: 'Crude Oil',
  NG: 'Natural Gas',
  HO: 'Heating Oil',
  RB: 'RBOB Gasoline',
  GC: 'Gold',
  SI: 'Silver',
  HG: 'Copper',
  ZC: 'Corn',
  ZS: 'Soybeans',
  ZW: 'Wheat',
  ZL: 'Soybean Oil',
  ZM: 'Soybean Meal',
  LE: 'Live Cattle',
  HE: 'Lean Hogs',
}

/** Shared by both screens. */
export const MARKET = {
  loading: 'Loading the futures universe.',
  failed: 'The futures universe could not be read: {detail}',
  refused: 'The gate refused the request: {detail}',
  postHocTag: '[POST HOC]',
  warnGlyph: '⚠',
  basis: 'Basis: {basis}',
  asOf: 'As of',
  window: 'Window',
  windowOption: '{n} sessions',
  gate: 'Gate: caller {caller}, years {first} to {last} served, {reads} reads this process{cached}',
  gateCached: ', cached',
  gateNone: 'Gate: caller {caller}, no year served',
  missing: 'Not in the panel (no processed daily series): {symbols}',
} as const

export const MON = {
  title: 'Futures monitor (27F)',
  gridLabel: 'Futures monitor, 27 futures by sector',
  paramLabel: 'Monitor settings',
  view: 'View',
  viewReturns: 'Returns',
  viewNormalised: 'Vol-normalised',
  heat: 'Heat cells',
  heatOn: 'Turn heat cells on',
  heatOff: 'Turn heat cells off',
  showReturns: 'Show returns (%)',
  showNormalised: 'Show vol-normalised returns (sd)',
  windowItem: 'Window: {n} sessions',
  colTicker: 'Ticker',
  colName: 'Name',
  colLast: 'Last',
  colFlag: 'Flag',
  colRv: 'RV %',
  colCorr: 'ρ/NQ',
  colUnits: 'Price units',
  /** Horizon headers carry the unit of the view: `1D %` or `1D sd`. */
  colHorizon: '{h} {unit}',
  unitPct: '%',
  unitSd: 'sd',
  flagServed: 'x',
  flagServedText: 'served to the fence',
  flagStale: 's',
  flagStaleText: 'stale: last close carried from an earlier session',
  unitsReturns:
    'Returns: {unit}, shown in % to 2 decimals. Last: the raw front-contract close (c_none) on {asOf}, Treasuries in 32nds.',
  unitsHidden: 'Price units: the Price units column shows in a panel at least 1100 px wide (maximise this panel).',
  unitsNormalised:
    'Vol-normalised: each horizon return divided by (daily sd x square root of its sessions), in sd units to 2 decimals.',
  unitsRisk: 'RV: annualised sd of daily returns over the last {window} sessions, %. ρ/NQ: Pearson over the same {window} sessions.',
  heatNote: 'Heat cells: green up and red down, the strong step at 1 sd or more of vol-normalised move (house choice).',
  horizons: 'Horizons in sessions: {list}.',
  drillTitle: 'Functions for {ticker}',
  drillCrumb: 'Futures monitor > {ticker}',
  drillCancel: '<Cancel>',
  drillCancelLabel: 'Cancel: close the functions for {ticker}',
  drillGp: 'Candle chart',
  drillGip: 'Intraday chart',
  drillDes: 'Instrument description',
  drillCorr: 'Correlation matrix',
} as const

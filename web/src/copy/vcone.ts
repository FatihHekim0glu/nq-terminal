// Copy for VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3). UK spelling, no em or en dashes,
// sentence case. `{name}` slots are filled by fillCopy(). Shared market strings (gate, basis) are in market.ts.

export const VCONE = {
  title: 'Volatility cone',
  instrument: 'Instrument',
  paramLabel: 'Cone settings',
  view: 'View',
  viewCone: 'Cone',
  viewSmall: '27F at one horizon',
  horizon: 'Horizon',
  horizonOption: '{n} sessions',
  notInUniverse: '{root} is not one of the 27 futures; the cone shows {fallback}.',
  loading: 'Loading the volatility cone.',
  failed: 'The volatility cone could not be read: {detail}',
  smallLoading: 'Loading the cone statistics of the 27 futures.',
  smallFailed: 'The cone statistics of the 27 futures could not be read: {detail}',
  // chart
  coneName: '{ticker} volatility cone',
  coneSummary:
    '{name}, realised volatility by horizon to {asOf}: at {short} sessions median {shortMedian}, range {shortMin} to {shortMax}, latest {shortLatest}; at {long} sessions median {longMedian}, latest {longLatest}.',
  coneSummaryEmpty: '{name}: no horizon has enough history for a cone.',
  coneCaption: '{name}, annualised realised volatility (%) by horizon',
  keyRange: 'Min to max',
  keyOuter: '10th to 90th percentile',
  keyInner: '25th to 75th percentile',
  keyMedian: 'Median',
  keyLatest: 'Latest (window ending {asOf})',
  axisSessions: 'Sessions',
  // table
  gridLabel: 'Cone by horizon, {ticker}',
  colN: '#',
  colTicker: 'Ticker',
  colHorizon: 'Horizon',
  colWindows: 'Windows',
  colFirst: 'First window end',
  colMin: 'Min %',
  colP10: 'P10 %',
  colP25: 'P25 %',
  colP50: 'Median %',
  colP75: 'P75 %',
  colP90: 'P90 %',
  colMax: 'Max %',
  colLatest: 'Latest %',
  colRank: 'Rank %',
  rowOpen: 'Show the 27 futures at {n} sessions',
  horizonCell: '{n} sessions',
  // small multiples
  smallLabel: '27 futures, realised volatility at {n} sessions',
  smallCaption: '27 futures, annualised realised volatility (%) at {n} sessions',
  tileSummary:
    '{ticker} {name}, {n} sessions: latest {latest}, rank {rank}; median {median}, 10th to 90th percentile {p10} to {p90}, range {min} to {max}.',
  tileEmpty: '{ticker} {name}, {n} sessions: not enough history for a cone.',
  tileOpen: 'Open the cone of {ticker}',
  scaleNote: 'Every tile uses one scale, 0 to {max}%, so widths compare across the 27 futures.',
  tileKey:
    'Each tile: its number, the ticker, the latest value in % and its rank in %; the bar shows the range, the 10th to 90th and the 25th to 75th percentile boxes, the median tick and the latest value as a diamond.',
  // notes
  units:
    'Values: annualised realised volatility of log returns, % to 1 decimal. Rank: the share of in-sample windows at or below the latest value, % to 0 decimals; descriptive, not a p-value.',
  history:
    'History: every full window from 2010 to {asOf}, overlapping; a horizon needs at least {min} windows. Percentiles by linear interpolation.',
  undefinedReturns: '{count} sessions had no log return (a price at or below zero) and every window holding one is left out.',
  numberedCone: 'Cone view',
  numberedSmall: '27F view',
} as const

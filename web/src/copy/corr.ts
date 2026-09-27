// Copy for CORR (look spec 7.8, UI_SPEC 7). UK spelling, no em or en dashes, sentence case. Shared
// market strings (loading, gate, basis) are in market.ts.

export const CORR = {
  title: 'Correlation matrix',
  universeField: 'Universe',
  paramLabel: 'Correlation settings',
  matrix: 'Matrix',
  matrixWindow: '{n} sessions',
  matrixFull: 'Full sample',
  order: 'Order',
  orderClustered: 'Clustered',
  orderSector: 'By sector',
  pair: 'Pair',
  pairVs: 'vs',
  heatName: '27F correlation, {matrix}, {order} order',
  heatNameWindow: 'last {n} sessions',
  heatNameFull: 'full sample to {asOf}',
  orderNameClustered: 'clustered',
  orderNameSector: 'sector',
  numberedWindow: 'Window matrix',
  numberedFull: 'Full sample matrix',
  pairHeading: 'Rolling correlation {a} vs {b}, {n}-session window',
  pairTitle: 'Rolling correlation {a} vs {b}',
  pairLoading: 'Loading the rolling correlation.',
  pairFailed: 'The rolling correlation could not be read: {detail}',
  pairLast: 'Last rolling value {value} on {date}; the {n}-session matrix entry is {entry}.',
  pairNoValue: 'No rolling value yet: a value needs {n} shared sessions.',
  pairFenced: '{count} points past 2021-12-31 were not drawn.',
  unitsMatrix:
    'Values: Pearson correlation of daily returns, pairwise complete, 2 decimals, signed. Order: average linkage on 1 - ρ from the API.',
  unitsSessions: 'Window matrix: the last {n} sessions to {asOf}. Full sample: every session from 2010 to {asOf}.',
  scaleNote: 'Fills: neutral below 0.10, weak 0.10 to 0.40, strong above 0.40 (house steps); the value is always printed.',
} as const

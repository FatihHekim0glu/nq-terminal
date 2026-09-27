// Copy for LV5, paper against model tracking on LIVE (ANALYTICS_CATALOG section 13). UK spelling, no em or
// en dashes. `{name}` slots are filled by fillCopy().

export const TRACKING = {
  title: 'Paper against model',
  label: 'Paper against model tracking, performance rows only',
  chartTitle: 'Paper against model, {journal}',
  paperSeries: 'Paper, cumulative',
  modelSeries: 'Model, cumulative',
  differenceSeries: 'Paper minus model',
  unitLine: '{basis}. Unit: {unit}, multiplier {multiplier}. {label}.',
  summary: 'Sessions with a close on both days {n}. Total difference {total} USD. Tracking sd {sd} USD per session.',
  empty: 'No session has a close on both days yet, so there is nothing to compare.',
  undated: '{n} rows without a date are left out of the chart.',
  plumbing: 'Plumbing rows dropped from this view: {n}.',
  loading: 'Reading the paper tracking.',
  failed: 'The paper tracking could not be read: {detail}',
} as const

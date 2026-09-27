// Copy for the P1 ECharts figures (TASKS Phase 10 on screen): the XY scatter (BR4, RD3, TA2) and the
// resampled cone (SV6), their data summaries (each chart's accessible name) and table views. UK spelling,
// no em or en dashes. `{name}` slots are filled by fillCopy().

export const XY_SCATTER = {
  summary: '{name}: {n} points; {x} from {xmin} to {xmax}, {y} from {ymin} to {ymax}{line}.',
  summaryLine: '; {label} slope {slope}, intercept {intercept}',
  summaryKinds: '; {solidN} {solid} (solid), {hollowN} {hollow} (hollow)',
  summaryEmpty: '{name}: no points.',
  colPoint: 'Point',
  colKind: 'Kind',
  caption: '{name}, one row per point',
} as const

export const CONE = {
  summary: '{name}: {label}; {horizon} steps; at the last step the 5th percentile is {low}, the median {median} and the 95th {high}; realised {realised} at {realisedDate}.',
  summaryNoRealised: '{name}: {label}; {horizon} steps; at the last step the 5th percentile is {low}, the median {median} and the 95th {high}.',
  percentile: 'p{p}',
  median: 'Median',
  realised: 'Realised',
  outer: 'p5 and p95',
  inner: 'p25 and p75',
  colStep: 'Step',
  colDate: 'Realised date',
  caption: '{name}, pointwise percentiles of the resampled paths at each step, not a band that whole paths stay inside',
} as const

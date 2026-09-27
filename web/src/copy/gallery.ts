// Copy for the component gallery (TASKS Phase 5): a fixture-mode page that exists only in gallery
// builds (`vite build --mode gallery`) and never in the production bundle. UK spelling, no em or en
// dashes. `{name}` slots are filled by fillCopy().

export const GALLERY = {
  title: 'Component gallery',
  entryTitle: 'Gallery: {name}',
  listLabel: 'Gallery entries',
  empty: 'No gallery entries yet.',
  missing: 'No gallery entry named {name}.',
  loading: 'Loading {name}.',
  failed: 'The {name} entry failed: {error}',
  back: 'All entries',
} as const

/** The ChartLibraries entry: one small chart per library, loaded lazily, two of them in link group A. */
export const GALLERY_PROBE = {
  heading: 'Chart libraries',
  uplotTitle: 'uPlot line, link group A',
  lwcTitle: 'lightweight-charts candles, link group A',
  echartsTitle: 'ECharts bars',
  syncTitle: 'Crosshair sync',
  readout: 'Link group A crosshair: {time}',
  none: 'none',
  note: 'Move the pointer over either chart in link group A: the other one follows.',
  loading: 'Loading the chart library.',
  failed: 'The chart library failed to load: {error}',
  equityName: 'Fixture equity',
  candlesName: 'Fixture NQ bars',
  candlesSummary: 'Fixture NQ bars: {count} daily bars from {start} to {end}; last close {last}.',
  barsName: 'Fixture monthly returns',
  barsSummary: 'Fixture monthly returns: {count} months, from {min} to {max} per cent.',
  colDate: 'Date',
  colValue: 'Value',
  colOpen: 'Open',
  colHigh: 'High',
  colLow: 'Low',
  colClose: 'Close',
  colVolume: 'Volume',
  colMonth: 'Month',
  colReturn: 'Return (%)',
} as const

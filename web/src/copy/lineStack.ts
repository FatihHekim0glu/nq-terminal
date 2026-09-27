// Copy for LineStack (TASKS 5.1: the stacked uPlot panes) and the OOS fence
// it draws (UI_SPEC section 6). UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const LINE_STACK = {
  rangeGroup: 'Range',
  logToggle: 'Log',
  /** Shown beside a Log toggle that cannot apply (a log scale needs every value above zero). */
  logUnavailable: 'Log scale needs every value above zero.',
  failed: 'The chart failed to load: {error}',
  /** The readout before the crosshair is placed; it doubles as the key guide. */
  readoutIdle: 'Left and Right move the crosshair one bar, Home and End jump to the ends, + and - zoom.',
  readout: '{time}: {values}',
  readoutValue: '{name} {value}',
  readoutJoin: ', ',
  missing: '--',
  /** Legend rows of a single-series pane (look spec 6.1). */
  legendHigh: 'High on {date}',
  legendAverage: 'Average',
  legendLow: 'Low on {date}',
  /** Axis tag after each series name in the legend: every LineStack series is on the right axis. */
  axisTag: '(R1)',
  summaryJoin: ' ',
  tableCaption: '{title}, {bucket}',
  bucketAll: 'every point',
  bucketDay: 'day-end values',
  bucketMonth: 'month-end values',
  bucketYear: 'year-end values',
  colTime: 'Time',
  colDate: 'Date',
} as const

/** Month abbreviations for the time axis (look spec 6.1: month names centred in each month span). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The LineStack gallery entries (gallery builds only). Fixture data, not research results. */
export const LINE_STACK_GALLERY = {
  name: 'Fixture strategy against a same-exposure benchmark, 2010-01-04 to 2021-12-31',
  title: 'Fixture equity with drawdown and rolling Sharpe',
  strategy: 'Strategy',
  benchmark: 'Same-exposure BH',
  underwater: 'Underwater',
  basis: 'fixture, compounded',
  sharpe63: 'Sharpe 63',
  sharpe252: 'Sharpe 252',
  perfName: 'Speed check: {count} one-minute points per pane, two panes',
  perfTitle: 'Fixture one-minute equity',
  perfPending: 'Drawing.',
  perfResult: 'Build {n} drawn in {ms} ms.',
  linkedA1: 'Link group A: first fixture',
  linkedA2: 'Link group A: second fixture',
  unlinked: 'Unlinked: third fixture',
  linkedTitle: 'Fixture equity and drawdown',
} as const

/** The OOS fence label (UI_SPEC section 6, look spec 6.1). */
export const FENCE = {
  label: 'IS | 2022+ SPENT',
} as const

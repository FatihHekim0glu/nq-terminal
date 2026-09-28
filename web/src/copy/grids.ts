// Copy for the grids (TASKS 5.4: MonitorGrid and JournalTable; look spec 4.8, 7.7 and 7.11).
// UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const GRID = {
  /** Header of the `N)` column, read by screen readers only. */
  numberHeader: 'Number',
  /** The visible `N)` hot-link number. */
  number: '{n})',
  section: '{n}) {label}',
  /** Number <GO> on a section heading (U26): says the heading is a heading, not a row, and the
   * numbers of the rows under it, so a numbered select on a heading is never silent. */
  headingNumber: '{n}) {label} is a heading: rows {first} to {last}.',
  headingNumberEmpty: '{n}) {label} is a heading.',
  keysHint:
    'Arrow keys move between cells, Page Up and Page Down by a page, Home and End along the row, Control with Home or End to the first or last row. Enter on a column header sorts by it; Enter on a row opens it.',
  empty: 'No rows.',
  sortAscending: 'sorted ascending',
  sortDescending: 'sorted descending',
} as const

/**
 * The plumbing banner as the backend sends it (`paper_plumbing.BANNER`, UI_SPEC section 6). The
 * JournalTable shows the banner the API row carries; this copy is only its fallback, and a test
 * checks it against the Python constant.
 */
export const PLUMBING_BANNER = 'PLUMBING TEST, DELAYED DATA: not strategy performance'

export const JOURNAL = {
  label: 'Journal rows: {file}',
  colDate: 'Date',
  colTime: 'Time (ET)',
  colType: 'Event',
  colSummary: 'Summary',
  colSource: 'Src',
  sourceLive: 'LIVE',
  sourcePlumbing: 'PLMB',
  sourceLiveName: 'paper book',
  sourcePlumbingName: 'plumbing test',
  yes: 'yes',
  no: 'no',
  summaryClose: 'Target {target}, actual {actual}, sent {sent}, exposure {exposure}',
  summaryRefused: 'refused: {reason}',
  summaryBlocked: 'blocked: {reason}',
  summaryWarmup: 'Warm-up: {requests} of {planned} requests, {valid} of {window} sessions valid',
  summaryDelayed: 'Delayed fetch: {bars} bars, lag {lag} s',
  summaryHalted: 'halted',
  empty: 'No journal rows yet.',
} as const

/** Gallery captions and the drill-down readout the E2E run checks. */
export const GRID_GALLERY = {
  monitorLabel: 'Futures monitor, fixture data to 2021-12-31',
  monitorTitle: 'Futures monitor (27F), fixture',
  largeLabel: 'Runs, 10,000 fixture rows',
  largeTitle: 'Runs grid, 10,000 fixture rows',
  journalTitle: 'Paper book journal, fixture',
  opened: 'Opened: {name}',
  openedNone: 'Opened: none',
  colName: 'Name',
  colLast: 'Last',
  col1d: '1D',
  col1w: '1W',
  col1m: '1M',
  col3m: '3M',
  colYtd: 'YTD',
  col12m: '12M',
  colRv: 'RV',
  colCorr: 'Corr NQ',
  colRun: 'Run id',
  colStrategy: 'Strategy',
  colTrades: 'Trades',
  colPnl: 'Net P&L',
  colSharpe: 'Sharpe',
  colMaxDd: 'Max DD',
  colBalance: 'Balance',
} as const

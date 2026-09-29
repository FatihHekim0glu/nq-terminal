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
    'Arrow keys move between cells, Page Up and Page Down by a page, Home and End along the row, Control with Home or End to the first or last row. Enter on a column header sorts by it. Type a letter to jump to the next row whose name starts with it.',
  /** Added to the grid's description only when the grid can open a row (it has an onOpen): a grid with
   * no drill, such as the OOS log before G19, must not promise one. */
  openHint: 'Enter on a row opens it.',
  /** Row marking (roadmap 9). The glyph is ASCII on purpose: the fonts' cover of a triangle is unverified,
   * and a fallback glyph would shift the number column. */
  markGlyph: '+',
  /** Read by screen readers beside the glyph of a marked row. */
  marked: 'marked',
  /** Added to the grid's description only when the screen lets rows be marked. */
  markHint: 'Space marks the row for 95) Compare.',
  empty: 'No rows.',
  sortAscending: 'sorted ascending',
  sortDescending: 'sorted descending',
} as const

const BONF_HINT = 'Bonferroni adjusted p, over the whole registry family of k registered tests (k is on MT). Context only: it never changes PASS or FAIL.'
const HOLM_HINT = 'Holm step-down adjusted p, over the whole registry family of k registered tests (k is on MT). Context only: it never changes PASS or FAIL.'
const BH_HINT = 'Benjamini-Hochberg q, the false discovery rate at this p, over the whole registry family (k is on MT). Context only: it never changes PASS or FAIL.'

/**
 * What a column header means, for the ones that were bare words (U03). Keyed by the header text the REG and MT
 * grids draw (copy/grids.hints.test.ts keeps the keys honest); a column may also carry its own `hint`, which wins.
 * MonitorGrid shows it as the house tooltip on hover and reads it out on the message line when the keyboard
 * reaches the header.
 */
export const COLUMN_HINTS: Readonly<Record<string, string>> = {
  Verdict: "PASS or FAIL against the hypothesis's own pre-registered bar. Family-adjusted p is context and does not change it.",
  Bonf: BONF_HINT,
  'Bonf (family)': BONF_HINT,
  Holm: HOLM_HINT,
  'Holm (family)': HOLM_HINT,
  'BH q': BH_HINT,
  'BH q (family)': BH_HINT,
  'Spec sha': "The spec file's sha256, shortened. Hash ok says whether it still matches.",
  'Hash ok': "ok when the registry's spec sha256 and the terminal's own re-hash of the spec both match. NO names the check that failed.",
  Tag: 'edge, [OVERLAY] (a registered risk overlay, in the family but not an edge) or check (a row with no own bar).',
  Amend: 'Accepted amendments of the spec. ok when each still binds to its spec and result, NO when one has changed since it was accepted.',
  'Bonf line': "The Bonferroni boundary, alpha/k: a p under it clears the family correction. Context only: PASS or FAIL is the spec's own bar.",
  'Holm line': "The Holm boundary for this rank, alpha/(k-i+1) for the i-th smallest p: a p under it clears the family correction. Context only: PASS or FAIL is the spec's own bar.",
  'BH line': "The Benjamini-Hochberg boundary for this rank, i alpha/k for the i-th smallest p: a p under it clears the family correction. Context only: PASS or FAIL is the spec's own bar.",
}

/** The OOS log's row open (G19): a caller that is not a registered hypothesis has no DES, so Enter reads the
 * entry's full reason out on the message line instead of doing nothing. */
export const OOS_ROW = {
  detail: '{caller}: {reason}',
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

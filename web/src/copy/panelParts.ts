// The panels' parts, in copy the first-paint shell never reads: the Export line on every screen that has it,
// the related functions menu, the quote header, the field lists, the chart wrapper and the tab sets. Kept out
// of copy/workspace.ts, which the shell holds for WORKSPACE and fillCopy (copy/panelParts.split.test.ts;
// scripts/shellBudget.test.ts). UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy()
// (copy/workspace.ts).

/** 98) Export on every screen that has it: the shown rows as a CSV download (nothing is requested). */
export const EXPORT = {
  csv: 'Shown rows as CSV',
  done: 'Saved {n} rows as {file}.',
  doneOne: 'Saved {n} row as {file}.',
  empty: 'Nothing to export on this screen yet.',
  unavailable: 'This browser cannot save a file here.',
  cancelled: 'Save cancelled: no file was written.',
  failed: 'The file could not be saved.',
} as const

export const RELATED = {
  title: 'Related functions',
  root: 'Main menu of functions',
  cancel: '<Cancel>',
  cancelLabel: 'Cancel: close the related functions menu',
  listLabel: 'Functions for {context}',
  noContext: 'no context',
  categories: {
    prices: 'Prices and markets',
    research: 'Research',
    runs: 'Runs and performance',
    live: 'Live and audit',
    terminal: 'Terminal',
  },
} as const

/** Screens that share one panel as tabs (look spec 7.5): the tab labels by mnemonic. */
export const TAB_SETS = {
  analytics: {
    label: 'Performance views',
    tabs: { EQ: 'Equity', DD: 'Drawdown', RET: 'Returns', RR: 'Rolling', MRET: 'Monthly' },
  },
} as const

export const QUOTE = {
  label: 'Quote for {ticker}',
  at: 'At',
  vol: 'Vol',
  open: 'O',
  high: 'H',
  low: 'L',
  rv: 'RV22',
  delayed: 'd',
  delayedLabel: 'served, delayed, in-sample',
  tickUp: 'last tick up',
  tickDown: 'last tick down',
  sparkLabel: 'Intraday price line',
  t: 't',
  p: 'p',
  round: 'round',
} as const

export const FIELD = {
  listLabel: '{label} choices',
  disabled: 'not available',
} as const

export const CHART = {
  /** Visible label of the chart's table-view toggle; aria-pressed carries its state (WCAG 2.5.3). */
  tableToggle: 'Table',
  readoutLabel: 'Crosshair readout',
  keysHint: 'T toggles the table view while the chart has focus.',
  emptySeries: '{name}: no data.',
  seriesSummary: '{name}: {count} points from {start} to {end}; first {first}, last {last}, low {min}, high {max}{unit}.',
  seriesSummaryDrawdown: '{name}: {count} points from {start} to {end}; first {first}, last {last}, low {min}, high {max}{unit}; max drawdown {drawdown} ({basis}).',
} as const

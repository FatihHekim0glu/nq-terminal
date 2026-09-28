// Copy for the workspace and its panels, including the chart wrapper (UI_SPEC sections 2 and 7 to 9,
// look spec sections 4.3 to 4.8). UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy().

export const WORKSPACE = {
  label: 'Workspace',
  empty: 'No panels open. Type a mnemonic in the command line, for example HOME or HELP.',
  unreadableTitle: 'Unreadable panel',
  unreadable: 'This panel could not be read back from the saved layout. Run a command to replace it.',
  loading: 'Loading the workspace.',
  loadingScreen: 'Loading this screen.',
  screenFailed: 'This screen could not be drawn: {detail}. The other panels are not affected.',
  notReady: 'The workspace is still loading. Try the command again in a moment.',
} as const

export const PANEL = {
  /** `<panel no>-<MNEMONIC>` at the left of the title bar (look spec 4.3). */
  number: '{n}-{code}',
  linkChipLabel: 'Link group {group}',
  /** Accessible name of the table-view toggle; the visible glyph is `T`. */
  tableViewLabel: 'Table view',
  tableViewKey: 'T',
  bodyLabel: '{title} content',
  options: 'Options',
  optionsMenu: 'Panel options for {title}',
  maximise: 'Maximise panel',
  restore: 'Restore panel',
  back: 'Back',
  forward: 'Forward',
  related: 'Related functions',
  tableOn: 'Table view on',
  tableOff: 'Table view off',
} as const

export const FUNCTION_BAR = {
  label: '{title} functions',
  page: 'Page {n}/{m}',
  compare: 'Compare',
  actions: 'Actions',
  settings: 'Settings',
  export: 'Export',
  help: 'Help',
  menuLabel: '{label} menu',
} as const

/** 98) Export on every screen that has it: the shown rows as a CSV download (nothing is requested). */
export const EXPORT = {
  csv: 'Shown rows as CSV',
  done: 'Saved {n} rows as {file}.',
  doneOne: 'Saved {n} row as {file}.',
  empty: 'Nothing to export on this screen yet.',
  unavailable: 'This browser cannot save a file here.',
} as const

/** House numbering for red-bar buttons (look spec 4.4). */
export const FUNCTION_NUMBERS = { compare: 95, actions: 96, settings: 97, export: 98, help: 99 } as const

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

export const PLACEHOLDER = {
  heading: '{code}: {screen}',
  status: 'Not built yet.',
  P0: 'This screen arrives in phase {phase} of the build. The command, the panel and its link group already work.',
  P1: 'A P1 screen, planned for after the P0 release.',
  P2: 'A P2 screen, built only after the user gives an explicit go.',
  context: 'Context: {value}',
  noContext: 'Context: none',
  argument: 'Argument: {value}',
  gridCaption: '{code} placeholder: what this panel will show',
  itemColumn: 'Item',
  valueColumn: 'Value',
  noteColumn: 'Note',
  rowScreen: 'Screen',
  rowStatus: 'Status',
  rowBuild: 'Build',
  rowContext: 'Context',
  rowArgument: 'Argument',
  missing: '--',
  none: 'none',
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

/** Replaces each `{name}` slot with its value; unknown slots are left as they are. */
export function fillCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (slot, name: string) =>
    name in values ? String(values[name]) : slot,
  )
}

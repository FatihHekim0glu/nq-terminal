// Copy for the workspace and its panels, including the chart wrapper (UI_SPEC sections 2 and 7 to 9).
// UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const WORKSPACE = {
  label: 'Workspace',
  empty: 'No panels open. Type a mnemonic in the command line, for example HOME or HELP.',
  unreadableTitle: 'Unreadable panel',
  unreadable: 'This panel could not be read back from the saved layout. Run a command to replace it.',
  loading: 'Loading the workspace.',
  loadingScreen: 'Loading this screen.',
} as const

export const PANEL = {
  linkChipLabel: 'Link group {group}',
  linkChipNone: 'Not linked to a group',
  /** Visible label of the table-view toggle; aria-pressed carries its state (WCAG 2.5.3). */
  tableViewLabel: 'Table',
  bodyLabel: '{title} content',
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
} as const

export const CHART = {
  /** Visible label of the chart's table-view toggle; aria-pressed carries its state (WCAG 2.5.3). */
  tableToggle: 'Table',
  readoutLabel: 'Crosshair readout',
  keysHint: 'T toggles the table view while the chart has focus.',
  emptySeries: '{name}: no data.',
  seriesSummary: '{name}: {count} points from {start} to {end}; first {first}, last {last}, low {min}, high {max}{unit}.',
  seriesSummaryDrawdown: '{name}: {count} points from {start} to {end}; first {first}, last {last}, low {min}, high {max}{unit}; max drawdown {drawdown}.',
} as const

/** Replaces each `{name}` slot with its value; unknown slots are left as they are. */
export function fillCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (slot, name: string) =>
    name in values ? String(values[name]) : slot,
  )
}

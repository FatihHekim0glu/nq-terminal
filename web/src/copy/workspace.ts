// Copy for the workspace and its panels (UI_SPEC sections 2 and 7 to 9, look spec sections 4.3 to 4.8). UK
// spelling, no em or en dashes. `{name}` slots are filled by fillCopy(). This file is part of the first-paint
// shell: the copy that only the panels' parts read (export, related menu, quote header, field, chart wrapper,
// tab sets) is in copy/panelParts.ts.

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

/** House numbering for red-bar buttons (look spec 4.4). */
export const FUNCTION_NUMBERS = { compare: 95, actions: 96, settings: 97, export: 98, help: 99 } as const

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

/** Replaces each `{name}` slot with its value; unknown slots are left as they are. */
export function fillCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (slot, name: string) =>
    name in values ? String(values[name]) : slot,
  )
}

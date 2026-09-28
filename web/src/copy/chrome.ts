// Copy for the global chrome (spec 4.1, 4.2, 4.9, 4.10): frame strip, key toolbar, nav toolbar,
// command zone, message line, event tape and status line. UK spelling, no em or en dashes.
// `{value}` is filled in by the component.

export const CHROME = {
  appTitle: 'nq-lab terminal',
  chromeLabel: 'Terminal controls',
} as const

export const FRAME_STRIP = {
  label: 'Layouts',
  newTab: 'New layout: type a screen mnemonic',
  safetyLabel: 'Safety',
  readOnly: 'READ ONLY',
  noOrderPath: 'NO ORDER PATH',
  /** Shown only in the demo (`pnpm demo`), where every answer is fixture data served in the browser. */
  demoData: 'DEMO DATA',
  options: 'Options',
  optionsGlyph: '≡',
  tape: 'Event tape',
  schemesLabel: 'Colour scheme',
  schemes: {
    standard: 'Standard colours',
    deut: 'Deuteranopia colours',
    prot: 'Protanomaly colours',
  },
  tabs: {
    HOME: { label: 'HOME', title: 'Home view' },
    RESEARCH: { label: 'RESEARCH', title: 'Registry and multiple testing' },
    LIVE: { label: 'LIVE', title: 'Paper book and journals' },
  },
} as const

/** Key toolbar (spec 4.2): official keys in their order, then custom keys. `name` is the accessible name. */
export const KEY_TOOLBAR = {
  label: 'Key toolbar',
  keys: {
    esc: { text: 'CANCEL', name: 'CANCEL key, Esc: close the list, then clear the command line' },
    help: { text: 'HELP', name: 'HELP key, F1: help for the focused screen' },
    search: { text: 'SEARCH', name: 'SEARCH key: search help, hypotheses and runs (HL)' },
    menu: { text: 'MENU', name: 'MENU key: related functions for the focused panel' },
    pgback: { text: 'PG BACK', name: 'PG BACK key, PgUp: previous page of the focused panel' },
    pgfwd: { text: 'PG FWD', name: 'PG FWD key, PgDn: next page of the focused panel' },
  },
  custom: {
    HOME: 'HOME key: open the home screen',
    REG: 'REG key: open the registry board',
    RUNS: 'RUNS key: open the Nautilus runs table',
    LEDG: 'LEDG key: open the ledger',
    LIVE: 'LIVE key: open the paper book',
    OOS: 'OOS key: open the gate access log',
  },
  keymap: 'Key map, Alt+K',
  keymapGlyph: '\u{1F527}︎',
} as const

export const NAV_TOOLBAR = {
  label: 'Navigation toolbar',
  back: 'Back, End',
  forward: 'Forward, Shift+End',
  contextLabel: 'Context {value}: show its functions',
  noContext: 'No context: show the sector menus',
  mnemonicLabel: '{value}: help for this function',
  noMnemonic: 'No panel focused',
  related: 'Related Functions Menu',
  relatedGlyph: '≚',
  message: 'Message',
  messageGlyph: '✉',
  killOff: 'KILL off',
  killOn: 'KILL ON',
  killUnknown: 'KILL unknown',
  tws: 'TWS not monitored',
  favourites: 'Favourite layouts',
  favouritesGlyph: '★',
  exportCsv: 'Export CSV',
  exportGlyph: '⧉',
  help: 'Help for the focused screen',
  helpGlyph: '?',
  menuGlyph: '▾',
  favouritesTitle: 'Favourite layouts',
} as const

export const CONTEXT_STRIP = {
  label: 'Link groups',
  empty: '-',
  focused: 'focused group',
  panelNumber: 'Command line for panel {value}',
} as const

/** Message line texts (spec 4.2): prompts and status in place of toasts. */
export const MESSAGES = {
  idle: '<HELP> for explanation.',
  tapeOn: 'Event tape on. <NO> <GO> hides it.',
  tapeOff: 'Event tape off.',
  noEquities: 'No equities in nq-lab: Equity is accepted but matches nothing.',
  /** F2 and F4 have no function of their own (look spec 5.2); the browser does not get them either. */
  reservedKeys: {
    F2: 'F2 has no function in nq-lab. Type REG <GO> for the registry, or use a key on the key toolbar.',
    F4: 'F4 has no function in nq-lab. Type LEDG <GO> for the ledger, or use a key on the key toolbar.',
  },
  backNone: 'Nothing to go back to in this panel.',
  forwardNone: 'Nothing to go forward to in this panel.',
  noPanel: 'No panel {value} on this screen.',
  onePage: 'This screen has one page.',
  noExport: 'This screen has nothing to export yet.',
  theme: 'New theme applied. Rerun the screen to see the changes.',
  newLayout: 'Type a screen mnemonic, for example REG, then <GO>.',
  keymapOpen: 'Key map open. <Alt+K> or <Esc> closes it.',
} as const

export const STATUS_BAR = {
  label: 'Status line',
  lead: 'Status',
  screen: 'Screen',
  data: 'DATA',
  // The in-sample window as the gate enforces it, shown until /api/health answers.
  dataWindow: 'DATA {value}',
  dataFallbackValue: '2010-01-01..2021-12-31',
  tws: 'TWS',
  twsValue: 'not monitored',
  kill: 'KILL',
  killOff: 'off',
  killOn: 'ON',
  killOnNote: 'The live/KILL file is present: the paper book will not trade.',
  killLoading: 'reading',
  killUnknown: 'unknown',
  healthDown: 'HEALTH unavailable',
  healthDownNote: 'GET /api/health did not answer, so the kill switch state is unknown.',
  gateReads: 'Gate reads',
  missing: '--',
  fixture: 'FIXTURE DATA',
  readOnly: 'READ ONLY',
  noOrderPath: 'NO ORDER PATH',
  clock: '{value} ET',
  escKey: '<Esc>',
  escHint: 'command',
  empty: '-',
} as const

export const TAPE = {
  label: 'Event tape',
  src: 'OOS',
  read: 'gate read',
  sealed: '[SEALED]',
  inSample: '[IS]',
  empty: 'No gate reads logged yet.',
  error: 'The gate log did not answer.',
  loading: 'Reading the gate log.',
} as const

export const KEYMAP = {
  title: 'Keyboard map',
  close: 'Close the key map',
  closeText: 'Close',
} as const

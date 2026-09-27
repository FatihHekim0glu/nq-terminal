// Copy for HELP (spec 7.12, 5.1 and 5.2; UI_SPEC sections 5 and 7): the mnemonic index comes from the
// command registry; keys, the drawn keyboard, link groups and licences are listed here. Our own text:
// nothing is taken from any vendor manual. UK spelling, no em or en dashes.

export const HELP = {
  title: 'Help',
  crumb: 'Getting started > Help',
  tocLabel: 'Help contents',
  /** The amber field on the red bar; Enter runs HL with what was typed. */
  searchLabel: 'Search help',
  searchPlaceholder: '<Search help>',
  intro: 'Every function the command line knows, with the keys, link groups and licences. Nothing here places, changes or withdraws a trade: the terminal is read only.',
  grammarHeading: 'Command grammar',
  grammar: '[NXTW] <context> [SECTOR] <FUNCTION> [args] [HELP], then <GO> (Enter). The context is an instrument (root or generic ticker such as NQ1, with an optional sector key: INDEX, COMDTY or CURNCY), a hypothesis, a run id or 27F; leave it out to use the focused panel\'s link-group context. A number on its own selects that numbered item of the focused screen.',
  examplesLabel: 'Examples',
  examples: ['{NQ1 Index GP <GO>}', '{ZN COMDTY GP 1h <GO>}', '{NQ GIP 2019-03-14 <GO>}', '{rebal_v0 DES <GO>}', '{27F CORR <GO>}', '{REG <GO>}', '{GP HELP <GO>}'],
  mnemonicsHeading: 'Mnemonics',
  mnemonicsCaption: 'Mnemonic index, numbered for <GO>',
  columns: { number: 'No.', code: 'Mnemonic', screen: 'Screen', context: 'Context', priority: 'Pri', status: 'Status' },
  statusBuilt: 'built',
  statusPhase: 'placeholder, phase {phase}',
  statusP1: 'placeholder, P1',
  statusP2: 'placeholder, P2 on request',
  keysHeading: 'Keys',
  keysCaption: 'Keyboard reference',
  keyColumns: { key: 'Key', action: 'Action' },
  keyboardHeading: 'Keyboard map',
  keyboardLabel: 'Drawn keyboard: the terminal keys in their colours. The keyboard reference table lists every key and its action.',
  substitute: 'substitute',
  linkHeading: 'Link groups',
  linkText: 'Panels in link group [A], [B] or [C] share one context: setting it in one panel retargets every panel of the same group and syncs their time crosshair. Unlinked panels show no chip.',
  linkGroups: ['A', 'B', 'C'],
  licencesHeading: 'Licences and attributions',
  tradingView: 'Candle charts use TradingView Lightweight Charts, copyright TradingView, Inc., under the Apache License 2.0. The TradingView attribution logo stays on every candle chart.',
  tradingViewLink: 'TradingView website',
  newTab: '(opens in a new tab)',
  tradingViewUrl: 'https://www.tradingview.com/',
} as const

export const HELP_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Esc', 'CANCEL: close the open list or menu; else clear a typed line; else return to the panel. From a panel, focus the command line.'],
  ['Enter', '<GO>: run the command line. NumpadEnter does the same.'],
  ['Shift+Enter', 'Open the result in a new panel instead of replacing the focused one (the same as NXTW before the command).'],
  ['F1', 'HELP for the focused screen, or for the function typed in the line. Twice quickly: this HELP index. If the browser opens its own help instead, press HELP on the key toolbar or type HELP.'],
  ['F8', 'Insert Equity. nq-lab has no equities, so it matches nothing.'],
  ['F9', 'Insert Comdty: rates, energy, metals, grains and livestock futures.'],
  ['F10', 'Insert Index: the equity index futures. If the browser takes F10 for its menu, type INDEX.'],
  ['F11', 'Insert Curncy: the currency futures. If the browser takes F11 for full screen, type CURNCY.'],
  ['End', 'BACK in the focused panel, from a panel or an empty command line; in a typed line it moves the caret.'],
  ['Home', 'Focus the command line from anywhere else.'],
  ['PgUp, PgDn', 'PAGE BACK and PAGE FORWARD in the focused panel; a number first (3 PgDn) jumps that many pages.'],
  ['Shift+PgUp, Shift+PgDn', 'Walk the command history, older and newer.'],
  ['Up, Down', 'In an empty command line, walk the history; in the list or a menu, move through it. Up on the first row hides the list.'],
  ['Alt+1 to Alt+9', 'Focus panel 1 to 9 (a substitute for the PANEL key).'],
  ['Alt+K', 'Show or hide the key map.'],
  ['Ctrl+K', 'Focus the command line and select its text.'],
  ['Tab, Shift+Tab', 'Move between panels; each panel is one Tab stop. In the command line with the list open, Tab completes.'],
  ['Left, Right', 'Move between the items of the focused panel.'],
  ['Left, Right (chart)', 'Step the crosshair one bar and update the readout.'],
  ['+, - (chart)', 'Zoom in and out.'],
  ['Home, End (chart)', 'Jump to the ends of the data, while the chart has focus.'],
  ['T (chart)', 'Toggle the table view, only while the chart has focus.'],
  ['Arrows, PgUp, PgDn (grid)', 'Move through rows; Enter drills down.'],
]

/** The drawn keyboard (spec 7.12): key, cap label, colour group; substitutes are marked. */
export const HELP_KEYBOARD: ReadonlyArray<{ readonly key: string; readonly cap: string; readonly colour: 'cancel' | 'go' | 'sector' | 'panel' | 'plain'; readonly substitute?: boolean }> = [
  { key: 'Esc', cap: 'CANCEL', colour: 'cancel' },
  { key: 'F1', cap: 'HELP', colour: 'go' },
  { key: 'F8', cap: 'EQUITY', colour: 'sector' },
  { key: 'F9', cap: 'COMDTY', colour: 'sector' },
  { key: 'F10', cap: 'INDEX', colour: 'sector' },
  { key: 'F11', cap: 'CURNCY', colour: 'sector' },
  { key: 'Home', cap: 'HOME', colour: 'plain' },
  { key: 'End', cap: 'BACK', colour: 'go' },
  { key: 'PgUp', cap: 'PG BACK', colour: 'plain' },
  { key: 'PgDn', cap: 'PG FWD', colour: 'plain' },
  { key: 'Alt+1..9', cap: 'PANEL', colour: 'panel', substitute: true },
  { key: 'Enter', cap: 'GO', colour: 'go' },
]

export const HELP_FONT_LICENCES = {
  bergoom: ['Bergoom (vendored font files with their licence file)', 'SIL Open Font Licence 1.1'],
  sourceSans: ['Source Sans 3 (self-hosted through Fontsource)', 'SIL Open Font Licence 1.1'],
  ptMono: ['PT Mono (self-hosted through Fontsource)', 'SIL Open Font Licence 1.1'],
} as const

export const HELP_LICENCES: ReadonlyArray<readonly [string, string]> = [
  ['React, React DOM', 'MIT'],
  ['dockview-react', 'MIT'],
  ['cmdk', 'MIT'],
  ['zustand', 'MIT'],
  ['TanStack Query', 'MIT'],
]

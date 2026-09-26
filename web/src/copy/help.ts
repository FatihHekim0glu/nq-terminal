// Copy for HELP (UI_SPEC sections 5 and 7): the mnemonic index comes from the command registry;
// keys, link groups and licences are listed here. UK spelling, no em or en dashes.

export const HELP = {
  title: 'HELP',
  intro: 'Every function the command line knows, with the keys, link groups and licences. Nothing here places, changes or withdraws a trade: the terminal is read only.',
  grammarHeading: 'Command grammar',
  grammar: '<context> <FUNCTION> [args], then Enter. The context is an instrument, a hypothesis, a run id or 27F; leave it out to use the focused panel\'s link-group context.',
  examples: ['NQ GP', 'NQ GIP 2019-03-14', 'volmanaged_v0 DES', 'nt_dtsmom_v0_ts1 RUN', '27F CORR', 'REG'],
  examplesLabel: 'Examples',
  mnemonicsHeading: 'Mnemonics',
  mnemonicsCaption: 'Mnemonic index, numbered as on the status bar',
  columns: { number: 'No.', code: 'Mnemonic', screen: 'Screen', context: 'Context', priority: 'Pri', status: 'Status' },
  statusBuilt: 'built',
  statusPhase: 'placeholder, phase {phase}',
  statusP1: 'placeholder, P1',
  statusP2: 'placeholder, P2 on request',
  keysHeading: 'Keys',
  keysCaption: 'Keyboard reference',
  keyColumns: { key: 'Key', action: 'Action' },
  linkHeading: 'Link groups',
  linkText: 'Panels in link group [A], [B] or [C] share one context: setting it in one panel retargets every panel of the same group and syncs their time crosshair. [-] panels are unlinked.',
  licencesHeading: 'Licences and attributions',
  tradingView: 'Candle charts use TradingView Lightweight Charts, copyright TradingView, Inc., under the Apache License 2.0. The TradingView attribution logo stays on every candle chart.',
  tradingViewLink: 'TradingView website',
  newTab: '(opens in a new tab)',
  tradingViewUrl: 'https://www.tradingview.com/',
} as const

export const HELP_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Esc', 'Focus the command line; a second Esc returns focus to the previous panel.'],
  ['Ctrl+K', 'Focus the command line.'],
  ['Enter', 'Run the command in the focused panel (a screen with several panels loads its layout).'],
  ['Shift+Enter', 'Open the result in a new panel instead of replacing the focused one.'],
  ['Enter (layouts)', 'A screen typed from another screen brings back your saved layout for it; typed on the screen already shown, it resets that screen to its default layout.'],
  ['Up, Down', 'In an empty command line, walk the history.'],
  ['Tab, Shift+Tab', 'Move between panels; each panel is one Tab stop.'],
  ['Left, Right', 'Move between the items of the focused panel.'],
  ['Left, Right (chart)', 'Step the crosshair one bar and update the readout.'],
  ['+, - (chart)', 'Zoom in and out.'],
  ['Home, End (chart)', 'Jump to the ends of the data.'],
  ['T (chart)', 'Toggle the table view, only while the chart has focus.'],
  ['Arrows, PgUp, PgDn (grid)', 'Move through rows; Enter drills down.'],
  ['F2, F4, F8, F9', 'P1: REG, LEDG, LIVE and HOME, once a browser test shows the browser leaves them alone.'],
]

export const HELP_LICENCES: ReadonlyArray<readonly [string, string]> = [
  ['React, React DOM', 'MIT'],
  ['dockview-react', 'MIT'],
  ['cmdk', 'MIT'],
  ['zustand', 'MIT'],
  ['TanStack Query', 'MIT'],
  ['JetBrains Mono, Inter, Space Grotesk (self-hosted through Fontsource)', 'SIL Open Font Licence 1.1'],
]

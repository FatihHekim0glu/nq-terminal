// Copy for the command line, its parser messages, its menus and the mnemonic registry (spec 4.2 and
// 5.1; UI_SPEC section 5). UK spelling, no em or en dashes. `{token}`, `{code}`, `{kinds}`, `{value}`,
// `{sector}`, `{phrase}` and `{key}` are filled in by src/commands/messages.ts.

/**
 * Titles the front end shows in place of the backend's (the backend is frozen). HOME's backend title
 * is a trade name the look spec keeps out of the UI (section 1.2).
 */
export const SCREEN_TITLE_OVERRIDES = {
  HOME: 'Home view',
} as const

/**
 * Screen titles, identical to the backend's constants.MNEMONICS apart from SCREEN_TITLE_OVERRIDES
 * (a test keeps them in step).
 */
export const MNEMONIC_SCREENS = {
  HOME: SCREEN_TITLE_OVERRIDES.HOME,
  GP: 'Candles with volume and roll markers',
  GIP: 'Intraday candles for one date',
  DES: 'Hypothesis tear sheet or instrument description',
  REG: 'Registry board',
  MT: 'Multiple-testing view',
  RUNS: 'Nautilus runs table',
  RUN: 'Run inspector',
  EQ: 'Analytics: equity',
  DD: 'Analytics: drawdown',
  RET: 'Analytics: returns and risk',
  RR: 'Analytics: rolling statistics',
  MRET: 'Analytics: monthly returns',
  MON: '27-futures monitor',
  CORR: 'Correlation matrix',
  LEDG: 'Ledger',
  OOS: 'Gate access log and openings',
  LIVE: 'Paper book',
  JRNL: 'Journals',
  HELP: 'Mnemonics and keys, with link groups and licences',
  COST: 'Cost ladder',
  BLK: 'Blocks',
  EXPO: 'Exposure',
  SEAL: 'Sealed results',
  VCONE: 'Volatility cone',
  SEAS: 'Seasonality',
  EVT: 'Event study',
  ROLL: 'Roll calendar',
  DQ: 'Data quality',
  JOBS: 'Backtest queue',
} as const

/** Words the command line acts on itself; they are not screens (spec 5.1 items 6 to 9). */
export const CHROME_WORDS = {
  HL: 'Search help, hypotheses and runs',
  NO: 'Event tape on or off',
  MENU: 'Related functions for the focused panel',
  LAST: 'The last 8 commands',
  MAIN: 'The home screen (the same as HOME)',
  NXTW: 'Open the command after it in a new panel',
} as const

export const CONTEXT_KIND_NAMES = {
  instrument: 'an instrument',
  hypothesis: 'a hypothesis',
  run: 'a run',
  universe: 'the universe (27F)',
} as const

/** Sector keys in title case, as the command line and the chrome show them (spec 3.3). */
export const SECTOR_TITLES = {
  INDEX: 'Index',
  COMDTY: 'Comdty',
  CURNCY: 'Curncy',
  EQUITY: 'Equity',
  GOVT: 'Govt',
  CORP: 'Corp',
} as const

export const SECTOR_PHRASES = {
  INDEX: 'an Index future',
  COMDTY: 'a Comdty future',
  CURNCY: 'a Curncy future',
  EQUITY: 'an Equity',
  GOVT: 'a Govt bond',
  CORP: 'a Corp bond',
} as const

export const PARSE_MESSAGES = {
  empty: 'Type a command: <context> <FUNCTION> [args], for example NQ GP or REG.',
  'too-long': 'That line is too long for a command.',
  'bad-character': '{token} has a character a command cannot contain.',
  'unknown-command': '{token} is not a function or a known context.',
  'unknown-function': '{token} is not a function. Type HELP for the list.',
  'unknown-context': '{token} is not a known instrument, hypothesis or run.',
  'index-unavailable': 'The command index has not loaded yet, so {token} cannot be resolved.',
  'missing-function': '{token} needs a function after it. Type HELP for the list.',
  'missing-context': '{code} needs {kinds}: type it before {code}, or focus a panel whose link group holds one.',
  'context-not-accepted': '{code} takes {kinds}; {token} is not one.',
  'no-context-taken': '{code} takes no context. Type {code} on its own.',
  'missing-argument': '{code} needs {value}.',
  'bad-argument': '{token} is not a valid argument for {code}; it takes {value}.',
  'too-many-arguments': '{code} takes one argument; {token} is one too many.',
  'sector-mismatch': '{token} is {phrase}: use {sector} ({key}).',
  'sector-not-taken': '{token} takes no sector key: type it without {sector}.',
  'missing-command': '{token} needs a command after it, for example {token} NQ GP.',
  'extra-after-word': '{token} takes nothing after it.',
} as const

export const ARGUMENT_NAMES = {
  none: 'no arguments',
  date: 'a date as YYYY-MM-DD',
  timeframe: 'an optional timeframe: 1m, 5m, 1h or 1d',
} as const

/** Autocomplete group headings: uppercase, as the data itself is a heading (spec 3.3). */
export const SUGGESTION_GROUPS = {
  function: 'FUNCTIONS',
  instrument: 'INSTRUMENTS',
  hypothesis: 'HYPOTHESES',
  run: 'RUNS',
  universe: 'UNIVERSE',
  argument: 'ARGUMENTS',
  search: 'SEARCH',
} as const

/** The "More ..." row under a group that has more rows than the sheet shows. */
export const SUGGESTION_MORE = {
  function: 'More functions...',
  instrument: 'More instruments...',
  hypothesis: 'More hypotheses...',
  run: 'More runs...',
  universe: 'More...',
  argument: 'More...',
  search: 'More...',
} as const

export const SUGGESTION_DETAILS = {
  hypothesis: 'registered hypothesis',
  confirmation: 'sealed-window confirmation',
  run: 'Nautilus run',
  universe: 'the 27 futures',
  timeframe: 'bar timeframe',
  instrument: '{value} back-adj',
  search: 'Search help, hypotheses and runs',
  notBuilt: '{value}, not built yet',
} as const

export const COMMAND_LINE = {
  label: 'Command line',
  hint: 'Enter runs the command, Shift+Enter opens it in a new panel, Tab completes, Up and Down in an empty line walk the history, Esc closes the list, then clears the line, then returns to the panel.',
  suggestionsLabel: 'Suggestions',
  hideHint: '<UP ARROW> to hide',
  ran: 'Opened {value}.',
  ranNewPanel: 'Opened {value} in a new panel.',
  loaded: 'Loaded {value}. Type a number for its function.',
  noItem: 'No item {value} on this screen.',
  noMenuItem: 'No item {value} in this menu.',
  searchEmpty: 'Type what to search for after HL.',
  indexError: 'Suggestions are unavailable: the command index did not load.',
  registryError: 'Hypothesis names are missing: {value}',
  lastTitle: 'Last commands',
  lastEmpty: 'No commands yet.',
  menuTitle: 'Related functions',
  searchTitle: 'Search: {value}',
  searchNone: 'Nothing matches {value}.',
  helpTitle: '{value}',
  helpContext: 'Context: {value}',
  helpArgument: 'Argument: {value}',
  menuCancel: '<Cancel> X',
  menuCancelLabel: 'Close the menu',
  menuLabel: 'Menu',
  categoryMark: ' >',
} as const

/** Sector menus (spec 5.1 item 4): COMDTY opens these categories. */
export const SECTOR_MENU = {
  INDEX: 'Index',
  COMDTY: 'Comdty',
  CURNCY: 'Curncy',
  EQUITY: 'Equity',
  GOVT: 'Govt',
  CORP: 'Corp',
  categories: {
    rates: 'Rates',
    energy: 'Energy',
    metals: 'Metals',
    grains: 'Grains',
    livestock: 'Livestock',
  },
  none: 'No futures in nq-lab carry this sector key.',
} as const

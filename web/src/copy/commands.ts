// Copy for the command line, its parser messages and the mnemonic registry (UI_SPEC section 5).
// UK spelling, no em or en dashes. `{token}`, `{code}`, `{kinds}` and `{value}` are filled in by
// src/commands/messages.ts.

/** Screen titles, identical to the backend's constants.MNEMONICS (a test keeps them in step). */
export const MNEMONIC_SCREENS = {
  HOME: 'Launchpad',
  GP: 'Candles with volume and an indicator pane',
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

export const CONTEXT_KIND_NAMES = {
  instrument: 'an instrument',
  hypothesis: 'a hypothesis',
  run: 'a run',
  universe: 'the universe (27F)',
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
} as const

export const ARGUMENT_NAMES = {
  none: 'no arguments',
  date: 'a date as YYYY-MM-DD',
  timeframe: 'an optional timeframe: 1m, 5m, 1h or 1d',
} as const

export const SUGGESTION_GROUPS = {
  function: 'Functions',
  instrument: 'Instruments',
  hypothesis: 'Hypotheses',
  run: 'Runs',
  universe: 'Universe',
  argument: 'Arguments',
} as const

export const SUGGESTION_DETAILS = {
  hypothesis: 'registered hypothesis',
  confirmation: 'sealed-window confirmation',
  run: 'Nautilus run',
  universe: 'the 27 futures',
  timeframe: 'bar timeframe',
  notBuilt: '{value}, not built yet',
} as const

export const COMMAND_LINE = {
  prompt: 'nq-lab>',
  label: 'Command line',
  placeholder: 'type a mnemonic, for example REG or HELP',
  hint: 'Enter runs the command, Shift+Enter opens it in a new panel, Tab completes, Up and Down in an empty line walk the history, Esc returns to the panel.',
  suggestionsLabel: 'Suggestions',
  ran: 'Opened {value}.',
  ranNewPanel: 'Opened {value} in a new panel.',
  indexError: 'Suggestions are unavailable: the command index did not load.',
  registryError: 'Hypothesis names are missing: {value}',
} as const

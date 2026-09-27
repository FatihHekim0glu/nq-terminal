// Per-function HELP pages (look spec 7.12, UI_SPEC sections 5 to 7): what each mnemonic shows, where
// its numbers come from, the honesty rule that applies, runnable examples and related functions. Our
// own text, written from this project's specs; nothing is taken from any vendor manual. UK spelling,
// no em or en dashes. Examples are `{<line> <GO>}` command links; every one parses (helpTopics.test).

export const HELP_TOPIC = {
  crumb: 'Getting started > Help > Help for {code}',
  crumbIndex: 'Getting started > Help',
  backToIndex: 'Back to the help index',
  context: 'Context',
  argument: 'Argument',
  status: 'Status',
  shows: 'What it shows',
  data: 'Where the numbers come from',
  honesty: 'Labels and limits',
  examples: 'Examples',
  related: 'Related functions',
  relatedHint: 'Shows that function\'s help here.',
  topicLabel: 'Help for {code}',
  noContext: 'none',
} as const

export interface HelpTopicCopy {
  readonly summary: string
  readonly shows: readonly string[]
  readonly data: string
  readonly honesty?: string
  readonly examples: readonly string[]
  readonly related: readonly string[]
}

const POST_HOC_PRICES = 'Price analytics are [POST HOC]: descriptive, in-sample, not a registered test. No p value is shown on a slice you pick.'
const TEAR_DATA = 'GET /api/analytics/hypothesis/{name} (Basis A, the screen series at 0, 1 or 2 ticks) or GET /api/analytics/run/{run_id} (Basis B, the account).'
const TEAR_HONESTY = 'Every tile names its basis (A screen, B account) and unit. Values the terminal computes carry [POST HOC]; values read from a registered result carry [PRE-REG].'
const TEAR_TABS = ['EQ', 'DD', 'RET', 'RR', 'MRET', 'DES']
/** The other tear sheet tabs and DES, for the page of tab `self`. */
const tearRelated = (self: string): string[] => TEAR_TABS.filter((c) => c !== self)
const P1 = 'Planned for P1, after the P0 release; until then the command opens a labelled placeholder.'

export const HELP_TOPICS: Readonly<Record<string, HelpTopicCopy>> = {
  HOME: {
    summary: 'The launchpad: four linked panels in a 2x2 grid, about 19 grid rows each at 1920x1080.',
    shows: [
      '1) GP: NQ1 Index daily candles, in link group A.',
      '2) MON: the 27-futures monitor, also in link group A.',
      '3) EQ: volmanaged_v0 equity against its same-exposure benchmark, with underwater and rolling Sharpe panes, in link group B.',
      '4) REG: the registry board, unlinked.',
      'LIVE and OOS open with Shift+Enter; MAIN is the same as HOME.',
    ],
    data: 'Panel 3 reads GET /api/analytics/hypothesis/{name}/panel (or the run panel); the other panels read their own screens.',
    honesty: 'Panel 3 is [POST HOC]: the terminal computes it from the series, descriptive only.',
    examples: ['{HOME <GO>}', '{MAIN <GO>}'],
    related: ['GP', 'MON', 'EQ', 'REG', 'LIVE', 'OOS'],
  },
  GP: {
    summary: 'Candles and volume for one instrument, with roll markers and, on daily bars, an RV22 pane.',
    shows: [
      'Timeframes 1m, 5m, 1h or 1d, on vendor or repaired bars.',
      'Roll markers, the dashed 2022-01-01 fence and [GATED] or [REPAIRED] session tags.',
      'Fills from a linked RUN in the same link group.',
      'A readout of the time and the bar (open, high, low, close, volume); the quote header adds RV22 on daily charts that end at the fence.',
      'On daily bars, an RV22 pane under the volume: 22-session realised volatility, annualised, in per cent [POST HOC].',
      'The amber field in the red bar opens another instrument on the same function.',
    ],
    data: 'GET /api/bars and, on daily bars, GET /api/market/rv, through the OOS gate with the caller terminal. In-sample only: nothing after 2021-12-31 is served.',
    honesty: 'A window past the fence shows the gate\'s refusal text in the panel instead of a chart.',
    examples: ['{NQ1 Index GP <GO>}', '{ZN COMDTY GP 1h <GO>}', '{ES GP 5m <GO>}'],
    related: ['GIP', 'DES', 'MON', 'CORR'],
  },
  GIP: {
    summary: 'GP for one date, intraday.',
    shows: [
      'Bar sizes 1m, 5m or 1h, with a two-row time and date axis.',
      'Dashed day separators; the date must lie inside the in-sample window.',
    ],
    data: 'GET /api/bars for that session, through the OOS gate.',
    honesty: 'Collapsed early 1m sessions are gated; the repaired variant shows the sessions rebuilt from trades as [REPAIRED].',
    examples: ['{NQ GIP 2019-03-14 <GO>}'],
    related: ['GP', 'DES'],
  },
  DES: {
    summary: 'The hypothesis tear sheet, or an instrument description.',
    shows: [
      'Registration: the spec sha256 with its re-hash check; the round; the verdict; the pass bar, verbatim.',
      'Key figures: the headline value, then n, t, p, control p, Bonferroni, Holm, BH q.',
      'Pass checks, the blocks and the cost ladder from 0 to 2 ticks per side.',
      'An in-sample against sealed strip, marked [SPENT], where a confirmation exists.',
      'For an instrument: contract notes, trading hours, roll dates and data coverage.',
    ],
    data: 'GET /api/hypotheses/{name}. Values are read from the result files at fixed paths, never recomputed.',
    honesty: 'The screen JSON\'s dsr field is the Sharpe difference, shown as "Sharpe difference (m - BH)"; it is not the Deflated Sharpe Ratio.',
    examples: ['{rebal_v0 DES <GO>}', '{volmanaged_v0 DES <GO>}', '{TY1 COMDTY DES <GO>}'],
    related: ['EQ', 'REG', 'MT', 'RUNS'],
  },
  REG: {
    summary: 'The registry board: every registered hypothesis with its verdict.',
    shows: [
      'Name, round, verdict, n, p, control p, Bonferroni, Holm, BH q and the short spec sha with its check.',
      'Counts read from the registry file when the screen opens.',
      'Sealed confirmations in their own block, with their own alpha.',
      'Enter on a row, or its number and <GO>, opens DES.',
    ],
    data: 'GET /api/registry and GET /api/hypotheses.',
    honesty: 'Verdicts come from the result files; the terminal never produces a pass or a fail.',
    examples: ['{REG <GO>}'],
    related: ['MT', 'DES'],
  },
  MT: {
    summary: 'Multiple testing across the registry.',
    shows: [
      'Sorted p values against rank, with the Bonferroni and Holm boundaries and the BH line.',
      'The adjusted values table.',
    ],
    data: 'GET /api/multiple-testing: the registry p values, recomputed, then compared with the stored columns.',
    examples: ['{MT <GO>}'],
    related: ['REG', 'DES'],
  },
  RUNS: {
    summary: 'Every Nautilus backtest run on disk.',
    shows: [
      'Badges: probe, anchor, ledgered; checks: balance, MTM, coverage.',
      'Trades and net P&L, with Sharpe and max drawdown on Basis B.',
      'Filters: all, ledgered, anchors, probes, unusable.',
    ],
    data: 'GET /api/runs.',
    honesty: 'Probe runs carry [PROBE: never a result] and stay out of compare views by default.',
    examples: ['{RUNS <GO>}'],
    related: ['RUN', 'LEDG'],
  },
  RUN: {
    summary: 'One backtest run, inspected.',
    shows: [
      'Config, Nautilus version, elapsed time, venue, fill model and cost per side.',
      'Balance check and MTM max difference; coverage; the anchor verdict.',
      'Equity on Basis B with the underwater curve.',
      'Trades, fills, then the log: decisions, closes, rolls, notes.',
      'The ledger copy command for an eligible run; the terminal never writes the ledger.',
    ],
    data: 'GET /api/runs/{run_id}, plus /trades, /fills, /log and /equity.',
    honesty: 'A run whose balance check fails shows [UNUSABLE: BALANCE] and no equity line.',
    examples: ['{nt_dtsmom_v0_ts1 RUN <GO>}'],
    related: ['RUNS', 'EQ', 'LEDG'],
  },
  EQ: {
    summary: 'Analytics tear sheet, tab 1: equity.',
    shows: [
      'Key figures: total return, CAGR, volatility, Sharpe with its interval, Sortino, Calmar, max drawdown, PSR, MinTRL, IR, TE, alpha t.',
      'Equity against the benchmark, with a log toggle and the range buttons.',
      'A performance difference pane (m - BH).',
    ],
    data: TEAR_DATA,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 EQ <GO>}', '{nt_dtsmom_v0_ts1 EQ <GO>}'],
    related: tearRelated('EQ'),
  },
  DD: {
    summary: 'Analytics tear sheet, tab 2: drawdown.',
    shows: [
      'Equity against the benchmark over the underwater curve.',
      'The top-10 drawdown table: start, trough, recovery, depth, length.',
    ],
    data: TEAR_DATA,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 DD <GO>}'],
    related: tearRelated('DD'),
  },
  RET: {
    summary: 'Analytics tear sheet, tab 3: returns and risk.',
    shows: [
      'A histogram of period returns with the fitted normal curve and the VaR lines.',
      'VaR and CVaR at 95 and 99, the 21-session tails and a statistics table.',
    ],
    data: TEAR_DATA,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 RET <GO>}'],
    related: tearRelated('RET'),
  },
  RR: {
    summary: 'Analytics tear sheet, tab 4: rolling statistics.',
    shows: [
      'Rolling Sharpe over 63 and 252 sessions (12 and 36 months for a monthly book).',
      'Rolling volatility with its high and low.',
    ],
    data: TEAR_DATA,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 RR <GO>}'],
    related: tearRelated('RR'),
  },
  MRET: {
    summary: 'Analytics tear sheet, tab 5: monthly returns.',
    shows: [
      'A year by month heat map, with the average row on top and the newest year next.',
      'Months behind the fence stay empty.',
    ],
    data: TEAR_DATA,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 MRET <GO>}'],
    related: tearRelated('MRET'),
  },
  MON: {
    summary: 'The 27-futures monitor.',
    shows: [
      'Grouped by sector: the last close to 2021-12-31 and the returns over 1D, 1W, 1M, 3M, YTD, 12M.',
      'A vol-normalised toggle, realised volatility and the correlation to NQ.',
      'Enter on a row opens its related functions: GP, GIP, DES, CORR.',
    ],
    data: 'GET /api/market/universe, on daily bars served through the OOS gate.',
    honesty: POST_HOC_PRICES,
    examples: ['{27F MON <GO>}'],
    related: ['CORR', 'GP', 'DES'],
  },
  CORR: {
    summary: 'The correlation matrix of the 27 futures.',
    shows: [
      'A clustered 27x27 heat map over a 252-session window or the full sample, with every value printed.',
      'A cell opens the rolling pair correlation in a linked panel.',
    ],
    data: 'GET /api/market/universe and GET /api/market/pair-corr, through the OOS gate.',
    honesty: POST_HOC_PRICES,
    examples: ['{27F CORR <GO>}'],
    related: ['MON', 'GP'],
  },
  LEDG: {
    summary: 'The run ledger.',
    shows: [
      'Ledger rows with the balance column in colour and in text.',
      'Anchor pair status and links to each run.',
    ],
    data: 'GET /api/ledger. The ledger is append-only and written by its own script, never by the terminal.',
    examples: ['{LEDG <GO>}'],
    related: ['RUNS', 'RUN'],
  },
  OOS: {
    summary: 'The OOS gate\'s access log and the openings record.',
    shows: [
      'Swimlanes by caller with the fence line; sealed reads are marked.',
      'Log entries: time, caller, reason, symbol, window, result.',
      'The openings card: opened 2026-09-26, CLOSED, with its pin status.',
      'The count of reads the terminal made.',
    ],
    data: 'GET /api/audit/oos-log and GET /api/audit/openings.',
    honesty: 'The window from 2022 is spent: descriptive only, never clean out-of-sample evidence.',
    examples: ['{OOS <GO>}'],
    related: ['LIVE', 'GP'],
  },
  LIVE: {
    summary: 'The paper book, read only.',
    shows: [
      'Contract, quantity, target, exposure scale c, RV22, USD value, the kill switch and the delayed flag.',
      'Countdowns to the decision at 15:55:05 ET and the order at 15:59:30 ET, and the roll date.',
      'Target against actual, from performance rows only.',
    ],
    data: 'GET /api/live/status and GET /api/live/performance, polled every 2 seconds.',
    honesty: 'Plumbing rows never feed a performance chart. The terminal has no order path.',
    examples: ['{LIVE <GO>}'],
    related: ['JRNL', 'OOS'],
  },
  JRNL: {
    summary: 'The paper book\'s journals.',
    shows: [
      'Journal rows, newest first.',
      'Plumbing rows hatched, with the banner "PLUMBING TEST, DELAYED DATA: not strategy performance".',
      'An empty journal names the file it expects.',
    ],
    data: 'GET /api/live/journal, polled every 2 seconds.',
    honesty: 'Plumbing output is never strategy performance.',
    examples: ['{JRNL <GO>}'],
    related: ['LIVE'],
  },
  HELP: {
    summary: 'This help: every function, the keys, the keyboard, link groups and licences.',
    shows: [
      'The numbered mnemonic index; a number and <GO> opens that function\'s help here.',
      'MNEM HELP or F1 shows one function\'s help; HL searches the help, the hypotheses and the runs.',
    ],
    data: 'GET /api/commands for the hypotheses and runs the command line knows.',
    examples: ['{HELP <GO>}', '{GP HELP <GO>}'],
    related: ['HOME'],
  },
  COST: {
    summary: 'Costs of a run or hypothesis on a screen of their own.',
    shows: ['The cost waterfall and the cost sensitivity. P0 shows the cost ladder inside DES.', P1],
    data: 'GET /api/analytics/run/{run_id}/costs.',
    examples: ['{nt_dtsmom_v0_ts1 COST <GO>}'],
    related: ['DES', 'RUN'],
  },
  BLK: {
    summary: 'The blocks of a hypothesis on a screen of their own.',
    shows: ['The block results as a bar ladder. P0 shows the blocks inside DES.', P1],
    data: 'GET /api/hypotheses/{name}.',
    examples: ['{rebal_v0 BLK <GO>}'],
    related: ['DES'],
  },
  EXPO: {
    summary: 'Exposure and turnover of a run.',
    shows: ['Exposure, turnover, notional: each over time.', P1],
    data: 'GET /api/analytics/run/{run_id}/exposure.',
    examples: ['{nt_dtsmom_v0_ts1 EXPO <GO>}'],
    related: ['RUN'],
  },
  SEAL: {
    summary: 'The sealed-window files of a hypothesis.',
    shows: ['The servable sealed files, each labelled spent.', P1],
    data: 'GET /api/sealed and GET /api/sealed/{name}, through a column allowlist.',
    honesty: 'Spent window, opened 2026-09-26, descriptive only.',
    examples: ['{rebal_v0 SEAL <GO>}'],
    related: ['DES', 'OOS'],
  },
  VCONE: {
    summary: 'A volatility cone for one instrument.',
    shows: ['Realised volatility percentiles by horizon.', P1],
    data: 'GET /api/bars, through the OOS gate.',
    honesty: POST_HOC_PRICES,
    examples: ['{NQ VCONE <GO>}'],
    related: ['GP'],
  },
  SEAS: {
    summary: 'Seasonality of one instrument.',
    shows: ['Average returns by calendar period.', P1],
    data: 'GET /api/bars, through the OOS gate.',
    honesty: POST_HOC_PRICES,
    examples: ['{NQ SEAS <GO>}'],
    related: ['GP'],
  },
  EVT: {
    summary: 'An event study on one instrument.',
    shows: ['Average paths around a set of event dates.', P1],
    data: 'GET /api/bars, through the OOS gate.',
    honesty: POST_HOC_PRICES,
    examples: ['{NQ EVT <GO>}'],
    related: ['GP'],
  },
  ROLL: {
    summary: 'The roll calendar of one instrument.',
    shows: ['Roll dates with their gaps in points and percent.', P1],
    data: 'GET /api/bars (roll markers), through the OOS gate.',
    examples: ['{NQ ROLL <GO>}'],
    related: ['GP'],
  },
  DQ: {
    summary: 'Data quality of one instrument.',
    shows: ['Gated and repaired sessions on a calendar.', P1],
    data: 'GET /api/qa and GET /api/qa/{name}, with every market time after the fence removed.',
    examples: ['{NQ DQ <GO>}'],
    related: ['GP', 'GIP'],
  },
  JOBS: {
    summary: 'A backtest queue.',
    shows: ['Planned for P2 and built only after an explicit go. P0 and P1 have no job runner and write nothing.'],
    data: 'None in P0 and P1.',
    examples: ['{JOBS <GO>}'],
    related: ['RUNS'],
  },
}

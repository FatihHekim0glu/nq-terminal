// Per-function HELP pages (look spec 7.12, UI_SPEC sections 5 to 7): what each mnemonic shows, where
// its numbers come from, the honesty rule that applies, runnable examples and related functions. Our
// own text, written from this project's specs; nothing is taken from any vendor manual. UK spelling,
// no em or en dashes. Examples are `{<line> <GO>}` command links; every one parses (helpTopics.test).
import { DEMO_DATA, isDemoPage } from './chrome'

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

/** One label the terminal prints, and what it means (U03). */
export interface GlossaryEntry {
  readonly term: string
  readonly meaning: string
}

/**
 * The glossary of the labels the terminal prints: the honesty tags, the verdict words, the gate and the
 * safety segments of the status line. Our own text, read from this project's specs and screens. It is listed
 * on the HELP page (HELP_TOPICS.HELP.shows below), which HL's help text search reads, so each term is
 * searchable: before this, HL answered 'Nothing matches' for TWS, DEMO DATA, Own bar and more.
 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: '[PRE-REG]', meaning: 'A value read from a registered result. The terminal did not compute it.' },
  { term: '[POST HOC]', meaning: 'A value the terminal computed from a series: descriptive and in sample, not a registered test. No p value is shown on a slice you pick.' },
  { term: '[SPENT]', meaning: 'The sealed window has been opened, so anything on it is descriptive only and never clean out-of-sample evidence. Opened 2026-09-26.' },
  { term: '[SEALED]', meaning: 'A gate read that touched the sealed window. OOS marks it and the event tape tags it.' },
  { term: '[IS]', meaning: 'A gate read inside the in-sample window.' },
  { term: '[PLUMBING]', meaning: 'A paper book row from a plumbing test on delayed data. It is not strategy performance and never feeds a performance chart.' },
  { term: '[PROBE]', meaning: 'A backtest run kept as a probe, [PROBE: never a result]. It stays out of compare views by default.' },
  { term: '[OVERLAY]', meaning: 'A registered risk overlay. It is in the multiple-testing family, but its PASS is not an edge.' },
  { term: '[GATED]', meaning: 'A session rejected by the day gate.' },
  { term: '[REPAIRED]', meaning: 'A session rebuilt from trades after the day gate rejected it.' },
  { term: '[UNUSABLE: BALANCE]', meaning: 'A backtest run whose balance check fails. It shows no equity line.' },
  { term: 'PASS', meaning: 'The hypothesis met its own pre-registered bar. Family-adjusted p is context and does not change it.' },
  { term: 'FAIL', meaning: 'The hypothesis missed its own pre-registered bar. Family-adjusted p is context and does not change it.' },
  { term: 'CHECK', meaning: 'A registry row with no own bar, such as an unregistered check. It has no verdict.' },
  { term: 'Verdict', meaning: 'PASS or FAIL as the result files hold it. The terminal never produces one and never overrides one.' },
  { term: 'Own bar', meaning: 'The pass bar a hypothesis registered before it was tested, printed verbatim on DES. It decides PASS or FAIL; family-adjusted p never does.' },
  { term: 'Family-adjusted p', meaning: 'A p adjusted over the whole registry family of k registered tests (Bonf, Holm and BH q; k is on MT). It is context beside the own bar and does not change PASS or FAIL.' },
  { term: 'Bonf', meaning: 'Bonferroni adjusted p over the registry family. Its boundary is alpha/k.' },
  { term: 'Holm', meaning: 'Holm step-down adjusted p over the registry family. Its boundary for the i-th smallest p is alpha/(k-i+1).' },
  { term: 'BH q', meaning: 'Benjamini-Hochberg q over the registry family: the false discovery rate at that p. Its boundary for the i-th smallest p is i alpha/k.' },
  { term: 'Hash ok', meaning: "ok when the registry's spec sha256 and the terminal's own re-hash of the spec both match. NO names the check that failed." },
  { term: 'Amend', meaning: 'Accepted amendments of a spec. ok when each still binds to its spec and result, NO when one has changed since it was accepted.' },
  { term: 'Fence', meaning: "The dashed line at 2022-01-01 on every time axis, labelled IS | 2022+ SPENT. Served data stops at it, and a request past it shows the gate's refusal text." },
  { term: 'Gate', meaning: 'The OOS gate. Every price the terminal shows is served through it, in sample only, and every read is logged (see OOS).' },
  { term: 'IS', meaning: 'In sample: the window 2010-01-01 to 2021-12-31, the last day before the fence.' },
  { term: 'Sealed', meaning: 'The window from 2022-01-01 that research does not read. A sealed confirmation tests one hypothesis on it, with its own alpha and outside the family.' },
  { term: 'Basis A', meaning: "A hypothesis's screen series at 0, 1 or 2 ticks per side: the research view of a registered test." },
  { term: 'Basis B', meaning: 'The account of a Nautilus run or of the paper book: its own balances and trades.' },
  { term: DEMO_DATA.term, meaning: 'The demo build: captured fixtures, research file snapshots and seeded prices served in the browser, and nothing live. The frame strip flag and the status line use this one term. In the demo, About this demo leads this page and says which is which.' },
  { term: 'FIXTURE DATA', meaning: `The backend is reading a fixture folder instead of the research files, so the numbers are test data, not research results. The demo shows ${DEMO_DATA.term} in its place.` },
  { term: 'KILL', meaning: "The paper book's kill switch. KILL ON means the live/KILL file is present and the paper book will not trade. The terminal only reads it and never toggles it." },
  { term: 'TWS', meaning: 'The Interactive Brokers Trader Workstation behind the paper book. The terminal never talks to it, so the status line says TWS not monitored.' },
  { term: 'Gate reads', meaning: 'The number of price reads the gate has served since the backend started. It rises with every price a screen reads.' },
  { term: 'READ ONLY', meaning: 'The terminal reads and never writes: it changes no file, registry entry or ledger.' },
  { term: 'NO ORDER PATH', meaning: 'The terminal has no way to place, change or cancel an order.' },
  { term: 'R1', meaning: 'The right axis of a chart. A series name followed by (R1) in a legend is drawn against it.' },
  { term: 'RV22', meaning: '22-session realised volatility, annualised, in per cent. It is [POST HOC], descriptive only.' },
]

const glossaryLine = (g: GlossaryEntry): string => `${g.term}: ${g.meaning}`

/**
 * About this demo (U01): what the DEMO DATA flag and the demo's status segment mean. The lines lead the HELP page in
 * the demo only (HELP_TOPICS.HELP.shows below adds them when the demo boot has marked the page): they say the
 * terminal runs on captured data with no backend behind it, which is false of the real terminal, whose HELP page and
 * HL index must not carry them. The DEMO DATA key opens the page and HL reads it, so 'demo', 'synthetic' or
 * 'snapshot' find the lines there. A topic has to be a registry mnemonic (helpTopics.test), and the demo has no code
 * of its own. The run names of the demo dataset are not spelled out: one of them is a marker the bundle check keeps
 * out of a production build (scripts/bundleCheck.ts DEMO_MARKERS), and this copy ships in every build. The demo's own
 * refusal names them. The DES cards split by where each answer came from (demo/data/research.ts): volmanaged_v0 and
 * overnight_v0 are the fixture backend's, and rebal_v0, za_v0 and its check are real answers of the API
 * (helpTopics.demo.test guards the five names).
 */
export const DEMO_TOPIC = {
  title: 'About this demo',
  lines: [
    `About this demo: the ${DEMO_DATA.term} flag and status segment mark the real terminal, running in your browser on captured data with no backend behind it. Nothing in it is live.`,
    'Synthetic prices: every price comes from a seeded generator, so it is not market data and does not pass through the OOS gate. The market views (MON, CORR, VCONE, SEAS) are seeded or hand-built fillers on the real scale, not statistics of real prices.',
    'Captured fixtures: the DES cards of volmanaged_v0 and overnight_v0, the tear sheets, the runs, the ledger and the paper book are answers captured from the fixture backend. The LIVE screen replays a recorded journal instead of reading a live one.',
    "Research files: REG, MT and the deflated Sharpe view are the API's answers on the real research files, captured on 2026-09-27. The DES cards of rebal_v0 and za_v0 (with its check) are real answers of the API too. They are a snapshot, so their verdicts are the real ones as of that day and they do not change.",
    'Full evidence: volmanaged_v0 has DES, EQ and RET at 1 tick per side. Two runs have tear sheets: the fixture run of volmanaged_v0 and smoke_2015_01. Other hypotheses open a DES card only where one was captured, and have no tear sheet.',
    'Not in the demo dataset: the answer a screen gives when the demo holds no captured answer for what you asked, such as intraday bars, run comparison or sealed file bodies. It is a gap in the demo, not a fault and not a finding. For a tear sheet it goes on to name the evidence the demo does hold.',
    'Read only: the demo answers GET requests in the page, refuses any other and never reaches a real backend, so it cannot write, order or send anything.',
  ],
} as const

/** What the HELP page shows in every build; the demo adds DEMO_TOPIC.lines in front (see HELP_TOPICS.HELP.shows). */
const HELP_SHOWS: readonly string[] = [
  'The numbered mnemonic index; a number and <GO> opens that function\'s help here.',
  'MNEM HELP or F1 shows one function\'s help; HL searches functions, metrics, instruments, help text, hypotheses and runs.',
  'The glossary below defines the labels the terminal prints: the honesty tags, the verdict words, the gate and the safety segments of the status line. HL finds each term.',
  ...GLOSSARY.map(glossaryLine),
]

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
    examples: ['{volmanaged_v0 DES <GO>}', '{rebal_v0 DES <GO>}', '{TY1 COMDTY DES <GO>}'],
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
      '85) Family holds all of this, with the Deflated Sharpe (SV3) and an approximate power table computed in the browser.',
      '86) Replication draws each sealed confirmation\'s p against its parent\'s registered in-sample p: stored numbers only.',
      "87) Effective trials estimates the effective number of trials from the daily trials' own return correlations and shows the SR0 and DSR each N would set: computed in the browser, an extra view only.",
      "88) Family test runs White's Reality Check, a non-studentised SPA (arch's form) and Romano-Wolf StepM over the pre-registered NQ hypotheses on one contract against cash (some member has a positive mean) and, as a second row, against NQ buy and hold, and reads the effective number of members from the correlation of their differentials: served p-values, the effective number computed in the browser, an extra view only.",
    ],
    data: 'GET /api/multiple-testing: the registry p values, recomputed, then compared with the stored columns; GET /api/analytics/deflated for SV3 and the power table; GET /api/registry once 86) Replication is open; GET /api/analytics/hypothesis/{name}?cost=1 for each daily trial once 87) Effective trials is open; GET /api/analytics/spa once 88) Family test is open.',
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
      'The ulcer index and recovery factor (PF11) and the modified expected shortfall (RK4, Boudt, Peterson and Croux), read from the series own risk extras.',
    ],
    data: `${TEAR_DATA} GET /api/analytics/{hypothesis or run}/risk-extras for the PF11 and RK4 cards.`,
    honesty: TEAR_HONESTY,
    examples: ['{volmanaged_v0 RET <GO>}'],
    related: tearRelated('RET'),
  },
  RR: {
    summary: 'Analytics tear sheet, tab 4: rolling statistics.',
    shows: [
      'Rolling Sharpe over 63 and 252 sessions (12 and 36 months for a monthly book).',
      'Rolling volatility with its high and low.',
      'The Treynor ratio (BR5): CAGR over beta, with a note when beta is negative.',
      "The trend regime (RG2): NQ's back-adjusted close at the session before against the mean of its last 200 session closes, drawn with the regime as a strip, with each regime's sessions, mean, Sharpe and hit rate and Welch t. No p-value; daily series only.",
    ],
    data: `${TEAR_DATA} GET /api/analytics/{hypothesis or run}/risk-extras for the Treynor card, and GET /api/analytics/{hypothesis or run}/trend-regime for the trend card (prices through the OOS gate).`,
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
      "READ ONLY IB snapshot: the masked paper account, net liquidation, positions, open orders (view only) and today's executions, when NQT_IB_READONLY=1 is set; otherwise it says it is off.",
    ],
    data: 'GET /api/live/status and GET /api/live/performance, polled every 2 seconds; GET /api/ib/snapshot, polled every 10 seconds while LIVE is open (a paper TWS or Gateway on this machine, client id 95).',
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
    summary: 'This help: every function, the keys, the keyboard, link groups, licences and a glossary of the labels.',
    // Read each time the page or the HL index is built, like REG.criteriaSource: the demo boot marks the page before
    // anything renders (src/demo/boot.tsx), and the HL index is built lazily after first paint.
    get shows(): readonly string[] {
      return [...(isDemoPage() ? DEMO_TOPIC.lines : []), ...HELP_SHOWS]
    },
    data: 'GET /api/commands for the hypotheses and runs the command line knows.',
    examples: ['{HELP <GO>}', '{GP HELP <GO>}'],
    related: ['HOME'],
  },
  COST: {
    summary: 'Costs of a run or hypothesis on a screen of their own.',
    shows: [
      'For a hypothesis: the cost ladder the screen JSON recorded, as a numbered table beside the bar ladder, with the break-even cost. The values are the ones DES shows.',
      'For a run: the cost waterfall, the costs by instrument and the net P&L at each slippage cost per side.',
    ],
    data: 'GET /api/hypotheses/{name} for a hypothesis; GET /api/analytics/run/{run_id}/costs for a run.',
    examples: ['{rebal_v0 COST <GO>}', '{nt_dtsmom_v0_ts1 COST <GO>}'],
    related: ['DES', 'RUN'],
  },
  BLK: {
    summary: 'The blocks of a hypothesis on a screen of their own.',
    shows: ['The block results the screen JSON recorded, as a numbered table beside the bar ladder. The values are the ones DES shows.'],
    data: 'GET /api/hypotheses/{name}.',
    examples: ['{rebal_v0 BLK <GO>}'],
    related: ['DES'],
  },
  EXPO: {
    summary: 'Exposure and turnover of a run.',
    shows: [
      'Gross and net exposure over turnover, per session, with the price basis; the means the API sends; every session in a grid, newest first.',
      'A run with no mark to market snapshots (an intraday run) says so and shows none.',
      'With a per instrument series: Totals, By instrument (a heat map) and By sector (a stack), sampled rather than averaged; 98) Export adds one column per instrument.',
      "Capacity (EX5): contracts per session over the session's volume for each series traded, with the sessions of largest participation. Descriptive: capacity is not a test.",
    ],
    data: 'GET /api/analytics/run/{run_id}/exposure; GET /api/analytics/run/{run_id}/capacity (the vendor 1d volume through the OOS gate); GET /api/commands for the instrument sectors.',
    examples: ['{nt_dtsmom_v0_ts1 EXPO <GO>}'],
    related: ['RUN'],
  },
  SEAL: {
    summary: 'The sealed-window files of a hypothesis.',
    shows: [
      'The sealed-window files of a hypothesis, numbered; a number and <GO> shows one: CSV columns from the allowlist, JSON without price keys, markdown as text.',
      'Where a confirmation tested the hypothesis, the in-sample against sealed comparison with its own alpha. The name of a confirmation shows the files of its parent.',
    ],
    data: 'GET /api/sealed and GET /api/sealed/{name}, through a column allowlist.',
    honesty: 'Spent window, opened 2026-09-26, descriptive only.',
    examples: ['{rebal_v0 SEAL <GO>}'],
    related: ['DES', 'OOS'],
  },
  VCONE: {
    summary: 'A volatility cone for one instrument, and the 27 futures at one horizon.',
    shows: [
      'Cone view: realised volatility over six horizons from 5 to 252 sessions; the spread of every full window to 2021-12-31 as percentiles, with the latest value and its rank drawn over it.',
      '1) to 6): the horizon rows; a number and <GO> opens the 27 futures at that horizon.',
      '27F view: one small cone per future on one scale; 1) to 27) open the cone of that future.',
      '31) Cone view and 32) 27F view switch views; 98) Export saves the table on screen as CSV.',
    ],
    data: 'GET /api/market/vcone and GET /api/market/vcone/universe: the 1d series through the OOS gate, log returns on the project convention, annualised with the square root of 252.',
    honesty: `${POST_HOC_PRICES} The rank is a place among past windows, not a test.`,
    examples: ['{NQ VCONE <GO>}', '{ZN VCONE <GO>}'],
    related: ['GP', 'MON', 'SEAS'],
  },
  SEAS: {
    summary: 'Seasonality of one instrument or one hypothesis.',
    shows: [
      'Tabs 81) to 85): month, weekday, week of month, 30 minutes, month by year. Each shows the mean with one standard error either side; the grid adds n with the hit rate.',
      'Grid rows are numbered 1) to 13); a number and <GO> reads that row out.',
      'The 30 minute buckets use only sessions not gated for the variant shown; a symbol with no record has no intraday panel.',
      '96) Actions; 98) Export saves the tab shown as CSV; 99) Help.',
    ],
    data: 'GET /api/seasonality/instrument/{root} (1d and 1m bars through the OOS gate) or GET /api/seasonality/hypothesis/{name} (the Basis A series; no price is read).',
    honesty: `${POST_HOC_PRICES} The whiskers are one standard error, a spread and not a confidence interval.`,
    examples: ['{NQ SEAS <GO>}', '{volmanaged_v0 SEAS <GO>}'],
    related: ['GP', 'DES', 'MRET', 'EVT'],
  },
  EVT: {
    summary: 'An event study on one instrument around the fixed macro releases (CPI, PPI, NFP, FOMC).',
    shows: [
      'The mean cumulative return path around the chosen release, daily in sessions or intraday in minutes, with a pointwise cross-event band.',
      'The distribution at the last offset, and one grid row per event; a row number and <GO> draws that event over the mean. A void row gives its reason.',
      '96) Actions; 98) Export saves the mean path with its band as CSV.',
    ],
    data: 'GET /api/events/calendar (the event lines of macroday_v0, checked against the FOMC statements) and GET /api/events/study (bars through the OOS gate).',
    honesty: `${POST_HOC_PRICES} The band is the mean plus and minus 1.96 standard errors at each offset, descriptive only.`,
    examples: ['{NQ EVT <GO>}', '{ES EVT <GO>}'],
    related: ['GP', 'SEAS'],
  },
  ROLL: {
    summary: 'The roll calendar of the 27 futures and the MNQ roll dates of the paper book.',
    shows: [
      '1) Calendar: rolls per year and a strip by month for every market; strip rows 11) to 37) open that market.',
      '2) Market: every in-sample roll of one market with its gap in points and percent of the raw close, then its term structure: the front to next carry in percent a year over the spread, and the latest curve over every chain rank.',
      '3) Paper book MNQ: the roll schedule of the paper book, dates only.',
      '96) Actions and 98) Export (the view shown, as CSV).',
    ],
    data: 'GET /api/market/rolls (the 1d series through the OOS gate, checked against the roll count in the universe QA report) and GET /api/market/paper-rolls (calendar arithmetic, no price); GET /api/market/term-structure/{root} once 2) Market is open (the calendar chains through the OOS gate).',
    honesty: POST_HOC_PRICES,
    examples: ['{NQ ROLL <GO>}', '{ES ROLL <GO>}'],
    related: ['GP', 'MON'],
  },
  DQ: {
    summary: 'Data quality of one instrument, and the guard fingerprint status.',
    shows: [
      '85) Calendar: one square per session to 2021-12-31; a day that is not plain vendor data is marked G (gated out), R (rejected), B (rebuilt) or U (unrepairable). T or the Table button gives the year table.',
      'Flagged days are numbered 1) to N) in the grid; a number and <GO> gives the reason for that day and outlines it on the calendar.',
      '86) Guard fingerprints: every guard group with its status in words (OK, MISMATCH, NO RECORD).',
      '96) Actions; 98) Export saves the flagged days, or the guard table, as CSV.',
    ],
    data: 'GET /api/dq/symbols with /api/dq/calendar/{symbol} for the calendar; GET /api/dq/guards for the guards. Records only; no price is read.',
    honesty: 'Descriptive counts from the records, [POST HOC]; no p value.',
    examples: ['{NQ DQ <GO>}', '{ES DQ <GO>}'],
    related: ['GP', 'GIP'],
  },
  JOBS: {
    summary: 'A backtest queue.',
    shows: [
      'JOBS queues a backtest of a strategy over the in-sample years and shows how it goes. Pick a strategy, a data variant, a start (not before 2010-01-01), an end (not after 2022-01-01, the end itself is excluded), a run id that starts with t_ and has not been used, and the parameters the strategy declares as a JSON object, then press Queue run.',
      'One run goes at a time and at most ten jobs wait. A finished run, OK or FAILED CHECKS, can be opened in RUN with Open in RUN; a run that ended in ERROR or was stopped has no result to open. View log shows the last lines of what the run printed. Stop asks once before it stops a queued or running job.',
      'JOBS runs backtests only: it writes backtests/output/<run id> and its gate log lines, never the ledger, and it never connects to a broker.',
    ],
    data: 'GET /api/jobs and GET /api/jobs/{job_id}; POST /api/jobs to queue and DELETE /api/jobs/{job_id} to stop, the only writes in the terminal, each with the X-NQT: 1 header.',
    examples: ['{JOBS <GO>}'],
    related: ['RUNS', 'RUN'],
  },
}

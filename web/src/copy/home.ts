// Copy for HOME (look spec 7.1, UI_SPEC section 7): the equity panel of the launchpad (panel 3, link
// group B) and the launchpad index a HOME panel shows on its own. UK spelling, no em or en dashes.
// `{name}` slots are filled by fillCopy().

export const HOME_EQ = {
  title: 'Equity curve',
  fieldLabel: 'Hypothesis or run',
  fieldPlaceholder: '<Hypothesis or run>',
  fullSheet: 'Full tear sheet in a new panel',
  drawdown: 'Drawdown in a new panel',
  rolling: 'Rolling statistics in a new panel',
  loading: 'Loading the equity panel.',
  noContext: 'Link group {group} has no run or hypothesis yet. Type one with EQ, for example:',
  noContextExample: '{volmanaged_v0 EQ <GO>}',
  error: 'The equity panel could not load: {detail}',
  tagNote: 'computed by the terminal from the {source}, descriptive',
  sourceHypothesis: 'screen series',
  sourceRun: 'run series',
  // U24: the equity pane plots p.equity_unit, not p.unit (the return unit): on a screen basis they
  // read very differently ('return on capital per session' vs 'multiple of K (K = 1), arithmetic'),
  // so the caption must name both, not only the return unit.
  basis: 'Basis {basis}, {basisLabel}. Returns in {unit}; the equity pane plots {equityUnit}.',
  window: '{n} {per} from {first} to {last}.',
  bench: 'Benchmark: {bench}.',
  noBench: 'No benchmark series for this context.',
  dropped: 'Dropped: {list}.',
  rollingEmpty: 'The rolling {window}-{one} Sharpe needs {window} {per}; this series has {n}, so its pane stays empty.',
  chartTitle: '{name}: equity, underwater and rolling Sharpe',
  tilesLabel: 'Key figures for {name}',
  series: {
    equity: '{name}',
    bench: 'Benchmark',
    underwater: '{name} underwater',
    benchUnderwater: 'Benchmark underwater',
    rolling: 'Rolling {window}-{one} Sharpe',
  },
  tiles: {
    sharpe: 'Sharpe',
    benchSharpe: 'Benchmark Sharpe',
    maxDd: 'Max DD',
    benchMaxDd: 'Benchmark max DD',
    sessions: 'Periods',
  },
  unitCount: 'count',
  describe: {
    sharpe: 'Annualised Sharpe ratio of the series: mean over standard deviation (ddof 1) times the square root of {p}, risk-free rate 0.',
    benchSharpe: 'The same Sharpe ratio on the benchmark: {bench}.',
    benchSharpeNone: 'No benchmark series for this context.',
    maxDd: 'Deepest point below the running peak. {unit}.',
    maxDdPercent: 'Deepest point below the running peak, {unit}, shown in percent.',
    benchMaxDd: 'The same drawdown on the benchmark: {bench}.',
    sessions: 'Rows in the series ({per}), from {first} to {last}.',
    alpha: '{label} from the tear sheet, in {unit}. The tag says whether the screen recorded it or the terminal fitted it.',
    unit: 'Unit as the API states it: {unit}.',
  },
  per: { sessions: 'sessions', months: 'months' },
  // The tear sheet's drawdown units, for a backend that does not send drawdown_unit yet.
  drawdownUnitOlder: {
    A: 'fraction of K below the running peak',
    B: 'fraction below the running peak, compounded',
    sum: 'below the running peak of the cumulative sum, {unit}',
  },
  perOne: { sessions: 'session', months: 'month' },
} as const

export const HOME_LAUNCHPAD = {
  title: 'Launchpad',
  caption: 'Launchpad: numbered for <GO>',
  intro: 'HOME opens four panels in a 2x2 grid: GP and MON share link group A, EQ is in link group B and REG is unlinked. A number <GO> runs that line here; Shift+Enter on the command line opens it in a new panel.',
  columns: { number: 'No.', command: 'Command', screen: 'Screen', group: 'Link group' },
  groupNone: 'none',
  sections: { home: 'The HOME grid', more: 'More screens' },
  open: 'Run {line}',
  moreLines: ['LIVE', 'OOS', 'RUNS', 'LEDG', 'HELP'],
} as const

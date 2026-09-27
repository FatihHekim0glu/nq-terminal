// Copy for the ECharts set (TASKS 5.3): Heatmap, Distribution, BarLadder, PScatter and Swimlane,
// their data summaries (each chart's accessible name) and their table views, plus the gallery
// entries' fixture names. UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const ECHARTS = {
  loading: 'Loading the chart.',
  failed: 'The chart could not be drawn: {error}',
  blank: 'blank',
  /** Honesty label on the 2022-01-01 fence (UI_SPEC section 6). */
  fence: 'IS | 2022+ SPENT',
} as const

export const HEATMAP = {
  summary: '{name}: {rows} rows by {columns} columns; low {min} at {minAt}, high {max} at {maxAt}; {blank} blank cells.',
  summaryEmpty: '{name}: {rows} rows by {columns} columns, all blank.',
  at: '{row} {column}',
  averageRow: '{n} yr avg',
  rowHeader: {
    mret: 'Year',
    corr: 'Instrument',
    mon: 'Instrument',
  },
  scaleLabel: 'Colour scale',
  corrScale: ['Strong negative', 'Weak negative', 'Neutral', 'Weak positive', 'Strong positive'],
  monScale: ['Strong fall', 'Fall', 'Rise', 'Strong rise'],
  corrEnds: { low: '-1.00', high: '+1.00' },
} as const

export const DISTRIBUTION = {
  summary: '{name}: {n} returns in {bins} bins from {lo} to {hi}; mean {mean}, standard deviation {sd}; VaR 95 {varFive}, CVaR 95 {cvarFive}, VaR 99 {varOne}, CVaR 99 {cvarOne} (losses).',
  mean: 'Mean',
  plusSigma: '+1σ',
  minusSigma: '-1σ',
  var95: 'VaR 95',
  cvar95: 'CVaR 95',
  var99: 'VaR 99',
  cvar99: 'CVaR 99',
  colFrom: 'From',
  colTo: 'To',
  colCount: 'Count',
  colNormal: 'Normal (expected)',
  caption: '{name}: histogram bins',
  seriesName: 'Daily returns',
  notAvailable: 'not available',
} as const

export const BAR_LADDER = {
  summary: '{name}: {count} bars, {pos} positive and {neg} negative; high {max} ({maxAt}), low {min} ({minAt}).',
  summaryCi: ' Whiskers show the {ci}.',
  summaryEmpty: '{name}: no values.',
  colLabel: 'Bar',
  colValue: 'Value',
  colLo: 'CI low',
  colHi: 'CI high',
  colN: 'n',
} as const

export const P_SCATTER = {
  summary: '{name}: {m} p-values at alpha {alpha}; lowest {pmin} ({pminAt}); passing: Bonferroni {bonferroni}, Holm {holm}, BH {bh}.',
  summaryEmpty: '{name}: no p-values.',
  bonferroni: 'Bonferroni',
  holm: 'Holm',
  bh: 'BH',
  rank: 'Rank',
  colRank: 'Rank',
  colName: 'Hypothesis',
  colP: 'p',
  colBonferroni: 'Bonferroni line',
  colHolm: 'Holm line',
  colBh: 'BH line',
  colPasses: 'Passes',
  passesNone: 'none',
  yes: 'yes',
  no: 'no',
} as const

export const SWIMLANE = {
  summary: '{name}: {count} reads by {lanes} callers; windows from {start} to {end}; {sealed} sealed reads past the fence.',
  summaryEmpty: '{name}: no reads.',
  colCaller: 'Caller',
  colReads: 'Reads',
  colSealed: 'Sealed reads',
  colStart: 'Earliest start',
  colEnd: 'Latest end',
  caption: '{name}: reads by caller',
} as const

/** Names and captions for the gallery entries' fixture data (gallery builds only). */
export const ECHARTS_GALLERY = {
  mretName: 'Fixture monthly returns (%), volmanaged_v0',
  corrName: 'Fixture 252-session correlation, 27F',
  monName: 'Fixture 27F returns (%)',
  distributionName: 'Fixture daily returns (%), volmanaged_v0',
  blocksName: 'Fixture net R per trade by block, za_v0',
  weekdayName: 'Fixture mean P&L per trade by weekday (USD)',
  costName: 'Fixture Sharpe by cost (ticks per side), rebal_v0',
  breakEven: 'Break-even',
  pScatterName: 'Fixture registry p-values',
  swimlaneName: 'Fixture gate reads by caller',
  ci95: '95% confidence interval',
  monColumns: ['1D', '1W', '1M', '3M', 'YTD', '12M'],
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  costs: ['0 ticks', '1 tick', '2 ticks', '3 ticks'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  titles: {
    mret: 'MRET: monthly returns heat map',
    corr: 'CORR: correlation matrix',
    mon: 'MON: 27F returns heat cells',
    distribution: 'RET: return distribution',
    blocks: 'DES: blocks',
    weekday: 'Trades: P&L by weekday',
    cost: 'DES: cost ladder',
    pScatter: 'MT: p-values against rank',
    swimlane: 'OOS: gate reads by caller',
  },
} as const

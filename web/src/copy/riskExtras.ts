// Copy for the P2 risk extras on the tear sheet (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5): the RET tab's
// ulcer index, recovery factor and modified expected shortfall, and the RR tab's Treynor ratio. UK spelling, no em
// or en dashes. `{name}` slots are filled by fillCopy(). Every value here is [POST HOC]: computed by the terminal,
// descriptive, in sample, never a registered test and never a verdict. No p-value appears in these views.

export const RISK_EXTRAS = {
  loading: 'Reading the risk extras.',
  failed: 'Risk extras not available: {detail}',
  drawdown: {
    title: 'Ulcer index and recovery factor (PF11)',
    label: 'Ulcer index and recovery factor',
    ulcer: 'Ulcer index: the root mean square of the underwater series over all {n} {per}, in {unit}. It weighs how deep and how long the drawdowns were. quantstats divides by n - 1 instead, so its value is a little larger.',
    recovery: 'Recovery factor: total return over the deepest drawdown, on the same basis ({unit}).',
  },
  es: {
    title: 'Modified expected shortfall (RK4)',
    caption: 'Expected shortfall by level and method, {horizon}, a positive loss',
    cols: {
      level: 'Level',
      gaussian: 'Gaussian',
      historical: 'Historical CVaR (RK1)',
      modified: 'Modified',
      raw: 'Raw expansion',
      value: 'Shown',
      used: 'Method',
    },
    usedModified: 'modified ES',
    usedFloored: 'modified ES, floored at the modified VaR',
    usedHistorical: 'historical: modified ES not defined here',
    usedInverse: 'historical: modified ES below zero',
    notDefined: 'not defined',
    moments: 'Population moments: mean {mean}, sigma {sigma}, skew {skew}, excess kurtosis {kurt}.',
    source: 'Boudt, Peterson and Croux (2008), as PerformanceAnalytics ES with method "modified" and its operational floor.',
  },
  treynor: {
    title: 'Treynor ratio (BR5)',
    label: 'Treynor ratio',
    description: 'CAGR over beta: a CAGR of {cagr} per year over a beta of {beta} against {bench}, the beta on {pairs} paired {per}.',
    benchFallback: 'the benchmark',
    /** The unit the API gives CAGR (PF2), so it prints as a percentage. */
    cagrUnit: 'fraction per year',
    none: 'No Treynor ratio: {note}',
  },
  periods: { sessions: 'sessions', months: 'months' },
} as const

// Copy for MT 87) Effective trials (ANALYTICS_CATALOG SV3b, roadmap #19): the effective number of trials from the
// registered daily trials' own return correlations, and the SR0 and DSR that each N would set. [POST HOC], computed
// in the browser from the served series and pinned to qa/crosscheck/p12_neff.py: an extra view only, it never
// overrides a frozen pass bar and gives no verdict. When the browser formula cannot reproduce the served SV3 numbers
// the view says why and draws nothing. UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const EFFECTIVE_N = {
  tab: 'Effective trials',
  label: 'Effective number of trials from the trials own return correlations',
  title: 'Effective number of trials',
  basis: 'Basis A at 1 tick per side, per session (SV3a): the {daily} daily trials in the matrix; the {monthly} monthly books counted as independent trials.',
  computed: 'Computed in the browser from the served series and pinned to qa/crosscheck/p12_neff.py; not a served number. SR0 and DSR under each N are extra views only: they never override a frozen pass bar and give no verdict.',
  reading: 'Reading the daily trials series: {done} of {total}.',
  malformed: 'the series body has no session returns',
  /** The detail for a series that was neither read nor reported as failed (a caller that stopped early). */
  notRead: 'the series was not read',
  window: 'Common window {from} to {to}: {sessions} sessions that every daily trial records.',
  served: 'served',
  refused: {
    noDaily: 'Not computed: the view names no daily trial.',
    unavailable: 'Not computed: {n} of {total} daily trials series could not be read (first {name}: {detail}). Every trial is needed, as in SV3.',
    anchor: 'Not computed: the browser formula does not reproduce the served SR0 or DSR at N {n} ({name}); nothing is shown rather than a number that disagrees.',
    basis: 'Not computed: {name} serves {read} sessions but SV3 counts {served}.',
    sharpe: 'Not computed: the {name} series gives a per-session Sharpe of {computed}, but SV3 serves {served}.',
    tooFew: 'Not computed: only {sessions} sessions are common to every daily trial (at least 252 are needed).',
    degenerate: 'Not computed: {name} does not vary on the common window.',
  },
  estimates: {
    caption: 'N and SR0 under V0 by estimator',
    cols: {
      estimator: 'Estimator',
      nDaily: 'N daily',
      nTotal: 'N total',
      sr0Session: 'SR0/session',
      sr0Annual: 'SR0 (ann.)',
    },
    registered: 'Registered rows',
    participation: 'Eigenvalue participation',
    liJi: 'Li and Ji (2005)',
    clusters: 'Clusters at 1 - rho {cut}, average linkage',
  },
  clusters: 'Clusters at the cut: {groups}.',
  heatmapName: 'Correlation of the daily trials on the common window',
  diagonalNote: 'Diagonal left blank; columns numbered as the rows.',
  dsrCaption: 'DSR under V0 by trial at each N',
  dsrCols: {
    name: 'Trial',
    periods: 'P',
    served: 'DSR V0, N {n} (served)',
    participation: 'N participation',
    liJi: 'N Li and Ji',
    clusters: 'N clusters',
  },
  gallery: {
    note: 'Synthetic series from a seeded generator: not research data.',
  },
} as const

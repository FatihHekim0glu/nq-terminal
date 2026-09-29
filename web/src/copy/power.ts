// Copy for the power table on MT (ANALYTICS_CATALOG SV9): the smallest annual Sharpe ratio each registered test can
// detect, and its power at a fixed reference Sharpe ratio. UK spelling, no em or en dashes. `{name}` slots are filled
// by fillCopy(). [POST HOC], computed in the browser: descriptive only, it never overrides a frozen pass bar and gives
// no verdict.

export const POWER = {
  label: 'Power of the registered tests (approximate)',
  title: 'Power (approximate)',
  basis: 'Basis A, annualised Sharpe ratio on the SV3a common daily basis; n and P as the Deflated Sharpe view serves them.',
  approx: 'Approximate: each test is read as annual Sharpe x sqrt(years), normal and serially independent, one sided. The registered tests use trade means, Newey-West t or alpha regressions, so their exact power differs.',
  computed: 'Computed in the browser from served n and P and pinned to qa/crosscheck/p12_power.py; not a served number. Descriptive only: it never overrides a frozen pass bar and gives no verdict.',
  summary: 'Smallest annual Sharpe detectable with {target} power: {nominalLow} to {nominalHigh} at alpha {alpha}, {familyLow} to {familyHigh} at alpha/k {alphaK} (k {k}), over {yearsLow} to {yearsHigh} years.',
  caption: 'Minimum detectable annual Sharpe and power by registered trial',
  cols: {
    name: 'Trial',
    periods: 'P',
    n: 'n',
    years: 'Years',
    sharpe: 'Sharpe (ann.)',
    mdeNominal: 'MDE alpha',
    mdeFamily: 'MDE alpha/k',
    ratio: 'Sharpe/MDE alpha/k',
    powerNominal: 'Power at {s}, alpha',
    powerFamily: 'Power at {s}, alpha/k',
  },
  unavailable: 'Alpha and k are not available, so the power table is not drawn: {detail}',
  gallery: {
    title: 'Power table (captured SV3 view)',
  },
} as const

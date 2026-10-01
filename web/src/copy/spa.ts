// Copy for the SV8 family test on MT (ANALYTICS_CATALOG SV8): White's Reality Check, a non-studentised SPA (arch's
// form, not Hansen's studentised one) and Romano-Wolf StepM over the pre-registered NQ hypotheses on one contract. UK spelling, no em or en dashes. `{name}` slots
// are filled by fillCopy(). [POST HOC] and an extra view only: the p-values are over a family fixed by a rule on
// the registry, never over a slice picked on screen, and none of them is a verdict on one hypothesis.

export const SPA = {
  tab: 'Family test',
  title: 'Family test: Reality Check, non-studentised SPA and StepM (SV8)',
  label: 'Family test over the pre-registered NQ hypotheses',
  loading: 'Reading the family test.',
  failed: 'The family test is not available: {detail}',
  extra: 'Family-wise p-values over pre-registered hypotheses; an extra view only, never a verdict on one hypothesis.',
  facts: '{k} pre-registered NQ hypotheses on one contract; {n} common sessions, {first} to {last}; {cost} tick per side; losses -r against {benchmark}, in {unit}.',
  benchMissing: '{count} shared sessions left out because the benchmark has no close change.',
  bootstrap: 'Stationary bootstrap: block {block} sessions, {reps} replications, seed {seed}.',
  pvalues: 'SPA p-values (non-studentised, arch form): consistent {consistent}, lower {lower}, upper {upper}. White\'s Reality Check p-value {rc}.',
  stepm: 'StepM at family-wise size {size} ({steps} steps): rejects {names}.',
  stepmNone: 'StepM at family-wise size {size}: rejects none. {none}',
  caption: 'Family members: mean return and mean differential against {benchmark}, USD per session on one contract',
  benchmarks: {
    cash: {
      name: 'cash (zero return each session)',
      none: 'No member is shown to have a positive mean.',
    },
    nq_buy_and_hold: {
      name: 'NQ buy and hold on one contract',
      none: 'No member is shown to beat NQ buy and hold on one contract.',
    },
  },
  heldHeading: 'Second row: the same family against NQ buy and hold on one contract',
  heldNote: 'A different and much harder null than the cash row above: one contract held earned a large positive mean, so a member that is out of the market most sessions has a negative mean differential whatever its quality. Read it beside the cash row, never instead of it.',
  excludedHeading: 'Registered hypotheses outside the family',
  excludedEmpty: 'Every registered hypothesis is in the family.',
  yes: 'yes',
  no: 'no',
  rejectedAt: 'rejected at step {step}',
  notRejected: 'not rejected',
  leftOut: '{count} ({pnl} with P&L)',
  effective: {
    summary: 'Effective number of members: {participation} by eigenvalue participation and {liJi} by Li and Ji (2005), of {k}; {clusters} at 1 - rho {cut} (average linkage): {groups}.',
    clustersOne: '1 cluster',
    clustersMany: '{count} clusters',
    pair: 'Most correlated pair of differentials: {a} and {b}, rho {rho}.',
    computed: 'Computed in the browser from the served correlation, with the estimators of MT 87) Effective trials; not a served number, and no verdict.',
    single: 'One member only, so no effective number of members is drawn.',
    undefined: 'Not computed: {name} does not vary on the common index, so it has no correlation.',
    malformed: 'Not computed: the served correlation is not a k by k correlation matrix of the members.',
  },
  cols: {
    name: 'Member',
    meanReturn: 'Mean r (USD)',
    meanDiff: 'Mean d (USD)',
    block: 'Block',
    consistent: 'In consistent set',
    stepm: 'StepM',
    leftOut: 'Sessions left out',
  },
} as const

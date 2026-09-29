// Copy for MT 86) Replication (roadmap R8): each sealed confirmation drawn against the registered
// in-sample p of the hypothesis it tests. Stored p-values only: the terminal fits nothing, runs no new
// test and adds no pass or fail. The sealed window is spent, so every number here is tagged [SPENT].
// UK spelling, no em or en dashes. `{name}` slots are filled by fillCopy().

export const REPLICATION = {
  tab: 'Replication',
  label: 'Replication: registered in-sample p against the sealed confirmation p',
  title: 'Replication',
  note: 'Stored p-values only: no fit, no new test, no new pass or fail. The sealed window was opened once and is descriptive only.',
  legend: 'Up triangle: sealed PASS; down triangle: sealed FAIL; ring: other; hollow: a risk overlay. Axes reversed: stronger evidence up and to the right.',
  xAxis: 'In-sample p (registry)',
  yAxis: 'Sealed p (2022+, spent)',
  diagonal: 'same p',
  alphaLine: 'family alpha {alpha}',
  bonferroniLine: 'alpha/k {value}',
  ownAlphaLine: 'own alpha {alpha}',
  pair: '{parent} tested by {confirmation}',
  gridLabel: 'Replication pairs: in-sample test and sealed confirmation',
  empty: 'No sealed confirmation with a recorded p tests a registered hypothesis.',
  untested: 'Never tested in the sealed window ({n}): {names}.',
  untestedNone: 'Every registered hypothesis has a sealed confirmation.',
  unmatched: 'Not drawn ({n}): {items}.',
  unmatchedItem: '{name}: {reason}',
  reasons: {
    noParent: 'no parent recorded',
    notInFamily: 'parent {parent} is not in the family',
    noP: 'no p recorded',
  },
  registryFailed: 'In-sample verdicts are not available: {detail}',
  offScale: 'Off the axes: {lines}.',
  cols: {
    parent: 'Hypothesis',
    confirmation: 'Confirmation',
    inSampleP: 'In-sample p',
    inSampleVerdict: 'In-sample',
    sealedP: 'Sealed p',
    ownAlpha: 'Own alpha',
    sealedVerdict: 'Sealed',
    window: 'Window',
  },
} as const

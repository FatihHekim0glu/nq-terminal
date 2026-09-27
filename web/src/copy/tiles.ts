// Copy for the tiles (TASKS 5.4: KpiTile, SpecCard, BalanceCheck, Countdown; UI_SPEC sections 6 and 7,
// look spec 7.1, 7.3, 7.4 and 7.11). UK spelling, no em or en dashes. `{name}` slots are filled by
// fillCopy().

export const KPI = {
  rowLabel: 'Key figures',
  /** Added to the tile's name, so a screen reader hears that it opens details. */
  detailsHint: 'Show details',
  basisA: 'Basis A: a screen value, read from the research screen.',
  basisB: 'Basis B: an account value, from the Nautilus account.',
  unit: 'Unit: {unit}',
  note: 'Note: {note}',
  ci: '[{lo}, {hi}]',
  ciLabel: '95% interval {lo} to {hi}',
} as const

export const SPEC = {
  title: 'Registration and spec',
  hypothesis: 'Hypothesis',
  tag: 'Tag',
  verdict: 'Verdict',
  round: 'Round',
  spec: 'Spec',
  sha: 'Spec sha256',
  shaCheck: 'Hash check',
  shaOk: '[sha ok]',
  shaBad: '[sha MISMATCH]',
  rehashOk: 're-hash ok',
  rehashBad: 're-hash failed',
  n: 'n',
  t: 't',
  p: 'p',
  controlP: 'Control p',
  bonferroni: 'Bonferroni',
  holm: 'Holm',
  bhq: 'BH q',
  confirmations: 'Sealed confirmations',
  passBar: 'Pass bar (verbatim from the spec)',
  more: 'More',
  less: 'Less',
  preReg: '[PRE-REG]',
  postHoc: '[POST HOC]',
  badge: '[{badge}]',
} as const

export const BALANCE = {
  title: 'Balance check',
  balance: 'Balance',
  ok: '[OK]',
  fail: '[FAIL]',
  missing: '[NOT RECORDED]',
  diff: 'diff {value} USD',
  mtm: 'MTM',
  mtmDiff: 'max abs diff {value} USD, {bad} bad rows',
  starting: 'Starting balance (USD)',
  final: 'Final balance (USD)',
  delta: 'Change (USD)',
  realised: 'Realised P&L sum (USD)',
  tradeList: 'Trade list sum (USD)',
  difference: 'Difference (USD)',
  openPositions: 'Open positions',
  mtmRows: 'MTM rows checked',
  coverage: 'Coverage',
  coverageValue: '{done}/{total}',
  anchor: 'Anchor',
  unusableTag: '[UNUSABLE: BALANCE]',
  unusable: 'The balance check failed, so this run is unusable and its equity is not drawn (rule 4).',
} as const

export const COUNTDOWN = {
  label: 'Paper book times for {date} (ET)',
  decision: 'Decision',
  order: 'Order',
  roll: 'Roll',
  timeEt: '{time} ET',
  remaining: 'in {left}',
  remainingLabel: '{what} in {left}',
  passed: 'passed',
  rollDate: '{date} ({contract})',
  rollDays: 'in {n} days',
  rollOneDay: 'in 1 day',
  rollToday: 'today',
} as const

/** Gallery headings for the tile entries (fixture data, in-sample dates only). */
export const TILE_GALLERY = {
  kpiTitle: 'volmanaged_v0 against same-exposure buy and hold, fixture key figures',
  specTitle: 'Registration and spec cards, fixture',
  balanceTitle: 'Balance checks, fixture runs',
  countdownTitle: 'Paper book countdown, fixture clock',
  before: 'Before the decision (14:31:55 ET)',
  between: 'Between the decision and the order (15:57:00 ET)',
  after: 'After the close (16:10:00 ET)',
} as const

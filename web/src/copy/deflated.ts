// Copy for the Deflated Sharpe views on REG, MT and DES (ANALYTICS_CATALOG SV3, SV3a). UK spelling, no em
// or en dashes. `{name}` slots are filled by fillCopy(). SV3 is [POST HOC]: an extra view only, it never
// overrides a frozen pass bar and gives no verdict.

export const DEFLATED = {
  title: 'Deflated Sharpe (SV3)',
  label: 'Deflated Sharpe over the registered hypotheses',
  loading: 'Reading the Deflated Sharpe view.',
  failed: 'The Deflated Sharpe view is not available: {detail}',
  facts: 'N {n} registered trials; V {v} (variance of the per-session Sharpe ratios); SR0 {sessionSr} per session, {annualSr} annualised; {cost} tick per side; Basis {basis}.',
  nullFacts: "Under the null variance V0 {vNull} (the sampling variance of a Sharpe estimate when no trial has skill, 1/(n - 1) for each trial averaged in sessions: the variance the expected maximum assumes): SR0 {sessionSr} per session, {annualSr} annualised.",
  leaveOneOut: 'Without {name}, V is {v} and SR0 {annualSr} annualised (N kept at {n}).',
  belowFloor: '< 0.000001',
  extra: 'Extra view only: it never overrides a frozen pass bar and gives no verdict.',
  caption: "Deflated Sharpe by registered trial under V and under V0; SR0 in each trial's own period",
  ladderName: 'Deflated Sharpe by registered trial under the null variance V0',
  /** G06: the row's own period, session or month, so a reader never compares a Sharpe in one period
   * with an SR0 hurdle in another with no unit to catch it. */
  periods: { session: 'session', month: 'month' },
  cols: {
    name: 'Trial',
    kind: 'Series',
    periods: 'P',
    // U17: this table's n is always sessions (SV3a basis), unlike REG's n (regNColumn below), which can
    // be trades, months or sessions depending on the trial.
    n: 'n sessions (SV3a basis)',
    annual: 'Sharpe (ann.)',
    srSession: 'SR/session',
    skew: 'Skew',
    // U17: raw, normal = 3 (population moments, no bias correction), unlike RET's excess kurtosis
    // (copy/tear.ts TEAR_RET.rows.excessKurtosis) or its bias-corrected Summary skew (rows.skew).
    kurt: 'Kurtosis (raw, normal = 3)',
    srOwn: 'SR (own period)',
    sr0: 'SR0 (V), own period',
    dsr: 'DSR (V)',
    sr0Null: 'SR0 (V0), own period',
    dsrNull: 'DSR (V0)',
  },
  regColumn: 'DSR V0',
  /** U17: REG_COLUMNS' n column header, overriding copy/reg.ts's plain 'n' (that file belongs to another
   * worker in this polish-2 wave). Kept here, not there, since regColumns.tsx already reads this module
   * for regColumn above. REG's n can be trades, months or sessions depending on the trial, unlike the
   * DSR table's n above, which is always sessions. */
  regNColumn: 'n (trades/months/sessions)',
  /** U17: runsColumns.tsx's hit column header, overriding copy/runs.ts's plain 'Hit rate' (also another
   * worker's file this wave). RUNS counts a hit per trade; the tear sheet's hit rate is per non-zero
   * session (copy/tear.ts TEAR_RET.rows.hitRate, already labelled). */
  runsHitRateColumn: 'Hit rate (trades)',
  regNote: 'DSR V0 [POST HOC]: Deflated Sharpe over {n} registered trials on one daily basis (SV3), under the null variance V0; an extra view only, never a verdict. MT shows it beside the empirical V.',
  desLabel: 'Deflated Sharpe [POST HOC]',
  desLine: 'Sharpe {sr} per {period}; SR0 {floor} per {period} ({annual}/yr) under V, {floorNull} per {period} ({annualNull}/yr) under V0; DSR {dsr} under V, {dsrNull} under V0; N {n}; defined for the best trial only.',
  desNone: 'not an SV3 trial (unregistered)',
} as const

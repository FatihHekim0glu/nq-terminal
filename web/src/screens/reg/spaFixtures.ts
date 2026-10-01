// Hand-built GET /api/analytics/spa answers for the SV8 panel tests (not project results: the members' numbers are
// invented so both StepM branches, a rejection at the first step and one at the step down, are drawn).
import type { SpaView } from './spaTypes'

const TEXT = {
  label: 'Family test over the pre-registered NQ hypotheses against cash, the null that no member has a positive mean: an extra view only; it never overrides a frozen pass bar and gives no verdict on any single hypothesis',
  family_note: 'The family is fixed by a rule on the registry (every registered hypothesis on one NQ contract with a daily series), not picked on screen, so its p-values are family-wise over pre-registered hypotheses',
  construction: 'ANALYTICS_CATALOG section 7, SV8 construction',
  benchmark: 'Cash: zero return every session (r_0 = 0), no costs; no price is read for it',
  loss: "loss L_i = -r_i against cash's L_0 = 0; differential d_i = L_0 - L_i = r_i, the member's own return",
  statistic: "max over the members of mean(d_i), as arch 8.0.0 computes it: not studentised (White's form, not Hansen's studentised statistic), so it favours members with a large spread and a strong quiet member can be hidden by a noisy one; the kernel variances set only the consistent recentring",
  block_rule: "mean of the members' Politis-White stationary block lengths of d_i (Patton, Politis and White correction, arch's variant); the draws and the variance kernel use it",
  note: 'Reading: a small consistent p-value says at least one member has a positive mean per session after costs, the null the registrations, MT power and the deflated Sharpe ratio use; StepM names which, with the family-wise error held at the size. A large p-value says the family shows no hypothesis with a positive mean. Arithmetic mean USD per session; in-sample only, to 2021-12-31. It does not compare with holding NQ: the buy and hold row does',
}

const HELD_TEXT = {
  label: 'Family test over the pre-registered NQ hypotheses against NQ buy and hold: an extra view only; it never overrides a frozen pass bar and gives no verdict on any single hypothesis',
  family_note: 'The family is fixed by a rule on the registry (every registered hypothesis on one NQ contract with a daily series), not picked on screen, so its p-values are family-wise over pre-registered hypotheses',
  construction: 'ANALYTICS_CATALOG section 7, SV8 construction',
  benchmark: 'NQ buy and hold, close to close, one contract, USD per session, no costs (through the gate)',
  loss: "loss L_i = -r_i against the benchmark's L_bh = -r_bh; differential d_i = L_bh - L_i = r_i - r_bh",
  statistic: "max over the members of mean(d_i), as arch 8.0.0 computes it: not studentised (White's form, not Hansen's studentised statistic), so it favours members with a large spread and a strong quiet member can be hidden by a noisy one; the kernel variances set only the consistent recentring",
  block_rule: "mean of the members' Politis-White stationary block lengths of d_i (Patton, Politis and White correction, arch's variant); the draws and the variance kernel use it",
  note: 'Reading: a small consistent p-value says at least one member beat holding NQ on one contract after costs; StepM names which, with the family-wise error held at the size. A large p-value says the family shows no hypothesis beating buy and hold. Arithmetic mean USD per session; in-sample only, to 2021-12-31',
}

export const SPA_HELD: SpaView = {
  tag: '[POST HOC]',
  ...HELD_TEXT,
  benchmark_id: 'nq_buy_and_hold',
  buy_and_hold: null,
  basis: 'A',
  cost: 1,
  unit: 'USD per session, one NQ contract',
  n_sessions: 2806,
  first: '2010-10-26',
  last: '2021-12-31',
  bench_missing: 2,
  block: 21.37,
  reps: 10000,
  seed: 20260927,
  size: 0.05,
  pvalues: { lower: 0.3364, consistent: 0.4898, upper: 0.4922 },
  reality_check: 0.4922,
  critical_values: { lower: 18.2, consistent: 19.4, upper: 21.9 },
  stepm_steps: 1,
  superior: [],
  members: [
    { name: 'za_v0', sessions: 2825, left_out: 19, left_out_with_pnl: 19, mean_return: 12.5, mean_differential: -61.25, long_run_variance: 1.2e6, block: 21.2, in_consistent_set: false, rejected: false, step: null },
    { name: 'overnight_v0', sessions: 2836, left_out: 30, left_out_with_pnl: 22, mean_return: 88.1, mean_differential: -9.4, long_run_variance: 9.1e5, block: 19.5, in_consistent_set: true, rejected: false, step: null },
    { name: 'halloween_v0', sessions: 2836, left_out: 30, left_out_with_pnl: 4, mean_return: 97.3, mean_differential: -0.2, long_run_variance: 8.4e5, block: 23.4, in_consistent_set: true, rejected: false, step: null },
  ],
  correlation: [
    [1, 0.12, 0.08],
    [0.12, 1, 0.61],
    [0.08, 0.61, 1],
  ],
  correlation_note: "Correlation of the members' loss differentials d_i = r_i - r_bh on the common index (the series the bootstrap resamples): the dependence the maximum statistic runs over. Every d_i holds -r_bh, so for a low-exposure member (a sparse calendar book) the correlation is pulled towards 1; it is not the number of independent hypotheses, so read it beside the returns' correlation of MT 87; a member that does not vary has none",
  excluded: [],
}

export const SPA_REJECTS: SpaView = {
  tag: '[POST HOC]',
  ...TEXT,
  benchmark_id: 'cash',
  buy_and_hold: SPA_HELD,
  basis: 'A',
  cost: 1,
  unit: 'USD per session, one NQ contract',
  n_sessions: 2806,
  first: '2010-10-26',
  last: '2021-12-31',
  bench_missing: 0,
  block: 21.37,
  reps: 10000,
  seed: 20260927,
  size: 0.05,
  pvalues: { lower: 0.0021, consistent: 0.0034, upper: 0.0052 },
  reality_check: 0.0052,
  critical_values: { lower: 18.2, consistent: 19.4, upper: 21.9 },
  stepm_steps: 3,
  superior: ['halloween_v0', 'overnight_v0'],
  members: [
    { name: 'za_v0', sessions: 2825, left_out: 19, left_out_with_pnl: 19, mean_return: 12.5, mean_differential: 12.5, long_run_variance: 1.2e6, block: 21.2, in_consistent_set: false, rejected: false, step: null },
    { name: 'overnight_v0', sessions: 2836, left_out: 30, left_out_with_pnl: 22, mean_return: 88.1, mean_differential: 88.1, long_run_variance: 9.1e5, block: 19.5, in_consistent_set: true, rejected: true, step: 2 },
    { name: 'halloween_v0', sessions: 2836, left_out: 30, left_out_with_pnl: 4, mean_return: 97.3, mean_differential: 97.3, long_run_variance: 8.4e5, block: 23.4, in_consistent_set: true, rejected: true, step: 1 },
  ],
  correlation: [
    [1, 0.12, 0.08],
    [0.12, 1, 0.61],
    [0.08, 0.61, 1],
  ],
  correlation_note: "Correlation of the members' returns on the common index (against cash the differential is the return, so this is the series the bootstrap resamples and the matrix of MT 87); a member that does not vary has none",
  excluded: [
    { name: 'volmanaged_v0', reason: 'its series is in return on capital per session, not USD per session on one NQ contract' },
    { name: 'tsmom_v0', reason: 'a monthly book: its result files hold no daily series' },
  ],
}

export const SPA_NONE: SpaView = {
  ...SPA_REJECTS,
  pvalues: { lower: 0.3364, consistent: 0.4898, upper: 0.4922 },
  reality_check: 0.4922,
  stepm_steps: 1,
  superior: [],
  members: SPA_REJECTS.members.map((m) => ({ ...m, rejected: false, step: null })),
  excluded: [],
  buy_and_hold: null,
}

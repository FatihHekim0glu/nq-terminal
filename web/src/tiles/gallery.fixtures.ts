// Fixture data for the tile gallery entries (gallery builds only). Registration values are copied
// from results/registry.csv (rebal_v0, volmanaged_v0, the za_v0 C3 check); KPI values are rounded
// descriptive figures of the same kind; balance checks are the backend test fixtures; the countdown
// clock is fixed on 2021-11-10, so every date shown is in sample.
import type { Schemas } from '../api/types'
import type { SpecCardData } from './SpecCard'
import { etEpochMs } from './etTime'

type Kpi = Schemas['Kpi']

export interface KpiFixture {
  readonly kpi: Kpi
  readonly decimals?: number
  readonly signed?: boolean
  readonly description: string
  readonly ci?: readonly [number, number]
}

const kpi = (key: string, label: string, value: number | null, unit: string, basis: 'A' | 'B', note: string | null = null): Kpi =>
  ({ key, label, value, unit, basis, tag: basis === 'A' ? '[PRE-REG]' : '[POST HOC]', note })

export const KPI_FIXTURES: readonly KpiFixture[] = [
  { kpi: kpi('total', 'Total return', 312.4, '%', 'B'), decimals: 1, signed: true, description: 'Account equity growth over the whole run.' },
  { kpi: kpi('cagr', 'CAGR', 12.9, '%', 'B'), decimals: 1, signed: true, description: 'Compound annual growth rate of account equity.' },
  { kpi: kpi('vol', 'Vol', 13.1, '%', 'B'), decimals: 1, description: 'Annualised volatility of daily account returns.' },
  { kpi: kpi('sharpe', 'Sharpe', 0.99, 'ratio', 'B'), description: 'Annualised Sharpe ratio of daily account returns, 252 sessions a year.', ci: [0.41, 1.57] },
  { kpi: kpi('sortino', 'Sortino', 1.37, 'ratio', 'B'), description: 'Sortino ratio: excess return over downside deviation.' },
  { kpi: kpi('calmar', 'Calmar', 0.57, 'ratio', 'B'), description: 'CAGR over the maximum drawdown.' },
  { kpi: kpi('maxdd', 'Max DD', -22.6, '%', 'B'), decimals: 1, description: 'Largest peak to trough fall of account equity.' },
  { kpi: kpi('psr', 'PSR(0)', 0.99, 'probability', 'B'), description: 'Probabilistic Sharpe ratio against a benchmark Sharpe of zero.' },
  { kpi: kpi('mintrl', 'MinTRL', null, 'sessions', 'B', 'the Sharpe ratio is below the benchmark at 95%'), decimals: 0, description: 'Minimum track record length for 95% confidence.' },
  { kpi: kpi('ir', 'IR', 0.12, 'ratio', 'B'), signed: true, description: 'Information ratio against same-exposure buy and hold.' },
  { kpi: kpi('te', 'TE', 7.8, '%', 'B'), decimals: 1, description: 'Tracking error against same-exposure buy and hold.' },
  { kpi: kpi('alpha', 'Alpha', 3.5, '%/yr', 'A', 'read from results/screens/sizing_summary.md'), decimals: 1, signed: true, description: 'Spanning alpha against the same-exposure book (t 1.18).' },
]

export const SPEC_FIXTURES: readonly SpecCardData[] = [
  {
    name: 'rebal_v0', registered: true, round: 4, verdict: 'FAIL', verdict_badge: 'FAIL', verdict_note: null, spec: 'rebal_v0',
    spec_sha256: 'd594ec5fa7947687ccdc44ef459adc311224443152311b92c594f0c594180b74', spec_sha_ok: true, spec_rehash_ok: true,
    n: 129, t_stat: 1.13, t_label: 't', p: 0.13004898713256266, control_p: 0.09928297188210455, bonferroni_p: 1, holm_p: 1,
    bh_q: 0.2600979742651253, confirmations: ['rebal_v1_confirm'],
  },
  {
    name: 'volmanaged_v0', registered: true, round: 3, verdict: 'FAIL', verdict_badge: 'FAIL', verdict_note: null, spec: 'volmanaged_v0',
    spec_sha256: '16cc52cb5d0e4800acbc028e76571636dc573e74517db8d246ac630d7cdf444b', spec_sha_ok: true, spec_rehash_ok: true,
    n: 2686, t_stat: 1.18, t_label: 'alpha t', p: 0.11980770986703647, control_p: 0.11980770986703647, bonferroni_p: 1, holm_p: 1,
    bh_q: 0.2600979742651253, confirmations: [],
  },
  {
    name: 'za_v0_C3_gao_momentum', registered: false, round: 1, verdict: 'check inside za_v0 (no own pass bar)', verdict_badge: 'CHECK',
    verdict_note: null, spec: 'za_v0', spec_sha256: 'b02fa22b15506ec7d8d0de3ae89346418ebacba9ba07d4b7c6c9e0623d30fd89', spec_sha_ok: true,
    spec_rehash_ok: true, n: 2789, t_stat: -1.86, t_label: 't', p: 0.9687711279175623, control_p: null, bonferroni_p: null, holm_p: null,
    bh_q: null, confirmations: [],
  },
]

/** The opening of rebal_v0's frozen pass bar (experiments/rebal_v0.json), verbatim. */
export const REBAL_PASS_BAR = [
  'PASS requires ALL of 1-6, on valid months, net of costs, with one NQ per trade.',
  '',
  'Headline:',
  '1. Mean net_nq_1 > 0 and trade t >= 2.5.',
  '2. Mean net_nq_1 > 0 in EACH block (2010-13, 2014-17, 2018-21, by entry year).',
  '3. Mean net_nq_2 (2 ticks, 1.224 pts per round trip, plus rolls) >= 0.',
].join('\n')

export interface BalanceFixture {
  readonly runId: string
  readonly check: Readonly<Record<string, unknown>>
  readonly coverage: Readonly<Record<string, unknown>> | null
  readonly anchor: string | null
}

export const BALANCE_FIXTURES: readonly BalanceFixture[] = [
  {
    runId: 'nt_dtsmom_v0_fixture_ts1',
    check: {
      starting_usd: 100000000.0, final_usd: 100060658.125, delta_usd: 60658.125, realized_sum_usd: 60658.125, diff_usd: 0.0, ok: true,
      open_positions: 0, trade_list_sum_usd: 60658.125,
      mtm: { rows: 15, fills: 11, fills_after_last_snapshot: 0, max_abs_diff_usd: 0.0, net_qty_ok: true, lots_match: true, final_flat: true, bad_rows: [], n_bad: 0, ok: true },
    },
    coverage: { sessions: 15, processed: 15, ok: true },
    anchor: 'IDENTICAL',
  },
  {
    runId: 'nt_overnight_v0_fixture_open',
    check: { starting_usd: 1000000.0, final_usd: 1000412.5, delta_usd: 412.5, realized_sum_usd: 412.5, diff_usd: 0.0, ok: true, open_positions: 0, trade_list_sum_usd: 412.5 },
    coverage: { nights: 4, n_trades: 4, skipped: 0, ok: true },
    anchor: null,
  },
  {
    runId: 'nt_za_v0_fixture_unbalanced',
    check: { starting_usd: 1000000.0, final_usd: 1001065.46, delta_usd: 1065.46, realized_sum_usd: 1053.12, diff_usd: 12.34, ok: false, open_positions: 0, trade_list_sum_usd: 1053.12 },
    coverage: null,
    anchor: null,
  },
]

export const NEXT_FIXTURE: Schemas['NextTimes'] = { contract: 'MNQZ1', decision_et: '15:55:05', order_et: '15:59:30', roll_date: '2021-12-07', today_et: '2021-11-10' }

/** Fixed clock readings on 2021-11-10: before the decision, between decision and order, after the close. */
export const COUNTDOWN_NOWS = {
  before: etEpochMs('2021-11-10', '14:31:55'),
  between: etEpochMs('2021-11-10', '15:57:00'),
  after: etEpochMs('2021-11-10', '16:10:00'),
} as const

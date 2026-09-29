// Run bodies of the demo dataset: the fixture backend's answers for its six fixture runs
// (screens/runs/runs.fixtures.ts, captured 2026-09-27, and the two records below). Records, tables and log
// sections are keyed by the run id the body itself carries; a run without a captured body for a view answers the
// honest 404.
import type { Schemas } from '../../api/types'
import {
  COMPARE_STATS, DECISIONS_DTSMOM, DETAIL_DTSMOM, DETAIL_OVERNIGHT, DETAIL_UNBALANCED, FILLS_DTSMOM, LEDGER, NOTES_DTSMOM,
  ROLLS_DTSMOM, RUNS, TRADES_DTSMOM,
} from '../../screens/runs/runs.fixtures'
import { NOT_IN_DEMO, PAGE_LIMITS, intParam, served, type DemoBody, type DemoRefusal } from './answer'

export { COMPARE_STATS, LEDGER, RUNS }

type Page<T> = { readonly items: T[]; readonly offset: number; readonly limit: number; readonly total: number }
type LogPage = Schemas['Page_dict_str__Any__']

/** The run list row of a run, which is also the `summary` of its record. */
function listed(runId: string): Schemas['RunSummary'] {
  const row = RUNS.find((r) => r.run_id === runId)
  if (row === undefined) throw new Error(`the run list holds no row for ${runId}`)
  return row
}

// The records of the two runs that have analytics (analytics.ts). runs.fixtures.ts holds no record for them, and the tear
// sheet reads the run record before it asks the analytics route (screens/tear/tearQueries.ts), so without these every tab
// of their tear sheet (EQ, DD, RET, RR, MRET) refused. Each body is RunService.detail() of the fixture run folder
// (backend/tests/fixtures/backtests/output/<run>/result.json): everything in result.json but the trades, fills and strategy log,
// which the counts and log sections stand for. Nothing is typed by hand: runs.provenance.test.ts derives each field from the
// file again. A field the file lacks is null or empty (smoke_2015_01 has no coverage check, no skipped list, no fills and no
// strategy log), as the contract allows. Neither run has trades, fills or log tables here, so those views answer the 404.

const DETAIL_VOLMANAGED: Schemas['RunDetail'] = {
  summary: listed('nt_volmanaged_v0_fixture_m1'),
  config: {
    strategy: 'volmanaged',
    params: { ticks: 1 },
    variant: 'repaired',
    start: '2011-06-02',
    end: '2011-06-17',
    run_id: 'nt_volmanaged_v0_fixture_m1',
  },
  data: {
    variant: 'repaired',
    start: '2011-06-02 00:00:00+00:00',
    end: '2011-06-17 00:00:00+00:00',
    sessions: 11,
    first_session: '2011-06-02',
    last_session: '2011-06-16',
    bars_fed: 3900,
    raw_c_filled_rows: 0,
    meta_rolls: 1,
    ticks: 1,
    cost_per_contract_side_usd: '1.11',
    liquidation_day: '2011-06-16',
    cost_per_contract_side_usd_float: 1.11,
  },
  venue: {
    venue: 'XCME',
    oms_type: 'HEDGING',
    account_type: 'MARGIN',
    currency: 'USD',
    fill_model: 'BestPriceFillModel (any size at the best price: the bar close)',
    bar_execution: true,
    bar_adaptive_high_low_ordering: false,
    fee_per_contract_side_usd: 1.11,
    starting_balance_usd: 1000000,
    instrument: 'MNQ.XCME',
    multiplier: 2,
    cost_note: 'one per-contract-per-side cost = MNQ fee $0.61 + ticks x $0.50 slippage (params.ticks)',
  },
  summary_stats: {
    n_trades: 4,
    pnl_total: -3580.28,
    fees_total: 108.78,
    mean_net_r: null,
    t_net_r: null,
    gross_mean_r: null,
    hit_rate: 0,
    mean_pnl_usd: -895.07,
    t_pnl_usd: -1.941966302975811,
    mean_pnl_pts: -36.53125,
    reasons: { roll: 2, liq: 1, rebal: 1 },
    blocks: {
      '2010-2013': {
        n: 0,
        mean_net_r: null,
        t: null,
        n_trades: 4,
        mean_pnl_usd: -895.07,
        t_pnl_usd: -1.941966302975811,
      },
      '2014-2017': { n: 0, mean_net_r: null, t: null, n_trades: 0, mean_pnl_usd: null, t_pnl_usd: null },
      '2018-2021': { n: 0, mean_net_r: null, t: null, n_trades: 0, mean_pnl_usd: null, t_pnl_usd: null },
    },
  },
  balance_check: {
    starting_usd: 1000000,
    final_usd: 996419.72,
    delta_usd: -3580.28,
    realized_sum_usd: -3580.28,
    diff_usd: 0,
    ok: true,
    open_positions: 0,
    trade_list_sum_usd: -3580.28,
    mtm: {
      rows: 10,
      fills: 9,
      fills_after_last_snapshot: 0,
      max_abs_diff_usd: 0,
      net_qty_ok: true,
      lots_match: true,
      final_flat: true,
      bad_rows: [],
      n_bad: 0,
      ok: true,
    },
  },
  coverage_check: { sessions: 11, processed: 11, ok: true },
  strategy_skipped: [],
  counts: { trades: 4, fills: 9 },
  log_sections: { snapshots: 10, closes: 10, decisions: 11, notes: 1 },
  log_meta: { sessions_done: 11, sessions: 11 },
  anchor: null,
  ledger_command: {
    eligible: true,
    reasons: [],
    command: '"C:\\Users\\Fatih Hekimoglu\\nq-lab\\.venv\\Scripts\\python.exe" scripts\\ledger_append.py backtests\\output\\nt_volmanaged_v0_fixture_m1\\result.json --exp-id <exp>',
    cwd: 'C:\\Users\\Fatih Hekimoglu\\nq-lab',
    exp_id: null,
    exp_id_source: 'placeholder',
  },
  run_log_file: false,
}

const DETAIL_SMOKE: Schemas['RunDetail'] = {
  summary: listed('smoke_2015_01'),
  config: {
    strategy: 'za_orb',
    params: { or_minutes: 5, target_r: 10 },
    variant: 'repaired',
    start: '2015-01-01',
    end: '2015-02-01',
    run_id: 'smoke_2015_01',
  },
  data: {
    variant: 'repaired',
    start: '2015-01-01 00:00:00+00:00',
    end: '2015-02-01 00:00:00+00:00',
    sessions: 20,
    gated_days: 20,
    rejected_days: 0,
    rejected_reasons: {},
    bars_fed: 7800,
  },
  venue: {
    venue: 'XCME',
    oms_type: 'NETTING',
    account_type: 'MARGIN',
    currency: 'USD',
    fill_model: { prob_fill_on_limit: 0, prob_slippage: 0 },
    bar_execution: true,
    bar_adaptive_high_low_ordering: false,
    fee_per_contract_side_usd: 2.24,
    starting_balance_usd: 1000000,
  },
  summary_stats: {
    n_trades: 20,
    pnl_total: 175.4,
    fees_total: 89.6,
    mean_net_r: 0.06064101909577474,
    t_net_r: 0.11899853251919738,
    gross_mean_r: 0.08334413150567573,
    hit_rate: 0.2,
    reasons: { stop: 16, eod: 4 },
    blocks: {
      '2010-2013': { n: 0, mean_net_r: null, t: null },
      '2014-2017': { n: 20, mean_net_r: 0.06064101909577474, t: 0.11899853251919738 },
      '2018-2021': { n: 0, mean_net_r: null, t: null },
    },
  },
  balance_check: {
    starting_usd: 1000000,
    final_usd: 1000175.4,
    delta_usd: 175.4,
    realized_sum_usd: 175.4,
    diff_usd: 0,
    ok: true,
    open_positions: 0,
    trade_list_sum_usd: 175.4,
  },
  coverage_check: null,
  strategy_skipped: null,
  counts: { trades: 20, fills: 0 },
  log_sections: {},
  log_meta: {},
  anchor: null,
  ledger_command: {
    eligible: true,
    reasons: [],
    command: '"C:\\Users\\Fatih Hekimoglu\\nq-lab\\.venv\\Scripts\\python.exe" scripts\\ledger_append.py backtests\\output\\smoke_2015_01\\result.json --exp-id <exp>',
    cwd: 'C:\\Users\\Fatih Hekimoglu\\nq-lab',
    exp_id: null,
    exp_id_source: 'placeholder',
  },
  run_log_file: false,
}

export const RUN_DETAILS: ReadonlyMap<string, Schemas['RunDetail']> = new Map(
  [DETAIL_DTSMOM, DETAIL_OVERNIGHT, DETAIL_UNBALANCED, DETAIL_VOLMANAGED, DETAIL_SMOKE].map((detail) => [detail.summary.run_id, detail]),
)

const DTSMOM = DETAIL_DTSMOM.summary.run_id

export const RUN_TRADES: ReadonlyMap<string, Schemas['Page_TradeRow_']> = new Map([[DTSMOM, TRADES_DTSMOM]])
export const RUN_FILLS: ReadonlyMap<string, Schemas['Page_FillRow_']> = new Map([[DTSMOM, FILLS_DTSMOM]])
/** The captured log sections by run; the fixture run's snapshots and closes were not captured. */
const RUN_LOGS: ReadonlyMap<string, ReadonlyMap<string, LogPage>> = new Map([
  [DTSMOM, new Map([['decisions', DECISIONS_DTSMOM], ['notes', NOTES_DTSMOM], ['rolls', ROLLS_DTSMOM]])],
])

/** One page of a captured table, cut as the API cuts it: items[offset, offset + limit), total unchanged. */
export function repage<T>(page: Page<T> | undefined, query: URLSearchParams): DemoBody<Page<T>> | DemoRefusal {
  const offset = intParam(query, 'offset', 0)
  const limit = intParam(query, 'limit', PAGE_LIMITS.default)
  if (page === undefined || offset === null || limit === null || limit < 1 || limit > PAGE_LIMITS.max) return NOT_IN_DEMO
  const items = page.items.slice(offset, offset + limit)
  return served({ items, offset, limit, total: page.total })
}

/** One page of a run's log section, when the dataset holds that section. */
export function logPage(runId: string, section: string, query: URLSearchParams): DemoBody<LogPage> | DemoRefusal {
  return repage(RUN_LOGS.get(runId)?.get(section), query)
}

/** CompareStats of distinct listed runs, in the order asked; any id the dataset does not hold is a 404. */
export function compareStats(ids: string | null): DemoBody<Schemas['CompareStats'][]> | DemoRefusal {
  const wanted = (ids ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')
  const found = wanted.map((id) => COMPARE_STATS.find((s) => s.run_id === id))
  if (wanted.length === 0 || new Set(wanted).size !== wanted.length || found.some((s) => s === undefined)) return NOT_IN_DEMO
  return served(found as Schemas['CompareStats'][])
}

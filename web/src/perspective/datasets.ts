// The four pivot datasets (TASKS 9.1): RUN fills and trades, the LEDG pivot and the OOS log. Each is
// the API rows as the grid already shows them, one Perspective column per grid column, plus the viewer
// preset it opens with. Names come from src/copy/perspective.ts. No p-value column is carried, so no
// slice picked in the pivot can show one (UI_SPEC section 6). Pure.
import type { Schemas } from '../api/types'
import { PIVOT } from '../copy/perspective'
import { toSchema, type PspColumn } from './schema'

export type FillRow = Schemas['FillRow']
export type TradeRow = Schemas['TradeRow']
export type LedgerRow = Schemas['LedgerRow']
export type OosEntry = Schemas['OosLogEntry']

export interface PivotPreset {
  readonly columns: readonly string[]
  readonly group_by?: readonly string[]
  readonly split_by?: readonly string[]
  readonly sort?: ReadonlyArray<readonly [string, 'asc' | 'desc']>
  readonly aggregates?: Readonly<Record<string, string>>
  /** Per-column styling for the viewer: every datetime column formats in UTC (its name says "(UTC)"). */
  readonly columns_config?: Readonly<Record<string, { readonly date_format: { readonly timeZone: 'UTC' } }>>
}

export interface Dataset<Row> {
  readonly columns: readonly PspColumn<Row>[]
  readonly preset: PivotPreset
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** Epoch milliseconds for an ISO date or time (nanosecond fractions allowed); null otherwise. */
export function isoToMs(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || !ISO.test(text)) return null
  const trimmed = text.replace(/(\.\d{3})\d+/, '$1')
  const ms = Date.parse(trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed)
  return Number.isFinite(ms) ? ms : null
}

/** Perspective formats a datetime in the browser's zone unless its date_format names one; date columns are
 * already formatted in UTC by the viewer. */
function utcColumns<Row>(columns: readonly PspColumn<Row>[]): NonNullable<PivotPreset['columns_config']> {
  return Object.fromEntries(columns.filter((c) => c.type === 'datetime').map((c) => [c.name, { date_format: { timeZone: 'UTC' as const } }]))
}

/** A dataset whose preset carries the UTC styling of its datetime columns. */
function dataset<Row>(columns: readonly PspColumn<Row>[], preset: Omit<PivotPreset, 'columns_config'>): Dataset<Row> {
  return { columns, preset: { ...preset, columns_config: utcColumns(columns) } }
}

const seconds = (s: number | null | undefined) => (typeof s === 'number' && Number.isFinite(s) ? s * 1000 : null)

const F = PIVOT.fills
const fills = dataset<FillRow>(
  [
    { name: F.ts, type: 'datetime', value: (r) => seconds(r.ts_epoch_s) },
    { name: F.instrument, type: 'string', value: (r) => r.instrument },
    { name: F.side, type: 'string', value: (r) => r.side },
    { name: F.qty, type: 'float', value: (r) => r.qty },
    { name: F.px, type: 'float', value: (r) => r.px },
    { name: F.commission, type: 'float', value: (r) => r.commission_float },
    { name: F.position, type: 'string', value: (r) => r.position_id },
    { name: F.order, type: 'string', value: (r) => r.order_id },
    { name: F.tags, type: 'string', value: (r) => r.tags },
  ],
  { columns: [F.ts, F.instrument, F.side, F.qty, F.px, F.commission, F.position, F.order, F.tags], sort: [[F.ts, 'desc']] },
)

const T = PIVOT.trades
const side = (d: number | null) => (d === 1 ? T.long : d === -1 ? T.short : null)
const trades = dataset<TradeRow>(
  [
    { name: T.date, type: 'date', value: (r) => isoToMs(r.date) },
    { name: T.side, type: 'string', value: (r) => side(r.direction) },
    { name: T.entryTs, type: 'datetime', value: (r) => seconds(r.entry_ts_epoch_s) },
    { name: T.entryPx, type: 'float', value: (r) => r.entry_px },
    { name: T.exitTs, type: 'datetime', value: (r) => seconds(r.exit_ts_epoch_s) },
    { name: T.exitPx, type: 'float', value: (r) => r.exit_px },
    { name: T.reason, type: 'string', value: (r) => r.reason },
    { name: T.pnlPts, type: 'float', value: (r) => r.pnl_pts },
    { name: T.pnlUsd, type: 'float', value: (r) => r.pnl_usd },
    { name: T.commissions, type: 'float', value: (r) => r.commissions_usd },
    { name: T.netR, type: 'float', value: (r) => r.net_r },
  ],
  { columns: [T.date, T.side, T.entryTs, T.entryPx, T.exitTs, T.exitPx, T.reason, T.pnlPts, T.pnlUsd, T.commissions, T.netR], sort: [[T.exitTs, 'desc']] },
)

const L = PIVOT.ledger
const ledger = dataset<LedgerRow>(
  [
    { name: L.ts, type: 'datetime', value: (r) => isoToMs(r.ts_utc) },
    { name: L.runId, type: 'string', value: (r) => r.run_id },
    { name: L.expId, type: 'string', value: (r) => r.exp_id },
    { name: L.strategy, type: 'string', value: (r) => r.strategy },
    { name: L.start, type: 'date', value: (r) => isoToMs(r.start) },
    { name: L.end, type: 'date', value: (r) => isoToMs(r.end) },
    { name: L.trades, type: 'integer', value: (r) => r.n_trades },
    { name: L.pnl, type: 'float', value: (r) => r.pnl_total },
    { name: L.fees, type: 'float', value: (r) => r.fees_total },
    { name: L.hitRate, type: 'float', value: (r) => r.hit_rate },
    { name: L.meanNetR, type: 'float', value: (r) => r.mean_net_r },
    { name: L.tNetR, type: 'float', value: (r) => r.t_net_r },
    { name: L.balance, type: 'string', value: (r) => r.balance_check },
    { name: L.matches, type: 'boolean', value: (r) => r.matches_result },
    { name: L.runtime, type: 'float', value: (r) => r.runtime_s },
  ],
  // Grouped by strategy: how many ledger rows each has and the rows' trades, P&L and fees added up.
  {
    columns: [L.runId, L.trades, L.pnl, L.fees, L.balance],
    group_by: [L.strategy],
    aggregates: { [L.runId]: 'count', [L.balance]: 'count' },
    sort: [[L.ts, 'desc']],
  },
)

const O = PIVOT.oos
const oos = dataset<OosEntry>(
  [
    { name: O.ts, type: 'datetime', value: (r) => seconds(r.ts_epoch_s) ?? isoToMs(r.ts_utc) },
    { name: O.caller, type: 'string', value: (r) => r.caller },
    { name: O.reason, type: 'string', value: (r) => r.reason },
    { name: O.symbol, type: 'string', value: (r) => r.symbol },
    { name: O.timeframe, type: 'string', value: (r) => r.timeframe },
    { name: O.variant, type: 'string', value: (r) => r.variant },
    { name: O.start, type: 'datetime', value: (r) => seconds(r.start_epoch_s) },
    { name: O.end, type: 'datetime', value: (r) => seconds(r.end_epoch_s) },
    { name: O.rows, type: 'integer', value: (r) => r.rows },
    { name: O.severity, type: 'integer', value: (r) => r.severity },
    { name: O.sealed, type: 'boolean', value: (r) => r.is_sealed },
    { name: O.alert, type: 'boolean', value: (r) => r.alert },
    { name: O.line, type: 'integer', value: (r) => r.line_no },
  ],
  // Grouped by caller: reads per caller, the latest read and the highest severity.
  {
    columns: [O.line, O.ts, O.symbol, O.rows, O.severity],
    group_by: [O.caller],
    aggregates: { [O.line]: 'count', [O.ts]: 'high', [O.symbol]: 'distinct count', [O.severity]: 'high' },
    sort: [[O.ts, 'desc']],
  },
)

export const DATASETS = { fills, trades, ledger, oos } as const
export type DatasetName = keyof typeof DATASETS

/** Names in a preset that its schema lacks, as `field: name` (empty when the preset is sound). */
export function presetProblems<Row>(dataset: Dataset<Row>): string[] {
  const known = new Set(Object.keys(toSchema(dataset.columns)))
  const p = dataset.preset
  const check = (field: string, names: readonly string[] | undefined) => (names ?? []).filter((n) => !known.has(n)).map((n) => `${field}: ${n}`)
  return [
    ...check('columns', p.columns),
    ...check('group_by', p.group_by),
    ...check('split_by', p.split_by),
    ...check('sort', p.sort?.map(([n]) => n)),
    ...check('aggregates', Object.keys(p.aggregates ?? {})),
    ...check('columns_config', Object.keys(p.columns_config ?? {})),
  ]
}

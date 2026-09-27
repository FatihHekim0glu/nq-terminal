// COST for a run (TASKS 9.4; ANALYTICS_CATALOG EX3 and EX4): the API's waterfall, its costs by
// instrument and the slippage sensitivity, as rows. Money prints as the run books print it (2 decimals,
// thousands separators); the net at the run's own cost equals the waterfall's net. Pure.
import type { Schemas } from '../../api/types'
import { toCsv } from '../../chrome/exportCsv'
import { formatNumber, formatShare } from '../tear/tearFormat'

export type RunCosts = Schemas['RunCosts']

export interface InstrumentCostRow {
  readonly instrument: string
  readonly sides: string
  readonly commissions: string
  readonly slippage: string
}

export interface SensitivityRow {
  readonly ticks: number
  readonly usd: string
  readonly pct: string
  /** The rung the run itself charged. */
  readonly charged: boolean
}

const money = (v: number | null | undefined) => formatNumber(v, 2, { thousands: true })

export function instrumentRows(costs: RunCosts): InstrumentCostRow[] {
  return costs.waterfall.by_instrument.map((r) => ({
    instrument: r.instrument,
    sides: formatNumber(r.sides, 0, { thousands: true }),
    commissions: money(r.commissions),
    slippage: money(r.slippage),
  }))
}

/** EX4 per rung; `net_pct_of_k` is a fraction of capital, printed as a percentage. */
export function sensitivityRows(costs: RunCosts): SensitivityRow[] {
  const s = costs.sensitivity
  return s.ticks.map((ticks, i) => ({
    ticks,
    usd: money(s.net_usd[i]),
    pct: formatShare(s.net_pct_of_k[i]),
    charged: ticks === s.run_ticks,
  }))
}

/** Every table of the screen in one CSV: section, item, value (the API values at full precision). */
export function runCostsCsv(costs: RunCosts): { readonly csv: string; readonly rows: number } {
  const w = costs.waterfall
  const s = costs.sensitivity
  const rows: Array<Array<string | number | null>> = [
    ...w.rows.map((r) => ['waterfall', r.step, r.value]),
    ...w.by_instrument.flatMap((r) => [
      ['sides', r.instrument, r.sides],
      ['commissions', r.instrument, r.commissions],
      ['slippage', r.instrument, r.slippage],
    ]),
    ...s.ticks.map((t, i) => ['net_usd_at_ticks', String(t), s.net_usd[i] ?? null]),
    ...s.ticks.map((t, i) => ['net_pct_of_k_at_ticks', String(t), s.net_pct_of_k[i] ?? null]),
  ]
  return { csv: toCsv(['section', 'item', 'value'], rows), rows: rows.length }
}

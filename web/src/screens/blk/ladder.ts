// The DES ladders as numbered rows (TASKS 9.4, BLK and COST for a hypothesis; ANALYTICS_CATALOG RL5 and
// EX4). The values are the screen JSON's own, printed with the same decimals and sign as the DES ladder's
// table view (decimalsFor over the ladder, then `signed`), so BLK and COST read exactly as DES does. Pure.
import { signed } from '../../charts/echarts/format'
import { toCsv } from '../../chrome/exportCsv'
import { MISSING, decimalsFor, ticksLabel, type DesExtract } from '../des/desModel'

export interface LadderRow {
  /** The Number <GO> of the row, from 1. */
  readonly n: number
  readonly label: string
  /** The value as DES prints it. */
  readonly value: string
  /** The API value, for the export. */
  readonly raw: number | null
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function rows(items: ReadonlyArray<{ readonly label: string; readonly value: number | null }>): LadderRow[] {
  const d = decimalsFor(items.map((i) => i.value))
  return items.map((item, i) => ({
    n: i + 1,
    label: item.label,
    value: finite(item.value) ? signed(item.value, d) : MISSING,
    raw: finite(item.value) ? item.value : null,
  }))
}

export function blockRows(des: DesExtract): LadderRow[] {
  return rows(des.blocks.map((b) => ({ label: b.label, value: b.value })))
}

export function costRows(des: DesExtract): LadderRow[] {
  return rows(des.cost_ladder.map((r) => ({ label: ticksLabel(r.ticks_per_side), value: r.value })))
}

/** A two-column CSV of the rows: label and the API value at full precision. */
export function ladderCsv(header: readonly [string, string], ladder: readonly LadderRow[]): string {
  return toCsv(header, ladder.map((r) => [r.label, r.raw]))
}

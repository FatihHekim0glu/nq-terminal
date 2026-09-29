// REG's cost survival board (93) Cost survival, look spec 7.2, roadmap #5, EX4): one small tile per
// registry row's recorded cost ladder, each on its own stated scale including 0, sorted by the
// served break-even (furthest first, nulls last, then name), with a missing list for rows whose
// detail has not loaded, failed or simply records no ladder. Every printed number is the screen
// JSON's own (desModel.costInput, unchanged); the terminal computes only decimals, the scale, the
// marker position and the sort order.
import type { ChartTable } from '../../charts/ChartA11y'
import { signed } from '../../charts/echarts/format'
import { COST_BOARD } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { MISSING, costInput, breakEvenText as desBreakEvenText, decimalsFor, ticksLabel, type DesExtract } from '../des/desModel'
import type { Badge, RegRow } from './regModel'
import type { HypothesisDetails } from './useHypothesisDetails'

export interface CostRung {
  readonly ticks: number
  readonly label: string
  readonly value: number | null
  /** The signed, fixed-decimal value as the tile prints it; `--` when the API sent no value. */
  readonly text: string
}

export interface CostTile {
  /** The tile's Number <GO>, 1..N, assigned after sorting. */
  readonly n: number
  readonly name: string
  readonly badge: Badge
  readonly unit: string | null
  readonly rungs: readonly CostRung[]
  /** The recorded break-even cost, raw; null when none is recorded. */
  readonly breakEven: number | null
  /** Where the break-even sits on the drawn rungs, as a fractional category index; null when it is
   *  not recorded, or is recorded but sits beyond the drawn ladder (desModel.costInput's marker). */
  readonly breakEvenAt: number | null
  readonly breakEvenText: string
  readonly scale: { readonly min: number; readonly max: number }
  readonly scaleText: string
}

export interface CostMissing {
  readonly name: string
  /** pending: detail not read yet. failed: the GET failed. none: read, but no cost ladder recorded. */
  readonly reason: 'pending' | 'failed' | 'none'
  readonly detail: string | null
}

export type CostBoardStatus =
  | { readonly kind: 'reading'; readonly n: number }
  | { readonly kind: 'failed'; readonly n: number; readonly name: string; readonly detail: string }
  | null

export interface CostBoardView {
  readonly tiles: readonly CostTile[]
  readonly missing: readonly CostMissing[]
  /** The one status line the board shows outside the chart: reading while anything is still pending,
   *  else the first failure (if any); never both (mirrors evidenceModel.detailStatus). */
  readonly status: CostBoardStatus
  /** The board's own accessible summary (ChartA11y's label): the tile count and the count of rows
   *  read but recording no ladder (reason 'none'); a pending or failed row is not "missing a ladder". */
  readonly label: string
  readonly table: ChartTable
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** [min(0, values), max(0, values)]; -1 to 1 when every value (and 0) is the same, so a flat ladder
 *  still draws a scale instead of collapsing to a point. */
function scaleFor(values: readonly number[]): { readonly min: number; readonly max: number } {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  return min === max ? { min: -1, max: 1 } : { min, max }
}

function buildTile(name: string, badge: Badge, des: DesExtract): CostTile | null {
  const ladder = costInput(des, name)
  if (!ladder) return null
  const decimals = ladder.decimals ?? decimalsFor(des.cost_ladder.map((r) => r.value))
  const rungs: CostRung[] = des.cost_ladder.map((r, i) => ({
    ticks: r.ticks_per_side,
    label: ladder.bars[i]?.label ?? ticksLabel(r.ticks_per_side),
    value: r.value,
    text: finite(r.value) ? signed(r.value, decimals) : MISSING,
  }))
  const scale = scaleFor(rungs.map((r) => r.value).filter(finite))
  const unit = ladder.unit ?? null
  return {
    n: 0,
    name,
    badge,
    unit,
    rungs,
    breakEven: des.break_even_ticks_per_side,
    breakEvenAt: ladder.marker?.at ?? null,
    breakEvenText: desBreakEvenText(des),
    scale,
    scaleText: fillCopy(COST_BOARD.scale, { min: signed(scale.min, decimals), max: signed(scale.max, decimals), unit: unit ?? '' }),
  }
}

/** Descending break-even, nulls last, then name: the whole point of the board is comparing
 *  break-evens, so the served registry order is never reused here. */
function tileOrder(a: CostTile, b: CostTile): number {
  if (a.breakEven === null && b.breakEven === null) return a.name.localeCompare(b.name)
  if (a.breakEven === null) return 1
  if (b.breakEven === null) return -1
  return b.breakEven - a.breakEven || a.name.localeCompare(b.name)
}

function tableFor(tiles: readonly CostTile[]): ChartTable {
  return {
    caption: COST_BOARD.caption,
    columns: [
      { key: 'name', label: COST_BOARD.cols.name, rowHeader: true },
      { key: 'ticks', label: COST_BOARD.cols.ticks, numeric: true },
      { key: 'value', label: COST_BOARD.cols.value, numeric: true },
      { key: 'unit', label: COST_BOARD.cols.unit },
      { key: 'breakEven', label: COST_BOARD.cols.breakEven },
    ],
    rows: tiles.flatMap((t) =>
      t.rungs.map((r) => ({ name: t.name, ticks: r.ticks, value: r.text, unit: t.unit ?? MISSING, breakEven: t.breakEvenText })),
    ),
  }
}

/** Mirrors evidenceModel.detailStatus: reading while anything is pending, else the first failure. */
function statusFor(missing: readonly CostMissing[]): CostBoardStatus {
  const pending = missing.filter((m) => m.reason === 'pending').length
  if (pending > 0) return { kind: 'reading', n: pending }
  const failed = missing.filter((m) => m.reason === 'failed')
  if (failed.length === 0) return null
  const first = failed[0]!
  return { kind: 'failed', n: failed.length, name: first.name, detail: first.detail ?? '' }
}

/** REG's cost survival board: `rows` is the board's own filtered, served-order rows (RegViewBody's
 *  `shown`), so 93) Cost survival always agrees with what 91) Board and 92) Evidence show. */
export function buildCostBoard(rows: readonly RegRow[], details: HypothesisDetails): CostBoardView {
  const built: CostTile[] = []
  const missing: CostMissing[] = []
  for (const row of rows) {
    const detail = details.byName.get(row.name)
    if (detail) {
      const tile = buildTile(row.name, row.badge, detail.des)
      if (tile) built.push(tile)
      else missing.push({ name: row.name, reason: 'none', detail: null })
      continue
    }
    const failed = details.failed.get(row.name)
    missing.push(failed !== undefined ? { name: row.name, reason: 'failed', detail: failed } : { name: row.name, reason: 'pending', detail: null })
  }
  const tiles = built.sort(tileOrder).map((t, i) => ({ ...t, n: i + 1 }))
  const none = missing.filter((m) => m.reason === 'none').length
  return {
    tiles,
    missing,
    status: statusFor(missing),
    label: fillCopy(COST_BOARD.summary, { name: COST_BOARD.label, n: tiles.length, missing: none }),
    table: tableFor(tiles),
  }
}

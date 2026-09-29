// The compare basket of RUNS and REG (roadmap 9): which rows the reader has marked with Space, and which
// of the marked runs the compare view can draw. Pure rules, no statistic and no request: the screens
// keep the ids, this file only says what a toggle does and why a marked run is left out.
import type { Schemas } from '../../api/types'

/** One compare line style per run (LineStack COMPARE_STYLES has eight). */
export const BASKET_MAX = 8

export interface ToggleResult {
  /** The basket after the toggle, in marking order. */
  readonly ids: readonly string[]
  /** True when a new id was refused because the basket already holds BASKET_MAX; the screen says so. */
  readonly full: boolean
}

/** Marks an id (appended, so the basket keeps the order it was marked in) or unmarks it (always allowed). */
export function toggleMark(ids: readonly string[], id: string): ToggleResult {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), full: false }
  if (ids.length >= BASKET_MAX) return { ids: [...ids], full: true }
  return { ids: [...ids, id], full: false }
}

/** Why a marked run is not drawn. Checked in this order: the first that applies is the reason given. */
export type Exclusion = 'probe' | 'balance' | 'unusable' | 'unreadable' | 'unknown'

export interface Excluded {
  readonly id: string
  readonly reason: Exclusion
}

export interface CompareSelection {
  /** Run ids to draw, in basket order. */
  readonly drawn: readonly string[]
  /** Marked ids left out with their reason, in basket order. */
  readonly excluded: readonly Excluded[]
}

type RunFlags = Pick<Schemas['RunSummary'], 'run_id' | 'readable' | 'balance_ok' | 'usable' | 'is_probe'>

function exclusionOf(run: RunFlags | undefined, includeProbes: boolean): Exclusion | null {
  if (!run) return 'unknown'
  if (!run.readable) return 'unreadable'
  // Only an explicit false fails the balance check: a missing flag is not a pass, but `usable` decides then.
  if (run.balance_ok === false) return 'balance'
  if (!run.usable) return 'unusable'
  if (run.is_probe && !includeProbes) return 'probe'
  return null
}

/** Splits the basket into the runs the compare view draws and the ones it lists as left out. */
export function compareSelection(ids: readonly string[], runs: readonly RunFlags[], includeProbes: boolean): CompareSelection {
  const byId = new Map(runs.map((r) => [r.run_id, r] as const))
  const drawn: string[] = []
  const excluded: Excluded[] = []
  for (const id of ids) {
    const reason = exclusionOf(byId.get(id), includeProbes)
    if (reason === null) drawn.push(id)
    else excluded.push({ id, reason })
  }
  return { drawn, excluded }
}

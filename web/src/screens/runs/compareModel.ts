// The compare view's model (roadmap 9, phase A): the served RunComparison as one LineStack pane of
// rebased equity (Basis B, equity over the starting balance K, 1.0 on the day before each run's first
// session). Nothing here is computed from the curves: the rebased values, the time axis and the stats are
// the API's own; this file only says which series are drawn, how they are named and styled, and whether
// the Log toggle applies.
import type { Schemas } from '../../api/types'
import { COMPARE_STYLES, type LineStackPane } from '../../charts/LineStack.types'
import { RUNS } from '../../copy/runs'
import { fillCopy } from '../../copy/workspace'

type Comparison = Schemas['RunComparison']
type CompareStats = Schemas['CompareStats']

const C = RUNS.compare

export interface CompareView {
  /** Epoch seconds, as served. */
  readonly t: readonly number[]
  /** One pane of rebased curves, or none when no series can be drawn. */
  readonly panes: readonly LineStackPane[]
  /** The served headline numbers, verbatim. */
  readonly stats: readonly CompareStats[]
  /** Run ids the API marks unusable: listed, not drawn. */
  readonly undrawn: readonly string[]
}

const positiveOrGap = (v: number | null | undefined): boolean => typeof v !== 'number' || !Number.isFinite(v) || v > 0

export function compareModel(body: Comparison): CompareView {
  const drawn = body.series.filter((s) => s.usable)
  const undrawn = body.series.filter((s) => !s.usable).map((s) => s.run_id)
  if (drawn.length === 0) return { t: body.t, panes: [], stats: body.stats, undrawn }
  const pane: LineStackPane = {
    id: 'rebased',
    summaryAll: true,
    zero: 'none',
    decimals: 3,
    unit: '',
    logAllowed: drawn.every((s) => s.rebased.every(positiveOrGap)),
    series: drawn.map((s, i) => ({
      name: fillCopy(C.seriesName, { run: s.run_id, source: C.sources[s.source] }),
      style: COMPARE_STYLES[i] ?? 'primary',
      values: s.rebased,
    })),
  }
  return { t: body.t, panes: [pane], stats: body.stats, undrawn }
}

/** CompareStats sends the drawdown as a positive depth; RUNS, the tear sheet and RUN show a fall as a negative number. */
export function maxDdFall(stats: Pick<CompareStats, 'max_drawdown'>): number | null {
  return stats.max_drawdown === null ? null : -Math.abs(stats.max_drawdown)
}

/** One row of the stats table: the served numbers of a run and where its curve comes from. */
export interface CompareRow {
  readonly stats: CompareStats
  /** The words for the run's curve source; empty when the API sent no series for the run. */
  readonly source: string
}

/** The served stats in body order, each with the source label of its series (nothing is recomputed). */
export function statsRows(body: Comparison): CompareRow[] {
  const sources = new Map(body.series.map((s) => [s.run_id, C.sources[s.source]] as const))
  return body.stats.map((stats) => ({ stats, source: sources.get(stats.run_id) ?? '' }))
}

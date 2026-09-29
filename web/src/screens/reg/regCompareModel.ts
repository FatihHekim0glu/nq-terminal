// REG 95) Compare, the pure model (roadmap #9 phase B): the served Basis A screen series of the marked
// hypotheses (GET /api/hypotheses/{name}/series) grouped into LineStack panes. One pane per unit, so two
// units never share an axis (ANALYTICS_CATALOG C1); every series on the union of the served times, a null
// where a hypothesis has no value at that time; a line style by basket position. The values are the
// served `equity` (the recorded values' arithmetic running sum, in the body's unit) and nothing else: no
// rescale, no rounding, no statistic, and no value carried forward. Hypotheses that share a unit rarely
// share their times (trade exits against daily rows, a monthly book against a daily one), so on the union
// each series is mostly null: every line joins its own served points across those nulls (spanGaps), as its
// EQ line does, while the table view and the readout still show -- where a hypothesis has no row. The
// legend adds no High, Average or Low (legendStats: false): those would be statistics of the terminal's own.
// Hypotheses the reader picked are compared descriptively only.
import type { Schemas } from '../../api/types'
import { COMPARE_STYLES, type LineStackPane, type LineStackSeries } from '../../charts/LineStack.types'
import { REG } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'

type Series = Schemas['HypothesisSeries']

/** One basket entry as its query stands: the served body, the failure text, or neither while it loads. */
export interface RegSeriesInput {
  readonly name: string
  readonly body: Series | null
  readonly error: string | null
}

export interface RegCompareFailure {
  readonly name: string
  readonly detail: string
}

export interface RegCompareModel {
  /** Epoch seconds, ascending: the union of every served time. */
  readonly t: number[]
  readonly panes: LineStackPane[]
  /** The unit of each pane, in pane order (LineStackPane carries no unit name for a free-text unit). */
  readonly paneUnits: string[]
  /** The hypotheses drawn on each pane, in basket order, by name (the series names carry the cost too). */
  readonly paneNames: string[][]
  /** Basket entries whose series could not be read, in basket order, with the API's own detail. */
  readonly failed: RegCompareFailure[]
}

const DECIMALS = 3

/** The cost as the compare picker words it ("0 ticks", "1 tick", "2 ticks"); any other cost is its number. */
function costLabel(cost: number): string {
  return (REG.compare.costs as Readonly<Record<string, string>>)[String(cost)] ?? String(cost)
}

function unionOfTimes(bodies: readonly Series[]): number[] {
  const seen = new Set<number>()
  for (const b of bodies) for (const x of b.t) seen.add(x)
  return [...seen].sort((a, b) => a - b)
}

/**
 * The body's served values on the shared times: a value where the body has that time, null elsewhere. The
 * null is not a value and is not filled: the line joins the body's own points across it (spanGaps), and the
 * table view and readout show -- there.
 */
function alignedValues(body: Series, t: readonly number[]): Array<number | null> {
  const byTime = new Map<number, number>()
  body.t.forEach((x, i) => {
    const v = body.equity[i]
    if (v !== undefined) byTime.set(x, v)
  })
  return t.map((x) => byTime.get(x) ?? null)
}

/**
 * `cost` is the tick cost the bodies were asked for; it only names the series. A body wins over an error
 * (a failed refetch keeps the last answer), and an input with neither is still loading: not drawn, not
 * failed. A series keeps the style of its position in the basket whatever happens to the others.
 */
export function regCompareModel(inputs: readonly RegSeriesInput[], cost: number): RegCompareModel {
  const drawn = inputs.flatMap((input, index) => (input.body ? [{ input, body: input.body, index }] : []))
  const failed = inputs.flatMap((i) => (!i.body && i.error !== null ? [{ name: i.name, detail: i.error }] : []))
  const t = unionOfTimes(drawn.map((d) => d.body))
  const paneUnits: string[] = []
  const paneNames: string[][] = []
  const bySeries: LineStackSeries[][] = []
  for (const { input, body, index } of drawn) {
    let pane = paneUnits.indexOf(body.unit)
    if (pane < 0) {
      paneUnits.push(body.unit)
      paneNames.push([])
      bySeries.push([])
      pane = paneUnits.length - 1
    }
    paneNames[pane]!.push(input.name)
    bySeries[pane]!.push({
      name: fillCopy(REG.compare.seriesName, { name: input.name, cost: costLabel(cost) }),
      style: COMPARE_STYLES[index % COMPARE_STYLES.length]!,
      values: alignedValues(body, t),
      spanGaps: true,
    })
  }
  const panes = bySeries.map((series, i): LineStackPane => ({ id: `unit-${i}`, series, decimals: DECIMALS, zero: 'none', legendStats: false }))
  return { t, panes, paneUnits, paneNames, failed }
}

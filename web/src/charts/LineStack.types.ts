// Public shapes of LineStack (TASKS 5.1): a stack of uPlot panes sharing one time axis, used by EQ,
// DD, RR and the RUN equity panes (look spec 6 and 7.5).
import type { PanelLink } from '../state/linkGroups'
import type { SummaryDrawdown } from './ChartA11ySummary'
import type { Callout } from './LineStack.draw'
import type { UplotConstructor } from './lazy'
import type { RANGE_TOOLBAR } from './theme'

/** Series styles from the charts theme (lineStackSeries): colour, width and fill come from tokens. */
export type LineStyleKey = 'primary' | 'benchmark' | 'underwater' | 'perfDiff' | 'rollShort' | 'rollLong' | 'rollVol'

export interface LineStackSeries {
  readonly name: string
  readonly style: LineStyleKey
  /** One value per time; null, NaN and Infinity are gaps and no line crosses them. */
  readonly values: ReadonlyArray<number | null | undefined>
}

/** 'white' is the honest zero line of EQ and DD; 'grey' the RR zero line (look spec 6.2 and 7.5). */
export type ZeroLine = 'white' | 'grey' | 'none'

export interface LineStackPane {
  readonly id: string
  readonly series: readonly LineStackSeries[]
  /** Share of the stack's height (default 1). */
  readonly weight?: number
  readonly zero?: ZeroLine
  /** Decimals in the legend, tags, readout and table (default 2). */
  readonly decimals?: number
  readonly unit?: '' | '%'
  /** Print an explicit + on positive values (changes and differences). */
  readonly signed?: boolean
  /** Whether the Log toggle applies to this pane (only when every value is above zero). */
  readonly logAllowed?: boolean
  /**
   * The API's maximum drawdown for this pane's first series, formatted with its unit, and its basis.
   * Equity panes pass it; every other pane leaves it out, and the accessible name then states none.
   * The chart never derives a drawdown from the plotted values.
   */
  readonly summaryDrawdown?: SummaryDrawdown
  /** Marked points (RR's volatility Hi and Low): a white dot and its label, in the pane's display unit. */
  readonly callouts?: readonly Callout[]
}

export type RangeKey = (typeof RANGE_TOOLBAR.ranges)[number]

export interface LineStackProps {
  /** What the stack shows, for the table caption (for example "volmanaged_v0 equity"). */
  readonly title: string
  /** Epoch seconds, ascending, shared by every pane. */
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
  /** The panel's link group; '-' keeps the crosshair to this stack. */
  readonly link?: PanelLink
  /** The OOS fence time; null leaves it off. Defaults to 2022-01-01. */
  readonly fence?: number | null
  readonly initialRange?: RangeKey
  /** Where uPlot comes from; tests pass a stand-in. Defaults to the lazy chunk. */
  readonly loader?: () => Promise<UplotConstructor>
  /** Called once per build with the milliseconds from building the options to every pane drawn. */
  readonly onRender?: (ms: number) => void
}

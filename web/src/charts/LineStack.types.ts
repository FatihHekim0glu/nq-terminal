// Public shapes of LineStack (TASKS 5.1): a stack of uPlot panes sharing one time axis, used by EQ,
// DD, RR and the RUN equity panes (look spec 6 and 7.5).
import type { PanelLink } from '../state/linkGroups'
import type { SummaryDrawdown } from './ChartA11ySummary'
import type { Callout } from './LineStack.draw'
import type { UplotConstructor } from './lazy'
import type { RANGE_TOOLBAR } from './theme'

/**
 * Series styles from the charts theme (lineStackSeries): colour, width and fill come from tokens.
 * compare1 to compare8 are the lines of a compare basket (RUNS and REG): colour by position in the
 * series palette, and the last four dashed.
 */
export type LineStyleKey =
  | 'primary' | 'benchmark' | 'underwater' | 'perfDiff' | 'rollShort' | 'rollLong' | 'rollVol' | 'ciBound'
  | 'compare1' | 'compare2' | 'compare3' | 'compare4' | 'compare5' | 'compare6' | 'compare7' | 'compare8'

/** The compare styles in basket order: line i of a compare pane takes COMPARE_STYLES[i]. */
export const COMPARE_STYLES: readonly LineStyleKey[] = [
  'compare1', 'compare2', 'compare3', 'compare4', 'compare5', 'compare6', 'compare7', 'compare8',
]

export interface LineStackSeries {
  readonly name: string
  readonly style: LineStyleKey
  /** One value per time; null, NaN and Infinity are gaps and no line crosses them, unless spanGaps is set. */
  readonly values: ReadonlyArray<number | null | undefined>
  /**
   * True joins this series' own values across the nulls between them: a compare basket drawn on the union of
   * several series' times, where a null only means this series has no row at that time. Default false: a
   * null is a gap.
   */
  readonly spanGaps?: boolean
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
  /**
   * False leaves out the High on, Average and Low on rows a single-series pane's legend adds, for a view that
   * shows served values only. Default true.
   */
  readonly legendStats?: boolean
  /** Whether the Log toggle applies to this pane (only when every value is above zero). */
  readonly logAllowed?: boolean
  /**
   * The API's maximum drawdown for this pane's first series, formatted with its unit, and its basis.
   * Equity panes pass it; every other pane leaves it out, and the accessible name then states none.
   * The chart never derives a drawdown from the plotted values.
   */
  readonly summaryDrawdown?: SummaryDrawdown
  /**
   * The accessible name describes every series of this pane, in order, not only the first. It is for a
   * pane of peers, such as the RUNS compare lines, where the first run is no more the subject than the
   * others. The default is the first series only.
   */
  readonly summaryAll?: boolean
  /** Marked points (RR's volatility Hi and Low): a white dot and its label, in the pane's display unit. */
  readonly callouts?: readonly Callout[]
  /**
   * An episode-lanes pane: drawn in place of series on a fixed [0, n] scale, with no legend, value
   * labels, tags or zero line.
   */
  readonly lanes?: LanesSpec
}

// ---------------------------------------------------------------------------------------------
// Context layer (roadmap 12): marked windows, a regime strip and episode lanes. Every field is
// optional on LineStackProps and LineStackPane, and without them LineStack draws exactly as before.

/** A marked window on the shared time axis (a stress span): a translucent band with a chip. */
export interface StackSpan {
  /** Epoch seconds. */
  readonly from: number
  readonly to: number
  /** Shown on the chip and in the table; carries any [SPENT] tag of the window. */
  readonly label: string
}

/** The three states of the regime strip, low to high. */
export type RibbonState = 'low' | 'mid' | 'high'

/** A three-state strip under the time axis (for example volatility terciles). */
export interface RibbonSpec {
  /** What the strip shows, for the readout and the table caption (for example "Regime"). */
  readonly name: string
  /** One state per time, aligned to `t`; null draws nothing there. */
  readonly values: ReadonlyArray<RibbonState | null>
  /** Each state's words and its one-letter glyph, so no state is told apart by colour alone. */
  readonly states: Readonly<Record<RibbonState, { readonly label: string; readonly glyph: string }>>
  /** The readout text where the strip has no state. */
  readonly missing: string
}

/** One drawdown episode as a lane bar: a fall from `peak` to `trough`, a recovery to `end`. */
export interface LaneEpisode {
  /** 1 is the deepest; the lane order is the order served. */
  readonly rank: number
  /** Epoch seconds. */
  readonly peak: number
  readonly trough: number
  /** Where the recovery ended; for an open episode, the last time the data reaches. */
  readonly end: number
  /** The episode has not recovered its peak. */
  readonly open: boolean
  /** The depth, formatted with its unit (for example "-28.8%"). */
  readonly depth: string
}

/** A lanes pane: one row per episode, drawn in place of a line pane's series. */
export interface LanesSpec {
  readonly name: string
  readonly episodes: readonly LaneEpisode[]
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
  /** Marked windows: a band on every pane, chips on the top pane. A new array identity rebuilds every pane, so memoise it. */
  readonly spans?: readonly StackSpan[]
  /**
   * The regime strip under the bottom pane's time axis, which grows that axis by ribbonHeight +
   * ribbonGap (8 px). A new object identity rebuilds every pane, so memoise it.
   */
  readonly ribbon?: RibbonSpec
  /** The rank of the episode to outline in the lanes panes; null or absent outlines none. Changing it redraws the lanes panes only and never rebuilds. */
  readonly highlightLane?: number | null
  /**
   * Called with the rank of the lane under the pointer, or null when it leaves the lanes. Read at call
   * time, so a new function never rebuilds. It reports only the pointer's own moves over a lanes pane,
   * and null when the panes rebuild or unmount while a lane is reported.
   */
  readonly onLaneHover?: (rank: number | null) => void
}

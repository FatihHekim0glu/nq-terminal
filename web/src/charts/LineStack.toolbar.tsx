// LineStack's range row (look spec 6.4, row 2): contiguous 1D 3D 1M 6M YTD 1Y 5Y Max buttons with the
// active one pressed, then the Log toggle. The buttons join the panel's roving focus.
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import { LINE_STACK } from '../copy/lineStack'
import type { RangeKey } from './LineStack.types'
import { RANGE_TOOLBAR } from './theme'

export interface LineStackToolbarProps {
  /** The pressed range, or null after a zoom. */
  readonly range: RangeKey | null
  readonly onRange: (range: RangeKey) => void
  readonly log: boolean
  readonly onLog: (next: boolean) => void
  /** Whether any pane takes a log scale at all. */
  readonly logShown: boolean
  /** Whether the data allows it (every value above zero). */
  readonly logAvailable: boolean
}

const roving = { [ROVING_ATTR]: '' }

export function LineStackToolbar(props: LineStackToolbarProps) {
  return (
    <div className="linestack-toolbar">
      <div className="chart-range" role="group" aria-label={LINE_STACK.rangeGroup}>
        {RANGE_TOOLBAR.ranges.map((r) => (
          <button key={r} type="button" className="chart-range-btn" aria-pressed={props.range === r} onClick={() => props.onRange(r)} {...roving}>
            {r}
          </button>
        ))}
      </div>
      {props.logShown ? (
        <button
          type="button"
          className="chart-range-btn linestack-log"
          aria-pressed={props.log}
          disabled={!props.logAvailable}
          title={props.logAvailable ? undefined : LINE_STACK.logUnavailable}
          onClick={() => props.onLog(!props.log)}
          {...roving}
        >
          {LINE_STACK.logToggle}
        </button>
      ) : null}
    </div>
  )
}

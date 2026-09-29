// Accessibility wrapper for every canvas chart (UI_SPEC sections 8 and 9). axe cannot see into a
// canvas, so the chart is shown as role="img" named by a data summary (see ChartA11ySummary), and a
// table view gives the same numbers as a real table. `T` toggles the view only while the chart or
// its table has focus (WCAG 2.1.4: no always-on single-key shortcut). Other keys reach the chart's
// own handler first; Left and Right that the chart leaves unhandled move to the panel's next item.
// The crosshair readout (Left, Right, Home, End) sits outside role="img", whose children are
// presentational, in a polite live region; callers throttle what they pass. The toggle keeps one
// visible label ("Table") and carries its state in aria-pressed (WCAG 2.5.3). The chart and its
// scrolling table are Tab stops on their own (WCAG 2.1.1; axe scrollable-region-focusable); inside a
// panel, the roving focus (chrome/WorkspaceFocus) leaves one Tab stop per panel.
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CHART } from '../copy/workspace'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR } from '../chrome/WorkspaceFocus'
import './ChartA11y.css'

export interface ChartColumn {
  readonly key: string
  readonly label: string
  /** Numbers are right-aligned in tabular figures. */
  readonly numeric?: boolean
  /**
   * Renders as `<th scope="row">` instead of `<td>` in the table view, so a screen reader moving
   * down a column also announces the row it is in (WCAG 1.3.1). The first column is the row header
   * only as a default, when no column sets this explicitly (heatmapTable's `row`, stackTable's and
   * candleTable's `time`). A table whose naming column is not first (a numeric column leads, e.g.
   * pScatterModel's rank, coneModel's step) flags that naming column instead (D38), so the row header
   * is always the column that identifies the row, not whichever one happens to be first.
   */
  readonly rowHeader?: boolean
}

export interface ChartTable {
  readonly caption: string
  readonly columns: readonly ChartColumn[]
  /** Values already formatted for display (fixed decimals, explicit sign where signed). */
  readonly rows: ReadonlyArray<Readonly<Record<string, string | number | null>>>
}

export interface ChartA11yProps {
  /** The data summary: range, last value and the like. Becomes the chart's accessible name. */
  readonly label: string
  readonly table: ChartTable
  /**
   * More tables for the same chart (LineStack's marked windows, regime runs and episodes), shown in
   * the table view after the main one, in order. Absent or empty changes nothing.
   */
  readonly extraTables?: readonly ChartTable[]
  /** Controlled table view; leave both out for the wrapper to keep its own state. */
  readonly tableView?: boolean
  readonly onTableViewChange?: (next: boolean) => void
  /** The chart's own keys (crosshair, zoom); call preventDefault on the ones it handles. */
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  /** The crosshair readout (T O H L C V and the like); announced politely, so pass a throttled value. */
  readonly readout?: ReactNode
  /**
   * The chart's own controls (LineStack's range row), placed left of the Table toggle in one row
   * that wraps at narrow widths (WCAG 1.4.10), so no control covers another or the chart.
   */
  readonly toolbar?: ReactNode
  readonly children: ReactNode
}

const TOGGLE_KEY = 't'
const roving = { [ROVING_ATTR]: '' }
const rovingDefault = { ...roving, [ROVING_DEFAULT_ATTR]: '' }

/** The columns rendered as `<th scope="row">` in the body: the ones flagged, or else the first. */
function rowHeaderKeys(columns: readonly ChartColumn[]): ReadonlySet<string> {
  const flagged = columns.filter((c) => c.rowHeader === true)
  if (flagged.length > 0) return new Set(flagged.map((c) => c.key))
  return new Set(columns.length > 0 ? [columns[0]!.key] : [])
}

function DataTable({ table }: { readonly table: ChartTable }) {
  const headerKeys = rowHeaderKeys(table.columns)
  return (
    <table className="chart-a11y-table">
      <caption>{table.caption}</caption>
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {table.columns.map((c) =>
              headerKeys.has(c.key) ? (
                <th key={c.key} scope="row" className={c.numeric ? 'num' : undefined}>{row[c.key] ?? ''}</th>
              ) : (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>{row[c.key] ?? ''}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function useTableView(props: ChartA11yProps): [boolean, (next: boolean) => void] {
  const [own, setOwn] = useState(false)
  const controlled = props.tableView !== undefined
  const value = controlled ? props.tableView === true : own
  const set = (next: boolean) => {
    if (!controlled) setOwn(next)
    props.onTableViewChange?.(next)
  }
  return [value, set]
}

export default function ChartA11y(props: ChartA11yProps) {
  const [tableView, setTableView] = useTableView(props)
  const hintId = useId()

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!tableView) props.onKeyDown?.(event)
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.toLowerCase() === TOGGLE_KEY) {
      event.preventDefault()
      setTableView(!tableView)
    }
  }

  return (
    <div className="chart-a11y">
      <div className="chart-a11y-bar">
        {props.toolbar}
        <button type="button" className="chart-a11y-toggle" aria-pressed={tableView} onClick={() => setTableView(!tableView)} {...roving}>
          {CHART.tableToggle}
        </button>
        <span id={hintId} className="sr-only">{CHART.keysHint}</span>
      </div>
      {tableView ? (
        <div className="chart-a11y-tablewrap" role="region" aria-label={props.table.caption} aria-describedby={hintId} tabIndex={0} onKeyDown={onKeyDown} {...rovingDefault}>
          <DataTable table={props.table} />
          {props.extraTables?.map((table, i) => <DataTable key={i} table={table} />)}
        </div>
      ) : (
        <div className="chart-a11y-figure" role="img" aria-label={props.label} aria-describedby={hintId} tabIndex={0} onKeyDown={onKeyDown} {...rovingDefault}>
          {props.children}
        </div>
      )}
      {props.readout !== undefined ? (
        <div className="chart-a11y-readout crosshair-readout" role="status" aria-live="polite" aria-label={CHART.readoutLabel}>
          {props.readout}
        </div>
      ) : null}
    </div>
  )
}

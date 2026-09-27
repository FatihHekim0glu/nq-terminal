// MonitorGrid (TASKS 5.4, look spec 4.8 and 4.12, UI_SPEC sections 8 and 9): the terminal's data grid.
// TanStack Table sorts, TanStack Virtual renders only the rows in view (spacer rows keep the native
// table layout and the sticky header of grid.css), and every colour comes from grid.css.
//
// Keyboard: the table is the panel's one Tab stop (data-roving) and keeps DOM focus; the active cell
// is announced through aria-activedescendant, so scrolling never loses focus. Arrow keys, Page Up and
// Down, Home and End (with Control for the grid ends) move the active cell; Left and Right on the
// edge cells are left to the panel. Enter on a header sorts; Enter or a double click on a row drills
// down (onOpen). Rows carry their `N)` numbers and register them for Number <GO> in the panel.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { RowData } from '@tanstack/react-table'
import { GRID } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import { usePanelActions } from '../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../chrome/PanelChrome.numbers'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR } from '../chrome/WorkspaceFocus'
import { HEADER_ROW, buildDisplayRows, moveActive, numberWidthEm, type DisplayRow, type GridPos } from './MonitorGrid.model'
import { useGridWindow } from './MonitorGrid.window'
import { useSortedRows, type SortSpec } from './MonitorGrid.sort'
import './grid.css'

export type CellTone = 'up' | 'down' | 'muted'

export interface MonitorColumn<Row extends RowData> {
  readonly id: string
  readonly header: string
  /** Column width in CSS px (the grid is table-layout: fixed). */
  readonly width: number
  /** `name`: amber label; `num`: right-aligned tabular figures; `text`: plain. */
  readonly kind: 'name' | 'num' | 'text'
  /** The value the column sorts by; null sorts last in both directions. */
  readonly value: (row: Row) => string | number | null
  /** The text shown (fixed decimals, explicit sign); defaults to the value, or `--`. */
  readonly format?: (row: Row) => string
  readonly tone?: (row: Row) => CellTone | undefined
  /** Custom content (a badge, a bar); the cell still sorts by `value`. */
  readonly render?: (row: Row) => ReactNode
  readonly sortable?: boolean
}

export interface MonitorGridProps<Row extends RowData> {
  /** The grid's accessible name. */
  readonly label: string
  readonly rows: readonly Row[]
  /** Keep this array stable (module scope or useMemo): it drives the table model. */
  readonly columns: readonly MonitorColumn<Row>[]
  readonly rowId: (row: Row) => string
  /** Section of a row: rows are shown under numbered section rows (look spec 7.7). */
  readonly groupOf?: (row: Row) => string
  /** Show `N)` numbers and register them for Number <GO> (default true). */
  readonly numbered?: boolean
  /** Drill down: Enter, a double click or Number <GO> on a row. */
  readonly onOpen?: (row: Row) => void
  /** Label of a row in the Number <GO> registry; defaults to its first column. */
  readonly rowLabel?: (row: Row) => string
  readonly rowClassName?: (row: Row) => string | undefined
  readonly initialSort?: SortSpec
  /** Panel whose Number <GO> the rows answer; defaults to the enclosing panel. */
  readonly panelId?: string
  readonly emptyText?: string
}

const MISSING = '--'
const roving = { [ROVING_ATTR]: '', [ROVING_DEFAULT_ATTR]: '' }

export function signTone(value: number | null | undefined): CellTone | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return undefined
  return value > 0 ? 'up' : 'down'
}

export function cellText<Row extends RowData>(col: MonitorColumn<Row>, row: Row): string {
  if (col.format) return col.format(row)
  const v = col.value(row)
  return v === null || v === '' ? MISSING : String(v)
}

function cellClass<Row extends RowData>(col: MonitorColumn<Row>, row: Row, active: boolean): string {
  const tone = col.tone?.(row)
  return [col.kind === 'text' ? '' : col.kind, tone ?? '', active ? 'is-active' : ''].filter(Boolean).join(' ')
}

interface Ids {
  header(col: number): string
  cell(row: number, col: number): string
  group(row: number): string
}

function makeIds(base: string): Ids {
  return {
    header: (col) => `${base}-h${col}`,
    cell: (row, col) => `${base}-r${row}c${col}`,
    group: (row) => `${base}-r${row}g`,
  }
}

/** Number <GO> items: a row number selects and opens its row; a section number selects its section. */
function useNumberedRows<Row extends RowData>(
  display: readonly DisplayRow<Row>[],
  labelOf: (row: Row) => string,
  select: (index: number) => void,
  open: (row: Row) => void,
): NumberedItem[] {
  return useMemo(() => {
    const items: NumberedItem[] = []
    display.forEach((d, i) => {
      if (d.n === null) return
      if (d.kind === 'group') items.push({ n: d.n, label: d.label, run: () => select(i) })
      else items.push({ n: d.n, label: labelOf(d.row), run: () => { select(i); open(d.row) } })
    })
    return items
  }, [display, labelOf, select, open])
}

interface HeaderProps<Row extends RowData> {
  readonly columns: readonly MonitorColumn<Row>[]
  readonly numbered: boolean
  readonly ids: Ids
  readonly active: GridPos
  readonly sort: SortSpec | null
  readonly onSort: (col: number) => void
}

function GridHeader<Row extends RowData>({ columns, numbered, ids, active, sort, onSort }: HeaderProps<Row>) {
  const offset = numbered ? 1 : 0
  const isActive = (col: number) => active.row === HEADER_ROW && active.col === col
  return (
    <thead>
      <tr role="row" aria-rowindex={1}>
        {numbered ? (
          <th scope="col" id={ids.header(0)} className={`hot${isActive(0) ? ' is-active' : ''}`}>
            <span className="sr-only">{GRID.numberHeader}</span>
          </th>
        ) : null}
        {columns.map((c, i) => {
          const sorted = sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined
          return (
            <th
              key={c.id}
              scope="col"
              id={ids.header(i + offset)}
              className={[c.kind === 'num' ? 'num' : '', isActive(i + offset) ? 'is-active' : ''].filter(Boolean).join(' ') || undefined}
              aria-sort={sorted}
              onClick={() => onSort(i + offset)}
            >
              {c.header}
              {sorted ? <span className="sort-mark" aria-hidden="true">{sorted === 'ascending' ? ' ▲' : ' ▼'}</span> : null}
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

interface RowProps<Row extends RowData> {
  readonly d: DisplayRow<Row>
  readonly index: number
  readonly columns: readonly MonitorColumn<Row>[]
  readonly numbered: boolean
  readonly ids: Ids
  readonly active: GridPos
  readonly rowClassName?: (row: Row) => string | undefined
  readonly onPick: (pos: GridPos) => void
  readonly onOpen: (row: Row) => void
}

function GridRow<Row extends RowData>({ d, index, columns, numbered, ids, active, rowClassName, onPick, onOpen }: RowProps<Row>) {
  const colCount = columns.length + (numbered ? 1 : 0)
  const onRow = active.row === index
  if (d.kind === 'group') {
    const text = d.n === null ? d.label : fillCopy(GRID.section, { n: d.n, label: d.label })
    return (
      <tr role="row" className="group-row" aria-rowindex={index + 2}>
        <td role="gridcell" id={ids.group(index)} colSpan={colCount} className={onRow ? 'is-active' : undefined} onMouseDown={() => onPick({ row: index, col: active.col })}>
          {text}
        </td>
      </tr>
    )
  }
  const offset = numbered ? 1 : 0
  const row = d.row
  const pick = (col: number) => () => onPick({ row: index, col })
  return (
    <tr role="row" className={rowClassName?.(row)} aria-rowindex={index + 2} aria-selected={onRow} onDoubleClick={() => onOpen(row)}>
      {numbered ? (
        <td role="gridcell" id={ids.cell(index, 0)} className={`hot${onRow && active.col === 0 ? ' is-active' : ''}`} onMouseDown={pick(0)}>
          <span>{d.n === null ? '' : fillCopy(GRID.number, { n: d.n })}</span>
        </td>
      ) : null}
      {columns.map((c, i) => (
        <td role="gridcell" key={c.id} id={ids.cell(index, i + offset)} className={cellClass(c, row, onRow && active.col === i + offset) || undefined} onMouseDown={pick(i + offset)}>
          {c.render ? c.render(row) : cellText(c, row)}
        </td>
      ))}
    </tr>
  )
}

function activeId<Row extends RowData>(ids: Ids, display: readonly DisplayRow<Row>[], pos: GridPos, rendered: (row: number) => boolean): string | undefined {
  if (pos.row === HEADER_ROW) return ids.header(pos.col)
  const d = display[pos.row]
  if (!d || !rendered(pos.row)) return undefined
  return d.kind === 'group' ? ids.group(pos.row) : ids.cell(pos.row, pos.col)
}

function clampPos(pos: GridPos, rows: number, cols: number): GridPos {
  const row = rows === 0 ? HEADER_ROW : Math.min(pos.row, rows - 1)
  return { row, col: Math.min(Math.max(pos.col, 0), Math.max(cols - 1, 0)) }
}

export default function MonitorGrid<Row extends RowData>(props: MonitorGridProps<Row>) {
  const { label, rows, columns, rowId, groupOf, numbered = true, onOpen, rowClassName, initialSort, emptyText } = props
  const base = useId()
  const ids = useMemo(() => makeIds(base), [base])
  const hintId = `${base}-hint`
  const { sorted, sort, toggleSort, groupOrder } = useSortedRows(rows, columns, rowId, initialSort, groupOf)
  const display = useMemo(() => buildDisplayRows(sorted, { rowId, numbered, groupOf, groupOrder }), [sorted, rowId, numbered, groupOf, groupOrder])
  const colCount = columns.length + (numbered ? 1 : 0)
  const win = useGridWindow(display)
  const { scrollToRow } = win
  const [rawActive, setActive] = useState<GridPos>({ row: 0, col: 0 })
  const active = clampPos(rawActive, display.length, colCount)
  const reveal = useRef(false)

  const open = useCallback((row: Row) => onOpen?.(row), [onOpen])
  const select = useCallback((index: number) => {
    setActive((p) => ({ row: index, col: p.col }))
    scrollToRow(index)
  }, [scrollToRow])
  const labelOf = useCallback((row: Row) => (props.rowLabel ? props.rowLabel(row) : columns[0] ? cellText(columns[0], row) : rowId(row)), [props.rowLabel, columns, rowId])
  const items = useNumberedRows(display, labelOf, select, open)
  const panel = usePanelActions()
  useNumbered(props.panelId ?? panel.panelId, `grid${base}`, items)

  const sortByCol = (col: number) => {
    const c = columns[col - (numbered ? 1 : 0)]
    if (c && c.sortable !== false) toggleSort(c.id)
    setActive({ row: HEADER_ROW, col })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.altKey || e.metaKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (active.row === HEADER_ROW) sortByCol(active.col)
      else {
        const d = display[active.row]
        if (d?.kind === 'data') open(d.row)
      }
      return
    }
    const next = moveActive(active, { key: e.key, ctrl: e.ctrlKey }, { rows: display.length, cols: colCount, page: win.pageRows() })
    if (!next) return
    e.preventDefault()
    reveal.current = true
    setActive(next)
    if (next.row !== HEADER_ROW) win.scrollToRow(next.row)
  }

  const current = activeId(ids, display, active, win.isRendered)
  const { revealColumn } = win
  useEffect(() => {
    if (!reveal.current || current === undefined) return
    reveal.current = false
    revealColumn(document.getElementById(current))
  }, [current, revealColumn])
  const maxNumber = items.reduce((m, i) => Math.max(m, i.n), 1)

  return (
    <div className="nqt-grid-wrap">
      <span id={hintId} className="sr-only">{GRID.keysHint}</span>
      <div ref={win.scrollRef} className="nqt-grid-scroll">
        <table
          className="nqt-grid"
          role="grid"
          aria-label={label}
          aria-describedby={hintId}
          aria-rowcount={display.length + 1}
          aria-colcount={colCount}
          aria-activedescendant={current}
          tabIndex={0}
          onKeyDown={onKeyDown}
          {...roving}
        >
          <colgroup>
            {numbered ? <col style={{ width: `${numberWidthEm(maxNumber)}em` }} /> : null}
            {columns.map((c) => <col key={c.id} style={{ width: `${c.width}px` }} />)}
          </colgroup>
          <GridHeader columns={columns} numbered={numbered} ids={ids} active={active} sort={sort} onSort={sortByCol} />
          <tbody>
            {display.length === 0 ? (
              <tr role="row"><td role="gridcell" colSpan={colCount} className="muted">{emptyText ?? GRID.empty}</td></tr>
            ) : null}
            {win.spacer.top > 0 ? <tr aria-hidden="true" className="nqt-grid-spacer"><td colSpan={colCount} style={{ height: `${win.spacer.top}px` }} /></tr> : null}
            {win.items.map((item) => {
              const d = display[item.index]
              if (!d) return null
              return <GridRow key={d.key} d={d} index={item.index} columns={columns} numbered={numbered} ids={ids} active={active} rowClassName={rowClassName} onPick={setActive} onOpen={open} />
            })}
            {win.spacer.bottom > 0 ? <tr aria-hidden="true" className="nqt-grid-spacer"><td colSpan={colCount} style={{ height: `${win.spacer.bottom}px` }} /></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

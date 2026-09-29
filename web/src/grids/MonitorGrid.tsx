// MonitorGrid (TASKS 5.4, look spec 4.8 and 4.12, UI_SPEC sections 8 and 9): the terminal's data grid.
// TanStack Table sorts, TanStack Virtual renders only the rows in view (spacer rows keep the native
// table layout and the sticky header of grid.css), and every colour comes from grid.css.
//
// Keyboard: the table is the panel's one Tab stop (data-roving) and keeps DOM focus; the active cell
// is announced through aria-activedescendant, so scrolling never loses focus. Arrow keys, Page Up and
// Down, Home and End (with Control for the grid ends) move the active cell; Left and Right on the
// edge cells are left to the panel. Enter on a header sorts; Enter or a double click on a row drills
// down (onOpen); with Shift the drill asks for a new panel (G20). Rows carry their `N)` numbers and
// register them for Number <GO> in the panel. A cell cut to an ellipsis carries its full text as a title on
// hover and, when it becomes the active cell, on the message line (U08).
// Type-ahead (U09): with the grid focused, a letter jumps to the next row whose name starts with it, and letters
// typed close together build a prefix; it is scoped to the focused grid, so no page shortcut is bound (WCAG 2.1.4).
// Marking is opt-in: with onMark, Space on the active data row asks the screen to mark it, and rows the
// screen lists in `marked` are drawn with a fill, a plus and a screen reader word.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { RowData } from '@tanstack/react-table'
import { COLUMN_HINTS, GRID } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import { postMessage } from '../chrome/MessageLine.store'
import { usePanelActions } from '../chrome/PanelChrome.actions'
import Tooltip from '../chrome/Tooltip'
import { useNumbered, type NumberedItem } from '../chrome/PanelChrome.numbers'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR, ROVING_ENTRY_ATTR, ROVING_SCROLL_ATTR } from '../chrome/WorkspaceFocus'
import { HEADER_ROW, buildDisplayRows, columnWidth, moveActive, numberWidthEm, type DisplayRow, type GridPos } from './MonitorGrid.model'
import { useGridWindow, type GridScroll } from './MonitorGrid.window'
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
  /**
   * What the header means (U03): shown as the house tooltip and read out on the message line when the
   * keyboard reaches the header. Defaults to the shared hint for the header text (COLUMN_HINTS), if any.
   */
  readonly hint?: string
}

/** What a drill-down may ask besides the row (G20): Shift with Enter or a double click opens the drill in
 * a new panel. A plain Enter or double click passes no options at all. */
export interface OpenOptions {
  readonly newPanel: boolean
}

const NEW_PANEL: OpenOptions = { newPanel: true }

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
  /**
   * Drill down: Enter, a double click or Number <GO> on a row. Shift with Enter or a double click also
   * passes `{ newPanel: true }` (G20); a plain press passes the row alone. A grid without onOpen has no
   * drill, and its description does not say Enter opens a row (G19).
   */
  readonly onOpen?: (row: Row, options?: OpenOptions) => void
  /** Label of a row in the Number <GO> registry; defaults to its first column. */
  readonly rowLabel?: (row: Row) => string
  readonly rowClassName?: (row: Row) => string | undefined
  /**
   * Row marking, opt-in (the RUNS and REG compare baskets). `marked` holds the ids (`rowId`) of the
   * marked rows, which are drawn with a fill, an ASCII plus and the word `marked` for screen readers.
   * Space on the active data row calls `onMark`; the screen owns the set. Without `onMark` Space is
   * left alone and the description adds no hint.
   */
  readonly marked?: ReadonlySet<string>
  readonly onMark?: (row: Row) => void
  readonly initialSort?: SortSpec
  /** Panel whose Number <GO> the rows answer; defaults to the enclosing panel. */
  readonly panelId?: string
  readonly emptyText?: string
  /**
   * `own` (default): the grid scrolls in its own box and renders a window of its rows; the grid then
   * takes its panel's Tab stop (data-roving-scroll), so Tab reaches that box. `panel`: a bounded grid
   * (MON, REG) renders every row and the panel body, the panel's usual Tab stop, scrolls (axe
   * scrollable-region-focusable either way).
   */
  readonly scroll?: GridScroll
  /**
   * The grid is its panel's Tab stop (U09, REG: 24 round and criteria buttons come before it in the item
   * walk). It carries data-roving-entry, and ArrowUp on its header row is left to the panel, which steps
   * back to the item before the grid.
   */
  readonly tabStop?: boolean
}

const MISSING = '--'
const roving = { [ROVING_ATTR]: '', [ROVING_DEFAULT_ATTR]: '' }
// A grid that scrolls in its own box holds the panel's Tab stop, so that box is reachable by Tab.
const rovingOwnScroll = { ...roving, [ROVING_SCROLL_ATTR]: '' }
const entry = { [ROVING_ENTRY_ATTR]: '' }

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

/** U08: a cell is cut when its content is wider than the cell (a pixel of slack for sub-pixel layout). */
function isCut(cell: HTMLElement): boolean {
  return cell.scrollWidth > cell.clientWidth + 1
}

/** The title of a cell is its full text while the ellipsis hides part of it, and none once it fits. */
function syncCellTitle(cell: HTMLElement): void {
  const text = (cell.textContent ?? '').trim()
  if (text !== '' && isCut(cell)) {
    if (cell.title !== text) cell.title = text
  } else if (cell.hasAttribute('title')) cell.removeAttribute('title')
}

/** Letters typed further apart than this start a new prefix (the same pause as the amber dropdowns). */
const TYPEAHEAD_IDLE_MS = 800

/**
 * The index of the next row whose label starts with `query`, case insensitive (U09). A prefix of one
 * letter, or one letter typed again and again, searches from just after `from` and wraps, so repeating it
 * cycles every row that starts with it; a longer prefix keeps the row it is on when that still matches.
 * `labelAt` is null for a row that cannot match (a section heading). -1 when nothing matches.
 */
export function typeaheadRow(count: number, labelAt: (index: number) => string | null, query: string, from: number): number {
  if (query === '' || count === 0) return -1
  const repeated = query.length > 1 && [...query].every((c) => c === query[0])
  const needle = (repeated ? query[0]! : query).toLowerCase()
  const first = query.length > 1 && !repeated ? 0 : 1
  for (let step = first; step < count + first; step += 1) {
    const i = (((from + step) % count) + count) % count
    if (labelAt(i)?.toLowerCase().startsWith(needle)) return i
  }
  return -1
}

/** A single printable character with no chord modifier: what builds the type-ahead prefix. Space is left to marking. */
function isTypeaheadKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
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

/** The numbered data rows between a heading (just after display index `i`) and the next one: their
 * first and last `N)` numbers, or null when the heading has none (U26). */
function headingSpan<Row extends RowData>(display: readonly DisplayRow<Row>[], i: number): { readonly first: number; readonly last: number } | null {
  let first: number | null = null
  let last: number | null = null
  for (let j = i + 1; j < display.length; j += 1) {
    const row = display[j]!
    if (row.kind === 'group') break
    if (row.n === null) continue
    first ??= row.n
    last = row.n
  }
  return first === null || last === null ? null : { first, last }
}

/** Number <GO> items: a row number selects and opens its row; a section number selects its section
 * and says what it holds, e.g. '1) Equity is a heading: rows 10 to 12.' (U26), so a numbered select
 * on a heading is never silent. */
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
      if (d.kind === 'group') {
        const { n, label } = d
        const span = headingSpan(display, i)
        items.push({
          n,
          label,
          run: () => {
            select(i)
            postMessage(span ? fillCopy(GRID.headingNumber, { n, label, first: span.first, last: span.last }) : fillCopy(GRID.headingNumberEmpty, { n, label }))
          },
        })
      } else items.push({ n: d.n, label: labelOf(d.row), run: () => { select(i); open(d.row) } })
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
          const hint = c.hint ?? COLUMN_HINTS[c.header]
          const th = (
            <th
              key={c.id}
              scope="col"
              id={ids.header(i + offset)}
              className={[c.kind === 'num' ? 'num' : '', isActive(i + offset) ? 'is-active' : ''].filter(Boolean).join(' ') || undefined}
              aria-sort={sorted}
              data-hint={hint}
              onClick={() => onSort(i + offset)}
            >
              {c.header}
              {sorted ? <span className="sort-mark" aria-hidden="true">{sorted === 'ascending' ? ' ▲' : ' ▼'}</span> : null}
            </th>
          )
          return hint ? <Tooltip key={c.id} text={hint}>{th}</Tooltip> : th
        })}
      </tr>
    </thead>
  )
}

/** What a marked row shows besides its fill, so colour is never the only cue: an ASCII plus for the
 * eye (hidden from screen readers) and the word for them. */
function MarkCue() {
  return (
    <>
      <span className="mark-glyph" aria-hidden="true">{GRID.markGlyph}</span>
      <span className="sr-only">{GRID.marked}</span>
    </>
  )
}

interface RowProps<Row extends RowData> {
  readonly d: DisplayRow<Row>
  readonly index: number
  readonly columns: readonly MonitorColumn<Row>[]
  readonly numbered: boolean
  readonly ids: Ids
  readonly active: GridPos
  readonly marked: boolean
  readonly rowClassName?: (row: Row) => string | undefined
  readonly onPick: (pos: GridPos) => void
  readonly onOpen: (row: Row, options?: OpenOptions) => void
}

function GridRow<Row extends RowData>({ d, index, columns, numbered, ids, active, marked, rowClassName, onPick, onOpen }: RowProps<Row>) {
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
    <tr role="row" className={rowClassName?.(row)} aria-rowindex={index + 2} aria-selected={onRow} data-marked={marked ? 'true' : undefined} onDoubleClick={(e) => (e.shiftKey ? onOpen(row, NEW_PANEL) : onOpen(row))}>
      {numbered ? (
        <td role="gridcell" id={ids.cell(index, 0)} className={`hot${onRow && active.col === 0 ? ' is-active' : ''}`} onMouseDown={pick(0)}>
          <span>
            {marked ? <MarkCue /> : null}
            {d.n === null ? '' : fillCopy(GRID.number, { n: d.n })}
          </span>
        </td>
      ) : null}
      {columns.map((c, i) => (
        <td role="gridcell" key={c.id} id={ids.cell(index, i + offset)} className={cellClass(c, row, onRow && active.col === i + offset) || undefined} onMouseDown={pick(i + offset)}>
          {marked && !numbered && i === 0 ? <MarkCue /> : null}
          {c.render ? c.render(row) : cellText(c, row)}
        </td>
      ))}
    </tr>
  )
}

/** Column widths that fit every numeric value and every header (see columnWidth). */
function useColumnWidths<Row extends RowData>(columns: readonly MonitorColumn<Row>[], rows: readonly Row[]): string[] {
  return useMemo(
    () => columns.map((c) => columnWidth(c.width, c.kind, c.header, c.kind === 'num' ? rows.map((r) => cellText(c, r)) : [])),
    [columns, rows],
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
  const { label, rows, columns, rowId, groupOf, numbered = true, onOpen, rowClassName, initialSort, emptyText, marked, onMark } = props
  const base = useId()
  const ids = useMemo(() => makeIds(base), [base])
  const hintId = `${base}-hint`
  const { sorted, sort, toggleSort, groupOrder } = useSortedRows(rows, columns, rowId, initialSort, groupOf)
  const display = useMemo(() => buildDisplayRows(sorted, { rowId, numbered, groupOf, groupOrder }), [sorted, rowId, numbered, groupOf, groupOrder])
  const colCount = columns.length + (numbered ? 1 : 0)
  const win = useGridWindow(display, props.scroll)
  const { scrollToRow } = win
  const [rawActive, setActive] = useState<GridPos>({ row: 0, col: 0 })
  const active = clampPos(rawActive, display.length, colCount)
  const reveal = useRef(false)

  // A plain press passes the row alone; only Shift adds the option (G20), so an onOpen written for one argument sees no change.
  const openWith = useCallback((row: Row, options?: OpenOptions) => (options ? onOpen?.(row, options) : onOpen?.(row)), [onOpen])
  const open = useCallback((row: Row) => openWith(row), [openWith])
  const select = useCallback((index: number) => {
    setActive((p) => ({ row: index, col: p.col }))
    scrollToRow(index)
  }, [scrollToRow])
  const labelOf = useCallback((row: Row) => (props.rowLabel ? props.rowLabel(row) : columns[0] ? cellText(columns[0], row) : rowId(row)), [props.rowLabel, columns, rowId])
  const items = useNumberedRows(display, labelOf, select, open)
  const panel = usePanelActions()
  useNumbered(props.panelId ?? panel.panelId, `grid${base}`, items)

  const typed = useRef({ text: '', at: 0 })
  /** Adds a key to the prefix (a pause starts a new one) and finds the row it names. */
  const typeahead = (key: string): number => {
    const now = Date.now()
    typed.current = { text: now - typed.current.at > TYPEAHEAD_IDLE_MS ? key : typed.current.text + key, at: now }
    const labelAt = (i: number) => {
      const d = display[i]
      return d?.kind === 'data' ? labelOf(d.row) : null
    }
    return typeaheadRow(display.length, labelAt, typed.current.text, active.row)
  }

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
        if (d?.kind === 'data') openWith(d.row, e.shiftKey ? NEW_PANEL : undefined)
      }
      return
    }
    // Space marks only when the screen listens, on a data row, and only a plain press: Control and Shift
    // with Space belong to the browser and the input method. A held key repeats keydown and must not
    // flip the mark back and forth, though the page still must not scroll.
    if (e.key === ' ' && onMark && !e.ctrlKey && !e.shiftKey) {
      const d = active.row === HEADER_ROW ? undefined : display[active.row]
      if (d?.kind !== 'data') return
      e.preventDefault()
      if (!e.repeat) onMark(d.row)
      return
    }
    if (isTypeaheadKey(e)) {
      const at = typeahead(e.key)
      if (at === -1) return
      e.preventDefault()
      reveal.current = true
      setActive({ row: at, col: active.col })
      win.scrollToRow(at)
      return
    }
    // A tab stop grid has controls above it: ArrowUp on its header row (no row above to move to) is the panel's.
    if (props.tabStop && e.key === 'ArrowUp' && active.row === HEADER_ROW) return
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
    const cell = document.getElementById(current)
    revealColumn(cell)
    // U08 and U03: keyboard users have no hover, so a body cell cut to an ellipsis, or a header with a hint, is read out on the message line.
    if (cell?.tagName === 'TD' && isCut(cell)) postMessage((cell.textContent ?? '').trim())
    else if (cell?.tagName === 'TH' && cell.dataset.hint) postMessage(cell.dataset.hint)
  }, [current, revealColumn])
  const titleCutCell = useCallback((e: MouseEvent<HTMLTableElement>) => {
    const cell = e.target instanceof Element ? e.target.closest('td') : null
    if (cell) syncCellTitle(cell)
  }, [])
  const maxNumber = items.reduce((m, i) => Math.max(m, i.n), 1)
  const widths = useColumnWidths(columns, rows)

  return (
    <div className="nqt-grid-wrap">
      <span id={hintId} className="sr-only">{[GRID.keysHint, onOpen ? GRID.openHint : null, onMark ? GRID.markHint : null].filter(Boolean).join(' ')}</span>
      <div ref={win.scrollRef} className={props.scroll === 'panel' ? 'nqt-grid-scroll nqt-grid-scroll--panel' : 'nqt-grid-scroll'}>
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
          onMouseOver={titleCutCell}
          {...(props.scroll === 'panel' ? roving : rovingOwnScroll)}
          {...(props.tabStop ? entry : null)}
        >
          <colgroup>
            {numbered ? <col style={{ width: `${numberWidthEm(maxNumber)}em` }} /> : null}
            {columns.map((c, i) => <col key={c.id} style={{ width: widths[i] }} />)}
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
              const isMarked = d.kind === 'data' && marked?.has(rowId(d.row)) === true
              return <GridRow key={d.key} d={d} index={item.index} columns={columns} numbered={numbered} ids={ids} active={active} marked={isMarked} rowClassName={rowClassName} onPick={setActive} onOpen={openWith} />
            })}
            {win.spacer.bottom > 0 ? <tr aria-hidden="true" className="nqt-grid-spacer"><td colSpan={colCount} style={{ height: `${win.spacer.bottom}px` }} /></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

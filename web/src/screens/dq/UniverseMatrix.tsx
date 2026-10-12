// DQ universe matrix (research_ux item 3): every root by year 2010 to 2021, for 1m (vendor, and repaired where the
// repair passed) and 1d: the share of NYSE sessions that are usable, the first and last bar from the QA report (a
// last bar past the fence is only said to be sealed), the repair status and the known blocks in the records' words.
// Records only; no price is read. A real grid: one tab stop, arrow keys, Home and End, Page Up and Page Down; each
// cell has its counts as its accessible name and in the readout, so a screen reader never depends on the fill.
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ROVING_ATTR, ROVING_ENTRY_ATTR } from '../../chrome/WorkspaceFocus'
import { DQ } from '../../copy/dq'
import { fillCopy } from '../../copy/workspace'
import { gridStep, matrixColumns, matrixRows, universeSummary, type DqUniverse, type GridPos, type MatrixCell } from './universeModel'

const BAR_HEIGHT = 3
// Every cell is a roving item of the panel (chrome/WorkspaceFocus.ts), and the active cell is its entry (U09, as REG's grid is):
// the workspace takes every other focusable out of the Tab order, so without these marks the grid has no Tab stop at all.
const roving = { [ROVING_ATTR]: '' }
const entry = { [ROVING_ENTRY_ATTR]: '' }
const SCROLL: CSSProperties = { overflow: 'auto', margin: '0 6px', maxWidth: '100%' }
const TABLE: CSSProperties = { margin: 0, width: 'max-content', minWidth: '100%' }
const WORDS: CSSProperties = { minWidth: 320, maxWidth: 560, whiteSpace: 'normal', lineHeight: '1.3' }
const BOUND: CSSProperties = { minWidth: 110, whiteSpace: 'normal', lineHeight: '1.3' }
const SHARE: CSSProperties = { textAlign: 'right', minWidth: 56 }
const BAR_TRACK: CSSProperties = { display: 'block', height: BAR_HEIGHT, marginTop: 1 }

function cellStyle(cell: MatrixCell, col: number): CSSProperties {
  if (cell.kind === 'share') return SHARE
  if (cell.kind === 'words') return WORDS
  return col === 3 || col === 4 ? BOUND : {}
}

interface CellProps {
  readonly cell: MatrixCell
  readonly col: number
  readonly active: boolean
  readonly setRef: (el: HTMLTableCellElement | null) => void
  readonly onFocus: () => void
}

function Cell({ cell, col, active, setRef, onFocus }: CellProps) {
  const common = { ref: setRef, tabIndex: active ? 0 : -1, 'aria-label': cell.description, onFocus, style: cellStyle(cell, col), ...roving, ...(active ? entry : {}) }
  const bar = cell.share === null ? null : (
    <span aria-hidden="true" style={{ ...BAR_TRACK, width: `${Math.round(cell.share * 100)}%`, background: 'var(--cvd-up)' }} />
  )
  if (cell.kind === 'root') return <th scope="row" role="rowheader" {...common}>{cell.text}</th>
  return <td role="gridcell" {...common}>{cell.text}{bar}</td>
}

export interface UniverseMatrixProps {
  readonly universe: DqUniverse
}

export default function UniverseMatrix({ universe }: UniverseMatrixProps) {
  const headingId = useId()
  const rows = useMemo(() => matrixRows(universe), [universe])
  const columns = useMemo(() => matrixColumns(universe), [universe])
  const [pos, setPos] = useState<GridPos>({ row: 0, col: 0 })
  const [readout, setReadout] = useState('')
  const cells = useRef(new Map<string, HTMLTableCellElement>())
  const keyOf = (p: GridPos) => `${p.row}:${p.col}`
  const describe = (p: GridPos) => rows[p.row]?.cells[p.col]?.description ?? ''
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    // U09: the active cell is the panel's entry item, with the DQ tabs and the Actions bar above it. ArrowUp on the first
    // row has no row to move to, so it is left alone for the panel to step back to the control above (as MonitorGrid's tabStop).
    if (event.key === 'ArrowUp' && pos.row === 0) return
    const next = gridStep(pos, event.key, rows.length, columns.length)
    if (next === null) return
    event.preventDefault()
    setPos(next)
    cells.current.get(keyOf(next))?.focus()
  }
  const focusCell = (p: GridPos) => {
    setPos(p)
    setReadout(describe(p))
  }
  return (
    <>
      <p className="mkt-tag dq-label">{universe.label}</p>
      <h2 id={headingId} className="dq-heading">{DQ.universe.heading}</h2>
      <p className="dq-note">{universeSummary(universe)}</p>
      <p className="dq-note">{DQ.universe.legend}</p>
      <div style={SCROLL}>
        <table className="dq-table" role="grid" aria-labelledby={headingId} aria-rowcount={rows.length + 1} aria-colcount={columns.length} style={TABLE} onKeyDown={onKeyDown}>
          <thead>
            <tr>
              {columns.map((label, c) => <th key={label + c} scope="col" role="columnheader" className={c >= 5 && c < columns.length - 1 ? 'num' : undefined}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id}>
                {row.cells.map((cell, c) => (
                  <Cell
                    key={columns[c] ?? c}
                    cell={cell}
                    col={c}
                    active={pos.row === r && pos.col === c}
                    setRef={(el) => { if (el) cells.current.set(keyOf({ row: r, col: c }), el); else cells.current.delete(keyOf({ row: r, col: c })) }}
                    onFocus={() => focusCell({ row: r, col: c })}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dq-selected-line" role="status">{readout || DQ.universe.readoutEmpty}</p>
      {universe.missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(DQ.universe.missing, { files: universe.missing.join(', ') })}</p> : null}
      <div className="mkt-notes">
        <p>{fillCopy(DQ.fenceNote, { fence: universe.fence })}</p>
        <p>{DQ.universe.keys}</p>
      </div>
    </>
  )
}

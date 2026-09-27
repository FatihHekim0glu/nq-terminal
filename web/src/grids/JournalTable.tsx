// JournalTable (TASKS 5.4, UI_SPEC sections 6 and 7, look spec 7.11): the paper book's journal rows in
// a MonitorGrid, newest first and numbered. Plumbing rows are hatched and carry the exact banner the
// API sends (`paper_plumbing.BANNER`) before their summary, with the source code PLMB; performance
// rows show LIVE. The banner is text, so the hatch is never the only cue. Columns follow look spec 7.11:
// date, event, summary, the source code, then the time at the right edge, amber and right-aligned.
import { useMemo } from 'react'
import { JOURNAL } from '../copy/grids'
import { fillCopy } from '../copy/workspace'
import MonitorGrid, { type MonitorColumn } from './MonitorGrid'
import type { GridScroll } from './MonitorGrid.window'
import { journalLine, type JournalLine, type JournalRow } from './JournalTable.model'

export interface JournalTableProps {
  readonly rows: readonly JournalRow[]
  /** The journal file (or files) shown; names the grid. */
  readonly file: string
  /** Newest first (default) or file order. */
  readonly order?: 'newest' | 'oldest'
  readonly onOpen?: (row: JournalRow) => void
  readonly emptyText?: string
  readonly panelId?: string
  /** `panel`: the panel body scrolls the rows (JRNL), so it stays the panel's one Tab stop (MonitorGrid). */
  readonly scroll?: GridScroll
}

interface Entry {
  readonly line: JournalLine
  readonly row: JournalRow
}

function Summary({ line }: { readonly line: JournalLine }) {
  if (line.banner === null) return <>{line.summary}</>
  return (
    <>
      <span className="plumbing-banner">{line.banner}</span> {line.summary}
    </>
  )
}

const COLUMNS: MonitorColumn<Entry>[] = [
  { id: 'date', header: JOURNAL.colDate, width: 100, kind: 'name', value: (e) => e.line.date },
  { id: 'type', header: JOURNAL.colType, width: 110, kind: 'name', value: (e) => e.line.type },
  {
    id: 'summary', header: JOURNAL.colSummary, width: 760, kind: 'text',
    value: (e) => (e.line.banner ? `${e.line.banner} ${e.line.summary}` : e.line.summary),
    render: (e) => <Summary line={e.line} />,
  },
  { id: 'source', header: JOURNAL.colSource, width: 56, kind: 'text', value: (e) => e.line.source, render: (e) => <span className="src">{e.line.source}</span> },
  { id: 'time', header: JOURNAL.colTime, width: 84, kind: 'num', value: (e) => e.line.time, render: (e) => <span className="time">{e.line.time ?? '--'}</span> },
]

const entryId = (e: Entry) => e.line.key
const entryLabel = (e: Entry) => `${e.line.date} ${e.line.type}`
const plumbingClass = (e: Entry) => (e.line.plumbing ? 'plumbing-row' : undefined)

export default function JournalTable({ rows, file, order = 'newest', onOpen, emptyText, panelId, scroll }: JournalTableProps) {
  const entries = useMemo(() => {
    const list = rows.map((row) => ({ row, line: journalLine(row) }))
    return order === 'newest' ? list.reverse() : list
  }, [rows, order])
  const open = useMemo(() => (onOpen ? (e: Entry) => onOpen(e.row) : undefined), [onOpen])
  return (
    <MonitorGrid
      label={fillCopy(JOURNAL.label, { file })}
      rows={entries}
      columns={COLUMNS}
      rowId={entryId}
      rowLabel={entryLabel}
      rowClassName={plumbingClass}
      onOpen={open}
      emptyText={emptyText ?? JOURNAL.empty}
      panelId={panelId}
      {...(scroll ? { scroll } : {})}
    />
  )
}

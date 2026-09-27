// The journals under live/logs with their row counts by class (LV1, LV3), plus every expected journal
// not written yet with its empty-state text naming the file. A plumbing journal carries [PLUMBING].
import { useMemo } from 'react'
import { LIVE } from '../../copy/live'
import PlainTable, { type PlainColumn } from './PlainTable'
import type { LiveStatus } from './liveModel'

interface JournalLine {
  readonly name: string
  readonly rows: number | null
  readonly plumbingRows: number | null
  readonly performanceRows: number | null
  readonly lastType: string | null
  readonly lastDate: string | null
  readonly badLines: number | null
  readonly plumbing: boolean
  /** The empty-state text of an expected journal that is not on disk. */
  readonly emptyState: string | null
}

function lines(s: LiveStatus): JournalLine[] {
  const written = s.journals.map((j) => ({
    name: j.name, rows: j.rows, plumbingRows: j.plumbing_rows, performanceRows: j.performance_rows, lastType: j.last_type,
    lastDate: j.last_date, badLines: j.bad_lines, plumbing: j.plumbing, emptyState: null,
  }))
  const names = new Set(written.map((w) => w.name))
  const missing = s.expected.filter((e) => !e.present && !names.has(e.name)).map((e) => ({
    name: e.name, rows: null, plumbingRows: null, performanceRows: null, lastType: null, lastDate: null, badLines: null,
    plumbing: false, emptyState: e.empty_state,
  }))
  return [...written, ...missing]
}

function Name({ line }: { readonly line: JournalLine }) {
  return (
    <>
      {line.name}
      {line.plumbing ? <> <span className="live-plumbing-tag">{LIVE.plumbingTag}</span></> : null}
      {line.emptyState ? <> <span className="live-empty-state">{line.emptyState}</span></> : null}
    </>
  )
}

const count = (n: number | null) => (n === null ? LIVE.none : String(n))

const COLUMNS: PlainColumn<JournalLine>[] = [
  { id: 'name', header: LIVE.colJournal, width: 700, kind: 'name', text: (l) => <Name line={l} /> },
  { id: 'rows', header: LIVE.colRows, width: 56, kind: 'num', text: (l) => count(l.rows) },
  { id: 'plumbing', header: LIVE.colPlumbingRows, width: 76, kind: 'num', text: (l) => count(l.plumbingRows) },
  { id: 'performance', header: LIVE.colPerformanceRows, width: 100, kind: 'num', text: (l) => count(l.performanceRows) },
  { id: 'lastType', header: LIVE.colLastType, width: 110, kind: 'text', text: (l) => l.lastType ?? LIVE.none },
  { id: 'lastDate', header: LIVE.colLastDate, width: 96, kind: 'text', text: (l) => l.lastDate ?? LIVE.none },
  { id: 'bad', header: LIVE.colBadLines, width: 76, kind: 'num', text: (l) => count(l.badLines), tone: (l) => ((l.badLines ?? 0) > 0 ? 'down' : undefined) },
]

const lineId = (l: JournalLine) => l.name
const plumbingClass = (l: JournalLine) => (l.plumbing ? 'plumbing-row' : undefined)

export default function JournalsGrid({ status }: { readonly status: LiveStatus }) {
  const rows = useMemo(() => lines(status), [status])
  return (
    <PlainTable label={LIVE.journalsLabel} rows={rows} columns={COLUMNS} rowId={lineId} rowClassName={plumbingClass} emptyText={LIVE.none} />
  )
}

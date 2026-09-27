// The access log table (look spec 7.10, ECO layout): newest first, days banded black and #1E1E1E, an
// alert flag on sealed reads and reads past the fence, and the result in words (served [IS], PAST
// FENCE, SEALED READ), so the flag is never the only cue.
import { useCallback, useMemo } from 'react'
import { OOS } from '../../copy/oos'
import MonitorGrid, { type MonitorColumn } from '../../grids/MonitorGrid'
import { dayBandLines, entryResult, entryTime, resultText, windowText, type OosEntry } from './oosModel'

function Alert({ e }: { readonly e: OosEntry }) {
  const result = entryResult(e)
  if (result === 'served') return null
  return (
    <>
      <span className={result === 'sealed' ? 'oos-flag oos-flag-sealed' : 'oos-flag'} aria-hidden="true">{OOS.alertGlyph}</span>
      <span className="sr-only">{result === 'sealed' ? OOS.alertSealed : OOS.alertPast}</span>
    </>
  )
}

function Result({ e }: { readonly e: OosEntry }) {
  const result = entryResult(e)
  return <span className={`oos-result oos-result-${result}`}>{resultText(result)}</span>
}

const COLUMNS: MonitorColumn<OosEntry>[] = [
  { id: 'time', header: OOS.colTime, width: 150, kind: 'name', value: (e) => e.ts_utc, format: entryTime },
  { id: 'alert', header: OOS.colAlert, width: 22, kind: 'text', value: (e) => entryResult(e), render: (e) => <Alert e={e} />, sortable: false },
  { id: 'caller', header: OOS.colCaller, width: 150, kind: 'name', value: (e) => e.caller },
  { id: 'reason', header: OOS.colReason, width: 400, kind: 'text', value: (e) => e.reason },
  { id: 'symbol', header: OOS.colSymbol, width: 80, kind: 'text', value: (e) => e.symbol },
  { id: 'tf', header: OOS.colTimeframe, width: 36, kind: 'text', value: (e) => e.timeframe },
  { id: 'variant', header: OOS.colVariant, width: 72, kind: 'text', value: (e) => e.variant },
  { id: 'window', header: OOS.colWindow, width: 180, kind: 'num', value: (e) => e.start, format: windowText },
  { id: 'rows', header: OOS.colRows, width: 90, kind: 'num', value: (e) => e.rows, format: (e) => (e.rows === null ? '--' : e.rows.toLocaleString('en-GB')) },
  { id: 'result', header: OOS.colResult, width: 110, kind: 'text', value: (e) => entryResult(e), render: (e) => <Result e={e} /> },
]

const rowId = (e: OosEntry) => String(e.line_no)
const rowLabel = (e: OosEntry) => `${entryTime(e)} ${e.caller}`

export interface OosLogGridProps {
  /** Entries in display order (newest first). */
  readonly rows: readonly OosEntry[]
  readonly emptyText: string
  readonly panelId?: string
}

export default function OosLogGrid({ rows, emptyText, panelId }: OosLogGridProps) {
  const banded = useMemo(() => dayBandLines(rows), [rows])
  const rowClassName = useCallback((e: OosEntry) => (banded.has(e.line_no) ? 'oos-day-band' : undefined), [banded])
  return (
    <MonitorGrid
      label={OOS.gridLabel}
      rows={rows}
      columns={COLUMNS}
      rowId={rowId}
      rowLabel={rowLabel}
      rowClassName={rowClassName}
      emptyText={emptyText}
      panelId={panelId}
    />
  )
}

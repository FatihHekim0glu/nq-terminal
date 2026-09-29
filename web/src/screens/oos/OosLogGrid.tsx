// The access log table (look spec 7.10, ECO layout): newest first, days banded black and #1E1E1E, the
// API's alert flag (A: a sealed read or a window the gate would refuse), its house severity as a bar of
// 1 to 4 steps (R), and the result in words (served [IS], PAST FENCE, SEALED READ), so neither the flag
// nor the bar is ever the only cue. U07: the A and R headers carry the house tooltip (what the flag and the 1 to 4
// bar mean). The subtitle that spells out 'out-of-sample' belongs to the screen (OosScreen), so it shows in every
// view, not only here.
import { useCallback, useMemo } from 'react'
import { useHypotheses } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { postMessage } from '../../chrome/MessageLine.store'
import { OOS_ROW } from '../../copy/grids'
import { OOS } from '../../copy/oos'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn, type OpenOptions } from '../../grids/MonitorGrid'
import type { Schemas } from '../../api/types'
import {
  SEVERITY_MAX, alertText, dayBandLines, entryResult, entryTime, resultText, severitySteps, severityText, windowText, type OosEntry,
} from './oosModel'

function Alert({ e }: { readonly e: OosEntry }) {
  const text = alertText(e)
  if (text === null) return null
  return (
    <>
      <span className={e.is_sealed ? 'oos-flag oos-flag-sealed' : 'oos-flag'} aria-hidden="true">{OOS.alertGlyph}</span>
      <span className="sr-only">{text}</span>
    </>
  )
}

const STEPS = Array.from({ length: SEVERITY_MAX }, (_, i) => i + 1)

function Severity({ e, levels }: { readonly e: OosEntry; readonly levels: readonly Schemas['SeverityLevel'][] }) {
  const n = severitySteps(e)
  return (
    <span className={`oos-sev oos-sev-${n}`}>
      <span aria-hidden="true">{STEPS.map((s) => <span key={s} className={s <= n ? 'oos-sev-step on' : 'oos-sev-step'} />)}</span>
      <span className="sr-only">{severityText(e, levels)}</span>
    </span>
  )
}

function Result({ e }: { readonly e: OosEntry }) {
  const result = entryResult(e)
  return <span className={`oos-result oos-result-${result}`}>{resultText(result)}</span>
}

function oosColumns(levels: readonly Schemas['SeverityLevel'][]): MonitorColumn<OosEntry>[] {
  return [
  { id: 'time', header: OOS.colTime, width: 150, kind: 'name', value: (e) => e.ts_utc, format: entryTime },
  { id: 'alert', header: OOS.colAlert, width: 22, kind: 'text', value: (e) => (e.alert ? 1 : 0), format: (e) => alertText(e) ?? '', render: (e) => <Alert e={e} />, sortable: false, hint: OOS.hintAlert },
  // A text column, so its width is its own 44px (a number column widens to its longest text); the level
  // in words is inside the cell for assistive technology.
  { id: 'severity', header: OOS.colSeverity, width: 44, kind: 'text', value: (e) => e.severity, format: (e) => String(severitySteps(e)), render: (e) => <Severity e={e} levels={levels} />, hint: OOS.hintSeverity },
  { id: 'caller', header: OOS.colCaller, width: 150, kind: 'name', value: (e) => e.caller },
  { id: 'reason', header: OOS.colReason, width: 400, kind: 'text', value: (e) => e.reason },
  { id: 'symbol', header: OOS.colSymbol, width: 80, kind: 'text', value: (e) => e.symbol },
  { id: 'tf', header: OOS.colTimeframe, width: 36, kind: 'text', value: (e) => e.timeframe },
  { id: 'variant', header: OOS.colVariant, width: 72, kind: 'text', value: (e) => e.variant },
  { id: 'window', header: OOS.colWindow, width: 180, kind: 'num', value: (e) => e.start, format: windowText },
  { id: 'rows', header: OOS.colRows, width: 90, kind: 'num', value: (e) => e.rows, format: (e) => (e.rows === null ? '--' : e.rows.toLocaleString('en-GB')) },
  { id: 'result', header: OOS.colResult, width: 110, kind: 'text', value: (e) => entryResult(e), render: (e) => <Result e={e} /> },
  ]
}

const rowId = (e: OosEntry) => String(e.line_no)
const rowLabel = (e: OosEntry) => `${entryTime(e)} ${e.caller}`

export interface OosLogGridProps {
  /** Entries in display order (newest first). */
  readonly rows: readonly OosEntry[]
  readonly emptyText: string
  readonly panelId?: string
  /** The API's house severity levels (OosLog.severity_levels). */
  readonly levels: readonly Schemas['SeverityLevel'][]
}

export default function OosLogGrid({ rows, emptyText, panelId, levels }: OosLogGridProps) {
  const banded = useMemo(() => dayBandLines(rows), [rows])
  const columns = useMemo(() => oosColumns(levels), [levels])
  const rowClassName = useCallback((e: OosEntry) => (banded.has(e.line_no) ? 'oos-day-band' : undefined), [banded])
  // G19: Enter, Shift+Enter and Number <GO> on a row open the caller's DES when the caller is a registered
  // hypothesis (the callers are amber like every name column), and otherwise read the entry's full reason
  // out; until the hypotheses are known, or if they cannot be read, every caller reads its reason.
  const hypotheses = useHypotheses().data
  const registered = useMemo(() => new Set((hypotheses ?? []).map((h) => h.name)), [hypotheses])
  const onOpen = useCallback(
    (e: OosEntry, options?: OpenOptions) => {
      if (registered.has(e.caller)) requestLine(`${e.caller} DES`, options?.newPanel ?? false)
      else postMessage(fillCopy(OOS_ROW.detail, { caller: e.caller, reason: e.reason }))
    },
    [registered],
  )
  return (
    <MonitorGrid
      label={OOS.gridLabel}
      rows={rows}
      columns={columns}
      rowId={rowId}
      rowLabel={rowLabel}
      rowClassName={rowClassName}
      onOpen={onOpen}
      emptyText={emptyText}
      panelId={panelId}
    />
  )
}

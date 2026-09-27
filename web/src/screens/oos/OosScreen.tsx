// OOS: the gate access log and the sealed-window openings (TASKS 7.3; UI_SPEC section 7 OOS; look spec
// 7.10; ANALYTICS_CATALOG RI2). Read only: two GETs (/api/audit/oos-log, /api/audit/openings).
//
//   red bar      [Caller ▾] 96) Actions 98) Export                          Gate access log
//   param row    Since [YYYY-MM-DD]  View [Log | Timeline]   Terminal reads n  Sealed reads n  ...
//   card         Openings: opened 2026-09-26 by user CLOSED ... pins ... [SPENT]
//   body         the log table (newest first, days banded) or the swimlane timeline by caller
//
// Counts describe the whole log (the API's own totals); the table and the timeline show the matching
// entries, newest first, up to the API's page limit. View Pivot opens the same entries in the Perspective
// pivot grid (TASKS 9.1), grouped by caller.
import { useMemo, useState } from 'react'
import { useOosLog } from '../../api/queries'
import { Swimlane } from '../../charts/echarts/Swimlane'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import { ToggleGroup } from '../../chrome/Field.buttons'
import FunctionBar from '../../chrome/FunctionBar'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { OOS } from '../../copy/oos'
import { PIVOT } from '../../copy/perspective'
import { FUNCTION_BAR, FUNCTION_NUMBERS, fillCopy } from '../../copy/workspace'
import { saveText } from '../../chrome/download'
import { OosPivot } from '../../perspective'
import OosLogGrid from './OosLogGrid'
import OpeningsCard from './OpeningsCard'
import { actionsItem } from './panelMenu'
import { callerOptions, entriesCsv, newestFirst, severityLegend, sinceValid, swimlaneData, type OosLog } from './oosModel'
import './oos.css'

type View = 'log' | 'timeline' | 'pivot'

/** The API's largest page (ARCHITECTURE section 4): the newest 5,000 matching entries. */
const MAX_PAGE = 5000

const VIEWS = [
  { value: 'log', label: OOS.viewLog },
  { value: 'timeline', label: OOS.viewTimeline },
  { value: 'pivot', label: PIVOT.pivot },
] as const

function Counts({ log }: { readonly log: OosLog | undefined }) {
  if (!log) return null
  return (
    <span className="oos-counts" role="group" aria-label={OOS.countsLabel}>
      <span className="oos-count-key">{fillCopy(OOS.terminalReads, { n: log.terminal_reads })}</span>
      <span>{fillCopy(OOS.sealedReads, { n: log.sealed_reads })}</span>
      <span>{fillCopy(OOS.totalReads, { n: log.total })}</span>
      <span>{fillCopy(OOS.matched, { n: log.matched })}</span>
    </span>
  )
}

/** The R column's house levels (from the API) with their counts over the whole log. */
function SeverityLegend({ log }: { readonly log: OosLog }) {
  const items = useMemo(() => severityLegend(log.severity_levels, log.severity_counts), [log.severity_levels, log.severity_counts])
  if (items.length === 0) return null
  return (
    <div className="oos-legend">
      <span className="oos-legend-title" aria-hidden="true">{OOS.severityLegendTitle}</span>
      <ul aria-label={OOS.severityLegendLabel}>
        {items.map((i) => <li key={i.level} className={`oos-sev-${i.level}`}>{i.text}</li>)}
      </ul>
    </div>
  )
}

function Notes({ log }: { readonly log: OosLog }) {
  const notes: string[] = []
  if (log.returned < log.matched) notes.push(fillCopy(OOS.showing, { shown: log.returned, matched: log.matched }))
  if (log.partial_tail) notes.push(OOS.partialTail)
  if (notes.length === 0 && log.parse_errors.length === 0) return null
  return (
    <p className="oos-notes">
      {log.parse_errors.length > 0 ? <span className="oos-exc">{fillCopy(OOS.parseErrors, { n: log.parse_errors.length })}</span> : null}
      {notes.map((n) => <span key={n}>{n}</span>)}
    </p>
  )
}

interface BodyProps {
  readonly log: OosLog
  readonly view: View
  readonly lanes: readonly string[]
  readonly panelId: string
}

function Body({ log, view, lanes, panelId }: BodyProps) {
  const rows = useMemo(() => newestFirst(log.entries), [log.entries])
  const timeline = useMemo(() => swimlaneData(log.entries, lanes), [log.entries, lanes])
  const empty = log.log_present ? OOS.empty : OOS.noLog
  if (view === 'log') return <OosLogGrid rows={rows} emptyText={empty} panelId={panelId || undefined} levels={log.severity_levels} />
  if (view === 'pivot') return <div className="nqt-pivot-frame"><OosPivot entries={rows} /></div>
  if (log.entries.length === 0) return <p className="oos-message">{empty}</p>
  return (
    <div className="oos-timeline">
      {timeline.skipped > 0 ? <p className="oos-notes">{fillCopy(OOS.timelineSkipped, { n: timeline.skipped })}</p> : null}
      <Swimlane data={timeline.input} chartId="oos-swimlane" />
    </div>
  )
}

/** 98) Export: the shown entries, newest first, as a CSV download; nothing is requested. */
function exportEntries(log: OosLog | undefined): void {
  const entries = log ? newestFirst(log.entries) : []
  if (entries.length === 0) {
    postMessage(OOS.exportEmpty)
    return
  }
  const saved = saveText(OOS.exportFile, entriesCsv(entries))
  postMessage(saved ? fillCopy(OOS.exportDone, { n: entries.length }) : OOS.exportUnavailable)
}

export default function OosScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const [caller, setCaller] = useState('')
  const [sinceText, setSinceText] = useState('')
  const [since, setSince] = useState('')
  const [sinceBad, setSinceBad] = useState(false)
  const [view, setView] = useState<View>('log')
  const query = useOosLog({ caller: caller || undefined, since: since || undefined, limit: MAX_PAGE })
  const log = query.data
  const options = useMemo(() => callerOptions(log?.counts_by_caller ?? {}), [log?.counts_by_caller])
  const lanes = useMemo(() => options.slice(1).map((o) => o.value), [options])

  const submitSince = (value: string) => {
    const text = value.trim()
    const ok = sinceValid(text)
    setSinceBad(!ok)
    if (ok) setSince(text)
  }

  return (
    <div className="oos-screen">
      <FunctionBar
        panelId={actions.panelId}
        title={OOS.title}
        field={<DropdownField label={OOS.callerField} value={caller} options={options} onChange={setCaller} />}
        items={[
          actionsItem(actions),
          { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: () => exportEntries(log) },
        ]}
      />
      <ParamRow label={OOS.paramsLabel}>
        <AmberField label={OOS.sinceField} value={sinceText} placeholder={OOS.sincePlaceholder} width="116px" onChange={setSinceText} onSubmit={submitSince} />
        {sinceBad ? <span className="oos-invalid" role="status">{OOS.sinceInvalid}</span> : null}
        <span className="param-label">{OOS.viewLabel}</span>
        <ToggleGroup label={OOS.viewLabel} options={VIEWS} value={view} onChange={(v) => setView(v as View)} />
        <Counts log={log} />
      </ParamRow>
      <OpeningsCard />
      {log ? <Notes log={log} /> : null}
      {log ? <SeverityLegend log={log} /> : null}
      <div className="oos-body">
        {query.isError ? (
          <p className="oos-message" role="alert">{fillCopy(OOS.error, { detail: query.error.detail })}</p>
        ) : log ? (
          <Body log={log} view={view} lanes={lanes} panelId={actions.panelId} />
        ) : (
          <p className="oos-message">{OOS.loading}</p>
        )}
      </div>
    </div>
  )
}

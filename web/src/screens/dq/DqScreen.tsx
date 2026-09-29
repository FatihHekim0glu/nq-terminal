// DQ: data quality (ANALYTICS RI4 and RI5; UI_SPEC 7, look spec 4.4 and 4.8). Two sub-tabs under the red bar:
// 85) Calendar: the symbol's sessions to 2021-12-31 as a calendar heatmap of vendor, gated out, rejected,
//     rebuilt and unrepairable days (letters as well as fills), its table view by year, the flagged days in a
//     numbered grid (Number <GO> or Enter selects one: the heatmap outlines it and the line under it gives the
//     reason), and the symbol's per-year QA report counts;
// 86) Guard fingerprints: OK, MISMATCH or NO RECORD per guard group, in words, with both fingerprints.
// Every value comes from GETs under /api/dq, which read QA and repair records only; no price is read. The API's
// [POST HOC] label is shown verbatim. 98) Export saves the flagged days, or the guard table, as CSV.
import { useId, useMemo, useState } from 'react'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { csvFileName, exportCsv, toCsv } from '../../chrome/exportCsv'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { DQ } from '../../copy/dq'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn } from '../../grids/MonitorGrid'
import QueryStatus from '../mon/QueryStatus'
import { useDqCalendar, useDqGuards, useDqSymbols } from '../../api/queries.screens'
import CalendarHeatmap, { Legend } from './CalendarHeatmap'
import { flaggedCsv, flaggedDays, offCalendarDays, offCalendarText } from './model'
import type { DqCalendar, DqDay, DqQaYear, GuardGroup, GuardStatusReport } from './types'
import '../mon/market.css'
import './dq.css'

type DqTab = 'calendar' | 'guards'
const TABS: readonly DqTab[] = ['calendar', 'guards']
const FIRST_TAB = 85
const DEFAULT_SYMBOL = 'NQ.V.0'

const dayColumns: readonly MonitorColumn<DqDay>[] = [
  { id: 'date', header: DQ.colDate, width: 110, kind: 'name', value: (d) => d.date },
  { id: 'state', header: DQ.colState, width: 130, kind: 'text', value: (d) => DQ.states[d.state] },
  { id: 'reason', header: DQ.colReason, width: 620, kind: 'text', value: (d) => d.reason ?? '' },
]

const TONE = { OK: 'up', MISMATCH: 'down', 'NO RECORD': 'muted' } as const
const short = (sha: string | null) => (sha ? `${sha.slice(0, 12)}...` : '--')

const guardColumns: readonly MonitorColumn<GuardGroup>[] = [
  { id: 'name', header: DQ.colGroup, width: 210, kind: 'name', value: (g) => g.name },
  { id: 'status', header: DQ.colStatus, width: 110, kind: 'text', value: (g) => g.status, tone: (g) => TONE[g.status] },
  { id: 'keys', header: DQ.colKeys, width: 60, kind: 'num', value: (g) => g.keys },
  { id: 'live', header: DQ.colLive, width: 140, kind: 'text', value: (g) => g.live_sha256, format: (g) => short(g.live_sha256) },
  { id: 'recorded', header: DQ.colRecorded, width: 140, kind: 'text', value: (g) => g.recorded_sha256, format: (g) => short(g.recorded_sha256) },
  { id: 'record', header: DQ.colRecord, width: 360, kind: 'text', value: (g) => g.record },
]

function barItems(actions: PanelActions, onExport: () => void): FunctionBarItem[] {
  return [
    {
      n: FUNCTION_NUMBERS.actions,
      label: FUNCTION_BAR.actions,
      menu: [
        { label: PANEL.related, onSelect: () => actions.related() },
        { label: PANEL.back, onSelect: () => actions.back() },
        { label: PANEL.forward, onSelect: () => actions.forward() },
      ],
    },
    { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport },
  ]
}

const num = (v: number | null) => (v === null ? '--' : v.toLocaleString('en-GB'))

function QaYears({ calendar }: { readonly calendar: DqCalendar }) {
  const headingId = useId()
  if (calendar.qa_years.length === 0) return <p className="dq-note">{DQ.qaNone}</p>
  const cols: ReadonlyArray<[string, (y: DqQaYear) => number | null]> = [
    [DQ.colRows, (y) => y.rows], [DQ.colOhlc, (y) => y.ohlc_violations], [DQ.colDup, (y) => y.duplicate_ts],
    [DQ.colContracts, (y) => y.contract_changes], [DQ.colGaps, (y) => y.rth_days_with_gaps],
  ]
  return (
    <section className="dq-qa" aria-labelledby={headingId}>
      <h2 id={headingId} className="dq-heading">{DQ.qaHeading}</h2>
      <table className="dq-table" aria-labelledby={headingId}>
        <thead>
          <tr>
            <th scope="col">{DQ.colYear}</th>
            {cols.map(([label]) => <th key={label} scope="col" className="num">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {calendar.qa_years.map((y) => (
            <tr key={y.year}>
              <th scope="row">{y.year}</th>
              {cols.map(([label, get]) => <td key={label} className="num">{num(get(y))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dq-note">{fillCopy(DQ.qaSource, { source: calendar.qa_source ?? '--' })}</p>
    </section>
  )
}

function CalendarView({ calendar }: { readonly calendar: DqCalendar }) {
  const [selected, setSelected] = useState<DqDay | null>(null)
  const flagged = useMemo(() => flaggedDays(calendar.days), [calendar.days])
  const odd = useMemo(() => offCalendarDays(calendar.days, calendar.fence), [calendar.days, calendar.fence])
  const s = calendar.symbol
  return (
    <>
      <p className="mkt-tag dq-label">{calendar.label}</p>
      <Legend counts={s.counts} />
      <div className="dq-chart">
        <CalendarHeatmap symbol={s.symbol} days={calendar.days} counts={s.counts} fence={calendar.fence} selected={selected?.date ?? null} />
      </div>
      {odd.length > 0 ? <p className="dq-note" role="note">{offCalendarText(odd)}</p> : null}
      <p className="dq-selected-line" role="status">
        {selected ? fillCopy(DQ.selected, { date: selected.date, state: DQ.states[selected.state], reason: selected.reason ?? DQ.noReason }) : ''}
      </p>
      <h2 className="dq-heading">{fillCopy(DQ.flaggedHeading, { n: flagged.length.toLocaleString('en-GB') })}</h2>
      <div className="dq-grid">
        <MonitorGrid label={fillCopy(DQ.flaggedLabel, { symbol: s.symbol })} rows={flagged} columns={dayColumns} rowId={(d) => d.date} rowLabel={(d) => d.date} onOpen={setSelected} emptyText={DQ.flaggedEmpty} />
      </div>
      <QaYears calendar={calendar} />
      <div className="mkt-notes">
        <p>{fillCopy(DQ.statusLine, { repair: s.repair, status: s.status.replace('_', ' ') })}</p>
        {s.why_not_repaired ? <p>{fillCopy(DQ.whyNot, { why: s.why_not_repaired })}</p> : null}
        <p>{fillCopy(DQ.sourceLine, { source: s.source })}</p>
        <p>{fillCopy(DQ.fenceNote, { fence: calendar.fence })}</p>
        <p>{DQ.keysNote}</p>
      </div>
    </>
  )
}

function GuardsView({ report }: { readonly report: GuardStatusReport }) {
  const [selected, setSelected] = useState<GuardGroup | null>(null)
  const changed = selected && selected.changed_keys.length > 0 ? fillCopy(DQ.guardChanged, { keys: selected.changed_keys.join(', ') }) : ''
  return (
    <>
      <h2 className="dq-heading">{DQ.guardsHeading}</h2>
      <p className="dq-note">{fillCopy(DQ.guardsTally, { ok: report.ok, mismatch: report.mismatch, none: report.no_record })}</p>
      <div className="dq-grid">
        <MonitorGrid label={DQ.guardsLabel} rows={report.groups} columns={guardColumns} rowId={(g) => g.name} rowLabel={(g) => g.name} onOpen={setSelected} scroll="panel" />
      </div>
      <p className="dq-selected-line" role="status">
        {selected ? fillCopy(DQ.guardSelected, { group: selected.name, status: selected.status, record: selected.record, changed }) : ''}
      </p>
      <div className="mkt-notes">
        <p>{report.label}</p>
        <p>{DQ.guardsNote}</p>
      </div>
    </>
  )
}

function guardsCsv(report: GuardStatusReport): string {
  return toCsv(['group', 'status', 'keys', 'live_sha256', 'recorded_sha256', 'record', 'changed_keys'],
    report.groups.map((g) => [g.name, g.status, g.keys, g.live_sha256, g.recorded_sha256, g.record, g.changed_keys.join(' ')]))
}

function initialSymbol(context: ScreenProps['context']): string {
  return context && context.kind === 'instrument' && context.value ? `${context.value}.V.0` : DEFAULT_SYMBOL
}

export default function DqScreen({ context }: ScreenProps) {
  const actions = usePanelActions()
  const viewId = useId()
  const [tab, setTab] = useState<DqTab>('calendar')
  const index = useDqSymbols()
  const known = index.data?.symbols ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const wanted = picked ?? initialSymbol(context)
  const symbol = known.some((s) => s.symbol === wanted) ? wanted : (known[0]?.symbol ?? '')
  const calendar = useDqCalendar(symbol)
  const guards = useDqGuards(tab === 'guards')
  const onExport = () => {
    if (tab === 'guards') {
      const report = guards.data
      exportCsv(csvFileName('dq', 'guards'), report ? guardsCsv(report) : '', report?.groups.length ?? 0)
      return
    }
    const days = calendar.data ? flaggedDays(calendar.data.days) : []
    exportCsv(csvFileName('dq', symbol, 'flagged'), flaggedCsv(days), days.length)
  }
  const options = known.map((s) => ({ value: s.symbol, label: s.symbol }))
  return (
    <div className="mkt dq" data-screen="DQ">
      <FunctionBar panelId={actions.panelId} title={DQ.title} items={barItems(actions, onExport)} />
      <TabStrip
        panelId={actions.panelId}
        label={DQ.tabsLabel}
        variant="sub"
        start={FIRST_TAB}
        tabs={TABS.map((id) => ({ id, label: DQ.tabs[id] }))}
        selected={tab}
        onSelect={(id) => setTab(id as DqTab)}
        controls={viewId}
      />
      <div id={viewId} className="dq-body" role="tabpanel" aria-label={`${FIRST_TAB + TABS.indexOf(tab)}) ${DQ.tabs[tab]}`}>
        {tab === 'calendar' ? (
          <>
            {options.length > 0 ? (
              <ParamRow label={DQ.paramLabel}>
                <DropdownField label={DQ.symbolField} value={symbol} options={options} onChange={setPicked} />
                {calendar.data ? <ReadOnlyValue label={DQ.colStatus}>{calendar.data.symbol.status.replace('_', ' ')}</ReadOnlyValue> : null}
              </ParamRow>
            ) : null}
            {index.data && index.data.missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(DQ.missing, { files: index.data.missing.join(', ') })}</p> : null}
            {index.data && known.length === 0 ? <p className="mkt-status">{DQ.noSymbols}</p> : null}
            {calendar.data ? (
              <CalendarView key={calendar.data.symbol.symbol} calendar={calendar.data} />
            ) : index.data && known.length === 0 ? null : (
              // A disabled calendar query (no symbol to ask for, symbol === '') is idle, not loading:
              // in react-query v5 a disabled query with no data reports isPending true forever, which
              // would otherwise show a permanent aria-busy Loading line beside "No symbols" (D31).
              <QueryStatus loading={index.isPending || (symbol !== '' && calendar.isPending)} error={index.error ?? calendar.error} loadingText={DQ.loading} failedText={DQ.failed} />
            )}
          </>
        ) : guards.data ? (
          <GuardsView report={guards.data} />
        ) : (
          <QueryStatus loading={guards.isPending} error={guards.error} loadingText={DQ.loading} failedText={DQ.failed} />
        )}
      </div>
    </div>
  )
}

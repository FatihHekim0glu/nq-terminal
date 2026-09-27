// EVT: the event study (TASKS Phase 11, P1, UI_SPEC 7; the look of CORR and MON, look spec 4, 6, 7 and 8).
// The average cumulative return path of one instrument around the fixed CPI, PPI, NFP or FOMC releases, daily
// (sessions) or intraday (minutes, where a repaired 1m series exists), with its pointwise band from the
// cross-event standard error, the distribution at the last offset, and one grid row per event. Number <GO> (or
// Enter) on a row draws that event's own path over the mean. The user picks the instrument, the event type and
// the window; the event lists are fixed in the project's files. Every value is the API's, read through the gate
// to 2021-12-31, and the panel is [POST HOC]: descriptive, no p-value anywhere. The red bar carries the
// instrument field, 96) Actions and 98) Export (the mean path and its band as CSV).
import { useId, useMemo, useState } from 'react'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { EVT } from '../../copy/evt'
import { MARKET } from '../../copy/market'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid, { signTone, type MonitorColumn } from '../../grids/MonitorGrid'
import { gateText } from '../mon/model'
import QueryStatus from '../mon/QueryStatus'
import '../mon/market.css'
import { EventPathChart } from './EventPathChart'
import {
  DEFAULT_EVENT,
  DEFAULT_ROOT,
  DEFAULT_WINDOW,
  chartInput,
  endCells,
  eventOptions,
  formatPct,
  intradayAllowed,
  pathCsv,
  rootOf,
  statusText,
  symbolFor,
  unitsText,
  windowOptions,
} from './model'
import { useEventCalendar, useEventStudy } from '../../api/queries'
import type { EventCalendar, EventMode, EventRow, EventStudy, EventType } from './types'
import './evt.css'

interface Settings {
  /** The picked instrument root; null follows the panel's instrument context (NQ without one). */
  readonly root: string | null
  readonly event: EventType
  readonly mode: EventMode
  readonly pre: number
  readonly post: number
  /** The date of the event drawn over the mean; null draws none. */
  readonly selected: string | null
}

const INITIAL: Settings = { root: null, event: DEFAULT_EVENT, mode: 'daily', pre: DEFAULT_WINDOW.daily[0], post: DEFAULT_WINDOW.daily[1], selected: null }

const COLUMNS: readonly MonitorColumn<EventRow>[] = [
  { id: 'date', header: EVT.colDate, width: 96, kind: 'name', value: (r) => r.date },
  { id: 'types', header: EVT.colTypes, width: 96, kind: 'text', value: (r) => r.types.join('+') },
  { id: 'time', header: EVT.colTime, width: 64, kind: 'text', value: (r) => r.time_et },
  { id: 'first', header: EVT.colFirst, width: 80, kind: 'num', value: (r) => r.first, format: (r) => formatPct(r.first), tone: (r) => signTone(r.first) },
  { id: 'end', header: EVT.colEnd, width: 80, kind: 'num', value: (r) => r.end, format: (r) => formatPct(r.end), tone: (r) => signTone(r.end) },
  { id: 'status', header: EVT.colStatus, width: 420, kind: 'text', value: (r) => statusText(r), tone: (r) => (r.used ? undefined : 'muted') },
]

function actionsItem(actions: PanelActions): FunctionBarItem {
  return {
    n: FUNCTION_NUMBERS.actions,
    label: FUNCTION_BAR.actions,
    menu: [
      { label: PANEL.related, onSelect: () => actions.related() },
      { label: PANEL.back, onSelect: () => actions.back() },
      { label: PANEL.forward, onSelect: () => actions.forward() },
    ],
  }
}

function InstrumentField({ root }: { readonly root: string }) {
  return (
    <span className="field-ro fn-instrument">
      <span className="sr-only">{`${EVT.instrumentField} `}</span>
      {root}
    </span>
  )
}

interface ParamsProps {
  readonly s: Settings
  readonly set: (next: Settings) => void
  readonly calendar: EventCalendar
  readonly root: string
  readonly study: EventStudy | undefined
}

function Params({ s, set, calendar, root, study }: ParamsProps) {
  const symbols = s.mode === 'daily' ? calendar.daily_symbols : calendar.intraday_symbols
  const listed = symbols.includes(symbolFor(root)) ? symbols : [symbolFor(root), ...symbols]
  const instruments = listed.map((sym) => ({ value: rootOf(sym), label: rootOf(sym) }))
  const switchMode = (mode: EventMode) => set({ ...s, mode, pre: DEFAULT_WINDOW[mode][0], post: DEFAULT_WINDOW[mode][1], selected: null })
  return (
    <div className="mkt-params">
      <ParamRow label={EVT.paramLabel}>
        <DropdownField label={EVT.instrument} value={root} options={instruments} onChange={(v) => set({ ...s, root: v, selected: null })} />
        <span className="param-label">{EVT.event}</span>
        <ToggleGroup label={EVT.event} value={s.event} options={eventOptions(calendar)} onChange={(v) => set({ ...s, event: v as EventType, selected: null })} />
        <span className="param-label">{EVT.mode}</span>
        <ToggleGroup
          label={EVT.mode}
          value={s.mode}
          onChange={(v) => switchMode(v as EventMode)}
          options={[{ value: 'daily', label: EVT.modeDaily }, { value: 'intraday', label: EVT.modeIntraday }]}
        />
        <DropdownField label={EVT.before} value={String(s.pre)} options={windowOptions(s.mode, 'before')} onChange={(v) => set({ ...s, pre: Number(v), selected: null })} />
        <DropdownField label={EVT.after} value={String(s.post)} options={windowOptions(s.mode, 'after')} onChange={(v) => set({ ...s, post: Number(v), selected: null })} />
        <ReadOnlyValue label={EVT.events}>{study ? fillCopy(EVT.eventsValue, { used: study.n_used, listed: study.n_listed }) : '--'}</ReadOnlyValue>
      </ParamRow>
    </div>
  )
}

function EndTable({ study }: { readonly study: EventStudy }) {
  const cells = endCells(study)
  const captionId = useId()
  return (
    <table className="evt-end" aria-labelledby={captionId}>
      <caption id={captionId} className="evt-end-caption">{fillCopy(EVT.endHeading, { to: study.offsets.at(-1) ?? 0 })}</caption>
      <thead>
        <tr>{cells.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr>
      </thead>
      <tbody>
        <tr>{cells.map((c) => <td key={c.label} className={c.tone ? `num ${c.tone}` : 'num'}>{c.value}</td>)}</tr>
      </tbody>
    </table>
  )
}

function Notes({ study, calendar }: { readonly study: EventStudy; readonly calendar: EventCalendar }) {
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{study.label}</span>
      </p>
      <p>{fillCopy(MARKET.basis, { basis: study.basis })}</p>
      <p>{unitsText(study)}</p>
      <p>{fillCopy(EVT.bandNote, { note: study.band_note })}</p>
      <p>{fillCopy(EVT.source, { source: study.source, check: calendar.fomc_check })}</p>
      <p className="mkt-gate">{gateText(study.gate)}</p>
    </div>
  )
}

function Study({ study, calendar, s, set }: { readonly study: EventStudy; readonly calendar: EventCalendar; readonly s: Settings; readonly set: (next: Settings) => void }) {
  const selected = study.events.find((r) => r.date === s.selected && r.used) ?? null
  const data = useMemo(() => chartInput(study, selected), [study, selected])
  const uid = useId()
  return (
    <>
      <div className="evt-chart">
        <EventPathChart data={data} chartId={`evt-path${uid}`} />
      </div>
      <EndTable study={study} />
      <p className="evt-note">{selected ? fillCopy(EVT.selectedNote, { date: selected.date, types: selected.types.join('+') }) : EVT.pickNote}</p>
      <div className="mkt-grid evt-grid">
        <MonitorGrid
          label={fillCopy(EVT.gridLabel, { n: study.events.length })}
          rows={study.events}
          columns={COLUMNS}
          rowId={(r) => r.date}
          rowLabel={(r) => `${r.date} ${r.types.join('+')}`}
          onOpen={(r) => set({ ...s, selected: r.used ? r.date : null })}
          emptyText={EVT.gridEmpty}
          scroll="panel"
        />
      </div>
      <Notes study={study} calendar={calendar} />
    </>
  )
}

export default function EvtScreen({ context }: ScreenProps) {
  const actions = usePanelActions()
  const [s, set] = useState<Settings>(INITIAL)
  const root = s.root ?? (context?.kind === 'instrument' ? context.value : DEFAULT_ROOT)
  const symbol = symbolFor(root)
  const calendarQuery = useEventCalendar()
  const calendar = calendarQuery.data
  const allowed = calendar !== undefined && (s.mode === 'daily' ? calendar.daily_symbols.includes(symbol) : intradayAllowed(calendar, symbol))
  const studyQuery = useEventStudy({ symbol, event: s.event, mode: s.mode, pre: s.pre, post: s.post }, allowed)
  const study = allowed ? studyQuery.data : undefined
  const onExport = () => {
    if (!study) {
      exportCsv('evt.csv', '', 0)
      return
    }
    const out = pathCsv(study)
    exportCsv(csvFileName(EVT.exportName, root, study.event_type, study.mode, `${study.pre}_${study.post}`), out.csv, out.rows)
  }
  return (
    <div className="mkt evt" data-screen="EVT">
      <FunctionBar
        panelId={actions.panelId}
        title={EVT.title}
        field={<InstrumentField root={root} />}
        items={[actionsItem(actions), { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport }]}
      />
      {calendar ? (
        <>
          <Params s={s} set={set} calendar={calendar} root={root} study={study} />
          {!allowed ? (
            <p className="mkt-status mkt-warn-text">
              {s.mode === 'daily'
                ? fillCopy(EVT.notDaily, { root })
                : fillCopy(EVT.notIntraday, { root, symbols: calendar.intraday_symbols.map(rootOf).join(', ') })}
            </p>
          ) : study ? (
            <Study study={study} calendar={calendar} s={s} set={set} />
          ) : (
            <QueryStatus loading={studyQuery.isPending} error={studyQuery.error} loadingText={EVT.loading} failedText={EVT.failed} />
          )}
        </>
      ) : (
        <QueryStatus loading={calendarQuery.isPending} error={calendarQuery.error} loadingText={EVT.calendarLoading} failedText={EVT.calendarFailed} />
      )}
    </div>
  )
}

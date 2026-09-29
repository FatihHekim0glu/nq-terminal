// ROLL, the roll calendar (TASKS Phase 11; UI_SPEC 5, P1; ANALYTICS MV10, gaps as MV2). /api/market/rolls gives every
// in-sample roll of the 27 futures (instrument_id changes in the served 1d files, through the gate, to
// 2021-12-31) with its gap in points and percent. Three views on numbered tabs: 1) Calendar, the strip of
// every market's rolls by month for one year or all years; 2) Market, one market's rolls as a gap chart and
// a table, with the universe QA report's count beside ours; 3) Paper book MNQ, the paper book's roll
// schedule from /api/market/paper-rolls (dates only). An instrument context (link group) picks the market.
// Strip rows are numbered from 11 (Number <GO> opens the market). The red bar carries the [27F] field,
// 96) Actions and 98) Export (what the current view shows, as CSV). Every request is a GET.
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { csvFileName, exportCsv, toCsv } from '../../chrome/exportCsv'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { switchKeepingFocus } from '../../chrome/keepFocus'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { MARKET } from '../../copy/market'
import { ROLL } from '../../copy/roll'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { gateText } from '../mon/model'
import QueryStatus from '../mon/QueryStatus'
import UniverseField from '../mon/UniverseField'
import '../mon/market.css'
import { PAPER_WINDOW, rollsCsv, stripCsv, stripRows, yearsOf, type YearChoice } from './model'
import PaperRolls from './PaperRolls'
import { usePaperRolls, useRollCalendar } from '../../api/queries.screens'
import RollMarket from './RollMarket'
import RollStrip from './RollStrip'
import type { PaperRollSchedule, RollCalendar } from './types'
import './roll.css'

type View = 'calendar' | 'market' | 'paper'
const DEFAULT_SYMBOL = 'NQ.V.0'
const ALL = 'all'

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

function Notes({ calendar }: { readonly calendar: RollCalendar }) {
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{calendar.label}</span>
      </p>
      <p>{fillCopy(MARKET.basis, { basis: calendar.basis })}</p>
      <p>{calendar.unit_note}</p>
      <p>{fillCopy(ROLL.qaSource, { source: calendar.qa_source })}</p>
      <p className="mkt-gate">{gateText(calendar.gate)}</p>
      {calendar.missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(MARKET.missing, { symbols: calendar.missing.join(', ') })}</p> : null}
    </div>
  )
}

function exportView(view: View, calendar: RollCalendar | undefined, year: YearChoice, symbol: string, paper: PaperRollSchedule | undefined): void {
  if (view === 'paper') {
    const rows = (paper?.rows ?? []).map((r) => [r.contract, r.expiry, r.roll_date, r.into, r.status])
    exportCsv(csvFileName(ROLL.exportName, 'MNQ', 'paper'), toCsv(['contract', 'expiry', 'roll_date', 'into', 'status'], rows), rows.length)
    return
  }
  if (!calendar) {
    exportCsv(csvFileName(ROLL.exportName), '', 0)
    return
  }
  if (view === 'calendar') {
    const out = stripCsv(stripRows(calendar, year), year)
    exportCsv(csvFileName(ROLL.exportName, '27F', year), out.text, out.rows)
    return
  }
  const market = calendar.markets.find((m) => m.symbol === symbol)
  const out = market ? rollsCsv(market) : { text: '', rows: 0 }
  exportCsv(csvFileName(ROLL.exportName, market?.root ?? symbol), out.text, out.rows)
}

function CalendarView({ calendar, year, setYear, panelId, onOpen }: { readonly calendar: RollCalendar; readonly year: YearChoice; readonly setYear: (y: YearChoice) => void; readonly panelId: string; readonly onOpen: (symbol: string) => void }) {
  const options = useMemo(() => [{ value: ALL, label: ROLL.allYears }, ...yearsOf(calendar).map((y) => ({ value: y, label: y }))], [calendar])
  const rows = useMemo(() => stripRows(calendar, year), [calendar, year])
  return (
    <>
      <ParamRow label={ROLL.paramCalendar}>
        <DropdownField label={ROLL.year} value={year} options={options} onChange={setYear} />
        <ReadOnlyValue label={ROLL.asOf}>{calendar.as_of}</ReadOnlyValue>
      </ParamRow>
      <RollStrip panelId={panelId} rows={rows} year={year} onOpen={onOpen} />
    </>
  )
}

export default function RollScreen({ context }: ScreenProps) {
  const actions = usePanelActions()
  const bodyId = useId()
  const [view, setView] = useState<View>('calendar')
  const [year, setYear] = useState<YearChoice | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const query = useRollCalendar()
  const paper = usePaperRolls(PAPER_WINDOW, view === 'paper')
  const calendar = query.data
  const fromContext = context?.kind === 'instrument' && context.value ? `${context.value}.V.0` : DEFAULT_SYMBOL
  const symbol = picked ?? fromContext
  const shownYear = year ?? (calendar ? (yearsOf(calendar).at(-1) ?? ALL) : ALL)
  const rootRef = useRef<HTMLDivElement>(null)
  // A ticker button unmounts with the strip; focus moves to the selected tab, which stays (WCAG 2.4.3).
  const openMarket = useCallback((s: string) => {
    switchKeepingFocus(rootRef.current, '[role="tab"][aria-selected="true"]', () => {
      setPicked(s)
      setView('market')
    })
  }, [])
  const tabs = [
    { id: 'calendar', label: ROLL.tabCalendar },
    { id: 'market', label: ROLL.tabMarket },
    { id: 'paper', label: ROLL.tabPaper },
  ]
  return (
    <div className="mkt roll" data-screen="ROLL" ref={rootRef}>
      <FunctionBar
        panelId={actions.panelId}
        title={ROLL.title}
        field={<UniverseField label={ROLL.universeField} />}
        items={[actionsItem(actions), { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: () => exportView(view, calendar, shownYear, symbol, paper.data) }]}
      />
      <TabStrip panelId={actions.panelId} label={ROLL.tabsLabel} tabs={tabs} selected={view} onSelect={(id) => setView(id as View)} controls={bodyId} />
      <div id={bodyId} className="roll-body">
        {view === 'paper' ? <PaperRolls query={paper} /> : null}
        {view !== 'paper' && calendar ? (
          <>
            {view === 'calendar'
              ? <CalendarView calendar={calendar} year={shownYear} setYear={setYear} panelId={actions.panelId} onOpen={openMarket} />
              : <RollMarket calendar={calendar} symbol={symbol} onSymbol={setPicked} />}
            <Notes calendar={calendar} />
          </>
        ) : null}
        {view !== 'paper' && !calendar ? <QueryStatus loading={query.isPending} error={query.error} loadingText={ROLL.loading} failedText={ROLL.failed} /> : null}
      </div>
    </div>
  )
}

// LEDG (TASKS 6.3; UI_SPEC section 7 "LEDG"; look spec 7.9, models: a historical price table for density
// and a portfolio upload screen for the counts row): the red function bar with an amber `<Enter filter>`
// field, `96) Actions` and `99) Help`; a parameter row with the strategy and balance filters and the
// counts; the ledger rows from GET /api/ledger, newest first, with a weekday on the date, the balance in
// colour and text and the anchor pair status; then the anchor pairs themselves. `98) Export` saves the
// shown rows as CSV (the grid's columns, numbers at full precision). 96) Actions also starts a run from a row (Space marks one,
// else the newest): the Start from form (screens/launch) queues a backtest in JOBS; the ledger itself stays read only. Enter, a double click or
// Number <GO> on a row opens RUN for its run. Read only: the ledger is written by ledger_append alone.
// View [Grid | Pivot] opens the shown rows in the Perspective pivot grid (TASKS 9.1), grouped by strategy.
// While the record watch has marked a ledger row (roadmap 16), a Seen column first on the grid shows NEW or
// CHG for it, keyed run id @ time as the watch keys the ledger; 98) Export leaves that browser-local column out.
import { useMemo, useState } from 'react'
import { useLedger } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useWatchMarks, type WatchMark } from '../../chrome/RecordWatch.marks'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { exportCsv } from '../../chrome/exportCsv'
import { postMessage } from '../../chrome/MessageLine.store'
import { LAUNCH } from '../../copy/launch'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn, type OpenOptions } from '../../grids/MonitorGrid'
import { gridCsv } from '../../grids/gridCsv'
import { gridWidth, useElementWidth } from '../../grids/useElementWidth'
import { withWatchColumn } from '../../grids/watchColumn'
import { LEDG, LEDG_HELP_LINE } from '../../copy/ledg'
import { LedgerPivot, PivotToggle, type GridView } from '../../perspective'
import { useAnchorPanel } from '../../jobsbar/AnchorPanel'
import { JOBS_BAR } from '../../copy/jobsBar'
import { seedFromLedgerRow } from '../launch/model'
import { useStartFrom } from '../launch/StartFrom'
import AnchorPairs from './AnchorPairs'
import { ledgerColumns } from './ledgerColumns'
import {
  BALANCE_FILTERS,
  anchorsByRun,
  ledgerCounts,
  matchesBalance,
  matchesLedgerFilter,
  newestFirst,
  type BalanceFilter,
  type LedgerRow,
} from './model'
import '../runs/runs.css'
import './ledg.css'

type LedgerView = NonNullable<ReturnType<typeof useLedger>['data']>

const ALL = ''
const rowId = (r: LedgerRow) => `${r.run_id}|${r.ts_utc ?? ''}|${r.exp_id ?? ''}`
const rowLabel = (r: LedgerRow) => r.run_id
/** A row's key in the record watch: the run id and the time, as state/recordWatch.ts keys the ledger. */
const watchKey = (r: LedgerRow) => `${r.run_id}@${r.ts_utc ?? ''}`
const openRun = (r: LedgerRow, options?: OpenOptions) => requestLine(`${r.run_id} RUN`, options?.newPanel ?? false)
const BALANCE_OPTIONS = BALANCE_FILTERS.map((f) => ({ value: f, label: f === 'all' ? LEDG.all : f }))

const EXPORT_FILE = 'ledger.csv'

interface LedgBarProps {
  readonly filter: string
  readonly onFilter: (v: string) => void
  readonly onExport: () => void
  readonly startLabel: string
  readonly onStartFrom: () => void
  readonly anchorLabel: string
  readonly onAnchor: () => void
}

function LedgBar({ filter, onFilter, onExport, startLabel, onStartFrom, anchorLabel, onAnchor }: LedgBarProps) {
  const actions = usePanelActions()
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={LEDG.title}
      field={<AmberField label={LEDG.filterLabel} value={filter} placeholder={LEDG.filterPlaceholder} onChange={onFilter} width="220px" />}
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
            { label: startLabel, onSelect: onStartFrom },
            { label: anchorLabel, onSelect: onAnchor },
          ],
        },
        { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport },
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(LEDG_HELP_LINE) },
      ]}
    />
  )
}

interface Filters {
  readonly text: string
  readonly strategy: string
  readonly balance: BalanceFilter
}

const NO_ROWS: readonly LedgerRow[] = []

/**
 * The shown rows (newest first, filtered), every data column (98) Export saves them all, without the
 * browser-local Seen column) and the columns the grid shows: all of them when the panel is wide enough, else
 * the compact set (no sideways scroll). The Seen column is first in both while the watch has `marks`; a clean
 * watch adds none, so the narrow threshold counts it only then.
 */
function useLedgerView(view: LedgerView | undefined, filters: Filters, width: number | null, marks: ReadonlyMap<string, WatchMark>) {
  const pairs = view?.anchor_pairs
  const anchors = useMemo(() => anchorsByRun(pairs ?? []), [pairs])
  const columns = useMemo(() => ledgerColumns(anchors), [anchors])
  const fullColumns = useMemo(() => withWatchColumn(columns, marks, watchKey), [columns, marks])
  const compact = width !== null && width < gridWidth(fullColumns)
  const shownColumns = useMemo(
    () => (compact ? withWatchColumn(ledgerColumns(anchors, true), marks, watchKey) : fullColumns),
    [compact, anchors, marks, fullColumns],
  )
  const rows = useMemo(
    () =>
      view
        ? newestFirst(view.rows).filter(
            (r) => matchesLedgerFilter(r, filters.text) && matchesBalance(r, filters.balance) && (filters.strategy === ALL || r.strategy === filters.strategy),
          )
        : NO_ROWS,
    [view, filters],
  )
  return { columns, shownColumns, compact, rows }
}

interface LedgerProps {
  readonly view: LedgerView
  readonly rows: readonly LedgerRow[]
  readonly columns: readonly MonitorColumn<LedgerRow>[]
  readonly compact: boolean
  /** The row Space marked as the one to start a run from (at most one). */
  readonly marked: ReadonlySet<string>
  readonly onMark: (row: LedgerRow) => void
}

function Ledger({ view, rows, columns, compact, marked, onMark }: LedgerProps) {
  if (!view.ledger_found) return <p className="run-msg" role="status">{LEDG.missing}</p>
  return (
    <>
      <div className="ledg-grid">
        <MonitorGrid label={fillCopy(LEDG.gridLabel, { n: rows.length })} rows={rows} columns={columns} rowId={rowId} rowLabel={rowLabel} onOpen={openRun} marked={marked} onMark={onMark} emptyText={LEDG.empty} />
      </div>
      {compact ? <p className="runs-note">{LEDG.compactNote}</p> : null}
      <AnchorPairs pairs={view.anchor_pairs} />
    </>
  )
}

function strategyOptions(view: LedgerView | undefined) {
  const names = new Set((view?.rows ?? []).map((r) => r.strategy).filter((s): s is string => typeof s === 'string' && s !== ''))
  return [{ value: ALL, label: LEDG.all }, ...[...names].sort((a, b) => a.localeCompare(b, 'en')).map((s) => ({ value: s, label: s }))]
}

export default function LedgScreen(_props: ScreenProps) {
  const query = useLedger()
  const [text, setText] = useState('')
  const [strategy, setStrategy] = useState(ALL)
  const [balance, setBalance] = useState<BalanceFilter>('all')
  const [gridView, setGridView] = useState<GridView>('grid')
  const filters = useMemo(() => ({ text, strategy, balance }), [text, strategy, balance])
  const view = query.data
  const counts = ledgerCounts(view?.rows ?? [])
  const strategies = useMemo(() => strategyOptions(view), [view])
  const screen = useElementWidth()
  const watchMarks = useWatchMarks('ledger')
  const { columns, shownColumns, compact, rows } = useLedgerView(view, filters, screen.width, watchMarks)
  const onExport = () => exportCsv(EXPORT_FILE, gridCsv(columns, rows), rows.length)
  const startFrom = useStartFrom()
  const [markedId, setMarkedId] = useState<string | null>(null)
  const markedRow = markedId === null ? undefined : rows.find((r) => rowId(r) === markedId)
  const marked = useMemo(() => new Set(markedRow === undefined ? [] : [rowId(markedRow)]), [markedRow])
  const onMark = (row: LedgerRow) => setMarkedId(markedId === rowId(row) ? null : rowId(row))
  const anchor = useAnchorPanel()
  const onAnchor = () => {
    const row = markedRow ?? rows[0]
    if (row === undefined) return postMessage(JOBS_BAR.panel.noBase, 'error')
    return anchor.open(row.run_id)
  }
  const onStartFrom = () => {
    const row = markedRow ?? rows[0]
    if (row === undefined) return postMessage(LEDG.empty, 'error')
    const seed = seedFromLedgerRow(row)
    return seed === null ? postMessage(LAUNCH.noSeed, 'error') : startFrom.open(seed)
  }
  return (
    <div className="runs-screen ledg-screen" data-screen="LEDG" ref={screen.ref}>
      <LedgBar filter={text} onFilter={setText} onExport={onExport} startLabel={markedRow === undefined ? LAUNCH.menu.newest : LAUNCH.menu.marked} onStartFrom={onStartFrom} anchorLabel={markedRow === undefined ? JOBS_BAR.panel.menuNewest : JOBS_BAR.panel.menuMarked} onAnchor={onAnchor} />
      <ParamRow label={LEDG.paramsLabel}>
        <DropdownField label={LEDG.strategyLabel} value={strategy} options={strategies} onChange={setStrategy} />
        <DropdownField label={LEDG.balanceLabel} value={balance} options={BALANCE_OPTIONS} onChange={(v) => setBalance(v as BalanceFilter)} />
        <PivotToggle value={gridView} onChange={setGridView} />
        <span className="runs-counts" data-testid="ledger-counts">{fillCopy(LEDG.counts, { rows: counts.rows, balanced: counts.balanced, matching: counts.matching })}</span>
      </ParamRow>
      <p className="runs-note">{LEDG.note}</p>
      {startFrom.panel}
      {anchor.panel}
      {query.error ? <p className="run-msg" role="status">{fillCopy(LEDG.failed, { detail: query.error.detail })}</p> : null}
      {query.isPending ? <p className="run-msg" role="status">{LEDG.loading}</p> : null}
      {view && gridView === 'pivot' ? <div className="nqt-pivot-frame"><LedgerPivot rows={rows} /></div> : null}
      {view && gridView === 'grid' ? <Ledger view={view} rows={rows} columns={shownColumns} compact={compact} marked={marked} onMark={onMark} /> : null}
    </div>
  )
}

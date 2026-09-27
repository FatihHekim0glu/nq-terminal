// LEDG (TASKS 6.3; UI_SPEC section 7 "LEDG"; look spec 7.9, models: a historical price table for density
// and a portfolio upload screen for the counts row): the red function bar with an amber `<Enter filter>`
// field, `96) Actions` and `99) Help`; a parameter row with the strategy and balance filters and the
// counts; the ledger rows from GET /api/ledger, newest first, with a weekday on the date, the balance in
// colour and text and the anchor pair status; then the anchor pairs themselves. Enter, a double click or
// Number <GO> on a row opens RUN for its run. Read only: the ledger is written by ledger_append alone.
import { useMemo, useState } from 'react'
import { useLedger } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid from '../../grids/MonitorGrid'
import { LEDG, LEDG_HELP_LINE } from './copy'
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
const openRun = (r: LedgerRow) => requestLine(`${r.run_id} RUN`)
const BALANCE_OPTIONS = BALANCE_FILTERS.map((f) => ({ value: f, label: f === 'all' ? LEDG.all : f }))

function LedgBar({ filter, onFilter }: { readonly filter: string; readonly onFilter: (v: string) => void }) {
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
          ],
        },
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

function Ledger({ view, filters }: { readonly view: LedgerView; readonly filters: Filters }) {
  const anchors = useMemo(() => anchorsByRun(view.anchor_pairs), [view.anchor_pairs])
  const columns = useMemo(() => ledgerColumns(anchors), [anchors])
  const rows = useMemo(
    () =>
      newestFirst(view.rows).filter(
        (r) => matchesLedgerFilter(r, filters.text) && matchesBalance(r, filters.balance) && (filters.strategy === ALL || r.strategy === filters.strategy),
      ),
    [view.rows, filters],
  )
  if (!view.ledger_found) return <p className="run-msg" role="status">{LEDG.missing}</p>
  return (
    <>
      <div className="ledg-grid">
        <MonitorGrid label={fillCopy(LEDG.gridLabel, { n: rows.length })} rows={rows} columns={columns} rowId={rowId} rowLabel={rowLabel} onOpen={openRun} emptyText={LEDG.empty} />
      </div>
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
  const filters = useMemo(() => ({ text, strategy, balance }), [text, strategy, balance])
  const view = query.data
  const counts = ledgerCounts(view?.rows ?? [])
  const strategies = useMemo(() => strategyOptions(view), [view])
  return (
    <div className="runs-screen ledg-screen" data-screen="LEDG">
      <LedgBar filter={text} onFilter={setText} />
      <ParamRow label={LEDG.paramsLabel}>
        <DropdownField label={LEDG.strategyLabel} value={strategy} options={strategies} onChange={setStrategy} />
        <DropdownField label={LEDG.balanceLabel} value={balance} options={BALANCE_OPTIONS} onChange={(v) => setBalance(v as BalanceFilter)} />
        <span className="runs-counts" data-testid="ledger-counts">{fillCopy(LEDG.counts, { rows: counts.rows, balanced: counts.balanced, matching: counts.matching })}</span>
      </ParamRow>
      <p className="runs-note">{LEDG.note}</p>
      {query.error ? <p className="run-msg" role="status">{fillCopy(LEDG.failed, { detail: query.error.detail })}</p> : null}
      {query.isPending ? <p className="run-msg" role="status">{LEDG.loading}</p> : null}
      {view ? <Ledger view={view} filters={filters} /> : null}
    </div>
  )
}

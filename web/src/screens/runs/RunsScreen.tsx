// RUNS (TASKS 6.3; UI_SPEC section 7 "RUNS and RUN"; look spec 7.4, model: the backtest strategy table):
// the red function bar with an amber `<Enter filter>` field, `96) Actions` and `99) Help`; the sub-tab
// strip `85) All 86) Ledgered 87) Anchors 88) Probes 89) Unusable`; a parameter row with the strategy
// filter and the counts; then every run from GET /api/runs in a MonitorGrid with its badges, and Sharpe
// and max drawdown on Basis B from GET /api/runs/stats. Enter, a double click or Number <GO> on a
// row opens RUN for it through the command line, so it lands in history like a typed command.
import { useId, useMemo, useState } from 'react'
import { useRuns } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid from '../../grids/MonitorGrid'
import { HELP_LINES, RUNS } from './copy'
import { RUNS_TABS, inRunsTab, matchesRunFilter, strategiesOf, type RunSummary, type RunsTab } from './model'
import { runsColumns } from './runsColumns'
import { useCompareStats } from './useCompareStats'
import './runs.css'

const EMPTY: readonly RunSummary[] = []
const ALL = ''
const FIRST_TAB = 85
const runId = (r: RunSummary) => r.run_id
const openRun = (r: RunSummary) => requestLine(`${r.run_id} RUN`)

function useShownRuns(runs: readonly RunSummary[], tab: RunsTab, filter: string, strategy: string): readonly RunSummary[] {
  return useMemo(
    () => runs.filter((r) => inRunsTab(r, tab) && matchesRunFilter(r, filter) && (strategy === ALL || r.strategy === strategy)),
    [runs, tab, filter, strategy],
  )
}

function Counts({ runs }: { readonly runs: readonly RunSummary[] }) {
  const usable = runs.filter((r) => r.usable).length
  const ledgered = runs.filter((r) => r.ledger !== null).length
  return <span className="runs-counts">{fillCopy(RUNS.counts, { n: runs.length, usable, ledgered })}</span>
}

function RunsBar({ filter, onFilter }: { readonly filter: string; readonly onFilter: (v: string) => void }) {
  const actions = usePanelActions()
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={RUNS.title}
      field={<AmberField label={RUNS.filterLabel} value={filter} placeholder={RUNS.filterPlaceholder} onChange={onFilter} width="220px" />}
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
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(HELP_LINES.runs) },
      ]}
    />
  )
}

interface BodyProps {
  readonly runs: readonly RunSummary[]
  readonly shown: readonly RunSummary[]
}

function RunsGrid({ runs, shown }: BodyProps) {
  const { stats, error, pending } = useCompareStats(runs)
  const columns = useMemo(() => runsColumns(stats), [stats])
  return (
    <>
      {error ? <p className="runs-msg" role="status">{fillCopy(RUNS.statsFailed, { detail: error.detail })}</p> : null}
      {pending && !error ? <p className="runs-msg" role="status">{RUNS.statsLoading}</p> : null}
      <div className="runs-grid">
        <MonitorGrid
          label={fillCopy(RUNS.gridLabel, { n: shown.length })}
          rows={shown}
          columns={columns}
          rowId={runId}
          rowLabel={runId}
          onOpen={openRun}
          emptyText={runs.length === 0 ? RUNS.none : RUNS.empty}
        />
      </div>
    </>
  )
}

export default function RunsScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const query = useRuns()
  const [tab, setTab] = useState<RunsTab>('all')
  const viewId = useId()
  const [filter, setFilter] = useState('')
  const [strategy, setStrategy] = useState(ALL)
  const runs = query.data ?? EMPTY
  const shown = useShownRuns(runs, tab, filter, strategy)
  const strategies = useMemo(() => [{ value: ALL, label: RUNS.strategyAll }, ...strategiesOf(runs).map((s) => ({ value: s, label: s }))], [runs])
  return (
    <div className="runs-screen" data-screen="RUNS">
      <RunsBar filter={filter} onFilter={setFilter} />
      <TabStrip
        panelId={actions.panelId}
        label={RUNS.tabsLabel}
        variant="sub"
        start={FIRST_TAB}
        tabs={RUNS_TABS.map((id) => ({ id, label: RUNS.tabs[id] }))}
        selected={tab}
        onSelect={(id) => setTab(id as RunsTab)}
        controls={viewId}
      />
      <ParamRow label={RUNS.paramsLabel}>
        <DropdownField label={RUNS.strategyLabel} value={strategy} options={strategies} onChange={setStrategy} />
        <Counts runs={runs} />
      </ParamRow>
      <p className="runs-note">{RUNS.basisNote}</p>
      <div id={viewId} className="runs-tabpanel" role="tabpanel" aria-label={`${FIRST_TAB + RUNS_TABS.indexOf(tab)}) ${RUNS.tabs[tab]}`}>
        {query.error ? (
          <p className="runs-msg" role="alert">{fillCopy(RUNS.failed, { detail: query.error.detail })}</p>
        ) : query.isPending ? (
          <p className="runs-msg" role="status">{RUNS.loading}</p>
        ) : (
          <RunsGrid runs={runs} shown={shown} />
        )}
      </div>
    </div>
  )
}

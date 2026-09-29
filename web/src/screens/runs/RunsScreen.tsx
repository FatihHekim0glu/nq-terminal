// RUNS (TASKS 6.3; UI_SPEC section 7 "RUNS and RUN"; look spec 7.4, model: the backtest strategy table):
// the red function bar with an amber `<Enter filter>` field, `96) Actions` and `99) Help`; the sub-tab
// strip `85) All 86) Ledgered 87) Anchors 88) Probes 89) Unusable`; `98) Export` saves the shown rows as
// CSV (the same columns, numbers at full precision); a parameter row with the strategy
// filter and the counts; then every run from GET /api/runs in a MonitorGrid with its badges, and Sharpe
// and max drawdown on Basis B from GET /api/runs/stats. Enter, a double click or Number <GO> on a
// row opens RUN for it through the command line, so it lands in history like a typed command.
// Compare basket (roadmap 9): Space marks up to eight rows, `95) Compare n` (or the `90) Compare n` tab
// it adds) draws them rebased on one axis with the served stats; `97) Settings` includes probes or clears
// the basket. Marking asks for nothing; the compare view is the one GET on /api/runs/compare.
// While the record watch has marked a run (roadmap 16), a Seen column first on the grid shows NEW or CHG
// for it; 98) Export leaves that browser-local column out.
import { useId, useMemo, useState } from 'react'
import { useRuns } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField, DropdownField, ParamRow } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useWatchMarks } from '../../chrome/RecordWatch.marks'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn, type OpenOptions } from '../../grids/MonitorGrid'
import { gridCsv } from '../../grids/gridCsv'
import { withWatchColumn } from '../../grids/watchColumn'
import { HELP_LINES, RUNS } from '../../copy/runs'
import { toggleMark } from './basket'
import { RUNS_TABS, inRunsTab, matchesRunFilter, strategiesOf, type RunSummary, type RunsTab } from './model'
import RunsCompare from './RunsCompare'
import { runsColumns } from './runsColumns'
import { useCompareStats, type CompareStatsResult } from './useCompareStats'
import './runs.css'

const EMPTY: readonly RunSummary[] = []
const ALL = ''
const FIRST_TAB = 85
/** The compare view is a sixth tab, shown while the basket holds a run; the sub-tabs are the five RunsTab. */
const COMPARE = 'compare'
type RunsView = RunsTab | typeof COMPARE
const COMPARE_MIN = 2
const runId = (r: RunSummary) => r.run_id
// Shift with Enter or a double click opens RUN in a new panel (G20); a plain press replaces the RUNS panel.
const openRun = (r: RunSummary, options?: OpenOptions) => requestLine(`${r.run_id} RUN`, options?.newPanel ?? false)

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

interface RunsBarProps {
  readonly filter: string
  readonly onFilter: (v: string) => void
  readonly onExport: () => void
  /** Runs marked for comparison. */
  readonly marked: number
  readonly includeProbes: boolean
  readonly onCompare: () => void
  readonly onProbes: () => void
  readonly onClear: () => void
}

function RunsBar({ filter, onFilter, onExport, marked, includeProbes, onCompare, onProbes, onClear }: RunsBarProps) {
  const actions = usePanelActions()
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={RUNS.title}
      field={<AmberField label={RUNS.filterLabel} value={filter} placeholder={RUNS.filterPlaceholder} onChange={onFilter} width="220px" />}
      items={[
        {
          n: FUNCTION_NUMBERS.compare,
          label: marked > 0 ? fillCopy(RUNS.compare.bar, { n: marked }) : FUNCTION_BAR.compare,
          disabled: marked < COMPARE_MIN,
          onRun: onCompare,
        },
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
          ],
        },
        {
          n: FUNCTION_NUMBERS.settings,
          label: FUNCTION_BAR.settings,
          menu: [
            { label: includeProbes ? RUNS.compare.hideProbes : RUNS.compare.showProbes, onSelect: onProbes },
            { label: RUNS.compare.clear, onSelect: onClear },
          ],
        },
        { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport },
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(HELP_LINES.runs) },
      ]}
    />
  )
}

interface BodyProps {
  readonly runs: readonly RunSummary[]
  readonly shown: readonly RunSummary[]
  readonly columns: readonly MonitorColumn<RunSummary>[]
  readonly compare: CompareStatsResult
  /** Ids of the rows marked for comparison. */
  readonly marked: ReadonlySet<string>
  readonly onMark: (run: RunSummary) => void
}

function RunsGrid({ runs, shown, columns, compare, marked, onMark }: BodyProps) {
  const { error, pending } = compare
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
          marked={marked}
          onMark={onMark}
          emptyText={runs.length === 0 ? RUNS.none : RUNS.empty}
        />
      </div>
    </>
  )
}

export default function RunsScreen(props: ScreenProps) {
  const actions = usePanelActions()
  const query = useRuns()
  const [view, setView] = useState<RunsView>('all')
  const [basket, setBasket] = useState<readonly string[]>([])
  const [includeProbes, setIncludeProbes] = useState(false)
  const viewId = useId()
  const [filter, setFilter] = useState('')
  const [strategy, setStrategy] = useState(ALL)
  const runs = query.data ?? EMPTY
  // The compare view shows no table, so the table's own sub-tab is 'all' while it is open.
  const tab: RunsTab = view === COMPARE ? 'all' : view
  const shown = useShownRuns(runs, tab, filter, strategy)
  const strategies = useMemo(() => [{ value: ALL, label: RUNS.strategyAll }, ...strategiesOf(runs).map((s) => ({ value: s, label: s }))], [runs])
  const compare = useCompareStats(runs)
  const dataColumns = useMemo(() => runsColumns(compare.stats), [compare.stats])
  const watchMarks = useWatchMarks('runs')
  const columns = useMemo(() => withWatchColumn(dataColumns, watchMarks, runId), [dataColumns, watchMarks])
  const marked = useMemo(() => new Set(basket), [basket])
  const onExport = () => exportCsv(csvFileName('runs', tab), gridCsv(dataColumns, shown), shown.length)
  // An empty basket has no compare view: a reader who clears it (or unmarks the last run) lands on 85) All.
  const keep = (ids: readonly string[]) => {
    setBasket(ids)
    if (ids.length === 0 && view === COMPARE) setView('all')
  }
  const onMark = (run: RunSummary) => {
    const next = toggleMark(basket, run.run_id)
    if (next.full) postMessage(RUNS.compare.full, 'error')
    else keep(next.ids)
  }
  const tabs = [
    ...RUNS_TABS.map((id) => ({ id: id as RunsView, label: RUNS.tabs[id] })),
    ...(basket.length > 0 ? [{ id: COMPARE as RunsView, label: fillCopy(RUNS.tabs.compare, { n: basket.length }) }] : []),
  ]
  const shownTab = tabs.findIndex((t) => t.id === view)
  return (
    <div className="runs-screen" data-screen="RUNS">
      <RunsBar
        filter={filter}
        onFilter={setFilter}
        onExport={onExport}
        marked={basket.length}
        includeProbes={includeProbes}
        onCompare={() => setView(COMPARE)}
        onProbes={() => setIncludeProbes((on) => !on)}
        onClear={() => keep([])}
      />
      <TabStrip
        panelId={actions.panelId}
        label={RUNS.tabsLabel}
        variant="sub"
        start={FIRST_TAB}
        tabs={tabs}
        selected={view}
        onSelect={(id) => setView(id as RunsView)}
        controls={viewId}
      />
      <ParamRow label={RUNS.paramsLabel}>
        <DropdownField label={RUNS.strategyLabel} value={strategy} options={strategies} onChange={setStrategy} />
        <Counts runs={runs} />
      </ParamRow>
      <p className="runs-note">{RUNS.basisNote}</p>
      <div id={viewId} className="runs-tabpanel" role="tabpanel" aria-label={`${FIRST_TAB + shownTab}) ${tabs[shownTab]?.label ?? ''}`}>
        {query.error ? (
          <p className="runs-msg" role="alert">{fillCopy(RUNS.failed, { detail: query.error.detail })}</p>
        ) : query.isPending ? (
          <p className="runs-msg" role="status">{RUNS.loading}</p>
        ) : view === COMPARE ? (
          <RunsCompare ids={basket} runs={runs} includeProbes={includeProbes} link={props.params.group} />
        ) : (
          <RunsGrid runs={runs} shown={shown} columns={columns} compare={compare} marked={marked} onMark={onMark} />
        )}
      </div>
    </div>
  )
}

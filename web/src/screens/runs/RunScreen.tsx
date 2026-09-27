// RUN (TASKS 6.3; UI_SPEC section 7 "RUNS and RUN"; look spec 7.4, model: the backtest strategy
// analysis screen): the red function bar with the run id in an amber field, `96) Actions` and `99) Help`;
// the tabs `1) Chart 2) Trades 3) Fills 4) Decisions 5) Closes 6) Rolls 7) Config 8) Notes`; the facts
// row, the check strip and the ledger row; then the chosen tab. `98) Export` saves the tab on screen as
// CSV (the chart's series, the loaded page of a table, or the configuration). The context is a run id (from the
// command line, a RUNS row or the panel's link group). Every request is a GET on the run's own routes.
import { useId, useState } from 'react'
import { useRun } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { ExportSlotProvider, useExportSlot } from '../../chrome/exportSource'
import { AmberField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import TabStrip from '../../chrome/TabStrip'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { HELP_LINES, RUN } from '../../copy/runs'
import RunChart from './RunChart'
import RunConfig from './RunConfig'
import { LedgerRow, RunChecks, RunFacts, copyCommand } from './RunHeader'
import { AbsentLog, FillsTab, LogTab, TradesTab } from './RunTables'
import { LOG_TABS, RUN_TABS, hasLogSection, type RunDetail, type RunTab } from './runModel'
import './runs.css'

interface RunBarProps {
  readonly run: string
  readonly detail: RunDetail | undefined
  readonly onExport?: () => void
}

function RunBar({ run, detail, onExport }: RunBarProps) {
  const actions = usePanelActions()
  const [text, setText] = useState(run)
  const command = detail?.ledger_command.eligible ? detail.ledger_command.command : null
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={RUN.title}
      field={
        <AmberField
          label={RUN.fieldLabel}
          value={text}
          placeholder={RUN.fieldPlaceholder}
          onChange={setText}
          onSubmit={(v) => (v.trim() ? requestLine(`${v.trim()} RUN`) : undefined)}
          width="260px"
        />
      }
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
            ...(run ? [{ label: RUN.actions.tearSheet, onSelect: () => requestLine(`${run} EQ`) }] : []),
            { label: RUN.actions.runs, onSelect: () => requestLine('RUNS') },
            ...(command ? [{ label: RUN.actions.copyLedger, onSelect: () => copyCommand(command) }] : []),
          ],
        },
        ...(onExport ? [{ n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport }] : []),
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(HELP_LINES.run) },
      ]}
    />
  )
}

function TabBody({ tab, detail, link }: { readonly tab: RunTab; readonly detail: RunDetail; readonly link: LinkGroup }) {
  const run = detail.summary.run_id
  const title = RUN.tabs[tab]
  const section = LOG_TABS[tab]
  if (section) return hasLogSection(detail, section) ? <LogTab key={section} run={run} section={section} title={title} /> : <AbsentLog title={title} />
  switch (tab) {
    case 'chart':
      return <RunChart detail={detail} link={link} />
    case 'trades':
      return <TradesTab run={run} />
    case 'fills':
      return <FillsTab run={run} />
    default:
      return <RunConfig detail={detail} />
  }
}

function RunView({ run, link }: { readonly run: string; readonly link: LinkGroup }) {
  const actions = usePanelActions()
  const [tab, setTab] = useState<RunTab>('chart')
  const viewId = useId()
  const query = useRun(run)
  const detail = query.data
  const slot = useExportSlot()
  return (
    <ExportSlotProvider slot={slot}>
      <div className="run-screen" data-screen="RUN" data-run={run}>
        <RunBar key={run} run={run} detail={detail} onExport={() => slot.run()} />
        <TabStrip
          panelId={actions.panelId}
          label={RUN.tabsLabel}
          tabs={RUN_TABS.map((id) => ({ id, label: RUN.tabs[id] }))}
          selected={tab}
          onSelect={(id) => setTab(id as RunTab)}
          controls={viewId}
        />
        {query.error ? <p className="run-msg" role="alert">{fillCopy(RUN.failed, { run, detail: query.error.detail })}</p> : null}
        {query.isPending ? <p className="run-msg" role="status">{fillCopy(RUN.loading, { run })}</p> : null}
        {detail ? (
          <>
            <RunFacts detail={detail} />
            <RunChecks detail={detail} />
            <LedgerRow detail={detail} />
          </>
        ) : null}
        <div id={viewId} className="run-tabpanel" role="tabpanel" aria-label={`${RUN_TABS.indexOf(tab) + 1}) ${RUN.tabs[tab]}`}>
          {detail ? <TabBody tab={tab} detail={detail} link={link} /> : null}
        </div>
      </div>
    </ExportSlotProvider>
  )
}

export default function RunScreen({ params, context }: ScreenProps) {
  const run = context?.kind === 'run' ? context.value : ''
  if (run === '') {
    return (
      <div className="run-screen" data-screen="RUN">
        <RunBar run="" detail={undefined} />
        <p className="run-msg">{RUN.noRun}</p>
      </div>
    )
  }
  return <RunView key={run} run={run} link={params.group} />
}

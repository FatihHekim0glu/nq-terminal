// HOME [B] (look spec 7.1, UI_SPEC section 7): panel 3 of the launchpad, `3-EQ [B] volmanaged_v0`.
// The red bar carries the context as an amber field (Enter runs `<context> EQ` in this panel) and
// `96) Actions` (related functions, back, forward, and the full tear sheet, drawdown and rolling views
// in a new panel of the same link group). The body: the API's tag with what it means, five KPI tiles
// (Sharpe and max drawdown against the benchmark, and the row count), then equity against the
// benchmark, the underwater curve and the rolling Sharpe over the long window on one time axis with
// the fence, then the basis, unit, window and benchmark in words. One GET: the panel endpoint of the
// hypothesis or run in link group B (GET /api/analytics/{hypothesis|run}/.../panel).
import { useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { useApiQuery } from '../../api/queries'
import type { UplotConstructor } from '../../charts/lazy'
import LineStack from '../../charts/LineStack'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { HOME_EQ } from '../../copy/home'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import CommandLink from '../help/CommandLink'
import { homeNotes, homeStack, homeTarget, homeTiles, type HomePanel, type HomeTarget } from './homeEquity.model'
import './home.css'

export interface HomeEquityPanelProps extends ScreenProps {
  /** Where uPlot comes from; tests pass a stand-in. */
  readonly loader?: () => Promise<UplotConstructor>
}

/** Both panel endpoints as hooks (hooks cannot be conditional); only the one for the target runs. */
function useHomePanel(target: HomeTarget | null) {
  const hypothesis = useApiQuery(
    '/api/analytics/hypothesis/{name}/panel',
    { path: { name: target?.kind === 'hypothesis' ? target.name : '' } },
    { enabled: target?.kind === 'hypothesis' },
  )
  const run = useApiQuery(
    '/api/analytics/run/{run_id}/panel',
    { path: { run_id: target?.kind === 'run' ? target.name : '' } },
    { enabled: target?.kind === 'run' },
  )
  return target?.kind === 'run' ? run : hypothesis
}

function ContextField({ value }: { readonly value: string }) {
  const [text, setText] = useState(value)
  const submit = (typed: string) => {
    const name = typed.trim()
    if (name !== '') requestLine(`${name} EQ`)
  }
  return <AmberField label={HOME_EQ.fieldLabel} placeholder={HOME_EQ.fieldPlaceholder} value={text} onChange={setText} onSubmit={submit} width="12em" />
}

/** The tear sheet views `96) Actions` opens in a new panel of the same link group. */
const NEW_PANEL_VIEWS: ReadonlyArray<readonly [string, string]> = [
  ['EQ', HOME_EQ.fullSheet],
  ['DD', HOME_EQ.drawdown],
  ['RR', HOME_EQ.rolling],
]

function HomeBar({ name }: { readonly name: string | null }) {
  const actions = usePanelActions()
  const views = name ? NEW_PANEL_VIEWS.map(([code, label]) => ({ label, onSelect: () => requestLine(`${name} ${code}`, true) })) : []
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={HOME_EQ.title}
      field={<ContextField key={name ?? ''} value={name ?? ''} />}
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
            ...views,
          ],
        },
      ]}
    />
  )
}

interface ViewProps {
  readonly panel: HomePanel
  readonly group: ScreenProps['params']['group']
  readonly loader?: () => Promise<UplotConstructor>
}

/** The loaded panel: tag, tiles, the three-pane stack and the notes. */
export function HomeEquityView({ panel, group, loader }: ViewProps) {
  const tiles = useMemo(() => homeTiles(panel), [panel])
  const stack = useMemo(() => homeStack(panel), [panel])
  const notes = useMemo(() => homeNotes(panel), [panel])
  const source = panel.context.kind === 'run' ? HOME_EQ.sourceRun : HOME_EQ.sourceHypothesis
  return (
    <div className="home-eq">
      <p className="home-eq-tag">
        <span className="tag">{panel.tag}</span> {fillCopy(HOME_EQ.tagNote, { source })}
      </p>
      <KpiRow label={fillCopy(HOME_EQ.tilesLabel, { name: panel.context.name })}>
        {tiles.map((t) => (
          <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} signed={t.signed} description={t.description} />
        ))}
      </KpiRow>
      <div className="home-eq-chart">
        <LineStack title={stack.title} t={stack.t} panes={stack.panes} link={group} loader={loader} />
      </div>
      <ul className="home-eq-notes">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.detail : String(error)
}

function Body({ target, group, loader }: { readonly target: HomeTarget | null; readonly group: ViewProps['group']; readonly loader?: ViewProps['loader'] }) {
  const query = useHomePanel(target)
  if (!target) {
    return (
      <p className="home-eq-note">
        {fillCopy(HOME_EQ.noContext, { group: group === '-' ? 'B' : group })} <CommandLink text={HOME_EQ.noContextExample} />
      </p>
    )
  }
  if (query.isError) return <p className="home-eq-note">{fillCopy(HOME_EQ.error, { detail: errorText(query.error) })}</p>
  if (!query.data) return <p className="home-eq-note" aria-busy="true">{HOME_EQ.loading}</p>
  return <HomeEquityView panel={query.data} group={group} loader={loader} />
}

export default function HomeEquityPanel({ params, context, loader }: HomeEquityPanelProps) {
  const target = homeTarget(context)
  return (
    <>
      <HomeBar name={target?.name ?? null} />
      <Body target={target} group={params.group} loader={loader} />
    </>
  )
}

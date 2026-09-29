// HOME [B] (look spec 7.1, UI_SPEC section 7): panel 3 of the launchpad, `3-EQ [B] volmanaged_v0`.
// The red bar carries the context as an amber field (Enter runs `<context> EQ` in this panel) and
// `96) Actions` (related functions, back, forward, and the full tear sheet, drawdown and rolling views
// in a new panel of the same link group). The body: the API's tag with what it means, five KPI tiles
// (Sharpe and max drawdown against the benchmark, and the row count), then equity against the
// benchmark, the underwater curve and the rolling Sharpe over the long window on one time axis with
// the fence, then the basis, unit, window and benchmark in words. One GET: the panel endpoint of the
// hypothesis or run in link group B (GET /api/analytics/{hypothesis|run}/.../panel).
import { useLayoutEffect, useMemo, useState } from 'react'
import { useApiQuery } from '../../api/queries'
import type { UplotConstructor } from '../../charts/lazy'
import LineStack from '../../charts/LineStack'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import PanelFault from '../../chrome/PanelFault'
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

/** The chart never draws shorter than this (a legible time axis and pane legends). */
export const HOME_EQ_CHART_MIN_HEIGHT = 160
/** home.css's `.home-eq` bottom padding (`padding: 4px 6px 2px`); kept in step with that rule. */
const HOME_EQ_BOTTOM_PADDING = 2
/** home.css's `@container home-eq (max-height: 400px)` breakpoint: only below it does the short-panel
 * rule (a fixed 220px chart, tiles in a row, notes left to scroll) apply, so only there does the
 * measured fit height override the CSS; a tall panel keeps the chart's ordinary flex fill (flex: 1 1
 * auto), which already leaves the notes in view, instead of a fit height stretched to the full body. */
export const HOME_EQ_SHORT_PANEL = 400

/**
 * U16 (HOME at 1366x768): the KPI tiles wrap to two rows but home.css's short-panel rule kept the
 * chart at a fixed height, so its own foot (the time axis, the last pane's legend) fell below the
 * panel body's fold along with the notes. The chart's height is instead the panel body's own height
 * less whatever the tag and the tiles above it already claimed (`chartTop`, measured from the panel's top),
 * so the chart's bottom always stays inside the visible body; only the notes below it, which
 * home.css's comment already means to let scroll, are left to.
 */
export function fitChartHeight(containerHeight: number, chartTop: number, bottomPadding: number): number {
  return Math.max(HOME_EQ_CHART_MIN_HEIGHT, Math.round(containerHeight - chartTop - bottomPadding))
}

/** Measures `.home-eq` and `.home-eq-chart` and keeps the chart's fit height current with a
 *  ResizeObserver; null (CSS decides) until a real (non-zero) measurement lands, so jsdom's layout-free
 *  tests and a mid-mount render never force a wrong height. */
function useChartFit(): { readonly containerRef: (el: HTMLDivElement | null) => void; readonly chartRef: (el: HTMLDivElement | null) => void; readonly height: number | null } {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [chart, setChart] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!container || !chart) return undefined
    const measure = () => {
      const containerHeight = container.clientHeight
      if (containerHeight <= 0 || containerHeight > HOME_EQ_SHORT_PANEL) {
        setHeight(null)
        return
      }
      // getBoundingClientRect, not chart.offsetTop: .pstage (the portalled red bar and tabs slot), not
      // .home-eq, is the offsetParent, so offsetTop over-counts by their height. Both rects scroll
      // together, so this stays correct however the workspace is scrolled (U16, 1366x768).
      const chartTop = chart.getBoundingClientRect().top - container.getBoundingClientRect().top
      setHeight(fitChartHeight(containerHeight, chartTop, HOME_EQ_BOTTOM_PADDING))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    // The KPI row wrapping to two rows (a narrower panel) shifts the chart's top without resizing the
    // container itself, so it needs its own trigger to re-measure.
    if (chart.previousElementSibling) observer.observe(chart.previousElementSibling)
    return () => observer.disconnect()
  }, [container, chart])
  return { containerRef: setContainer, chartRef: setChart, height }
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
  const fit = useChartFit()
  return (
    <div className="home-eq" ref={fit.containerRef}>
      <p className="home-eq-tag">
        <span className="tag">{panel.tag}</span> {fillCopy(HOME_EQ.tagNote, { source })}
      </p>
      <KpiRow label={fillCopy(HOME_EQ.tilesLabel, { name: panel.context.name })}>
        {tiles.map((t) => (
          <KpiTile key={t.kpi.key} kpi={t.kpi} decimals={t.decimals} signed={t.signed} description={t.description} unit={t.unit} />
        ))}
      </KpiRow>
      <div className="home-eq-chart" ref={fit.chartRef} style={fit.height !== null ? { flex: '0 0 auto', height: fit.height } : undefined}>
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

function Body({ target, group, loader }: { readonly target: HomeTarget | null; readonly group: ViewProps['group']; readonly loader?: ViewProps['loader'] }) {
  const query = useHomePanel(target)
  if (!target) {
    return (
      <p className="home-eq-note">
        {fillCopy(HOME_EQ.noContext, { group: group === '-' ? 'B' : group })} <CommandLink text={HOME_EQ.noContextExample} />
      </p>
    )
  }
  // {detail} is left in HOME_EQ.error's template: PanelFault fills it from the error itself (roadmap
  // #7). HOME has its own 403 wording too (unchanged text; only the unified amber 403 look comes from
  // PanelFault's default), so refusedText is passed the same template as failedText.
  if (query.isError) return <PanelFault className="home-eq-note" error={query.error} failedText={HOME_EQ.error} refusedText={HOME_EQ.error} onRetry={query.refetch} />
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

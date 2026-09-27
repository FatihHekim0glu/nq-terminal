// GP and GIP (TASKS 7.1; UI_SPEC section 7 "GP / GIP"; look spec 7.6). One screen in two modes:
// GP is the candle chart over a range (bar sizes 1m 5m 1h 1d), GIP one session intraday (1m 5m 1h).
// Top to bottom: the two-line quote header, the red function bar (the amber instrument field, 96 Actions,
// 97 Settings), the parameter row (range or date, variant, the run whose fills are drawn), the range row,
// the session flags, the chart with its RV22 pane on daily bars (or the gate's refusal, amber and
// centred) and the basis footer.
// Honesty rules: every price is the served value (decimals follow the data); a window past the fence
// is refused before any request; fills are drawn only from a run the user linked or picked.
import { useId, useState } from 'react'
import CandleChart from '../../charts/CandleChart'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import QuoteHeader from '../../chrome/QuoteHeader'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { displayInstrument } from '../../commands/sectors'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { useLinkGroups } from '../../state/linkGroups'
import '../../charts/theme/chart.css'
import { GP_COPY as C } from '../../copy/gp'
import { GpParams, GpRangeRow, InstrumentField, spanReason } from './GpControls'
import { ChartMessage, GpFooter, SessionLine } from './GpStatus'
import { ET_ZONE, GIP_TIMEFRAMES, GP_TIMEFRAMES, RANGES, rangeAllowed, sessionBadges, symbolFor, type GpTimeframe, type Variant } from './model'
import { useChartView } from './useChartView'
import { FILLS_LIMIT, useGpData, type GpData } from './useGpData'
import { useGpWindow, type GpMode, type GpWindowState } from './useGpWindow'
import './GpScreen.css'

function initialTf(mode: GpMode, timeframe: string | undefined): GpTimeframe {
  const list: readonly string[] = mode === 'GP' ? GP_TIMEFRAMES : GIP_TIMEFRAMES
  return timeframe && list.includes(timeframe) ? (timeframe as GpTimeframe) : mode === 'GP' ? '1d' : '1m'
}

/** The run whose fills are drawn: the user's pick, else the run context of the panel's link group. */
function useFillsRun(group: ScreenProps['params']['group']): readonly [string | null, (run: string | null) => void] {
  const linked = useLinkGroups((s) => (group !== '-' ? s.contexts[group] : null))
  const [pick, setPick] = useState<string | null | undefined>(undefined)
  const run = pick === undefined ? (linked?.kind === 'run' ? linked.value : null) : pick
  return [run, setPick]
}

interface BarProps {
  readonly mode: GpMode
  readonly root: string
  readonly panelId: string
  readonly grid: boolean
  readonly onGrid: () => void
  readonly rolls: boolean
  readonly onRolls: () => void
}

function GpFunctionBar({ mode, root, panelId, grid, onGrid, rolls, onRolls }: BarProps) {
  const actions = usePanelActions()
  return (
    <FunctionBar
      panelId={panelId}
      title={mode === 'GP' ? C.titleGp : C.titleGip}
      field={<InstrumentField root={root} mode={mode} />}
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
            mode === 'GP'
              ? { label: C.openGip, onSelect: () => actions.open('GIP') }
              : { label: C.openGp, onSelect: () => actions.open('GP') },
          ],
        },
        {
          n: FUNCTION_NUMBERS.settings,
          label: FUNCTION_BAR.settings,
          menu: [
            { label: grid ? C.gridOff : C.gridOn, onSelect: onGrid },
            { label: rolls ? C.rollsOff : C.rollsOn, onSelect: onRolls },
          ],
        },
      ]}
    />
  )
}

function rvNote(data: GpData, tf: GpTimeframe): string | null {
  if (tf !== '1d') return null
  if (data.rv) return fillCopy(C.rvPane, { label: data.rv.label, basis: data.rv.basis, unit: data.rv.unit })
  return data.rvError ? fillCopy(C.rvPaneMissing, { detail: data.rvError.detail }) : null
}

function footerNotes(data: GpData, chosen: Variant, tf: GpTimeframe, ticker: string, run: string | null): string[] {
  const rv = rvNote(data, tf)
  const notes: string[] = rv ? [rv] : []
  if (data.variant !== chosen) notes.push(fillCopy(C.variantMissing, { variant: chosen, tf, ticker }))
  if (!run) return notes
  if (data.fillsError) return [...notes, fillCopy(C.fillsError, { run, detail: data.fillsError.detail })]
  if (data.fills.length === 0) return [...notes, fillCopy(C.fillsNoneInRun, { run })]
  notes.push(fillCopy(C.fillsNote, { n: data.fills.length, run }))
  if (data.fillsTotal > FILLS_LIMIT) notes.push(fillCopy(C.fillsCapped, { n: FILLS_LIMIT, total: data.fillsTotal }))
  return notes
}

function messageText(data: GpData, win: GpWindowState, tf: GpTimeframe, ticker: string): string {
  if (!data.spanOk) return spanReason(win.range ?? 'Max', tf, false) ?? ''
  if (data.barsLoading) return C.loading
  return fillCopy(C.empty, { ticker, tf, variant: data.variant })
}

interface BodyProps {
  readonly mode: GpMode
  readonly root: string
  readonly symbol: string
  readonly group: ScreenProps['params']['group']
  readonly args: ScreenProps['params']['args']
  readonly panelId: string
}

function GpBody({ mode, root, symbol, group, args, panelId }: BodyProps) {
  const ticker = displayInstrument(root, null)
  const [tf, setTf] = useState<GpTimeframe>(() => initialTf(mode, args.timeframe))
  const win = useGpWindow(mode, args, tf)
  const [variant, setVariant] = useState<Variant>('vendor')
  const [run, setRun] = useFillsRun(group)
  const [grid, setGrid] = useState(false)
  const [showRolls, setShowRolls] = useState(true)
  const data = useGpData({ root, symbol, tf, variant, window: win.window, runId: run })
  const view = useChartView(data, root, ticker, tf, showRolls)
  const bars = data.bars
  const showChart = bars !== undefined && bars.t.length > 0 && data.refusal === null
  return (
    <div className="gp-screen" data-screen={mode}>
      <QuoteHeader quote={view.quote} />
      <GpFunctionBar mode={mode} root={root} panelId={panelId} grid={grid} onGrid={() => setGrid(!grid)} rolls={showRolls} onRolls={() => setShowRolls(!showRolls)} />
      <GpParams
        mode={mode} draftStart={win.draftStart} draftEnd={win.draftEnd} onDraftStart={win.setDraftStart} onDraftEnd={win.setDraftEnd}
        onSubmit={win.submit} variant={data.variant} variants={data.variants} onVariant={setVariant}
        runs={data.runs} run={run} onRun={setRun}
      />
      <GpRangeRow
        mode={mode} timeframes={mode === 'GP' ? GP_TIMEFRAMES : GIP_TIMEFRAMES} tf={tf}
        onTf={(next) => {
          setTf(next)
          win.resetFor(next)
        }}
        ranges={RANGES} range={win.range} onRange={win.chooseRange}
        rangeBlocked={(r) => spanReason(r, tf, rangeAllowed(tf, win.windowFor(r)))}
        rolls={showRolls} onRolls={() => setShowRolls(!showRolls)} rollsLabel={C.rolls}
      />
      {win.fieldError ? <p className="gp-field-msg" role="status">{win.fieldError}</p> : null}
      {bars && data.refusal === null ? <SessionLine badges={sessionBadges(bars.sessions, win.date)} date={win.date} /> : null}
      <div className="gp-chart">
        {showChart ? (
          <CandleChart
            name={ticker} bars={bars} fills={data.fills} rolls={view.rolls} link={group} timeZone={ET_ZONE}
            {...(view.indicator ? { indicator: view.indicator } : {})}
            precision={view.precision} minMove={10 ** -view.precision} grid={grid}
          />
        ) : (
          <ChartMessage refusal={data.refusal} error={data.barsError} text={messageText(data, win, tf, ticker)} busy={data.spanOk && data.barsLoading} />
        )}
      </div>
      <GpFooter bars={bars} tf={tf} rvDate={view.rvDate} notes={footerNotes(data, variant, tf, ticker, run)} />
    </div>
  )
}

export interface GpScreenProps extends ScreenProps {
  readonly mode: GpMode
}

export function GpScreen({ mode, params, context }: GpScreenProps) {
  const actions = usePanelActions()
  const ownId = useId()
  const panelId = actions.panelId || ownId
  const root = context?.kind === 'instrument' ? context.value : null
  const symbol = root ? symbolFor(root) : null
  if (!root || !symbol) {
    const text = root ? fillCopy(C.badSymbol, { value: root }) : C.noInstrument
    return (
      <div className="gp-screen" data-screen={mode}>
        <ChartMessage refusal={null} error={null} text={text} />
      </div>
    )
  }
  // Keyed by the series, so a new instrument or argument starts from its own defaults.
  const key = `${symbol} ${params.args.timeframe ?? ''} ${params.args.date ?? ''}`
  return <GpBody key={key} mode={mode} root={root.toUpperCase()} symbol={symbol} group={params.group} args={params.args} panelId={panelId} />
}

export function GPScreen(props: ScreenProps) {
  return <GpScreen {...props} mode="GP" />
}

export function GIPScreen(props: ScreenProps) {
  return <GpScreen {...props} mode="GIP" />
}

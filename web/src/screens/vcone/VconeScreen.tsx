// VCONE: the volatility cone (TASKS Phase 11; UI_SPEC section 7 P1 list; ANALYTICS MV9 over MV3 close to close,
// annualised). GET /api/market/vcone gives, for 5 to 252 sessions, the min, percentiles and max of the rolling
// realised volatility over the in-sample history and the latest value; the cone is drawn with the latest term
// structure over it (ECharts, role img with a data summary and a table view) above a numbered horizon grid.
// A grid row (Number <GO> 1 to 6, or its button) opens the small multiples: GET /api/market/vcone/universe, the
// 27 futures at that horizon on one scale, each tile numbered to open its own cone. 31) and 32) switch the
// view. Every price read happens in the backend, through the gate, to 2021-12-31. The red bar carries the
// instrument field and 98) Export (the shown table as CSV, no request). [POST HOC]: descriptive, no p-value.
import { useMemo, useRef, useState } from 'react'
import { EchartsFigure, useChartTokens } from '../../charts/echarts/EchartsChart'
import { requestLine } from '../../chrome/CommandLine.bus'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { switchKeepingFocus } from '../../chrome/keepFocus'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { MARKET } from '../../copy/market'
import { VCONE } from '../../copy/vcone'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { gateText, tickerOf } from '../mon/model'
import QueryStatus from '../mon/QueryStatus'
import '../mon/market.css'
import HorizonGrid from './HorizonGrid'
import {
  DEFAULT_HORIZON,
  HORIZONS,
  UNIVERSE_ROOTS,
  coneCsv,
  coneInput,
  coneKey,
  coneOption,
  coneTable,
  describeCone,
  resolveRoot,
  smallCsv,
  smallView,
  symbolOf,
} from './model'
import { useVolCone, useVolConeUniverse } from '../../api/queries'
import SmallMultiples from './SmallMultiples'
import type { GateInfo, VolCone, VolConeUniverse } from './types'
import './vcone.css'

export type VconeView = 'cone' | 'small'
const NUMBER_CONE = 31
const NUMBER_SMALL = 32
const INSTRUMENT_OPTIONS = UNIVERSE_ROOTS.map((r) => ({ value: r, label: tickerOf(r) }))
const HORIZON_OPTIONS = HORIZONS.map((n) => ({ value: String(n), label: fillCopy(VCONE.horizonOption, { n }) }))

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

interface Settings {
  readonly view: VconeView
  readonly horizon: number
}

function ConeFigure({ cone, ticker }: { readonly cone: VolCone; readonly ticker: string }) {
  const tokens = useChartTokens()
  const input = useMemo(() => coneInput(cone, ticker), [cone, ticker])
  const option = useMemo(() => coneOption(input, tokens), [input, tokens])
  const key = useMemo(() => coneKey(cone.as_of, tokens), [cone.as_of, tokens])
  const footer = (
    <div className="echarts-scale">
      {key.map((k) => (
        <span key={k.label} className="echarts-scale-named">
          <span className="echarts-scale-step" style={{ background: k.fill }} />
          {k.label}
        </span>
      ))}
    </div>
  )
  return (
    <div className="vcone-chart">
      <EchartsFigure label={describeCone(input)} table={coneTable(input)} option={option} chartId="vcone-cone" footer={footer} />
    </div>
  )
}

interface NotesProps {
  readonly source: { readonly label: string; readonly basis: string; readonly as_of: string; readonly gate: GateInfo }
  readonly minWindows?: number
  readonly undefinedReturns?: number
  readonly missing?: readonly string[]
}

function Notes({ source, minWindows, undefinedReturns = 0, missing = [] }: NotesProps) {
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{source.label}</span>
      </p>
      <p>{fillCopy(MARKET.basis, { basis: source.basis })}</p>
      <p>{VCONE.units}</p>
      {minWindows !== undefined ? <p>{fillCopy(VCONE.history, { asOf: source.as_of, min: minWindows })}</p> : <p>{VCONE.tileKey}</p>}
      {undefinedReturns > 0 ? <p className="mkt-warn-text">{fillCopy(VCONE.undefinedReturns, { count: undefinedReturns })}</p> : null}
      {missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(MARKET.missing, { symbols: missing.join(', ') })}</p> : null}
      <p className="mkt-gate">{gateText(source.gate)}</p>
    </div>
  )
}

function ConeView({ cone, ticker, s, onOpen, panelId }: { readonly cone: VolCone; readonly ticker: string; readonly s: Settings; readonly onOpen: (n: number) => void; readonly panelId: string }) {
  return (
    <>
      <ConeFigure cone={cone} ticker={ticker} />
      <HorizonGrid panelId={panelId} ticker={ticker} rows={cone.horizons} selected={s.horizon} onOpen={onOpen} />
      <Notes source={cone} minWindows={cone.min_windows} undefinedReturns={cone.undefined_returns} />
    </>
  )
}

function SmallView({ small, panelId }: { readonly small: VolConeUniverse; readonly panelId: string }) {
  const view = useMemo(() => smallView(small), [small])
  return (
    <>
      <div className="vcone-small">
        <SmallMultiples panelId={panelId} view={view} />
      </div>
      <Notes source={small} missing={small.missing} />
    </>
  )
}

export default function VconeScreen({ context }: ScreenProps) {
  const actions = usePanelActions()
  const choice = resolveRoot(context)
  const symbol = symbolOf(choice.root)
  const ticker = tickerOf(choice.root)
  const [s, set] = useState<Settings>({ view: 'cone', horizon: DEFAULT_HORIZON })
  const coneQuery = useVolCone(symbol)
  const smallQuery = useVolConeUniverse(s.horizon, s.view === 'small')
  const rootRef = useRef<HTMLDivElement>(null)
  // A row button unmounts with the cone view; focus moves to the view toggle, which stays (WCAG 2.4.3).
  const open = (horizon: number) =>
    switchKeepingFocus(rootRef.current, `[role="group"][aria-label="${VCONE.view}"] [aria-pressed="true"]`, () => set({ view: 'small', horizon }))
  useNumbered(actions.panelId, 'vcone-views', [
    { n: NUMBER_CONE, label: VCONE.numberedCone, run: () => set((p) => ({ ...p, view: 'cone' })) },
    { n: NUMBER_SMALL, label: VCONE.numberedSmall, run: () => set((p) => ({ ...p, view: 'small' })) },
  ])
  const onExport = () => {
    if (s.view === 'cone') {
      const cone = coneQuery.data
      exportCsv(csvFileName('vcone', symbol), cone ? coneCsv(cone) : '', cone ? cone.horizons.length : 0)
      return
    }
    const small = smallQuery.data
    exportCsv(csvFileName('vcone', '27F', String(s.horizon)), small ? smallCsv(small) : '', small ? small.rows.length : 0)
  }
  const field = (
    <DropdownField label={VCONE.instrument} value={choice.root} options={INSTRUMENT_OPTIONS} onChange={(r) => (r !== choice.root ? requestLine(`${r} VCONE`) : undefined)} />
  )
  return (
    <div className="mkt vcone" data-screen="VCONE" ref={rootRef}>
      <FunctionBar
        panelId={actions.panelId}
        title={VCONE.title}
        field={field}
        items={[actionsItem(actions), { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport }]}
      />
      <div className="mkt-params">
        <ParamRow label={VCONE.paramLabel}>
          <span className="param-label">{VCONE.view}</span>
          <ToggleGroup
            label={VCONE.view}
            value={s.view}
            onChange={(v) => set({ ...s, view: v as VconeView })}
            options={[{ value: 'cone', label: VCONE.viewCone }, { value: 'small', label: VCONE.viewSmall }]}
          />
          <DropdownField label={VCONE.horizon} value={String(s.horizon)} options={HORIZON_OPTIONS} onChange={(v) => set({ ...s, horizon: Number(v) })} />
          {coneQuery.data ? <ReadOnlyValue label={MARKET.asOf}>{coneQuery.data.as_of}</ReadOnlyValue> : null}
        </ParamRow>
      </div>
      {!choice.known && choice.asked ? (
        <p className="mkt-warn-text vcone-note">{fillCopy(VCONE.notInUniverse, { root: choice.asked, fallback: ticker })}</p>
      ) : null}
      {s.view === 'cone' ? (
        coneQuery.data ? (
          <ConeView cone={coneQuery.data} ticker={ticker} s={s} onOpen={open} panelId={actions.panelId} />
        ) : (
          <QueryStatus loading={coneQuery.isPending} error={coneQuery.error} loadingText={VCONE.loading} failedText={VCONE.failed} />
        )
      ) : smallQuery.data ? (
        <SmallView small={smallQuery.data} panelId={actions.panelId} />
      ) : (
        <QueryStatus loading={smallQuery.isPending} error={smallQuery.error} loadingText={VCONE.smallLoading} failedText={VCONE.smallFailed} />
      )}
    </div>
  )
}

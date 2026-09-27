// CORR: the 27F correlation matrix (TASKS 7.2; look spec 7.8, modelled on a currency rates matrix with
// the 2018 movers heat scale; UI_SPEC 7; ANALYTICS MV5). /api/market/universe gives the windowed and the
// full-sample matrices with their average-linkage order; the Heatmap draws one in that order (or by
// sector), every value printed. The rolling pair panel below is /api/market/pair-corr drawn as a
// LineStack in this panel's link group, so its crosshair follows the group; its last value is set beside
// the matrix entry for the same window. Every price read happens in the backend, through the gate, to
// 2021-12-31; the pair series is cut at the fence once more before drawing. The red bar carries the
// [27F] field and 98) Export (the shown matrix as CSV); 95) Create new is not built (a house choice:
// the universe is the frozen 27F, and a matrix over another set would be a new computation).
import { useId, useMemo, useState } from 'react'
import { usePairCorr, useUniverse } from '../../api/queries'
import { Heatmap } from '../../charts/echarts/Heatmap'
import LineStack from '../../charts/LineStack'
import type { LineStackPane } from '../../charts/LineStack.types'
import { ToggleGroup } from '../../chrome/Field.buttons'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { MARKET } from '../../copy/market'
import UniverseField from '../mon/UniverseField'
import { DEFAULT_WINDOW, WINDOW_OPTIONS, formatCorr, gateText, type Universe } from '../mon/model'
import QueryStatus from '../mon/QueryStatus'
import '../mon/market.css'
import { CORR } from '../../copy/corr'
import { blockOf, corrHeatmapInput, defaultPair, matrixCsv, matrixEntry, pairSeries, rootOf, type CorrMatrix, type CorrOrder, type PairView } from './model'
import './corr.css'

const WINDOW_FIELD_OPTIONS = WINDOW_OPTIONS.map((n) => ({ value: String(n), label: fillCopy(MARKET.windowOption, { n }) }))
const NUMBER_WINDOW = 11
const NUMBER_FULL = 12

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
  readonly window: number
  readonly matrix: CorrMatrix
  readonly order: CorrOrder
  /** The chosen pair; null until the user picks one (the default pair is then shown). */
  readonly pair: readonly [string, string] | null
}

interface ParamsProps {
  readonly s: Settings
  readonly set: (next: Settings) => void
  readonly universe: Universe
  readonly pair: readonly [string, string]
}

function Params({ s, set, universe, pair }: ParamsProps) {
  const symbols = universe.correlation_window.symbols
  const options = symbols.map((sym) => ({ value: sym, label: rootOf(sym) }))
  const pick = (side: 0 | 1, symbol: string) => {
    const other = pair[side === 0 ? 1 : 0]
    const next: [string, string] = side === 0 ? [symbol, other] : [other, symbol]
    set({ ...s, pair: symbol === other ? [next[1], next[0]] : next })
  }
  return (
    <div className="mkt-params">
      <ParamRow label={CORR.paramLabel}>
        <DropdownField label={MARKET.window} value={String(s.window)} options={WINDOW_FIELD_OPTIONS} onChange={(v) => set({ ...s, window: Number(v) })} />
        <span className="param-label">{CORR.matrix}</span>
        <ToggleGroup
          label={CORR.matrix}
          value={s.matrix}
          onChange={(v) => set({ ...s, matrix: v as CorrMatrix })}
          options={[{ value: 'window', label: fillCopy(CORR.matrixWindow, { n: s.window }) }, { value: 'full', label: CORR.matrixFull }]}
        />
        <span className="param-label">{CORR.order}</span>
        <ToggleGroup
          label={CORR.order}
          value={s.order}
          onChange={(v) => set({ ...s, order: v as CorrOrder })}
          options={[{ value: 'clustered', label: CORR.orderClustered }, { value: 'sector', label: CORR.orderSector }]}
        />
        <DropdownField label={CORR.pair} value={pair[0]} options={options} onChange={(v) => pick(0, v)} />
        <DropdownField label={CORR.pairVs} value={pair[1]} options={options} onChange={(v) => pick(1, v)} />
        <ReadOnlyValue label={MARKET.asOf}>{universe.as_of}</ReadOnlyValue>
      </ParamRow>
    </div>
  )
}

function PairPanel({ pair, window, universe, group }: { readonly pair: readonly [string, string]; readonly window: number; readonly universe: Universe; readonly group: ScreenProps['params']['group'] }) {
  const query = usePairCorr(pair[0], pair[1], window)
  const view: PairView | null = useMemo(() => (query.data ? pairSeries(query.data) : null), [query.data])
  const [a, b] = [rootOf(pair[0]), rootOf(pair[1])]
  const series = useMemo(() => fillCopy(CORR.pairTitle, { a, b }), [a, b])
  const panes: LineStackPane[] = useMemo(
    () => (view ? [{ id: 'pair', series: [{ name: series, style: 'rollShort', values: view.values }], zero: 'grey', decimals: 2, signed: true }] : []),
    [view, series],
  )
  const entry = matrixEntry(universe.correlation_window, pair[0], pair[1])
  const headingId = useId()
  return (
    <section className="corr-pair" aria-labelledby={headingId}>
      <h2 id={headingId} className="corr-pair-heading">{fillCopy(CORR.pairHeading, { a, b, n: window })}</h2>
      {view ? (
        <>
          <div className="corr-pair-chart">
            <LineStack title={series} t={view.t} panes={panes} link={group} initialRange="Max" />
          </div>
          <p className="corr-pair-note">
            {view.last
              ? fillCopy(CORR.pairLast, { value: formatCorr(view.last.value), date: view.last.date, n: window, entry: formatCorr(entry) })
              : fillCopy(CORR.pairNoValue, { n: window })}
          </p>
          {view.fenced > 0 ? <p className="corr-pair-note mkt-warn-text">{fillCopy(CORR.pairFenced, { count: view.fenced })}</p> : null}
        </>
      ) : (
        <QueryStatus loading={query.isPending} error={query.error} loadingText={CORR.pairLoading} failedText={CORR.pairFailed} />
      )}
    </section>
  )
}

function Notes({ universe }: { readonly universe: Universe }) {
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{universe.label}</span>
      </p>
      <p>{fillCopy(MARKET.basis, { basis: universe.basis })}</p>
      <p>{CORR.unitsMatrix}</p>
      <p>{`${fillCopy(CORR.unitsSessions, { n: universe.window, asOf: universe.as_of })} ${CORR.scaleNote}`}</p>
      <p className="mkt-gate">{gateText(universe.gate)}</p>
      {universe.missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(MARKET.missing, { symbols: universe.missing.join(', ') })}</p> : null}
    </div>
  )
}

export default function CorrScreen({ params }: ScreenProps) {
  const actions = usePanelActions()
  const [s, set] = useState<Settings>({ window: DEFAULT_WINDOW, matrix: 'window', order: 'clustered', pair: null })
  const query = useUniverse(s.window)
  const universe = query.data
  const heat = useMemo(() => (universe ? corrHeatmapInput(universe, s.matrix, s.order) : null), [universe, s.matrix, s.order])
  const pair = s.pair ?? defaultPair(universe ? blockOf(universe, 'window').symbols : [])
  const onExport = () => {
    if (!heat) {
      exportCsv('corr.csv', '', 0)
      return
    }
    const window = s.matrix === 'window' ? String(s.window) : 'full'
    exportCsv(csvFileName('corr', '27F', window, s.order), matrixCsv(heat), heat.rows.length)
  }
  useNumbered(actions.panelId, 'corr', [
    { n: NUMBER_WINDOW, label: CORR.numberedWindow, run: () => set((p) => ({ ...p, matrix: 'window' })) },
    { n: NUMBER_FULL, label: CORR.numberedFull, run: () => set((p) => ({ ...p, matrix: 'full' })) },
  ])
  return (
    <div className="mkt corr" data-screen="CORR">
      <FunctionBar
        panelId={actions.panelId}
        title={CORR.title}
        field={<UniverseField label={CORR.universeField} />}
        items={[actionsItem(actions), { n: FUNCTION_NUMBERS.export, label: FUNCTION_BAR.export, onRun: onExport }]}
      />
      {universe && heat ? (
        <>
          <Params s={s} set={set} universe={universe} pair={pair} />
          <div className="corr-matrix">
            <Heatmap data={heat} chartId="corr-matrix" />
          </div>
          <PairPanel pair={pair} window={s.window} universe={universe} group={params.group} />
          <Notes universe={universe} />
        </>
      ) : (
        <QueryStatus loading={query.isPending} error={query.error} />
      )}
    </div>
  )
}

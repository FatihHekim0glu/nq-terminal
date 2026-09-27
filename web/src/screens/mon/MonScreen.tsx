// MON: the 27-futures monitor (TASKS 7.2; look spec 7.7, modelled on a futures monitor; UI_SPEC 7;
// ANALYTICS MV4). One GET of /api/market/universe, which serves every price through the OOS gate and
// ends at 2021-12-31. The screen computes nothing: it prints the API values at fixed precision with
// their units, keeps the API's post hoc label and basis verbatim, and names the gate's bookkeeping.
//
// Layout: red bar (the [27F] universe field, 95 Save defaults, 96 Actions, 97 Settings), then the parameter
// row, the grid (with the 2Day sparkline of each row on screen) and the notes. Save defaults keeps the
// view, heat cells and window in this browser only (safeStorage), validated when read back. In a short
// panel (the 2x2 HOME) the parameter row folds away (its settings stay in 97 Settings) and the grid takes
// the whole body, so the row budget of look spec 7 holds; the notes sit under the grid, reached by
// scrolling the body. Enter on a row opens that symbol's functions (GP, GIP, DES, CORR).
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useUniverse } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import { postMessage } from '../../chrome/MessageLine.store'
import { isPlainObject, readJson, safeLocalStorage, writeJson } from '../../state/safeStorage'
import FunctionBar, { type FunctionBarItem } from '../../chrome/FunctionBar'
import { usePanelActions, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import MonitorGrid from '../../grids/MonitorGrid'
import CheckField from './CheckField'
import { monColumns } from './columns'
import { MARKET, MON } from '../../copy/market'
import FunctionsMenu from './FunctionsMenu'
import { DEFAULT_WINDOW, WINDOW_OPTIONS, buildMonRows, gateText, type MonRow, type MonView, type Universe } from './model'
import QueryStatus from './QueryStatus'
import UniverseField from './UniverseField'
import './market.css'

const rowId = (r: MonRow) => r.symbol
const rowLabel = (r: MonRow) => r.root
const groupOf = (r: MonRow) => r.sectorTitle
const WINDOW_FIELD_OPTIONS = WINDOW_OPTIONS.map((n) => ({ value: String(n), label: fillCopy(MARKET.windowOption, { n }) }))
/** The price units column shows from this panel width; a HOME panel (959px) keeps every other column
    without a horizontal scrollbar, which would cost a grid row of the look spec 7 budget. */
const UNITS_MIN_WIDTH = 1100

function useWide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWide(el.getBoundingClientRect().width >= UNITS_MIN_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return wide
}

interface Settings {
  readonly view: MonView
  readonly heat: boolean
  readonly window: number
}

/** Browser storage key of the saved monitor defaults (per viewer, never shared). */
export const MON_DEFAULTS_KEY = 'nqt.mon.defaults'
const FACTORY: Settings = { view: 'returns', heat: false, window: DEFAULT_WINDOW }

function isSettings(value: unknown): value is Settings {
  return (
    isPlainObject(value) &&
    (value.view === 'returns' || value.view === 'normalised') &&
    typeof value.heat === 'boolean' &&
    (WINDOW_OPTIONS as readonly unknown[]).includes(value.window)
  )
}

function savedSettings(): Settings {
  const saved = readJson(safeLocalStorage, MON_DEFAULTS_KEY, isSettings)
  return saved ? { view: saved.view, heat: saved.heat, window: saved.window } : FACTORY
}

function saveItem(s: Settings): FunctionBarItem {
  return {
    n: FUNCTION_NUMBERS.compare,
    label: MON.saveDefaults,
    menu: [
      {
        label: MON.saveDefaults,
        onSelect: () => {
          const ok = writeJson(safeLocalStorage, MON_DEFAULTS_KEY, { view: s.view, heat: s.heat, window: s.window })
          postMessage(
            ok
              ? fillCopy(MON.saveDefaultsDone, { view: s.view === 'returns' ? MON.viewReturns : MON.viewNormalised, heat: s.heat ? MON.heatOnWord : MON.heatOffWord, window: s.window })
              : MON.saveDefaultsFailed,
            ok ? 'info' : 'error',
          )
        },
      },
      { label: MON.resetDefaults, onSelect: () => postMessage(safeLocalStorage.remove(MON_DEFAULTS_KEY) ? MON.resetDefaultsDone : MON.saveDefaultsFailed) },
    ],
  }
}



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

function settingsItem(s: Settings, set: (next: Settings) => void): FunctionBarItem {
  return {
    n: FUNCTION_NUMBERS.settings,
    label: FUNCTION_BAR.settings,
    menu: [
      s.view === 'returns'
        ? { label: MON.showNormalised, onSelect: () => set({ ...s, view: 'normalised' }) }
        : { label: MON.showReturns, onSelect: () => set({ ...s, view: 'returns' }) },
      { label: s.heat ? MON.heatOff : MON.heatOn, onSelect: () => set({ ...s, heat: !s.heat }) },
      ...WINDOW_OPTIONS.filter((n) => n !== s.window).map((n) => ({
        label: fillCopy(MON.windowItem, { n }),
        onSelect: () => set({ ...s, window: n }),
      })),
    ],
  }
}

function Params({ s, set, asOf }: { readonly s: Settings; readonly set: (next: Settings) => void; readonly asOf: string }) {
  return (
    <div className="mkt-params mon-params">
      <ParamRow label={MON.paramLabel}>
        <CheckField label={MON.viewNormalised} checked={s.view === 'normalised'} onChange={(on) => set({ ...s, view: on ? 'normalised' : 'returns' })} />
        <CheckField label={MON.heat} checked={s.heat} onChange={(heat) => set({ ...s, heat })} />
        <DropdownField label={MARKET.window} value={String(s.window)} options={WINDOW_FIELD_OPTIONS} onChange={(v) => set({ ...s, window: Number(v) })} />
        <ReadOnlyValue label={MARKET.asOf}>{asOf}</ReadOnlyValue>
      </ParamRow>
    </div>
  )
}

function Notes({ universe, s, wide }: { readonly universe: Universe; readonly s: Settings; readonly wide: boolean }) {
  const unit = universe.rows[0]?.returns_unit ?? ''
  const sessions = universe.horizons.map((h) => `${h} ${universe.horizon_sessions[h] ?? '--'}`).join(', ')
  return (
    <div className="mkt-notes">
      <p className="mkt-tag">
        <span className="mkt-warn" aria-hidden="true">{MARKET.warnGlyph}</span> <span>{universe.label}</span>
      </p>
      <p>{fillCopy(MARKET.basis, { basis: universe.basis })}</p>
      <p>{s.view === 'returns' ? fillCopy(MON.unitsReturns, { unit, asOf: universe.as_of }) : MON.unitsNormalised}</p>
      {wide ? null : <p>{MON.unitsHidden}</p>}
      <p>{fillCopy(MON.unitsRisk, { window: universe.window })}</p>
      <p>{fillCopy(MON.horizons, { list: sessions })}</p>
      {s.heat ? <p>{MON.heatNote}</p> : null}
      <p>{fillCopy(MON.twoDayNote, { last: universe.as_of })}</p>
      <p className="mkt-gate">{gateText(universe.gate)}</p>
      {universe.missing.length > 0 ? <p className="mkt-warn-text">{fillCopy(MARKET.missing, { symbols: universe.missing.join(', ') })}</p> : null}
    </div>
  )
}

export default function MonScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const [s, set] = useState<Settings>(savedSettings)
  const [drill, setDrill] = useState<MonRow | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root)
  const query = useUniverse(s.window)
  const universe = query.data
  const rows = useMemo(() => (universe ? buildMonRows(universe, s.view) : []), [universe, s.view])
  const horizons = universe?.horizons
  const columns = useMemo(() => monColumns(horizons ?? [], s.view, s.heat, wide), [horizons, s.view, s.heat, wide])
  const closeDrill = () => {
    setDrill(null)
    root.current?.querySelector<HTMLElement>('[role="grid"]')?.focus()
  }
  const run = (line: string) => {
    setDrill(null)
    requestLine(line, false)
  }
  return (
    <div ref={root} className="mkt mon" data-screen="MON">
      <FunctionBar panelId={actions.panelId} title={MON.title} field={<UniverseField label={MON.universeField} />} items={[saveItem(s), actionsItem(actions), settingsItem(s, set)]} />
      {universe ? (
        <>
          <Params s={s} set={set} asOf={universe.as_of} />
          <div className="mkt-grid">
            <MonitorGrid label={MON.gridLabel} rows={rows} columns={columns} rowId={rowId} rowLabel={rowLabel} groupOf={groupOf} onOpen={setDrill} scroll="panel" />
          </div>
          <Notes universe={universe} s={s} wide={wide} />
        </>
      ) : (
        <QueryStatus loading={query.isPending} error={query.error} />
      )}
      {drill ? <FunctionsMenu panelId={actions.panelId} root={drill.root} ticker={drill.ticker} onRun={run} onClose={closeDrill} /> : null}
    </div>
  )
}
